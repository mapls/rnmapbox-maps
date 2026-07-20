/** True for the transient mapbox-gl "Style is not done loading" error that the
 * styledata/idle retry loop is designed to absorb. */
export const isTransientStyleError = (e: unknown): boolean =>
  e instanceof Error && /not done loading/i.test(e.message);

const warnedAttach = new Set<string>();

/** Attach failures other than the transient style-loading one (invalid spec,
 * conflicting id, bad belowLayerID) would otherwise retry silently forever
 * with no diagnostics; surface them once per id. */
export const warnAttachErrorOnce = (
  what: 'source' | 'layer',
  id: string,
  e: unknown,
): void => {
  const key = `${what}:${id}`;
  if (warnedAttach.has(key)) return;
  warnedAttach.add(key);
  console.warn(
    `Mapbox [web]: ${what} "${id}" failed to attach (will keep retrying on styledata/idle):`,
    e,
  );
};

const warnedUnsupported = new Set<string>();

/** One-time warning for native-only props accepted for API parity. */
export const warnUnsupportedPropOnce = (
  owner: string,
  prop: string,
  hint: string,
): void => {
  const key = `${owner}:${prop}`;
  if (warnedUnsupported.has(key)) return;
  warnedUnsupported.add(key);
  console.warn(
    `Mapbox [web]: prop "${prop}" is not supported on web ("${owner}"); ${hint}`,
  );
};
