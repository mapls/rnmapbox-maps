import 'mapbox-gl/dist/mapbox-gl.css';

import MapboxModule from './MapboxModule';
import Camera from './components/Camera';
import CircleLayer from './components/CircleLayer';
import LineLayer from './components/LineLayer';
import MapView from './components/MapView';
import MarkerView from './components/MarkerView';
import ShapeSource from './components/ShapeSource';
import SymbolLayer from './components/SymbolLayer';
import Logger from './utils/Logger';

const ExportedComponents = {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  Logger,
  MarkerView,
  ShapeSource,
  SymbolLayer,
};

const Mapbox = {
  ...MapboxModule,
  ...ExportedComponents,
};

export {
  Camera,
  CircleLayer,
  LineLayer,
  Logger,
  MapView,
  MarkerView,
  ShapeSource,
  SymbolLayer,
};

export * from './MapboxModule';

export default Mapbox;
