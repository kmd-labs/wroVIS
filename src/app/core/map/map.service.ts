import { Injectable, NgZone, inject, signal } from '@angular/core';
import { AttributionControl, Map as MapLibreMap, addProtocol, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import {
  BASEMAP_STYLE_URL,
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  WROCLAW_CENTER,
  WROCLAW_MAX_BOUNDS
} from './map.config';

export type MapStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * MapLibre 6 ships its web worker as a separate ES module and resolves it next to `import.meta.url`,
 * which inside an Angular bundle points at main.js. The worker file is copied to this path by the
 * `assets` entry in angular.json; resolving against `document.baseURI` keeps it correct under `base-href`.
 */
const WORKER_ASSET_PATH = 'assets/maplibre/maplibre-gl-worker.mjs';

let maplibreConfigured = false;

/**
 * Owns the single MapLibre instance of the app.
 * The map is created outside the Angular zone so pointer/render events do not trigger change detection;
 * only the `status` signal is written back inside the zone.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly zone = inject(NgZone);
  private map: MapLibreMap | null = null;

  /** Lifecycle of the basemap style: idle → loading → ready | error. */
  readonly status = signal<MapStatus>('idle');

  /** The live MapLibre instance, or null before `init()` / after `destroy()`. */
  get instance(): MapLibreMap | null {
    return this.map;
  }

  init(container: HTMLElement): MapLibreMap {
    if (this.map) return this.map;

    if (!maplibreConfigured) {
      setWorkerUrl(new URL(WORKER_ASSET_PATH, document.baseURI).href);
      const protocol = new Protocol();
      addProtocol('pmtiles', protocol.tile);
      maplibreConfigured = true;
    }

    this.status.set('loading');

    const map = this.zone.runOutsideAngular(
      () =>
        new MapLibreMap({
          container,
          style: BASEMAP_STYLE_URL,
          center: WROCLAW_CENTER,
          zoom: MAP_DEFAULT_ZOOM,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: WROCLAW_MAX_BOUNDS,
          attributionControl: false,
          maplibreLogo: false
        })
    );

    // ODbL requires a visible OpenStreetMap credit: compact control, styled in styles.scss.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    map.once('load', () => this.zone.run(() => this.status.set('ready')));
    map.on('error', event => {
      // Tile-level errors are non-fatal; only a failed style load blocks the app.
      if (this.status() === 'loading') {
        console.error('[wroVIS] basemap failed to load', event.error);
        this.zone.run(() => this.status.set('error'));
      }
    });

    this.map = map;
    return map;
  }

  destroy() {
    this.map?.remove();
    this.map = null;
    this.status.set('idle');
  }
}
