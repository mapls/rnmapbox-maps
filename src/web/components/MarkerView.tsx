import {
  forwardRef,
  isValidElement,
  memo,
  type ReactElement,
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import type { ViewStyle } from 'react-native';

import MapContext from '../MapContext';
import type { ManagedMarker, MarkerAnchor } from '../MarkerManager';

type MarkerViewProps = {
  coordinate: [number, number];
  anchor?: { x: number; y: number };
  children?: ReactElement;
  style?: ViewStyle;
  className?: string;
};

/** Minimal imperative surface, API-compatible subset of mapboxgl.Marker. */
export type MarkerViewRef = {
  getElement: () => HTMLElement;
  getLngLat: () => { lng: number; lat: number } | undefined;
  setLngLat: (lngLat: [number, number]) => void;
};

const xyToAnchorPoint = ({ x, y }: { x: number; y: number }): MarkerAnchor => {
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error('Invalid anchor point');
  }

  // Center
  if (x >= 0.4 && x <= 0.6 && y >= 0.4 && y <= 0.6) {
    return 'center';
  }

  // Top
  if (x >= 0.4 && x <= 0.6 && y <= 0.1) {
    return 'top';
  }

  // Bottom
  if (x >= 0.4 && x <= 0.6 && y >= 0.9) {
    return 'bottom';
  }

  // Left
  if (x <= 0.1 && y >= 0.4 && y <= 0.6) {
    return 'left';
  }

  // Right
  if (x >= 0.9 && y >= 0.4 && y <= 0.6) {
    return 'right';
  }

  // Top-left
  if (x <= 0.1 && y <= 0.1) {
    return 'top-left';
  }

  // Top-right
  if (x >= 0.9 && y <= 0.1) {
    return 'top-right';
  }

  // Bottom-left
  if (x <= 0.1 && y >= 0.9) {
    return 'bottom-left';
  }

  // Bottom-right
  if (x >= 0.9 && y >= 0.9) {
    return 'bottom-right';
  }

  // Default to the closest anchor point
  if (x < 0.5) {
    if (y < 0.5) {
      return 'top-left';
    } else {
      return 'bottom-left';
    }
  } else {
    if (y < 0.5) {
      return 'top-right';
    } else {
      return 'bottom-right';
    }
  }
};

function MarkerView(props: MarkerViewProps, ref: Ref<MarkerViewRef>) {
  const { markerManager } = useContext(MapContext);
  const markerRef = useRef<ManagedMarker | null>(null);

  // Create the marker DOM element once; it survives map recreations so the
  // portaled children keep their state.
  const element: HTMLElement = useMemo(() => {
    const el = document.createElement('div');
    // Parity with mapboxgl.Marker elements (positioning CSS + selectors).
    el.className = 'mapboxgl-marker';
    const { style } = el;
    style.position = 'absolute';
    style.top = '0';
    style.left = '0';
    style.willChange = 'transform';
    if (props.style?.zIndex != null) {
      style.zIndex = props.style.zIndex.toString();
    }
    if (props.className) el.classList.add(props.className);
    if (!isValidElement(props.children)) {
      // Unlike mapboxgl.Marker there is no default pin; childless markers
      // render nothing (no consumer relies on the default pin).
      el.style.display = 'none';
    }
    return el;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anchor is constructor-only, matching the previous Marker behavior
  const anchor: MarkerAnchor = useMemo(
    () =>
      props?.anchor?.x && props?.anchor?.y
        ? xyToAnchorPoint(props.anchor)
        : 'center',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Latest coordinate for (re)registration without retriggering the effect
  const coordRef = useRef<{ lng: number; lat: number }>({
    lng: props.coordinate[0],
    lat: props.coordinate[1],
  });

  // Register with the manager; re-runs when the map is recreated after a
  // WebGL context loss (new manager identity through MapContext).
  useEffect(() => {
    if (!markerManager) {
      return;
    }

    const marker = markerManager.add(
      element,
      [coordRef.current.lng, coordRef.current.lat],
      anchor,
    );
    markerRef.current = marker;

    return () => {
      markerRef.current = null;
      marker.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerManager]);

  // Expose a stable imperative handle delegating to the current marker
  useImperativeHandle(
    ref,
    () => ({
      getElement: () => element,
      getLngLat: () => markerRef.current?.getLngLat(),
      setLngLat: (lngLat: [number, number]) => {
        coordRef.current = { lng: lngLat[0], lat: lngLat[1] };
        markerRef.current?.setLngLat(lngLat);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Update marker coordinates only when values change
  const lng = props.coordinate[0];
  const lat = props.coordinate[1];
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    coordRef.current = { lng, lat };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const marker = markerRef.current;
        if (!marker) return;
        const { lng: L, lat: A } = coordRef.current;
        const c = marker.getLngLat();
        if (c.lng !== L || c.lat !== A) {
          marker.setLngLat([L, A]);
        }
      });
    }
  }, [lng, lat]);
  useEffect(
    () => () => {
      if (rafRef.current != null) {
        try {
          cancelAnimationFrame(rafRef.current);
        } catch {}
        rafRef.current = null;
      }
    },
    [],
  );

  // Update className dynamically without recreating the marker element
  const prevClassRef = useRef<string | undefined>(props.className);
  useEffect(() => {
    const prev = prevClassRef.current;
    if (prev && prev !== props.className) {
      try {
        element.classList.remove(prev);
      } catch {}
    }
    if (props.className && props.className !== prev) {
      try {
        element.classList.add(props.className);
      } catch {}
    }
    prevClassRef.current = props.className;
  }, [element, props.className]);

  // Update zIndex dynamically
  const z = props.style?.zIndex;
  const prevZRef = useRef<number | undefined>(z);
  useEffect(() => {
    if (prevZRef.current !== z && z != null) {
      element.style.zIndex = z.toString();
      prevZRef.current = z;
    }
  }, [element, z]);

  // Inject children into marker element only if present
  return props.children ? createPortal(props.children, element) : null;
}

function propsAreEqual(prev: MarkerViewProps, next: MarkerViewProps) {
  // Compare coordinates by value to avoid unnecessary renders
  if (
    prev.coordinate[0] !== next.coordinate[0] ||
    prev.coordinate[1] !== next.coordinate[1]
  ) {
    return false;
  }
  // Compare anchor values if provided
  const pa = prev.anchor;
  const na = next.anchor;
  if ((pa?.x ?? -1) !== (na?.x ?? -1) || (pa?.y ?? -1) !== (na?.y ?? -1)) {
    return false;
  }
  // ClassName change should re-render (for children portal and effects)
  if (prev.className !== next.className) {
    return false;
  }
  // zIndex change should re-render to allow effect to run
  if ((prev.style?.zIndex ?? undefined) !== (next.style?.zIndex ?? undefined)) {
    return false;
  }
  // Children identity change should re-render
  if (prev.children !== next.children) {
    return false;
  }
  return true;
}

export default memo(forwardRef(MarkerView), propsAreEqual);
