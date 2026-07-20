import type { Map } from 'mapbox-gl';

export type WebLayerType = 'line' | 'symbol' | 'circle';

export type SplitStyle = {
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
};

/**
 * Layout property names per layer type, copied from style-spec/v8.json
 * (layout_line / layout_symbol / layout_circle). Everything else that the spec
 * knows for the type is paint; unknown keys are warned about and skipped.
 * The lists are embedded so the (large) style spec json never enters the
 * web bundle at runtime.
 */
const LAYOUT_KEYS: Record<WebLayerType, ReadonlySet<string>> = {
  line: new Set([
    'line-cap',
    'line-join',
    'line-miter-limit',
    'line-round-limit',
    'line-sort-key',
    'line-z-offset',
    'line-elevation-reference',
    'line-cross-slope',
    'visibility',
    'line-width-unit',
    'line-elevation-ground-scale',
  ]),
  symbol: new Set([
    'symbol-placement',
    'symbol-spacing',
    'symbol-avoid-edges',
    'symbol-sort-key',
    'symbol-z-order',
    'symbol-z-elevate',
    'symbol-elevation-reference',
    'icon-allow-overlap',
    'icon-ignore-placement',
    'icon-optional',
    'icon-rotation-alignment',
    'icon-size',
    'icon-size-scale-range',
    'icon-text-fit',
    'icon-text-fit-padding',
    'icon-image',
    'icon-rotate',
    'icon-padding',
    'icon-keep-upright',
    'icon-offset',
    'icon-anchor',
    'icon-pitch-alignment',
    'text-pitch-alignment',
    'text-rotation-alignment',
    'text-field',
    'text-font',
    'text-size',
    'text-size-scale-range',
    'text-max-width',
    'text-line-height',
    'text-letter-spacing',
    'text-justify',
    'text-radial-offset',
    'text-variable-anchor',
    'text-anchor',
    'text-max-angle',
    'text-writing-mode',
    'text-rotate',
    'text-padding',
    'text-keep-upright',
    'text-transform',
    'text-offset',
    'text-allow-overlap',
    'text-ignore-placement',
    'text-optional',
    'visibility',
  ]),
  circle: new Set([
    'circle-sort-key',
    'circle-elevation-reference',
    'visibility',
  ]),
};

const PAINT_KEYS: Record<WebLayerType, ReadonlySet<string>> = {
  line: new Set([
    'line-opacity',
    'line-color',
    'line-translate',
    'line-translate-anchor',
    'line-width',
    'line-gap-width',
    'line-offset',
    'line-blur',
    'line-dasharray',
    'line-pattern',
    'line-pattern-cross-fade',
    'line-gradient',
    'line-trim-offset',
    'line-trim-fade-range',
    'line-trim-color',
    'line-emissive-strength',
    'line-border-width',
    'line-border-color',
    'line-occlusion-opacity',
    'line-blend-mode',
    'line-blend-additive-clamp',
  ]),
  symbol: new Set([
    'icon-opacity',
    'icon-occlusion-opacity',
    'icon-emissive-strength',
    'text-emissive-strength',
    'icon-color',
    'icon-halo-color',
    'icon-halo-width',
    'icon-halo-blur',
    'icon-translate',
    'icon-translate-anchor',
    'icon-image-cross-fade',
    'text-opacity',
    'text-occlusion-opacity',
    'text-color',
    'text-halo-color',
    'text-halo-width',
    'text-halo-blur',
    'text-translate',
    'text-translate-anchor',
    'icon-color-saturation',
    'icon-color-contrast',
    'icon-color-brightness-min',
    'icon-color-brightness-max',
    'symbol-z-offset',
  ]),
  circle: new Set([
    'circle-radius',
    'circle-color',
    'circle-blur',
    'circle-opacity',
    'circle-translate',
    'circle-translate-anchor',
    'circle-pitch-scale',
    'circle-pitch-alignment',
    'circle-stroke-width',
    'circle-stroke-color',
    'circle-stroke-opacity',
    'circle-emissive-strength',
  ]),
};

export const camelToKebab = (key: string): string =>
  key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

const warnedKeys = new Set<string>();
const warnUnknownKey = (type: WebLayerType, key: string) => {
  const cacheKey = `${type}:${key}`;
  if (warnedKeys.has(cacheKey)) return;
  warnedKeys.add(cacheKey);
  console.warn(
    `Mapbox [web]: unsupported ${type} layer style property "${key}", skipping`,
  );
};

/**
 * Splits a camelCase rnmapbox style object into mapbox-gl layout and paint
 * objects with kebab-cased keys. `*Transition` keys whose base property is a
 * paint key stay paint (mapbox-gl accepts `<prop>-transition` via
 * setPaintProperty and in layer definitions).
 */
export const splitLayerStyle = (
  type: WebLayerType,
  style: Record<string, unknown> | undefined,
): SplitStyle => {
  const layout: Record<string, unknown> = {};
  const paint: Record<string, unknown> = {};
  if (!style) return { layout, paint };

  for (const [camelKey, value] of Object.entries(style)) {
    if (value === undefined) continue;
    const kebab = camelToKebab(camelKey);

    if (LAYOUT_KEYS[type].has(kebab)) {
      layout[kebab] = value;
    } else if (PAINT_KEYS[type].has(kebab)) {
      paint[kebab] = value;
    } else if (
      kebab.endsWith('-transition') &&
      PAINT_KEYS[type].has(kebab.slice(0, -'-transition'.length))
    ) {
      paint[kebab] = value;
    } else {
      warnUnknownKey(type, camelKey);
    }
  }
  return { layout, paint };
};

export const styleValueEquals = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!styleValueEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
};

/**
 * Applies only the changed keys between two split styles. This is the per-frame
 * hot path for animated style props (e.g. a marching text-offset): a single
 * changed key results in a single setLayoutProperty/setPaintProperty call.
 */
export const diffApplyStyle = (
  map: Map,
  layerId: string,
  prev: SplitStyle | null,
  next: SplitStyle,
): void => {
  const apply = (
    section: 'layout' | 'paint',
    set: (id: string, key: string, value: unknown) => void,
  ) => {
    const prevSection = prev?.[section] ?? {};
    const nextSection = next[section];
    for (const [key, value] of Object.entries(nextSection)) {
      if (!styleValueEquals(prevSection[key], value)) {
        set(layerId, key, value);
      }
    }
    for (const key of Object.keys(prevSection)) {
      if (!(key in nextSection)) {
        set(layerId, key, undefined);
      }
    }
  };
  // mapbox-gl types the property name params as literal unions; our keys are
  // validated against the embedded spec tables above, so widen at the call
  const gl = map as unknown as {
    setLayoutProperty(id: string, key: string, value: unknown): void;
    setPaintProperty(id: string, key: string, value: unknown): void;
  };
  apply('layout', (id, key, value) => gl.setLayoutProperty(id, key, value));
  apply('paint', (id, key, value) => gl.setPaintProperty(id, key, value));
};
