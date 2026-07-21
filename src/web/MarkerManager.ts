import type { Map, LngLatLike } from 'mapbox-gl';

export type MarkerAnchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

// Matches mapbox-gl's own anchor translations (see its Marker implementation).
const ANCHOR_TRANSLATE: Record<MarkerAnchor, string> = {
  center: 'translate(-50%, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
  left: 'translate(0, -50%)',
  right: 'translate(-100%, -50%)',
  'top-left': 'translate(0, 0)',
  'top-right': 'translate(-100%, 0)',
  'bottom-left': 'translate(0, -100%)',
  'bottom-right': 'translate(-100%, -100%)',
};

export class ManagedMarker {
  _manager: MarkerManager | null;
  _element: HTMLElement;
  _lngLat: [number, number];
  _anchorTranslate: string;
  _lastX: number | null = null;
  _lastY: number | null = null;

  constructor(
    manager: MarkerManager,
    element: HTMLElement,
    lngLat: [number, number],
    anchor: MarkerAnchor,
  ) {
    this._manager = manager;
    this._element = element;
    this._lngLat = lngLat;
    this._anchorTranslate = ANCHOR_TRANSLATE[anchor];
    // Same classes mapboxgl.Marker applies; app CSS keys pointer-events
    // rules off the anchor class, so dropping it breaks map interaction
    element.classList.add(
      'mapboxgl-marker',
      `mapboxgl-marker-anchor-${anchor}`,
    );
  }

  getElement(): HTMLElement {
    return this._element;
  }

  getLngLat(): { lng: number; lat: number } {
    return { lng: this._lngLat[0], lat: this._lngLat[1] };
  }

  setLngLat(lngLat: [number, number]): this {
    this._lngLat = lngLat;
    this._manager?.repositionMoved(this);
    return this;
  }

  remove(): void {
    this._manager?.remove(this);
  }
}

/**
 * Positions plain DOM marker elements over the map with a single per-frame
 * pass. Unlike one mapboxgl.Marker per pin (each with its own 'move'
 * listener, projection and DOM task), all markers share one listener and one
 * batched loop, which keeps panning smooth with many pins (notably on
 * Firefox). Intentionally skips mapbox Marker features the app never uses on
 * web: occlusion opacity, world-copy wrapping, dragging, pitch/rotation
 * alignment (the web app runs a 2D camera).
 */
export class MarkerManager {
  _map: Map | null;
  _markers = new Set<ManagedMarker>();
  _snapFrameId: number | null = null;
  // Mirrors mapboxgl.Marker's delaySnap: every move frame writes exact
  // subpixel positions so markers glide in lockstep with the canvas, and a
  // trailing rAF, cancelled by each subsequent move, snaps to whole pixels
  // only once movement has actually stopped (rounding at rest avoids subpixel
  // text blur; rounding mid-animation makes markers hop pixel to pixel
  // against a smoothly interpolating map). Deliberately not keyed on
  // map.isMoving(): jumpTo fires synchronous move/moveend pairs per call, so
  // a moveend-triggered snap would re-round every frame of a jumpTo-driven
  // animation.
  _onMove = () => {
    this._repositionAll(false);
    this._scheduleSnap();
  };

  constructor(map: Map) {
    this._map = map;
    map.on('move', this._onMove);
    map.on('moveend', this._onMove);
  }

  _scheduleSnap(): void {
    if (this._snapFrameId != null) {
      cancelAnimationFrame(this._snapFrameId);
    }
    this._snapFrameId = requestAnimationFrame(() => {
      this._snapFrameId = null;
      this._repositionAll(true);
    });
  }

  add(
    element: HTMLElement,
    lngLat: [number, number],
    anchor: MarkerAnchor,
  ): ManagedMarker {
    const marker = new ManagedMarker(this, element, lngLat, anchor);
    if (this._map) {
      this._map.getCanvasContainer().appendChild(element);
      this._markers.add(marker);
      this.reposition(marker);
    }
    return marker;
  }

  remove(marker: ManagedMarker): void {
    this._markers.delete(marker);
    marker._element.remove();
    marker._manager = null;
  }

  /** Repositions after a coordinate change: exact now, snapped once no more
   * updates arrive (a per-frame mover like the journey bee must not hop). */
  repositionMoved(marker: ManagedMarker): void {
    this.reposition(marker, false);
    this._scheduleSnap();
  }

  reposition(marker: ManagedMarker, snap = true): void {
    const map = this._map;
    if (!map) return;
    const pos = map.project(marker._lngLat as LngLatLike);
    const x = snap ? Math.round(pos.x) : pos.x;
    const y = snap ? Math.round(pos.y) : pos.y;
    if (x === marker._lastX && y === marker._lastY) return;
    marker._lastX = x;
    marker._lastY = y;
    marker._element.style.transform = `translate3d(${x}px, ${y}px, 0) ${marker._anchorTranslate}`;
  }

  _repositionAll(snap: boolean): void {
    for (const marker of this._markers) {
      this.reposition(marker, snap);
    }
  }

  destroy(): void {
    if (this._snapFrameId != null) {
      cancelAnimationFrame(this._snapFrameId);
      this._snapFrameId = null;
    }
    if (this._map) {
      this._map.off('move', this._onMove);
      this._map.off('moveend', this._onMove);
      this._map = null;
    }
    for (const marker of this._markers) {
      marker._element.remove();
      marker._manager = null;
    }
    this._markers.clear();
  }
}

export default MarkerManager;
