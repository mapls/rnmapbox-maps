jest.mock('mapbox-gl', () => ({
  __esModule: true,
  default: { Map: jest.fn() },
}));
jest.mock('../../src/web/MarkerManager', () => ({
  __esModule: true,
  default: jest.fn(() => ({ destroy: jest.fn() })),
  MarkerManager: jest.fn(() => ({ destroy: jest.fn() })),
}));

import mapboxgl from 'mapbox-gl';
import MapViewWeb from '../../src/web/components/MapView';

type PaintState = {
  land: Record<string, unknown>;
  landcover: Record<string, unknown>;
  'land-structure-line': Record<string, unknown>;
};

const ORIGINALS: PaintState = {
  land: { 'background-color': '#EAEAEA' },
  landcover: { 'fill-color': '#DDDDDD' },
  'land-structure-line': { 'line-color': '#CCCCCC' },
};

const STYLE_LAYERS = [
  { id: 'land', type: 'background' },
  { id: 'landcover', type: 'fill' },
  { id: 'land-structure-line', type: 'line' },
];

type StubMap = ReturnType<typeof createStubMap>;

const createStubMap = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const paint: PaintState = JSON.parse(JSON.stringify(ORIGINALS));
  // Emulates mapbox-gl: style reads/mutations throw until the stylesheet
  // is parsed (Style#_checkLoaded)
  const state = { styleLoaded: false };

  const on = jest.fn((ev: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(cb);
  });
  const off = jest.fn((ev: string, cb: (...args: unknown[]) => void) => {
    listeners.get(ev)?.delete(cb);
  });
  const once = jest.fn((ev: string, cb: (...args: unknown[]) => void) => {
    const wrap = (...args: unknown[]) => {
      off(ev, wrap);
      cb(...args);
    };
    on(ev, wrap);
  });

  return {
    state,
    paint,
    touchZoomRotate: { _tapDragZoom: {} },
    on,
    off,
    once,
    fire: (ev: string) => {
      [...(listeners.get(ev) ?? [])].forEach((cb) => cb());
    },
    getStyle: jest.fn(() => {
      if (!state.styleLoaded) throw new Error('Style is not done loading');
      return { layers: STYLE_LAYERS };
    }),
    isStyleLoaded: jest.fn(() => state.styleLoaded),
    getLayer: jest.fn((id: string) => STYLE_LAYERS.find((l) => l.id === id)),
    getPaintProperty: jest.fn(
      (id: string, prop: string) => paint[id as keyof PaintState]?.[prop],
    ),
    setPaintProperty: jest.fn((id: string, prop: string, value: unknown) => {
      if (!state.styleLoaded) throw new Error('Style is not done loading');
      paint[id as keyof PaintState][prop] = value;
    }),
    setStyle: jest.fn(),
    remove: jest.fn(),
  };
};

// Instantiated directly instead of rendered: react-test-renderer returns null
// for host element refs, so mapContainer would never be set
const setup = () => {
  const stub = createStubMap();
  (mapboxgl.Map as unknown as jest.Mock).mockImplementation(() => stub);
  const mv: any = new (MapViewWeb as any)({
    styleURL: 'mapbox://styles/test/style',
  });
  mv.setState = jest.fn();
  mv.mapContainer = {};
  mv._createMap();
  return { stub, mv };
};

const loadStyle = (stub: StubMap) => {
  stub.state.styleLoaded = true;
  stub.fire('style.load');
};

describe('web MapView land colors', () => {
  it('does not re-tint when the mode is left before the style loads (regression)', () => {
    const { stub, mv } = setup();

    mv.setLandColor('#ff8800');
    mv.resetLandColor();
    loadStyle(stub);

    expect(stub.setPaintProperty).not.toHaveBeenCalled();
    expect(stub.paint.land['background-color']).toBe('#EAEAEA');
  });

  it('applies a tint set during style load once the style is ready', () => {
    const { stub, mv } = setup();

    mv.setLandColor('#ff8800');
    expect(stub.paint.land['background-color']).toBe('#EAEAEA');

    loadStyle(stub);
    expect(stub.paint.land['background-color']).toBe('#ff8800');
    expect(stub.paint.landcover['fill-color']).not.toBe('#DDDDDD');
    expect(stub.paint['land-structure-line']['line-color']).not.toBe('#CCCCCC');
  });

  it('restores the captured originals on reset', () => {
    const { stub, mv } = setup();
    loadStyle(stub);

    mv.setLandColor('#ff8800');
    mv.resetLandColor();

    expect(stub.paint).toEqual(ORIGINALS);
    expect(mv.originalLandColors).toHaveLength(0);
  });

  it('keeps the first originals across a direct mode-to-mode transition', () => {
    const { stub, mv } = setup();
    loadStyle(stub);

    mv.setLandColor('#ff8800');
    mv.setLandColor('#3366ff');
    expect(stub.paint.land['background-color']).toBe('#3366ff');

    mv.resetLandColor();
    expect(stub.paint).toEqual(ORIGINALS);
  });

  it('recaptures originals and re-tints on a fresh style', () => {
    const { stub, mv } = setup();
    loadStyle(stub);
    mv.setLandColor('#ff8800');

    // Simulate a style swap: paint reverts to the new style's defaults
    stub.paint.land['background-color'] = '#101010';
    stub.fire('style.load');

    expect(stub.paint.land['background-color']).toBe('#ff8800');
    mv.resetLandColor();
    expect(stub.paint.land['background-color']).toBe('#101010');
  });
});
