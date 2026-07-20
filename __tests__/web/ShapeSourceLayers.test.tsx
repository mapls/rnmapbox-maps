import { act, render } from '@testing-library/react-native';

// Import component files directly: src/web/index.tsx imports mapbox-gl CSS
// which jest cannot parse
import MapContext from '../../src/web/MapContext';
import ShapeSource from '../../src/web/components/ShapeSource';
import LineLayer from '../../src/web/components/LineLayer';
import SymbolLayer from '../../src/web/components/SymbolLayer';

type StubMap = ReturnType<typeof createStubMap>;

const createStubMap = () => {
  const sources = new Map<string, { setData: jest.Mock }>();
  const layers: { id: string; source: string }[] = [];
  const callOrder: string[] = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const map = {
    // Emulates mapbox-gl: mutations throw until the stylesheet is parsed
    styleMutable: true,
    addSource: jest.fn((id: string) => {
      if (!map.styleMutable) throw new Error('Style is not done loading');
      sources.set(id, { setData: jest.fn() });
      callOrder.push(`addSource:${id}`);
    }),
    getSource: jest.fn((id: string) => sources.get(id)),
    removeSource: jest.fn((id: string) => {
      sources.delete(id);
      callOrder.push(`removeSource:${id}`);
    }),
    addLayer: jest.fn(
      (spec: {
        id: string;
        source: string;
        layout?: Record<string, unknown>;
        paint?: Record<string, unknown>;
      }) => {
        if (!map.styleMutable) throw new Error('Style is not done loading');
        layers.push({ id: spec.id, source: spec.source });
        callOrder.push(`addLayer:${spec.id}`);
      },
    ),
    getLayer: jest.fn((id: string) => layers.find((layer) => layer.id === id)),
    removeLayer: jest.fn((id: string) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
      callOrder.push(`removeLayer:${id}`);
    }),
    isStyleLoaded: jest.fn(() => true),
    getStyle: jest.fn(() => ({ layers: [...layers] })),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
    setFilter: jest.fn(),
    setLayerZoomRange: jest.fn(),
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
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    layers,
    sources,
    callOrder,
  };
  return map;
};

const FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const LINE: GeoJSON.Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [24.75, 59.43],
      [24.76, 59.43],
    ],
  },
};

function JourneyLikeTree({
  map,
  textOffset = [0, 0],
}: {
  map: StubMap;
  textOffset?: number[];
}) {
  return (
    <MapContext.Provider value={{ map: map as never }}>
      <ShapeSource id="trail" shape={FC}>
        <LineLayer
          id="trail-line"
          style={{ lineColor: '#5A5A5A', lineWidth: 4.5 }}
        />
      </ShapeSource>
      <ShapeSource id="leg" shape={LINE}>
        <LineLayer
          id="leg-line"
          style={{ lineColor: '#FFA500', lineCap: 'round' }}
        />
        <SymbolLayer
          id="leg-arrows"
          style={{
            symbolPlacement: 'line',
            textField: '▸',
            textOffset,
            textColor: '#ffffff',
          }}
        />
      </ShapeSource>
      <ShapeSource id="cover" shape={FC}>
        <LineLayer id="cover-line" style={{ lineColor: '#5A5A5A' }} />
      </ShapeSource>
    </MapContext.Provider>
  );
}

