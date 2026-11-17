import { Injectable, NgZone, effect, inject, signal, untracked } from '@angular/core';
import {
  AttributionControl,
  FeatureIdentifier,
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
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, WROCLAW_MAX_BOUNDS } from './map.config';
import { PickedFeature, StyleContext, ViewId } from './map.types';
import { VIEWS } from './layers.registry';
import { buildMapStyle } from './style.builder';
import { StyleTools } from './style.expr';
import { StopPulse } from './stop-pulse';

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
 * The style is a pure function of (theme, language, view, dock parameters, loaded data), rebuilt by an
 * `effect()` and applied with `setStyle(style, { diff: true })`, so MapLibre only patches what changed:
 * switching views toggles layer visibility, moving a slider updates a filter or paint property, and
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
  private appliedView: ViewId | null = null;
  private pulse: StopPulse | null = null;

  /** Lifecycle of the map: idle → loading → ready (first frame rendered) | error. */
  readonly status = signal<MapStatus>('idle');

  /** Last pointer position over the canvas (container pixels), updated while a feature is hovered. */
  readonly pointer = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  /** The live MapLibre instance, or null before `init()` / after `destroy()`. */
  get instance(): MapLibreMap | null {
    return this.map;
  }

  constructor() {
    // Style follows theme, language, view, dock parameters and data; MapLibre diffs the result.
    effect(() => {
      const style = this.buildStyle();
      const map = this.map;
      if (!map || !this.styleLoaded()) return;
      untracked(() => this.zone.runOutsideAngular(() => map.setStyle(style, { diff: true })));
    });

    // Entering a view flies the camera to its preset.
    effect(() => {
      const view = this.state.currentView();
      if (!this.map || !this.styleLoaded() || this.appliedView === view) return;
      this.appliedView = view;
      untracked(() => this.flyToView(view));
    });

    // Tram stops pulse while the neon view is active (and the user has not asked for reduced motion).
    // Only after "ready": a running animation keeps repainting, so MapLibre would never fire the first `idle`.
    effect(() => {
      const active = this.state.currentView() === 'cyberpunk' && this.status() === 'ready';
      untracked(() => {
        if (!this.pulse) return;
        if (active && !prefersReducedMotion()) this.zone.runOutsideAngular(() => this.pulse?.start());
        else this.pulse.stop();
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
    const view = VIEWS[this.state.currentView()];
    this.appliedView = view.id;

    const map = this.zone.runOutsideAngular(
      () =>
        new MapLibreMap({
          container,
          style: untracked(() => this.buildStyle()),
          center: view.camera.center,
          zoom: view.camera.zoom,
          pitch: view.camera.pitch,
          bearing: view.camera.bearing,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: WROCLAW_MAX_BOUNDS,
          attributionControl: false,
          maplibreLogo: false
        })
    );

    // ODbL requires a visible OpenStreetMap credit: compact control, styled in styles.scss.
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    this.pulse = new StopPulse(map);
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

  /** Keeps the camera centre clear of the HUD (header on top, dock at the bottom). */
  setHudPadding(top: number, bottom: number) {
    this.map?.setPadding({ top, bottom, left: 24, right: 24 });
  }

  destroy() {
    this.pulse?.stop();
    this.pulse = null;
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
      view: this.state.currentView(),
      params: this.state.params(),
      stats: this.data.stats()
    };
    const data = { districts: this.data.districts(), districtLabels: this.data.districtLabels() };
    return buildMapStyle(ctx, data, this.tokenTools());
  }

  /** Token readers memoised per build (a style touches ~40 tokens; `getComputedStyle` is called once each). */
  private tokenTools(): StyleTools {
    const colors = new Map<string, string>();
    return {
      color: token => {
        let value = colors.get(token);
        if (value === undefined) {
          value = this.theme.getTokenColor(token, '#ff00ff');
          colors.set(token, value);
        }
        return value;
      },
      opacity: token => this.theme.getTokenOpacity(token, 1)
    };
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  private flyToView(view: ViewId) {
    const map = this.map;
    if (!map) return;
    this.zone.runOutsideAngular(() => map.easeTo({ ...VIEWS[view].camera, duration: prefersReducedMotion() ? 0 : 1100, essential: true }));
  }

  // ─── Hover & click ────────────────────────────────────────────────────────

  private bindInteractions(map: MapLibreMap) {
    map.on('mousemove', e => this.onPointerMove(e));
    map.on('mouseout', () => this.setHover(null));
    map.on('dragstart', () => this.setHover(null));
    map.on('click', e => this.onClick(e));
  }

  private interactiveLayerIds(map: MapLibreMap): string[] {
    return VIEWS[this.state.currentView()].interactive.filter(id => map.getLayer(id) !== undefined);
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
      y: point.y
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
    const pick = this.pick(map, e.point);
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
