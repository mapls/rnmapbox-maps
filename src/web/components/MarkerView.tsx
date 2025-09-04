import { Marker } from 'mapbox-gl';
import {
  forwardRef,
  isValidElement,
  memo,
  ReactElement,
  Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { ViewStyle } from 'react-native';

import MapContext from '../MapContext';

type MarkerViewProps = {
  coordinate: [number, number];
  anchor?: { x: number; y: number };
  children?: ReactElement;
  style?: ViewStyle;
  className?: string;
};

const xyToAnchorPoint = ({ x, y }: { x: number, y: number }) => {
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

function MarkerView(props: MarkerViewProps, ref: Ref<Marker>) {
  const { map } = useContext(MapContext);

  // Create marker instance
  const marker: Marker = useMemo(() => {
    const _marker = new Marker({
      anchor: props?.anchor?.x && props?.anchor?.y ? xyToAnchorPoint(props.anchor) : 'center',
      element: isValidElement(props.children)
        ? document.createElement('div')
        : undefined,
    });

    // Set marker coordinates
    _marker.setLngLat(props.coordinate);

    if (props.className) _marker.addClassName(props.className);

    // Fix marker position
    const { style } = _marker.getElement();
    style.position = 'absolute';
    style.top = '0';
    style.left = '0';
    style.willChange = 'transform';
    if (props.style?.zIndex != null) {
      style.zIndex = props.style.zIndex.toString();
    }
    return _marker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add marker to map
  useEffect(() => {
    if (map === undefined) {
      return;
    }

    marker.addTo(map);

    return () => {
      marker.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Expose marker instance
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => marker, []);

  // Update marker coordinates only when values change
  const lng = props.coordinate[0];
  const lat = props.coordinate[1];
  const coordRef = useRef<{ lng: number; lat: number }>({ lng, lat });
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    coordRef.current = { lng, lat };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const { lng: L, lat: A } = coordRef.current;
        const c = marker.getLngLat();
        if (c.lng !== L || c.lat !== A) {
          marker.setLngLat([L, A]);
        }
      });
    }
  }, [marker, lng, lat]);
  useEffect(() => () => {
    if (rafRef.current != null) {
      try { cancelAnimationFrame(rafRef.current); } catch {}
      rafRef.current = null;
    }
  }, []);

  // Update className dynamically without recreating marker
  const prevClassRef = useRef<string | undefined>(props.className);
  useEffect(() => {
    const prev = prevClassRef.current;
    if (prev && prev !== props.className) {
      try { marker.removeClassName(prev); } catch {}
    }
    if (props.className && props.className !== prev) {
      try { marker.addClassName(props.className); } catch {}
    }
    prevClassRef.current = props.className;
  }, [marker, props.className]);

  // Update zIndex dynamically
  const z = props.style?.zIndex;
  const prevZRef = useRef<number | undefined>(z);
  useEffect(() => {
    if (prevZRef.current !== z && z != null) {
      marker.getElement().style.zIndex = z.toString();
      prevZRef.current = z;
    }
  }, [marker, z]);

  // Inject children into marker element only if present
  return props.children ? createPortal(props.children, marker.getElement()) : null;
}

function propsAreEqual(prev: MarkerViewProps, next: MarkerViewProps) {
  // Compare coordinates by value to avoid unnecessary renders
  if (prev.coordinate[0] !== next.coordinate[0] || prev.coordinate[1] !== next.coordinate[1]) {
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
