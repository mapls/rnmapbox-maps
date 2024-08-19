import React from 'react';
import mapboxgl, { type MapMouseEvent } from 'mapbox-gl';

import MapContext from '../MapContext';
import * as RNMapView from '../../components/MapView';

/**
 * MapView backed by Mapbox GL KS
 */
class MapView extends React.Component<
  RNMapView.default & {
    styleURL: string;
    children: JSX.Element;
    onPress: (e: GeoJSON.Feature) => void;
    onCameraChanged: (e: RNMapView.MapState) => void;
  } & {
    map?: object | null;
  }
> {
  state = { map: null };
  mapContainer: HTMLElement | null = null;
  map: object | null = null;

  componentDidMount() {
    const { styleURL } = this.props;
    if (!this.mapContainer) {
      console.error('MapView - mapContainer should is null');
      return;
    }
    const map = new mapboxgl.Map({
      container: this.mapContainer,
      style: styleURL || 'mapbox://styles/mapbox/streets-v11',
    });

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

    map.on('move', () => {
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
      this.handleCameraChanged(state);
    });

    this.map = map;
    this.setState({ map });
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

  render() {
    const { children } = this.props;
    const { map } = this.state;
    return (
      <div
        style={{ width: '100%', height: '100%' }}
        ref={(el) => (this.mapContainer = el)}
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
