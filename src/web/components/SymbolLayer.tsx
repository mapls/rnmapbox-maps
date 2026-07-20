import type { SymbolLayerStyleProps } from '../../utils/MapboxStyles';
import { useWebLayer, type WebLayerProps } from './useWebLayer';

export type SymbolLayerProps = Omit<WebLayerProps, 'style'> & {
  style?: SymbolLayerStyleProps;
};

/** Web SymbolLayer: renders a mapbox-gl symbol layer from the enclosing ShapeSource. */
function SymbolLayer(props: SymbolLayerProps) {
  useWebLayer('symbol', props as WebLayerProps);
  return null;
}

export default SymbolLayer;