describe('web ShapeSource and layers', () => {
  it('adds sources before their layers and preserves mount order as z-order', () => {
    const map = createStubMap();
    render(<JourneyLikeTree map={map} />);

    const layerAdds = map.callOrder.filter((call) =>
      call.startsWith('addLayer:'),
    );
    expect(layerAdds).toEqual([
      'addLayer:trail-line',
      'addLayer:leg-line',
      'addLayer:leg-arrows',
      'addLayer:cover-line',
    ]);

    // Every layer add happens after its source add
    for (const [layer, source] of [
      ['trail-line', 'trail'],
      ['leg-line', 'leg'],
      ['leg-arrows', 'leg'],
      ['cover-line', 'cover'],
    ]) {
      expect(map.callOrder.indexOf(`addSource:${source}`)).toBeLessThan(
        map.callOrder.indexOf(`addLayer:${layer}`),
      );
    }

    // Layers reference the enclosing source via context
    expect(map.layers.find((layer) => layer.id === 'leg-arrows')?.source).toBe(
      'leg',
    );
  });

  it('splits camelCase style into layout and paint on addLayer', () => {
    const map = createStubMap();
    render(<JourneyLikeTree map={map} />);

    const legLineSpec = map.addLayer.mock.calls
      .map((call) => call[0])
      .find((spec) => spec.id === 'leg-line')!;
    expect(legLineSpec.layout).toEqual({ 'line-cap': 'round' });
    expect(legLineSpec.paint).toEqual({ 'line-color': '#FFA500' });
  });

  it('applies a style prop change as exactly one property call', () => {
    const map = createStubMap();
    const { rerender } = render(
      <JourneyLikeTree map={map} textOffset={[0, 0]} />,
    );

    map.setLayoutProperty.mockClear();
    map.setPaintProperty.mockClear();
    rerender(<JourneyLikeTree map={map} textOffset={[1.25, 0]} />);

    expect(map.setLayoutProperty).toHaveBeenCalledTimes(1);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      'leg-arrows',
      'text-offset',
      [1.25, 0],
    );
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('updates source data when the shape prop changes', () => {
    const map = createStubMap();
    // Same element structure on both renders so the source is updated in
    // place, not remounted
    const tree = (shape: GeoJSON.Feature | GeoJSON.FeatureCollection) => (
      <MapContext.Provider value={{ map: map as never }}>
        <ShapeSource id="trail" shape={shape}>
          <LineLayer id="trail-line" style={{ lineColor: '#5A5A5A' }} />
        </ShapeSource>
      </MapContext.Provider>
    );
    const { rerender } = render(tree(FC));
    rerender(tree(LINE));

    expect(map.sources.get('trail')!.setData).toHaveBeenCalledWith(LINE);
  });

  it('cleans up layers before sources on unmount', () => {
    const map = createStubMap();
    const { unmount } = render(<JourneyLikeTree map={map} />);
    map.callOrder.length = 0;

    unmount();

    expect(map.layers).toHaveLength(0);
    expect(map.sources.size).toBe(0);
    // For each source, its layers were removed before the source itself
    for (const [layer, source] of [
      ['trail-line', 'trail'],
      ['leg-line', 'leg'],
      ['leg-arrows', 'leg'],
      ['cover-line', 'cover'],
    ]) {
      expect(map.callOrder.indexOf(`removeLayer:${layer}`)).toBeLessThan(
        map.callOrder.indexOf(`removeSource:${source}`),
      );
    }
  });

  it('re-adds everything on a new map identity without remounting (WebGL recovery)', () => {
    const mapA = createStubMap();
    const { rerender } = render(<JourneyLikeTree map={mapA} />);
    expect(mapA.sources.size).toBe(3);
    expect(mapA.layers).toHaveLength(4);

    const mapB = createStubMap();
    rerender(<JourneyLikeTree map={mapB} />);

    // Child (layer) effects re-run before parent (source) effects on the swap,
    // so sources land first and layers wait for the styledata event that a
    // real mapbox-gl map fires after any source addition
    expect(mapB.sources.size).toBe(3);
    act(() => mapB.fire('styledata'));
    expect(mapB.layers.map((layer) => layer.id)).toEqual([
      'trail-line',
      'leg-line',
      'leg-arrows',
      'cover-line',
    ]);
  });

  it('re-ensures sources and layers after a style wipe via styledata', () => {
    const map = createStubMap();
    render(<JourneyLikeTree map={map} />);

    // Simulate setStyle wiping everything
    map.layers.length = 0;
    map.sources.clear();
    act(() => map.fire('styledata'));

    expect(map.sources.size).toBe(3);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'trail-line',
      'leg-line',
      'leg-arrows',
      'cover-line',
    ]);
  });

  it('retries until the stylesheet is parsed instead of gating on isStyleLoaded', () => {
    const map = createStubMap();
    map.styleMutable = false;
    render(<JourneyLikeTree map={map} />);
    expect(map.sources.size).toBe(0);

    map.styleMutable = true;
    act(() => map.fire('styledata'));
    expect(map.sources.size).toBe(3);
    expect(map.layers).toHaveLength(4);
  });

  it('does NOT re-upload data when idle or styledata fire after a successful attach', () => {
    // Regression: ensure() used to call setData on every styledata/idle event
    // once the source existed; each setData triggers a repaint that ends in
    // another idle, so the map re-uploaded the full GeoJSON in a loop forever
    const map = createStubMap();
    render(<JourneyLikeTree map={map} />);
    expect(map.sources.size).toBe(3);

    for (const source of map.sources.values()) {
      source.setData.mockClear();
    }
    act(() => map.fire('idle'));
    act(() => map.fire('styledata'));
    act(() => map.fire('idle'));

    for (const source of map.sources.values()) {
      expect(source.setData).not.toHaveBeenCalled();
    }
  });

  it('does not redundantly setData on mount (addSource already carried the data)', () => {
    const map = createStubMap();
    render(<JourneyLikeTree map={map} />);

    for (const source of map.sources.values()) {
      expect(source.setData).not.toHaveBeenCalled();
    }
  });

  it('still applies a shape prop change as exactly one setData', () => {
    const map = createStubMap();
    const tree = (shape: GeoJSON.Feature | GeoJSON.FeatureCollection) => (
      <MapContext.Provider value={{ map: map as never }}>
        <ShapeSource id="trail" shape={shape}>
          <LineLayer id="trail-line" style={{ lineColor: '#5A5A5A' }} />
        </ShapeSource>
      </MapContext.Provider>
    );
    const { rerender } = render(tree(FC));
    rerender(tree(LINE));
    const setData = map.sources.get('trail')!.setData;
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith(LINE);

    // Later idle/styledata events do not repeat the upload
    setData.mockClear();
    act(() => map.fire('idle'));
    act(() => map.fire('styledata'));
    expect(setData).not.toHaveBeenCalled();
  });

  it('removes its styledata/idle listeners on unmount', () => {
    const map = createStubMap();
    const { unmount } = render(<JourneyLikeTree map={map} />);
    unmount();

    // Every on() registration was matched by an off() with the same handler
    expect(map.listenerCount('styledata')).toBe(0);
    expect(map.listenerCount('idle')).toBe(0);
  });

  it('warns once on a persistent non-transient attach failure and keeps retrying', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const map = createStubMap();
    map.addSource.mockImplementation(() => {
      throw new Error('Invalid GeoJSON source specification');
    });

    render(
      <MapContext.Provider value={{ map: map as never }}>
        <ShapeSource id="broken-spec-source" shape={FC} />
      </MapContext.Provider>,
    );
    act(() => map.fire('styledata'));
    act(() => map.fire('idle'));
    act(() => map.fire('idle'));

    const attachWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('"broken-spec-source" failed to attach'),
    );
    expect(attachWarnings).toHaveLength(1);
    // Still retrying: attach succeeds once the underlying problem is gone
    map.addSource.mockImplementation((id: string) => {
      map.sources.set(id, { setData: jest.fn() });
    });
    act(() => map.fire('idle'));
    expect(map.sources.has('broken-spec-source')).toBe(true);
    warn.mockRestore();
  });

  it('does not warn for the transient style-not-loaded error', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const map = createStubMap();
    map.styleMutable = false;

    render(
      <MapContext.Provider value={{ map: map as never }}>
        <ShapeSource id="pre-parse-source" shape={FC} />
      </MapContext.Provider>,
    );
    act(() => map.fire('styledata'));

    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('pre-parse-source'),
      ),
    ).toHaveLength(0);
    warn.mockRestore();
  });

  it('warns once for native-only ShapeSource props that web ignores', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const map = createStubMap();

    const tree = (
      <MapContext.Provider value={{ map: map as never }}>
        <ShapeSource
          id="native-parity-source"
          shape={FC}
          onPress={() => {}}
          hitbox={{ width: 44, height: 44 }}
        />
      </MapContext.Provider>
    );
    const { rerender } = render(tree);
    rerender(tree);

    const parityWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('native-parity-source'),
    );
    expect(parityWarnings.map((call) => String(call[0]))).toEqual([
      expect.stringContaining('"onPress"'),
      expect.stringContaining('"hitbox"'),
    ]);
    warn.mockRestore();
  });

  it('warns when a layer has neither an enclosing ShapeSource nor a sourceID', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const map = createStubMap();

    render(
      <MapContext.Provider value={{ map: map as never }}>
        <LineLayer id="orphan-line" style={{ lineColor: '#FFA500' }} />
      </MapContext.Provider>,
    );

    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('"orphan-line" has no source'),
      ),
    ).toHaveLength(1);
    expect(map.addLayer).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('recovers from a styledata burst that ends unsettled via the idle listener', () => {
    // Regression: isStyleLoaded() flips false on every mutation (including our
    // own addSource), and the last styledata of a load burst can pass with the
    // style still dirty; only a later idle re-fires ensure
    const map = createStubMap();
    map.styleMutable = false;
    render(<JourneyLikeTree map={map} />);
    act(() => map.fire('styledata'));
    expect(map.sources.size).toBe(0);

    map.styleMutable = true;
    act(() => map.fire('idle'));
    expect(map.sources.size).toBe(3);
    expect(map.layers).toHaveLength(4);
  });
});
