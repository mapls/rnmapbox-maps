import type { CircleLayerStyleProps } from '../../utils/MapboxStyles';
import { useWebLayer, type WebLayerProps } from './useWebLayer';

export type CircleLayerProps = Omit<WebLayerProps, 'style'> & {
  style?: CircleLayerStyleProps;
};

/** Web CircleLayer: renders a mapbox-gl circle layer from the enclosing ShapeSource. */
function CircleLayer(props: CircleLayerProps) {
  useWebLayer('circle', props as WebLayerProps);
  return null;
}

export default CircleLayer;
