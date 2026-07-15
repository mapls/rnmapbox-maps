import React from 'react';
import type { Map } from 'mapbox-gl';

import type { MarkerManager } from './MarkerManager';

const MapContext = React.createContext<{
  map?: Map;
  markerManager?: MarkerManager;
}>({});

export default MapContext;
