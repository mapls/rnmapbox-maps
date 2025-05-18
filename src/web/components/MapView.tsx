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
    children: JSX.Element;
    onPress: (e: GeoJSON.Feature) => void;
    onCameraChanged: (e: RNMapView.MapState) => void;
    onMapIdle: (e: RNMapView.MapState) => void;
    _setStyleURL: (props: styleURLProps) => void;
    setMonochrome: (enabled: boolean) => void;
  } & {
    map?: mapboxgl.Map | null;
  }
> {
  state = { map: null, isMonochrome: false };
  mapContainer: HTMLElement | null = null;
  map: mapboxgl.Map | null = null;
  originalLandColors: LayerColorState[] = [];

  componentDidMount() {
    const { styleURL } = this.props;
    if (!this.mapContainer) {
      console.error('MapView - mapContainer should is null');
      return;
    }

    const map = new mapboxgl.Map({
      container: this.mapContainer,
      style: styleURL || 'mapbox://styles/mapbox/streets-v12',
      maxPitch: 60,
    });

    /* eslint-disable dot-notation */
    // @ts-expect-error - Do not modify
    map.touchZoomRotate['_tapDragZoom']['_enabled'] = false;

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

    const currentMapState = () => {
      // @ts-expect-error - Partially implement for now.
      const state: RNMapView.MapState = {
        properties: {
          center: [map.getCenter().lng, map.getCenter().lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          heading: map.getBearing(),
          bounds: {
            ne: map.getBounds()?.getNorthEast().toArray() ?? [0, 0],
            sw: map.getBounds()?.getSouthWest().toArray() ?? [0, 0],
          },
        },
      };

      return state;
    };

    map.on('move', () => this.handleCameraChanged(currentMapState()));
    map.on('idle', () => this.handleMapOnIdle(currentMapState()));

    this.map = map;
    this.setState({ map });
  }

  _setStyleURL = (props: styleURLProps) => {
    if (this.map && props.styleURL && this.map.isStyleLoaded()) {
      this.map.setStyle(props.styleURL);
    }
  };

  colorLand = (color: string) => {
    if (!this.map) return;

    const landLayerIds = [
      'land',
      'landcover',
      'national-park',
      'landuse',
      'hillshade',
      'land-structure-polygon',
      'land-structure-line'
    ];

    landLayerIds.forEach(layerId => {
      if (!this.map) return;
      const layer = this.map.getStyle().layers.find(l => l.id === layerId);
      if (!layer) return;

      if (layer.type === 'background') {
        const originalValue = this.map.getPaintProperty(layerId, 'background-color');
        this.originalLandColors.push({
          layerId,
          property: 'background-color',
          originalValue
        });
        this.map.setPaintProperty(layerId, 'background-color', color);
      }
      else if (layer.type === 'fill') {
        const originalValue = this.map.getPaintProperty(layerId, 'fill-color');
        this.originalLandColors.push({
          layerId,
          property: 'fill-color',
          originalValue
        });
        this.map.setPaintProperty(layerId, 'fill-color', color);

        const outlineColor = this.map?.getPaintProperty(layerId, 'fill-outline-color');
        if (outlineColor) {
          this.originalLandColors.push({
            layerId,
            property: 'fill-outline-color',
            originalValue: outlineColor
          });
          this.map.setPaintProperty(layerId, 'fill-outline-color', color);
        }
      }
      else if (layer.type === 'line') {
        const originalColor = this.map?.getPaintProperty(layerId, 'line-color');
        this.originalLandColors.push({
          layerId,
          property: 'line-color',
          originalValue: originalColor
        });
        this.map.setPaintProperty(layerId, 'line-color', color);
      }
    });
  }

  resetLandColors = () => {
    if (!this.map || this.originalLandColors.length === 0) return;

    this.originalLandColors.forEach(item => {
      if (this.map?.getLayer(item.layerId)) {
        (this.map as any).setPaintProperty(item.layerId, item.property, item.originalValue);
      }
    });

    this.originalLandColors = [];
  }

  setLandColor = (color: string) => {
    if (!this.map || !this.mapContainer) return;

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
    if (!this.map || !this.mapContainer || this.originalLandColors.length === 0) return;

    this.resetLandColors();
  };

  setMonochrome = (enabled: boolean) => {
    if (!this.map || !this.mapContainer) return;

    this.setState({ isMonochrome: enabled });
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
            <MapContext.Provider value={{ map }}>
              {children}
            </MapContext.Provider>
          </div>
        )}
      </div>
    );
  }
}

export default MapView;
