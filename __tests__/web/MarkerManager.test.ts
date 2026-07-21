import MarkerManager from '../../src/web/MarkerManager';
import type { Map as MapboxMap } from 'mapbox-gl';

// Manual rAF harness: callbacks run only when the test flushes them, and
// cancelled ids never run, mirroring the delaySnap cancellation semantics
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId = 0;
beforeEach(() => {
  rafCallbacks = new Map();
  rafId = 0;
  global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallbacks.set(++rafId, cb);
    return rafId;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = ((id: number) => {
    rafCallbacks.delete(id);
  }) as typeof cancelAnimationFrame;
});
const flushRaf = () => {
  const pending = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of pending) cb(0);
};

const createStubMap = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  // Camera state the tests steer per-assertion; separate object so the map
  // stub's methods do not reference the stub in its own initializer
  const state = { projected: { x: 0, y: 0 } };
  const map = {
    state,
    project: jest.fn(() => ({ ...state.projected })),
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
  it('snaps to whole pixels on add', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    map.state.projected = { x: 10.4, y: 20.6 };
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');
    expect(el.style.transform).toContain('translate3d(10px, 21px, 0)');
  });

  it('keeps subpixel positions on every move frame while the camera animates', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');

    map.state.projected = { x: 10.4, y: 20.6 };
    map.fire('move');
    expect(el.style.transform).toContain('translate3d(10.4px, 20.6px, 0)');

    // Every animation frame must move the marker, not just pixel crossings;
    // rounding here made markers hop against the smoothly moving canvas
    map.state.projected = { x: 10.7, y: 20.9 };
    map.fire('move');
    expect(el.style.transform).toContain('translate3d(10.7px, 20.9px, 0)');
  });

  it('snaps via the trailing frame once movement stops', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');

    map.state.projected = { x: 10.4, y: 20.6 };
    map.fire('move');
    map.fire('moveend');
    expect(el.style.transform).toContain('translate3d(10.4px, 20.6px, 0)');

    flushRaf();
    expect(el.style.transform).toContain('translate3d(10px, 21px, 0)');
  });

  it('never snaps mid-animation even when jumpTo fires moveend every frame', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');

    // jumpTo per animation frame: synchronous move + moveend pairs
    for (const x of [10.2, 10.5, 10.8]) {
      map.state.projected = { x, y: 20.5 };
      map.fire('move');
      map.fire('moveend');
    }
    const subpixel = el.transformWrites.filter((t) => t.includes('translate3d(10.2px') || t.includes('translate3d(10.5px') || t.includes('translate3d(10.8px'));
    expect(subpixel).toHaveLength(3);
    // No rounded write happened between the frames
    expect(el.transformWrites.some((t) => t.includes('translate3d(10px') || t.includes('translate3d(11px'))).toBe(false);

    flushRaf();
    expect(el.style.transform).toContain('translate3d(11px, 21px, 0)');
  });

  it('coordinate updates write exact positions and snap after the updates stop', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    const marker = manager.add(asHtml(el), [24.7, 59.4], 'center');

    map.state.projected = { x: 30.3, y: 40.7 };
    marker.setLngLat([24.8, 59.5]);
    expect(el.style.transform).toContain('translate3d(30.3px, 40.7px, 0)');

    flushRaf();
    expect(el.style.transform).toContain('translate3d(30px, 41px, 0)');
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
    flushRaf();
    expect(el.transformWrites).toHaveLength(1);
  });

  it('destroy cancels the pending snap frame', () => {
    const map = createStubMap();
    const manager = new MarkerManager(map as unknown as MapboxMap);
    const el = makeElement();
    manager.add(asHtml(el), [24.7, 59.4], 'center');
    map.state.projected = { x: 10.4, y: 20.6 };
    map.fire('move');
    manager.destroy();
    expect(() => flushRaf()).not.toThrow();
    expect(el.style.transform).toContain('translate3d(10.4px, 20.6px, 0)');
  });
});
