import { Injectable, NgZone, effect, inject, signal, untracked } from '@angular/core';
import {
  AttributionControl,
  FeatureIdentifier,
  LngLatBounds,
  Map as MapLibreMap,
  MapMouseEvent,
  PointLike,
  addProtocol,
  setWorkerUrl
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { ThemeService } from '@kmd/design-system';
import { I18nService } from '../i18n/i18n.service';
import { DataService } from '../data/data.service';
import { AppState } from '../state/app.state';
import type { MultiPolygon, Polygon } from 'geojson';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, SRC_DISTRICTS, WROCLAW_MAX_BOUNDS } from './map.config';
import { PickedFeature, StyleContext } from './map.types';
import { INTRO_CAMERA, INTRO_STOPS, SEARCH_GLOW_OPACITY, START_CAMERA, interactiveLayers, routeActive } from './layers.registry';
import { PALETTE_TOKEN_ROLE, StyledPalette, cyberToken } from '../../shared/cyber-palette';
import { buildMapStyle } from './style.builder';
import { StyleTools } from './style.expr';

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
 *
 * The style is a pure function of (theme, language, palette, layers, tool, dock parameters, loaded data), rebuilt
 * by an `effect()` and applied with `setStyle(style, { diff: true })`, so MapLibre only patches what changed:
 * switching a layer or the palette toggles layer visibility, moving a slider updates a filter or paint property, and
 * switching to Midnight recolours every layer without reloading sources. The map runs outside the
 * Angular zone; only state signals are written back inside it.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly zone = inject(NgZone);
  private readonly theme = inject(ThemeService);
  private readonly i18n = inject(I18nService);
  private readonly data = inject(DataService);
  private readonly state = inject(AppState);

  private map: MapLibreMap | null = null;
  private readonly styleLoaded = signal(false);
  private hovered: PickedFeature | null = null;
  private selectedRef: FeatureIdentifier | null = null;
  private hud = { top: 0, bottom: 0, left: 0 };
  private introPending = false;
  private pulseFrame = 0;
  private rightInset = 0;

  /** Lifecycle of the map: idle → loading → ready (first frame rendered) | error. */
  readonly status = signal<MapStatus>('idle');

  /** Last pointer position over the canvas (container pixels), updated while a feature is hovered. */
  readonly pointer = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  /** The live MapLibre instance, or null before `init()` / after `destroy()`. */
  get instance(): MapLibreMap | null {
    return this.map;
  }

  constructor() {
    // Style follows theme, language, palette, layers, tool, dock parameters and data; MapLibre diffs the result.
    effect(() => {
      const style = this.buildStyle();
      const map = this.map;
      if (!map || !this.styleLoaded()) return;
      untracked(() => this.zone.runOutsideAngular(() => map.setStyle(style, { diff: true })));
    });

    // District hovered in the ranking panel mirrors into `feature-state.listHover`.
    let listHovered: number | null = null;
    effect(() => {
      const id = this.state.highlightedDistrict();
      const ready = this.styleLoaded();
      untracked(() => {
        const map = this.map;
        if (!map || !ready || id === listHovered) return;
        if (listHovered !== null) map.removeFeatureState({ source: SRC_DISTRICTS, id: listHovered }, 'listHover');
        if (id !== null) map.setFeatureState({ source: SRC_DISTRICTS, id }, { listHover: true });
        listHovered = id;
      });
    });

    // Selected feature mirrors into `feature-state` so the style can highlight it.
    effect(() => {
      const selected = this.state.selected();
      untracked(() => this.applySelected(selected));
    });
  }

  init(container: HTMLElement): MapLibreMap {
    if (this.map) return this.map;

    if (!maplibreConfigured) {
      setWorkerUrl(new URL(WORKER_ASSET_PATH, document.baseURI).href);
      addProtocol('pmtiles', new Protocol().tile);
      maplibreConfigured = true;
    }

    this.status.set('loading');
    // The intro flight starts from a view of the whole city; with reduced motion the map opens on the Market Square.
    this.introPending = !prefersReducedMotion();
    const camera = this.introPending ? INTRO_CAMERA : START_CAMERA;

    const map = this.zone.runOutsideAngular(
      () =>
        new MapLibreMap({
          container,
          style: untracked(() => this.buildStyle()),
          center: camera.center,
          zoom: camera.zoom,
          pitch: camera.pitch,
          bearing: camera.bearing,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: WROCLAW_MAX_BOUNDS,
          attributionControl: false,
          maplibreLogo: false
        })
    );

    // ODbL requires a visible OpenStreetMap credit: compact control, styled in styles.scss.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    map.once('style.load', () => this.zone.run(() => this.styleLoaded.set(true)));
    map.once('load', () => {
      this.bindInteractions(map);
      // "ready" once the first frame with tiles has been drawn, so the splash reveals a finished map.
      map.once('idle', () => this.zone.run(() => this.status.set('ready')));
    });
    map.on('error', event => {
      // Tile-level errors are non-fatal; only a failure before the first load blocks the app.
      if (this.status() === 'loading') {
        console.error('[wroVIS] map failed to load', event.error);
        this.zone.run(() => this.status.set('error'));
      }
    });

    this.map = map;
    return map;
  }

  /** Keeps the camera centre clear of the HUD: header on top, the dock on the left (a bottom sheet on phones). */
  setHudPadding(top: number, bottom: number, left: number) {
    this.hud = { top, bottom, left };
    this.applyPadding();
  }

  /** Width of the right HUD panel (district ranking) the camera should keep clear of; 0 when none. */
  setRightInset(px: number) {
    if (px === this.rightInset) return;
    this.rightInset = px;
    this.applyPadding();
  }

  private applyPadding() {
    this.map?.setPadding({ top: this.hud.top, bottom: this.hud.bottom, left: Math.max(24, this.hud.left), right: Math.max(24, this.rightInset + 12) });
  }

  destroy() {
    this.map?.remove();
    this.map = null;
    this.hovered = null;
    this.selectedRef = null;
    this.styleLoaded.set(false);
    this.status.set('idle');
  }

  // ─── Style ────────────────────────────────────────────────────────────────

  private buildStyle() {
    const ctx: StyleContext = {
      mode: this.theme.mode(),
      lang: this.i18n.lang(),
      palette: this.state.palette(),
      layers: this.state.layers(),
      tool: this.state.tool(),
      walkMode: this.state.walkMode(),
      params: this.state.params(),
      stats: this.data.stats(),
      hidden: this.state.hiddenLegend(),
      walkActive: this.state.walkActive(),
      searchStreet: this.state.searchStreet()
    };
    const data = { districts: this.data.districts(), districtLabels: this.data.districtLabels() };
    return buildMapStyle(ctx, data, this.tokenTools(ctx.palette === 'normal' ? null : ctx.palette));
  }

  /**
   * Token readers memoised per build (a style touches ~40 tokens; `getComputedStyle` is called once each).
   * On a styled map (neon, sunset), the theme tokens that shared layers use for casings, halos and highlights
   * read the palette's roles instead.
   */
  private tokenTools(palette: StyledPalette | null): StyleTools {
    const colors = new Map<string, string>();
    return {
      color: token => {
        let value = colors.get(token);
        if (value === undefined) {
          const role = palette ? PALETTE_TOKEN_ROLE[token] : undefined;
          value = this.theme.getTokenColor(role && palette ? cyberToken(role, palette) : token, '#ff00ff');
          colors.set(token, value);
        }
        return value;
      },
      opacity: token => this.theme.getTokenOpacity(token, 1)
    };
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  /** Flies to a point (address search); resolves once the camera has settled, so features there can be picked. */
  flyToPoint(lngLat: [number, number], minZoom = 16.5): Promise<void> {
    const map = this.map;
    if (!map) return Promise.resolve();
    return new Promise(resolve => {
      this.zone.runOutsideAngular(() => {
        map.once('moveend', () => resolve());
        map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), minZoom), duration: prefersReducedMotion() ? 0 : 1000, essential: true });
      });
    });
  }

  /** Frames a set of points (route waypoints); a single point is centred at street level. */
  fitPoints(points: [number, number][]) {
    const map = this.map;
    if (!map || !points.length) return;
    if (points.length === 1) {
      void this.flyToPoint(points[0], 15);
      return;
    }
    const bounds = new LngLatBounds();
    for (const p of points) bounds.extend(p);
    this.zone.runOutsideAngular(() => map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: prefersReducedMotion() ? 0 : 900 }));
  }

  /**
   * Cinematic flight after the splash: from the whole city down over the Odra and Ostrów Tumski to the Market
   * Square. Runs once; any drag, wheel or touch stops it where it is (MapLibre ends the animation, the chain stops).
   */
  playIntro() {
    const map = this.map;
    if (!map || !this.introPending) return;
    this.introPending = false;
    let stopped = false;
    const stop = () => (stopped = true);
    const events = ['mousedown', 'touchstart', 'wheel', 'keydown'] as const;
    this.zone.runOutsideAngular(() => {
      for (const ev of events) map.getCanvasContainer().addEventListener(ev, stop, { once: true, passive: true });
      const cleanup = () => events.forEach(ev => map.getCanvasContainer().removeEventListener(ev, stop));
      const run = (i: number) => {
        if (stopped || i >= INTRO_STOPS.length) return cleanup();
        const { camera, duration, fly } = INTRO_STOPS[i];
        map.once('moveend', () => run(i + 1));
        if (fly) map.flyTo({ ...camera, duration, curve: 1.25, essential: true });
        else map.easeTo({ ...camera, duration, easing: t => t * t * (3 - 2 * t), essential: true });
      };
      run(0);
    });
  }

  /** Frames a street from the search box and pulses its highlight. */
  fitStreet([w, s, e, n]: [number, number, number, number]) {
    const map = this.map;
    if (!map) return;
    // A street with a single address has an empty extent: pad it to ~150 m.
    const pad = 0.0012;
    const bounds = new LngLatBounds([w - (e - w < pad ? pad : 0), s - (n - s < pad ? pad / 1.6 : 0)], [e + (e - w < pad ? pad : 0), n + (n - s < pad ? pad / 1.6 : 0)]);
    this.zone.runOutsideAngular(() => {
      map.once('moveend', () => this.pulseStreet());
      map.fitBounds(bounds, { padding: 60, maxZoom: 16.5, pitch: Math.min(map.getPitch(), 45), duration: prefersReducedMotion() ? 0 : 1300, essential: true });
    });
  }

  /**
   * Pulses the glow of the picked street a few times (~4 s), then leaves it at its resting opacity: a short,
   * self-ending animation, as everything else on this map (nothing keeps redrawing the 3D city in the background).
   */
  private pulseStreet() {
    const map = this.map;
    if (!map || !map.getLayer('search-street-glow')) return;
    cancelAnimationFrame(this.pulseFrame);
    if (prefersReducedMotion()) return;
    const period = 800, cycles = 5;
    const t0 = performance.now();
    const step = (now: number) => {
      if (!map.getLayer('search-street-glow')) return;
      const p = (now - t0) / period;
      if (p >= cycles) {
        map.setPaintProperty('search-street-glow', 'line-opacity', SEARCH_GLOW_OPACITY);
        return;
      }
      // 0.1 → 0.9 → 0.1 per cycle.
      map.setPaintProperty('search-street-glow', 'line-opacity', 0.1 + 0.8 * Math.sin(Math.PI * (p % 1)) ** 2);
      this.pulseFrame = requestAnimationFrame(step);
    };
    this.zone.runOutsideAngular(() => (this.pulseFrame = requestAnimationFrame(step)));
  }

  /** Building drawn at a geographic point (after `flyToPoint`), or null. */
  buildingAt(lngLat: [number, number]): PickedFeature | null {
    const map = this.map;
    if (!map) return null;
    const layers = ['bld-extrusion', 'cy-bld'].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    if (!layers.length) return null;
    const point = map.project(lngLat);
    const feature = map.queryRenderedFeatures(point, { layers })[0];
    if (!feature || feature.id === undefined || feature.id === null) return null;
    return {
      layerId: feature.layer.id,
      source: feature.source,
      sourceLayer: feature.sourceLayer,
      id: feature.id,
      properties: feature.properties ?? {},
      x: point.x,
      y: point.y,
      lngLat
    };
  }

  /** Frames a district; the map padding (HUD and ranking panel) is added by MapLibre on top of `padding`. */
  focusDistrict(id: number) {
    const map = this.map;
    const feature = this.data.districts()?.features.find(f => f.properties?.['id'] === id);
    if (!map || !feature) return;
    const bounds = new LngLatBounds();
    const visit = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') bounds.extend(c as [number, number]);
      else if (Array.isArray(c)) c.forEach(visit);
    };
    visit((feature.geometry as Polygon | MultiPolygon).coordinates);
    this.zone.runOutsideAngular(() =>
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: prefersReducedMotion() ? 0 : 900 })
    );
  }

  // ─── Hover & click ────────────────────────────────────────────────────────

  private bindInteractions(map: MapLibreMap) {
    map.on('mousemove', e => this.onPointerMove(e));
    map.on('mouseout', () => this.setHover(null));
    map.on('dragstart', () => this.setHover(null));
    map.on('click', e => this.onClick(e));
  }

  private interactiveLayerIds(map: MapLibreMap): string[] {
    // While planning a route, a click places a waypoint, so features do not react to the pointer.
    if (routeActive({ tool: this.state.tool(), walkMode: this.state.walkMode() })) return [];
    const ids = interactiveLayers({ layers: this.state.layers(), tool: this.state.tool(), walkMode: this.state.walkMode() });
    return ids.filter(id => map.getLayer(id) !== undefined && map.getLayoutProperty(id, 'visibility') !== 'none');
  }

  private pick(map: MapLibreMap, point: PointLike & { x: number; y: number }): PickedFeature | null {
    const layers = this.interactiveLayerIds(map);
    if (!layers.length) return null;
    const feature = map.queryRenderedFeatures(point, { layers })[0];
    if (!feature || feature.id === undefined || feature.id === null) return null;
    return {
      layerId: feature.layer.id,
      source: feature.source,
      sourceLayer: feature.sourceLayer,
      id: feature.id,
      properties: feature.properties ?? {},
      x: point.x,
      y: point.y,
      lngLat: map.unproject(point).toArray() as [number, number]
    };
  }

  private onPointerMove(e: MapMouseEvent) {
    const map = this.map;
    if (!map) return;
    const pick = this.pick(map, e.point);
    if (pick || this.hovered) this.zone.run(() => this.pointer.set({ x: e.point.x, y: e.point.y }));
    if (sameFeature(pick, this.hovered)) return;
    this.setHover(pick);
  }

  private setHover(pick: PickedFeature | null) {
    const map = this.map;
    if (!map) return;
    if (this.hovered) map.removeFeatureState(featureRef(this.hovered), 'hover');
    if (pick) map.setFeatureState(featureRef(pick), { hover: true });
    this.hovered = pick;
    map.getCanvas().style.cursor = pick ? 'pointer' : '';
    this.zone.run(() => this.state.hovered.set(pick));
  }

  private onClick(e: MapMouseEvent) {
    const map = this.map;
    if (!map) return;
    const point: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    // Route planner (walking or bike): a click adds a waypoint, unless it lands on one, which starts a drag instead.
    if (routeActive({ tool: this.state.tool(), walkMode: this.state.walkMode() })) {
      const onPoint = map.getLayer('rt-points') && map.queryRenderedFeatures(e.point, { layers: ['rt-points'] }).length > 0;
      if (!onPoint) this.zone.run(() => this.state.routePoints.update(p => [...p, point]));
      return;
    }
    const pick = this.pick(map, e.point);
    // Walking reach: a click (re)starts the reach from that point; a clicked building or place is selected
    // as well, so its card shows next to it.
    if (this.state.tool() === 'walk') {
      const keep = pick && (pick.layerId === 'bld-extrusion' || pick.layerId === 'cy-bld' || pick.layerId === 'wk-places');
      this.zone.run(() => {
        this.state.walkOrigin.set(point);
        this.state.selected.set(keep ? pick : null);
      });
      return;
    }
    this.zone.run(() => this.state.selected.set(pick));
  }

  private applySelected(selected: PickedFeature | null) {
    const map = this.map;
    if (!map) return;
    if (this.selectedRef) map.removeFeatureState(this.selectedRef, 'selected');
    this.selectedRef = selected ? featureRef(selected) : null;
    if (this.selectedRef) map.setFeatureState(this.selectedRef, { selected: true });
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function featureRef(pick: PickedFeature): FeatureIdentifier {
  return { source: pick.source, sourceLayer: pick.sourceLayer, id: pick.id };
}

function sameFeature(a: PickedFeature | null, b: PickedFeature | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.source === b.source && a.sourceLayer === b.sourceLayer && a.layerId === b.layerId;
}
