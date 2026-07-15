import React from 'react';
import mapboxgl, { type MapMouseEvent, type LngLatLike } from 'mapbox-gl';

import type { Position } from '../../types/Position';
import MapContext from '../MapContext';
import * as RNMapView from '../../components/MapView';

/**
 * MapView backed by Mapbox GL KS
 */
type styleURLProps = { styleURL: string };

interface LayerColorState {
  layerId: string;
  property: string;
  originalValue: any;
}

class MapView extends React.Component<
  RNMapView.default & {
    styleURL: string;
    children: React.JSX.Element;
    onPress: (e: GeoJSON.Feature) => void;
    onCameraChanged: (e: RNMapView.MapState) => void;
    onMapIdle: (e: RNMapView.MapState) => void;
    onWillStartLoadingMap?: () => void;
    onDidFinishLoadingMap?: () => void;
    _setStyleURL: (props: styleURLProps) => void;
    setMonochrome: (enabled: boolean) => void;
    recoverOnContextLost?: boolean;
  } & {
    map?: mapboxgl.Map | null;
  }
> {
  state = { map: null };
  mapContainer: HTMLElement | null = null;
  map: mapboxgl.Map | null = null;
  originalLandColors: LayerColorState[] = [];
  colorOperationInProgress = false;
  // rAF throttling for camera updates
  _rafId: number | null = null;
  _pendingMove = false;
  // Bound visibility handler for cleanup
  _onVisibilityChange: (() => void) | null = null;
  // Pre-allocated state objects to avoid per-frame GC pressure
  _moveState: RNMapView.MapState = {
    properties: { center: [0, 0], zoom: 0, pitch: 0, heading: 0, bounds: { ne: [0, 0], sw: [0, 0] } },
    gestures: { isGestureActive: false },
  };
  // Stable context value to avoid re-rendering children unnecessarily
  _contextValue: { map?: mapboxgl.Map } = {};
  // WebGL context-loss recovery state
  _contextLost = false;
  _graceTimer: number | null = null;
  _retryTimer: number | null = null;
  _recreateAttempts = 0;
  _pendingRecreateOpts: Partial<mapboxgl.MapOptions> | null = null;
  _lastLandColor: string | null = null;

  // Give the browser a chance to fire webglcontextrestored (mapbox-gl fully
  // self-heals on it) before recreating the map ourselves.
  static RECOVERY_GRACE_MS = 1500;
  // In-place recreation attempts before falling back to a full page reload.
  static RECOVERY_MAX_ATTEMPTS = 3;
  // Backoff between failed creation attempts: 1s, 2s, 4s.
  static RECOVERY_BACKOFF_MS = 1000;

  componentDidMount() {
    if (!this.mapContainer) {
      console.error('MapView - mapContainer should is null');
      return;
    }

    if (this.props.recoverOnContextLost) {
      // Registered once for the component lifetime, not per map instance,
      // so recreation never stacks duplicate listeners.
      this._onVisibilityChange = this._handleVisibilityChange;
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    this._tryCreateMap();
  }

  _createMap = (cameraOpts?: Partial<mapboxgl.MapOptions>) => {
    const { styleURL } = this.props;
    if (!this.mapContainer) {
      throw new Error('MapView - mapContainer is null');
    }

    const map = new mapboxgl.Map({
      container: this.mapContainer,
      style: styleURL || 'mapbox://styles/mapbox/streets-v12',
      maxPitch: 60,
      antialias: false,
      ...cameraOpts,
    });

    /* eslint-disable dot-notation */
    map.touchZoomRotate['_tapDragZoom']['_enabled'] = false;

    if (this.props.recoverOnContextLost) {
      map.on('webglcontextlost', () => {
        console.log('MapView: webgl context lost, waiting for restore.');
        this._contextLost = true;
        this._scheduleRecovery();
      });
      map.on('webglcontextrestored', () => {
        // mapbox-gl recreated its painter and repaints on its own; stand down.
        this._contextLost = false;
        this._clearTimers();
        this._recreateAttempts = 0;
      });
    }

    map.on('mousedown', (e: MapMouseEvent) => {
      // @ts-expect-error - classList is actually present, TypeScript lies.
      if (!e.originalEvent.target.classList.contains('mapboxgl-canvas')) {
        return;
      }

      const point: GeoJSON.Feature<GeoJSON.Point> = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [e.lngLat.lng, e.lngLat.lat],
        },
        properties: {},
      };
      this.handleMapPress(point);
    });

    // Full state snapshot — only used for idle (includes expensive getBounds)
    const fullMapState = (): RNMapView.MapState => {
      const c = map.getCenter();
      const b = map.getBounds()!;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      return {
        properties: {
          center: [c.lng, c.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          heading: map.getBearing(),
          bounds: { ne: [ne.lng, ne.lat], sw: [sw.lng, sw.lat] },
        },
        gestures: { isGestureActive: false },
      };
    };

    // Throttle camera updates to animation frames — reuse pre-allocated object
    const onMove = () => {
      this._pendingMove = true;
      if (this._rafId == null) {
        this._rafId = window.requestAnimationFrame(() => {
          this._rafId = null;
          if (this._pendingMove) {
            this._pendingMove = false;
            // Mutate pre-allocated state in-place — no allocations
            const c = map.getCenter();
            const props = this._moveState.properties;
            (props.center as number[])[0] = c.lng;
            (props.center as number[])[1] = c.lat;
            props.zoom = map.getZoom();
            props.pitch = map.getPitch();
            props.heading = map.getBearing();
            this.handleCameraChanged(this._moveState);
          }
        });
      }
    };

    map.on('move', onMove);
    map.on('idle', () => this.handleMapOnIdle(fullMapState()));
    // Use styledataloading to avoid repeated styledata storms
    map.on('styledataloading', () => {
      const { onWillStartLoadingMap } = this.props;
      if (onWillStartLoadingMap) {
        onWillStartLoadingMap();
      }
    });

    map.on('load', () => {
      const { onDidFinishLoadingMap } = this.props;
      if (onDidFinishLoadingMap) {
        onDidFinishLoadingMap();
      }
    });

    this.map = map;
    this._contextValue = { map };
    this.setState({ map });
  };

  _isContextLost(): boolean {
    if (!this.map) return false;
    const canvas = this.map.getCanvas();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return !gl || gl.isContextLost();
  }

  _scheduleRecovery = () => {
    if (this._graceTimer != null) return;
    this._graceTimer = window.setTimeout(() => {
      this._graceTimer = null;
      this._recoverIfNeeded();
    }, MapView.RECOVERY_GRACE_MS);
  };

  _recoverIfNeeded = () => {
    if (this._pendingRecreateOpts) {
      this._tryCreateMap();
      return;
    }
    if (!this.map) return;
    if (!this._contextLost && !this._isContextLost()) return;
    if (document.visibilityState !== 'visible') return;

    console.log('MapView: webgl context not restored, recreating map.');
    // CPU-side transform state, still valid on a lost context. min/max zoom
    // must be baked into the constructor because Camera applies them only in
    // componentDidMount and children do not remount on recovery.
    const center = this.map.getCenter();
    this._pendingRecreateOpts = {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
      minZoom: this.map.getMinZoom(),
      maxZoom: this.map.getMaxZoom(),
    };
    try {
      this.map.remove();
    } catch {}
    this.map = null;
    // Captured from the dead style; recaptured fresh after recreation.
    this.originalLandColors = [];
    this.colorOperationInProgress = false;
    this._tryCreateMap();
  };

  _tryCreateMap = () => {
    // Browsers may refuse to create a WebGL context for a hidden tab; the
    // visibilitychange handler re-enters once the tab is visible again.
    if (document.visibilityState !== 'visible' && this._pendingRecreateOpts)
      return;
    try {
      this._createMap(this._pendingRecreateOpts ?? undefined);
      this._pendingRecreateOpts = null;
      this._contextLost = false;
      this._recreateAttempts = 0;
      if (this._lastLandColor) {
        this.setLandColor(this._lastLandColor);
      }
    } catch (e) {
      if (!this.props.recoverOnContextLost) throw e;
      console.warn('MapView: map creation failed, will retry.', e);
      this._recreateAttempts += 1;
      if (this._recreateAttempts >= MapView.RECOVERY_MAX_ATTEMPTS) {
        window.location.reload();
        return;
      }
      const delay =
        MapView.RECOVERY_BACKOFF_MS * 2 ** (this._recreateAttempts - 1);
      this._retryTimer = window.setTimeout(() => {
        this._retryTimer = null;
        this._tryCreateMap();
      }, delay);
    }
  };

  _handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (this._pendingRecreateOpts || !this.map) {
      this._tryCreateMap();
      return;
    }
    if (this._contextLost || this._isContextLost()) {
      this._scheduleRecovery();
      return;
    }
    // Context alive but tiles may be stale — force repaint
    this.map.resize();
    this.map.triggerRepaint();
  };

  _clearTimers = () => {
    if (this._graceTimer != null) {
      window.clearTimeout(this._graceTimer);
      this._graceTimer = null;
    }
    if (this._retryTimer != null) {
      window.clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  };

  componentWillUnmount() {
    this._clearTimers();
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this._rafId != null) {
      try {
        cancelAnimationFrame(this._rafId);
      } catch { }
      this._rafId = null;
    }
    if (this.map) {
      try {
        this.map.remove();
      } catch { }
      this.map = null;
    }
  }

  _setStyleURL = (props: styleURLProps) => {
    if (this.map && props.styleURL && this.map.isStyleLoaded()) {
      this.map.setStyle(props.styleURL);
    }
  };

  colorLand = (baseColor: string) => {
    if (!this.map) return;

    if (this.colorOperationInProgress) {
      return;
    }

    this.colorOperationInProgress = true;

    const hexToRgb = (hex: string) => {
      hex = hex.replace(/^#/, '');
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return { r, g, b };
    };

    const adjustBrightness = (hex: string, factor: number) => {
      const { r, g, b } = hexToRgb(hex);
      const adjustR = Math.min(255, Math.max(0, Math.round(r * factor)));
      const adjustG = Math.min(255, Math.max(0, Math.round(g * factor)));
      const adjustB = Math.min(255, Math.max(0, Math.round(b * factor)));
      return `#${adjustR.toString(16).padStart(2, '0')}${adjustG.toString(16).padStart(2, '0')}${adjustB.toString(16).padStart(2, '0')}`;
    };

    const layerConfig = {
      'land': { factor: 1.0 },
      'landcover': { factor: 0.95 },
      'national-park': { factor: 0.9 },
      'landuse': { factor: 1.05 },
      'hillshade': { factor: 0.85 },
      'land-structure-polygon': { factor: 1.1 },
      'land-structure-line': { factor: 0.75 }
    };

    const landLayerIds = Object.keys(layerConfig);

    const captureOriginalColors = this.originalLandColors.length === 0;

    landLayerIds.forEach(layerId => {
      if (!this.map) return;
      const layer = this.map.getStyle().layers.find(l => l.id === layerId);
      if (!layer) return;

      const { factor } = layerConfig[layerId as keyof typeof layerConfig];
      const shadeColor = adjustBrightness(baseColor, factor);

      if (layer.type === 'background') {
        if (captureOriginalColors) {
          const originalValue = this.map.getPaintProperty(layerId, 'background-color');
          this.originalLandColors.push({
            layerId,
            property: 'background-color',
            originalValue
          });
        }
        this.map.setPaintProperty(layerId, 'background-color', shadeColor);
      }
      else if (layer.type === 'fill') {
        if (captureOriginalColors) {
          const originalValue = this.map.getPaintProperty(layerId, 'fill-color');
          this.originalLandColors.push({
            layerId,
            property: 'fill-color',
            originalValue
          });
        }
        this.map.setPaintProperty(layerId, 'fill-color', shadeColor);

        const outlineColor = this.map?.getPaintProperty(layerId, 'fill-outline-color');
        if (outlineColor) {
          if (captureOriginalColors) {
            this.originalLandColors.push({
              layerId,
              property: 'fill-outline-color',
              originalValue: outlineColor
            });
          }
          this.map.setPaintProperty(layerId, 'fill-outline-color', adjustBrightness(shadeColor, 0.8));
        }
      }
      else if (layer.type === 'line') {
        if (captureOriginalColors) {
          const originalColor = this.map?.getPaintProperty(layerId, 'line-color');
          this.originalLandColors.push({
            layerId,
            property: 'line-color',
            originalValue: originalColor
          });
        }
        this.map.setPaintProperty(layerId, 'line-color', shadeColor);
      }
    });

    this.colorOperationInProgress = false;
  }

  resetLandColors = () => {
    if (!this.map || this.originalLandColors.length === 0) return;

    this.originalLandColors.forEach(item => {
      if (this.map?.getLayer(item.layerId)) {
        (this.map as any).setPaintProperty(item.layerId, item.property, item.originalValue);
      }
    });
  }

  setLandColor = (color: string) => {
    if (!this.map || !this.mapContainer) return;
    // Remembered so context-loss recovery can re-tint the recreated map.
    this._lastLandColor = color;

    if (!this.map.isStyleLoaded()) {
      const styleLoadListener = () => {
        this.colorLand(color);
        this.map?.off('styledata', styleLoadListener);
      };
      this.map.on('styledata', styleLoadListener);
      return;
    }

    this.colorLand(color);
  };

  resetLandColor = () => {
    this._lastLandColor = null;
    if (!this.map || !this.mapContainer || this.originalLandColors.length === 0) return;
    this.resetLandColors();

    this.originalLandColors = [];
  };

  setMonochrome = (enabled: boolean) => {
    if (!this.map || !this.mapContainer) return;
    this.applyMonochromeFilter(enabled);
  };

  applyMonochromeFilter(enable: boolean) {
    const mapCanvas = this.mapContainer?.querySelector('.mapboxgl-canvas');
    if (!mapCanvas || !(mapCanvas instanceof HTMLElement)) return;

    if (enable) {
      mapCanvas.style.filter = 'grayscale(1) brightness(1.1) contrast(0.9)';
      mapCanvas.style.transition = 'filter 0.2s ease';
    } else {
      mapCanvas.style.filter = 'none';
    }
  }

  handleMapPress(e: GeoJSON.Feature<GeoJSON.Point>) {
    const { onPress } = this.props;
    if (onPress) {
      onPress(e);
    }
  }

  handleCameraChanged(e: RNMapView.MapState) {
    const { onCameraChanged } = this.props;
    if (onCameraChanged) {
      onCameraChanged(e);
    }
  }

  handleMapOnIdle(e: RNMapView.MapState) {
    const { onMapIdle } = this.props;
    if (onMapIdle) {
      onMapIdle(e);
    }
  }

  getZoom(): number | undefined {
    return this.map?.getZoom();
  }

  getPointInView(coordinate: Position): Promise<Position> {
    return new Promise((resolve) => {
      if (!this.map) {
        resolve([0, 0]);
        return;
      }
      const point = this.map.project(coordinate as LngLatLike);
      resolve([point.x, point.y]);
    });
  }

  render() {
    const { children } = this.props;
    const { map } = this.state;
    return (
      <div
        style={{ width: '100%', height: '100%' }}
        ref={(el) => {
          this.mapContainer = el;
        }}
      >
        {map && (
          <div style={{ position: 'absolute' }}>
            <MapContext.Provider value={this._contextValue}>
              {children}
            </MapContext.Provider>
          </div>
        )}
      </div>
    );
  }
}

export default MapView;
