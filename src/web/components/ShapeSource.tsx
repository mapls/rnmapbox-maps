import { type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, GeoJSONSourceSpecification, Map } from 'mapbox-gl';

import MapContext from '../MapContext';
import SourceContext from '../SourceContext';
import {
  isTransientStyleError,
  warnAttachErrorOnce,
  warnUnsupportedPropOnce,
} from '../utils/attachWarning';

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
  /** Accepted for native API parity; not supported on web (warned once). */
  url?: string;
  /** Accepted for native API parity; not supported on web (warned once). */
  existing?: boolean;
  /** Accepted for native API parity; not supported on web (warned once). */
  onPress?: (event: unknown) => void;
  /** Accepted for native API parity; not supported on web (warned once). */
  hitbox?: { width: number; height: number };
  children?: ReactNode;
};

const UNSUPPORTED_PROPS = ['url', 'existing', 'onPress', 'hitbox'] as const;

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
  // Last GeoJSON handed to mapbox-gl (via addSource or setData); lets the data
  // effect skip the redundant re-upload right after ensure() created the source
  const lastUploadedDataRef = useRef<unknown>(null);

  useEffect(() => {
    if (!map) return;

    for (const prop of UNSUPPORTED_PROPS) {
      if (propsRef.current[prop] !== undefined) {
        warnUnsupportedPropOnce(id, prop, 'it is ignored on the web map');
      }
    }

    const ensure = () => {
      if (!isMapUsable(map)) return;
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (source) {
        // Already attached: never setData here. These listeners stay
        // subscribed for style-wipe re-adds, and a setData on idle triggers a
        // repaint that ends in another idle - a self-sustaining loop
        // re-uploading the GeoJSON forever. Data updates live in the
        // dedicated shape effect below.
        setReady(true);
        return;
      }
      const data = propsRef.current.shape ?? EMPTY_FC;
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
      try {
        map.addSource(id, spec);
      } catch (e) {
        // Style JSON not parsed yet; the styledata/idle listeners retry.
        // Deliberately NOT gated on isStyleLoaded(): that flag flips false on
        // every style mutation (including our own addSource) and the final
        // styledata of a load burst can leave it false with no further
        // styledata coming - gating on it deadlocks the whole attach chain.
        // Anything other than the transient not-loaded error is surfaced
        // once, or a bad spec would retry silently forever
        if (!isTransientStyleError(e)) warnAttachErrorOnce('source', id, e);
        return;
      }
      lastUploadedDataRef.current = data;
      setReady(true);
    };

    // styledata covers initial style load, setStyle wipes, and the first ensure
    // after WebGL recovery (this effect re-runs on the new map identity); idle
    // is the safety net that closes any styledata-burst deadlock window
    map.on('styledata', ensure);
    map.on('idle', ensure);
    ensure();

    return () => {
      map.off('styledata', ensure);
      map.off('idle', ensure);
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
    if (!source) return;
    const data = shape ?? EMPTY_FC;
    // Same object ensure() just uploaded via addSource; skip the redundant
    // full re-upload on mount and after style-wipe re-adds
    if (data === lastUploadedDataRef.current) return;
    lastUploadedDataRef.current = data;
    source.setData(data);
  }, [map, id, shape]);

  if (!ready) return null;
  return (
    <SourceContext.Provider value={{ sourceID: id }}>
      {props.children}
    </SourceContext.Provider>
  );
}

export default ShapeSource;
