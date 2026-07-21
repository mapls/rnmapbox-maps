import MarkerManager from '../../src/web/MarkerManager';
import type { Map as MapboxMap } from 'mapbox-gl';

const createStubMap = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  // Camera state the tests steer per-assertion; separate object so the map
  // stub's methods do not reference the stub in its own initializer
  const state = { moving: false, projected: { x: 0, y: 0 } };
  const map = {
    state,
    project: jest.fn(() => ({ ...state.projected })),
    isMoving: jest.fn(() => state.moving),
    getCanvasContainer: jest.fn(() => ({ appendChild: jest.fn() })),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    fire: (event: string) => {
      for (const handler of [...(listeners.get(event) ?? [])]) handler();
    },
  };
  return map;
};

// The manager only touches classList, style.transform and remove(); a plain
// stub keeps the suite on the fork's node test environment (no jsdom).
const makeElement = () => {
  const transformWrites: string[] = [];
  const el = {
    transformWrites,
    classList: { add: jest.fn() },
    style: {
      get transform() {
        return transformWrites[transformWrites.length - 1] ?? '';
      },
      set transform(value: string) {
        transformWrites.push(value);
      },
    },
    remove: jest.fn(),
  };
  return el;
};

type StubElement = ReturnType<typeof makeElement>;
const asHtml = (el: StubElement) => el as unknown as HTMLElement;

describe('MarkerManager positioning', () => {
  it('snaps to whole pixels while the map is at rest', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    map.state.projected = { x: 10.4, y: 20.6 };
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');
    expect(el.style.transform).toContain('translate3d(10px, 21px, 0)');
  });

  it('keeps subpixel positions while the camera is animating', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');

    map.state.moving = true;
    map.state.projected = { x: 10.4, y: 20.6 };
    map.fire('move');
    expect(el.style.transform).toContain('translate3d(10.4px, 20.6px, 0)');

    // Every animation frame must move the marker, not just pixel crossings;
    // rounding here made markers hop against the smoothly moving canvas
    map.state.projected = { x: 10.7, y: 20.9 };
    map.fire('move');
    expect(el.style.transform).toContain('translate3d(10.7px, 20.9px, 0)');
  });

  it('snaps back to whole pixels on moveend', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');

    map.state.moving = true;
    map.state.projected = { x: 10.4, y: 20.6 };
    map.fire('move');
    expect(el.style.transform).toContain('translate3d(10.4px, 20.6px, 0)');

    map.state.moving = false;
    map.fire('moveend');
    expect(el.style.transform).toContain('translate3d(10px, 21px, 0)');
  });

  it('skips the DOM write when the position is unchanged', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    map.state.projected = { x: 10, y: 20 };
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');
    expect(el.transformWrites).toHaveLength(1);
    map.fire('move');
    map.fire('moveend');
    expect(el.transformWrites).toHaveLength(1);
  });
});
