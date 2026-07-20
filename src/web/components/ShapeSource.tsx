import { type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, GeoJSONSourceSpecification, Map } from 'mapbox-gl';

import MapContext from '../MapContext';
import SourceContext from '../SourceContext';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

type ShapeSourceProps = {
  id: string;
  shape?:
    | GeoJSON.GeometryCollection
    | GeoJSON.Feature
    | GeoJSON.FeatureCollection
    | GeoJSON.Geometry;
  /**
   * Cluster options are applied at source creation only on web; changing them
   * after mount has no effect (mapbox-gl geojson sources cannot be
   * reconfigured in place).
   */
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoomLevel?: number;
  clusterProperties?: Record<string, unknown>;
  maxZoomLevel?: number;
  buffer?: number;
  tolerance?: number;
  lineMetrics?: boolean;
  children?: ReactNode;
};

const isMapUsable = (map: Map): boolean => {
  // getStyle() returns undefined after map.remove(); guards cleanups that run
  // after the MapView already tore the map down (parent-before-child order)
  try {
    return !!map.getStyle();
  } catch {
    return false;
  }
};

/**
 * Declarative GeoJSON source for the web map. Children (layer components) are
 * rendered only after the source exists so their addLayer calls always find
 * it; the `ready` flag never flips back because MapView recreates the map on
 * WebGL context loss WITHOUT remounting children - re-attachment happens via
 * the map identity changing in MapContext plus idempotent styledata re-ensures.
 */
function ShapeSource(props: ShapeSourceProps) {
  const { map } = useContext(MapContext);
  const { id, shape } = props;

  const [ready, setReady] = useState(false);

  // Latest values for the ensure path without re-running the main effect
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!map) return;

    const ensure = () => {
      if (!isMapUsable(map) || !map.isStyleLoaded()) return;
      const source = map.getSource(id) as GeoJSONSource | undefined;
      const data = propsRef.current.shape ?? EMPTY_FC;
      if (!source) {
        const current = propsRef.current;
        const spec: GeoJSONSourceSpecification = {
          type: 'geojson',
          data,
          ...(current.cluster !== undefined && { cluster: current.cluster }),
          ...(current.clusterRadius !== undefined && {
            clusterRadius: current.clusterRadius,
          }),
          ...(current.clusterMaxZoomLevel !== undefined && {
            clusterMaxZoom: current.clusterMaxZoomLevel,
          }),
          ...(current.clusterProperties !== undefined && {
            clusterProperties: current.clusterProperties,
          }),
          ...(current.maxZoomLevel !== undefined && {
            maxzoom: current.maxZoomLevel,
          }),
          ...(current.buffer !== undefined && { buffer: current.buffer }),
          ...(current.tolerance !== undefined && {
            tolerance: current.tolerance,
          }),
          ...(current.lineMetrics !== undefined && {
            lineMetrics: current.lineMetrics,
          }),
        };
        map.addSource(id, spec);
      } else {
        source.setData(data);
      }
      setReady(true);
    };

    // styledata covers: initial style load, setStyle wipes, and the first
    // ensure after WebGL recovery (this effect re-runs on the new map identity)
    map.on('styledata', ensure);
    ensure();

    return () => {
      map.off('styledata', ensure);
      if (!isMapUsable(map)) return;
      try {
        // Remove dependent layers first: this cleanup can run BEFORE child
        // layer cleanups during subtree teardown, and mapbox-gl refuses to
        // remove a source that layers still reference
        for (const layer of map.getStyle()?.layers ?? []) {
          if ('source' in layer && layer.source === id) {
            map.removeLayer(layer.id);
          }
        }
        if (map.getSource(id)) {
          map.removeSource(id);
        }
      } catch {
        // Map or style already gone; nothing to clean
      }
    };
  }, [map, id]);

  // Data updates outside the ensure path
  useEffect(() => {
    if (!map || !isMapUsable(map)) return;
    const source = map.getSource(id) as GeoJSONSource | undefined;
    source?.setData(shape ?? EMPTY_FC);
  }, [map, id, shape]);

  if (!ready) return null;
  return (
    <SourceContext.Provider value={{ sourceID: id }}>
      {props.children}
    </SourceContext.Provider>
  );
}

export default ShapeSource;
