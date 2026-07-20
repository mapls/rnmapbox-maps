import type { LineLayerStyleProps } from '../../utils/MapboxStyles';
import { useWebLayer, type WebLayerProps } from './useWebLayer';

export type LineLayerProps = Omit<WebLayerProps, 'style'> & {
  style?: LineLayerStyleProps;
};

/** Web LineLayer: renders a mapbox-gl line layer from the enclosing ShapeSource. */
function LineLayer(props: LineLayerProps) {
  useWebLayer('line', props as WebLayerProps);
  return null;
}

export default LineLayer;
