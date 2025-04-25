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
} from 'react';
import { createPortal } from 'react-dom';
import { ViewStyle } from 'react-native';

import MapContext from '../MapContext';

type MarkerViewProps = {
  coordinate: [number, number];
  anchor?: { x: number; y: number };
  children?: ReactElement;
  style?: ViewStyle;
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

    // Fix marker position
    const { style } = _marker.getElement();
    style.position = 'absolute';
    style.top = '0';
    style.left = '0';
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

  // Update marker coordinates
  const markerCoordinate = marker.getLngLat();
  if (
    markerCoordinate.lng !== props.coordinate[0] ||
    markerCoordinate.lat !== props.coordinate[1]
  ) {
    marker.setLngLat([props.coordinate[0], props.coordinate[1]]);
  }

  // Inject children into marker element
  return createPortal(props.children, marker.getElement());
}

export default memo(forwardRef(MarkerView));
