import {
  camelToKebab,
  diffApplyStyle,
  splitLayerStyle,
  styleValueEquals,
} from '../../src/web/utils/layerStyle';

describe('web layerStyle', () => {
  describe('camelToKebab', () => {
    it('converts style keys', () => {
      expect(camelToKebab('lineColor')).toBe('line-color');
      expect(camelToKebab('symbolPlacement')).toBe('symbol-placement');
      expect(camelToKebab('textField')).toBe('text-field');
      expect(camelToKebab('iconTextFitPadding')).toBe('icon-text-fit-padding');
      expect(camelToKebab('visibility')).toBe('visibility');
    });
  });

  describe('splitLayerStyle', () => {
    it('splits line style into layout and paint', () => {
      const { layout, paint } = splitLayerStyle('line', {
        lineColor: '#FFA500',
        lineWidth: 3.5,
        lineOpacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      });
      expect(layout).toEqual({ 'line-cap': 'round', 'line-join': 'round' });
      expect(paint).toEqual({
        'line-color': '#FFA500',
        'line-width': 3.5,
        'line-opacity': 0.9,
      });
    });

    it('splits symbol style into layout and paint', () => {
      const { layout, paint } = splitLayerStyle('symbol', {
        symbolPlacement: 'line',
        symbolSpacing: 60,
        textField: '▸',
        textSize: 12,
        textOffset: [1.5, 0],
        textAllowOverlap: true,
        textColor: '#ffffff',
        textHaloWidth: 1,
      });
      expect(layout).toEqual({
        'symbol-placement': 'line',
        'symbol-spacing': 60,
        'text-field': '▸',
        'text-size': 12,
        'text-offset': [1.5, 0],
        'text-allow-overlap': true,
      });
      expect(paint).toEqual({ 'text-color': '#ffffff', 'text-halo-width': 1 });
    });

    it('splits circle style into layout and paint', () => {
      const { layout, paint } = splitLayerStyle('circle', {
        circleRadius: 6,
        circleColor: '#123456',
        circleSortKey: 2,
      });
      expect(layout).toEqual({ 'circle-sort-key': 2 });
      expect(paint).toEqual({ 'circle-radius': 6, 'circle-color': '#123456' });
    });

    it('classifies transition keys of paint properties as paint', () => {
      const { layout, paint } = splitLayerStyle('line', {
        lineOpacityTransition: { duration: 300, delay: 0 },
      });
      expect(layout).toEqual({});
      expect(paint).toEqual({
        'line-opacity-transition': { duration: 300, delay: 0 },
      });
    });

    it('warns once and skips unknown keys', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { layout, paint } = splitLayerStyle('line', {
        totallyMadeUpProp: 1,
        lineColor: 'red',
      });
      splitLayerStyle('line', { totallyMadeUpProp: 2 });
      expect(layout).toEqual({});
      expect(paint).toEqual({ 'line-color': 'red' });
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('skips undefined values', () => {
      const { layout, paint } = splitLayerStyle('line', {
        lineColor: undefined,
        lineCap: 'round',
      });
      expect(paint).toEqual({});
      expect(layout).toEqual({ 'line-cap': 'round' });
    });
  });

  describe('styleValueEquals', () => {
    it('compares scalars, arrays and objects by value', () => {
      expect(styleValueEquals(1, 1)).toBe(true);
      expect(styleValueEquals([1.5, 0], [1.5, 0])).toBe(true);
      expect(styleValueEquals([1.5, 0], [1.6, 0])).toBe(false);
      expect(styleValueEquals({ a: 1 }, { a: 1 })).toBe(true);
      expect(styleValueEquals('a', 'b')).toBe(false);
    });
  });

  describe('diffApplyStyle', () => {
    const makeMap = () =>
      ({
        setLayoutProperty: jest.fn(),
        setPaintProperty: jest.fn(),
      }) as unknown as import('mapbox-gl').Map & {
        setLayoutProperty: jest.Mock;
        setPaintProperty: jest.Mock;
      };

    it('applies everything when there is no previous style', () => {
      const map = makeMap();
      diffApplyStyle(map, 'l1', null, {
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': 'red' },
      });
      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        'l1',
        'line-cap',
        'round',
      );
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        'l1',
        'line-color',
        'red',
      );
    });

    it('applies only changed keys', () => {
      const map = makeMap();
      const prev = {
        layout: { 'text-offset': [0, 0], 'symbol-spacing': 60 },
        paint: { 'text-color': '#fff' },
      };
      diffApplyStyle(map, 'arrows', prev, {
        layout: { 'text-offset': [1.2, 0], 'symbol-spacing': 60 },
        paint: { 'text-color': '#fff' },
      });
      expect(map.setLayoutProperty).toHaveBeenCalledTimes(1);
      expect(map.setLayoutProperty).toHaveBeenCalledWith(
        'arrows',
        'text-offset',
        [1.2, 0],
      );
      expect(map.setPaintProperty).not.toHaveBeenCalled();
    });

    it('unsets keys removed from the style', () => {
      const map = makeMap();
      diffApplyStyle(
        map,
        'l1',
        { layout: {}, paint: { 'line-color': 'red' } },
        { layout: {}, paint: {} },
      );
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        'l1',
        'line-color',
        undefined,
      );
    });
  });
});
