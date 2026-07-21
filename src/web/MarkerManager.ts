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
    this._manager?.reposition(this);
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
  _onMove = () => this._repositionAll();

  constructor(map: Map) {
    this._map = map;
    map.on('move', this._onMove);
    map.on('moveend', this._onMove);
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

  reposition(marker: ManagedMarker): void {
    const map = this._map;
    if (!map) return;
    const pos = map.project(marker._lngLat as LngLatLike);
    // mapbox-gl's Marker only snaps to whole pixels at rest (avoids subpixel
    // text blur) and keeps subpixel positions while the camera animates so
    // markers glide in lockstep with the canvas. Rounding during movement
    // makes every marker hop pixel to pixel against a smoothly interpolating
    // map, which reads as jitter, amplified on high-dpr phone screens.
    const snap = !map.isMoving();
    const x = snap ? Math.round(pos.x) : pos.x;
    const y = snap ? Math.round(pos.y) : pos.y;
    if (x === marker._lastX && y === marker._lastY) return;
    marker._lastX = x;
    marker._lastY = y;
    marker._element.style.transform = `translate3d(${x}px, ${y}px, 0) ${marker._anchorTranslate}`;
  }

  _repositionAll(): void {
    for (const marker of this._markers) {
      this.reposition(marker);
    }
  }

  destroy(): void {
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
