import { useContext, useEffect, useRef } from 'react';
import type { LayerSpecification, Map } from 'mapbox-gl';

import MapContext from '../MapContext';
import SourceContext from '../SourceContext';
import {
  diffApplyStyle,
  splitLayerStyle,
  type SplitStyle,
  type WebLayerType,
} from '../utils/layerStyle';
import type { FilterExpression } from '../../utils/MapboxStyles';

export type WebLayerProps = {
  id: string;
  /** Defaults to the enclosing ShapeSource's id. */
  sourceID?: string;
  filter?: FilterExpression;
  minZoomLevel?: number;
  maxZoomLevel?: number;
  /** Maps onto mapbox-gl addLayer's beforeId. */
  belowLayerID?: string;
  /** Accepted for native API parity; not supported on web (warned once). */
  aboveLayerID?: string;
  /** Accepted for native API parity; not supported on web (warned once). */
  layerIndex?: number;
  style?: Record<string, unknown>;
};

const isMapUsable = (map: Map): boolean => {
  try {
    return !!map.getStyle();
  } catch {
    return false;
  }
};

const warnedProps = new Set<string>();
const warnUnsupportedProp = (layerId: string, prop: string) => {
  const key = `${layerId}:${prop}`;
  if (warnedProps.has(key)) return;
  warnedProps.add(key);
  console.warn(
    `Mapbox [web]: layer prop "${prop}" is not supported on web (layer "${layerId}"); web layer order follows mount order, use belowLayerID for explicit placement`,
  );
};

/**
 * Shared web layer lifecycle: idempotent add keyed on the context map identity
 * (so layers survive WebGL recovery, where the map is recreated but children
 * do not remount), styledata re-ensure for setStyle wipes, and per-key style
 * diffing so animated style props cost one property call per change.
 */
export const useWebLayer = (type: WebLayerType, props: WebLayerProps): void => {
  const { map } = useContext(MapContext);
  const { sourceID: contextSourceID } = useContext(SourceContext);
  const { id, style, filter, minZoomLevel, maxZoomLevel } = props;
  const source = props.sourceID ?? contextSourceID;

  const propsRef = useRef(props);
  propsRef.current = props;
  const appliedStyleRef = useRef<SplitStyle | null>(null);

  useEffect(() => {
    if (!map || !source) return;

    const ensure = () => {
      if (!isMapUsable(map) || !map.isStyleLoaded()) return;
      // The parent source may land a beat later (styledata retriggers this),
      // and after recovery the new map starts empty
      if (!map.getSource(source)) return;
      if (map.getLayer(id)) return;

      const current = propsRef.current;
      if (current.aboveLayerID !== undefined) {
        warnUnsupportedProp(id, 'aboveLayerID');
      }
      if (current.layerIndex !== undefined) {
        warnUnsupportedProp(id, 'layerIndex');
      }

      const split = splitLayerStyle(type, current.style);
      const spec = {
        id,
        type,
        source,
        layout: split.layout,
        paint: split.paint,
        ...(current.filter !== undefined && { filter: current.filter }),
        ...(current.minZoomLevel !== undefined && {
          minzoom: current.minZoomLevel,
        }),
        ...(current.maxZoomLevel !== undefined && {
          maxzoom: current.maxZoomLevel,
        }),
      } as LayerSpecification;
      map.addLayer(spec, current.belowLayerID);
      appliedStyleRef.current = split;
    };

    map.on('styledata', ensure);
    ensure();

    return () => {
      map.off('styledata', ensure);
      if (!isMapUsable(map)) return;
      try {
        // Already gone when the parent ShapeSource cleaned up first
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
      } catch {
        // Map or style already gone
      }
      appliedStyleRef.current = null;
    };
  }, [map, source, id, type]);

  // Per-key style diff; the hot path for animated props
  useEffect(() => {
    if (!map || !isMapUsable(map) || !map.getLayer(id)) return;
    const split = splitLayerStyle(type, style);
    diffApplyStyle(map, id, appliedStyleRef.current, split);
    appliedStyleRef.current = split;
  }, [map, id, type, style]);

  useEffect(() => {
    if (!map || !isMapUsable(map) || !map.getLayer(id)) return;
    // rnmapbox FilterExpression is a readonly tuple; mapbox-gl wants a mutable
    // FilterSpecification - structurally compatible at runtime
    map.setFilter(id, filter as unknown as Parameters<Map['setFilter']>[1]);
  }, [map, id, filter]);

  useEffect(() => {
    if (!map || !isMapUsable(map) || !map.getLayer(id)) return;
    if (minZoomLevel === undefined && maxZoomLevel === undefined) return;
    map.setLayerZoomRange(id, minZoomLevel ?? 0, maxZoomLevel ?? 24);
  }, [map, id, minZoomLevel, maxZoomLevel]);
};
