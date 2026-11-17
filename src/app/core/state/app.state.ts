import { Injectable, computed, signal } from '@angular/core';
import { CYBER_PALETTES, CyberPalette, DEFAULT_VIEW_PARAMS, PickedFeature, TransitMode, VIEW_IDS, ViewId, ViewParams } from '../map/map.types';

const VIEW_STORAGE_KEY = 'wrovis.view';
const PALETTE_STORAGE_KEY = 'wrovis.cyberPalette';
const WALK_STORAGE_KEY = 'wrovis.walk';

function isViewId(val: string | null): val is ViewId {
  return (VIEW_IDS as readonly string[]).includes(val ?? '');
}

/**
 * Application state shared between the HUD, the dock and the map: current view, dock parameters,
 * hovered and selected thematic features. Plain signals; the map reacts through effects.
 */
@Injectable({ providedIn: 'root' })
export class AppState {
  readonly currentView = signal<ViewId>(this.readStoredView());
  readonly params = signal<ViewParams>({ ...DEFAULT_VIEW_PARAMS, cyberPalette: this.readStoredPalette() });

  readonly hovered = signal<PickedFeature | null>(null);
  readonly selected = signal<PickedFeature | null>(null);

  readonly hasHover = computed(() => this.hovered() !== null);

  /** District id highlighted from the ranking panel (hover or keyboard focus on its row). */
  readonly highlightedDistrict = signal<number | null>(null);
  /** Ranking bottom sheet on phones (on wider screens the panel is always shown in the districts view). */
  readonly rankingSheetOpen = signal(false);
  /** Starting point of the walking reach ([lon, lat]), set by a click in the 3D buildings view. */
  readonly walkOrigin = signal<[number, number] | null>(null);
  /** Walking reach on/off in the 3D buildings view (off by default; remembered). */
  readonly walkEnabled = signal<boolean>(this.readStoredWalk());
  /** True while a reach is shown: enabled and a point was clicked. */
  readonly walkActive = computed(() => this.walkEnabled() && this.walkOrigin() !== null);

  /** Transport view mode: tram stop radius slider, or the bike route planner. */
  readonly transitMode = signal<TransitMode>('radius');
  /** Waypoints of the bike route ([lon, lat]), in order. */
  readonly bikePoints = signal<[number, number][]>([]);

  /** Legend entries switched off by the user, as `view:labelKey`; session only (reset on reload). */
  readonly hiddenLegend = signal<ReadonlySet<string>>(new Set());

  setWalkEnabled(on: boolean) {
    this.walkEnabled.set(on);
    if (!on) this.walkOrigin.set(null);
    try {
      localStorage.setItem(WALK_STORAGE_KEY, on ? '1' : '0');
    } catch {
      // localStorage unavailable
    }
  }

  toggleLegend(view: ViewId, key: string) {
    const id = `${view}:${key}`;
    this.hiddenLegend.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  setView(view: ViewId) {
    if (view === this.currentView()) return;
    this.currentView.set(view);
    this.hovered.set(null);
    this.selected.set(null);
    this.highlightedDistrict.set(null);
    this.rankingSheetOpen.set(false);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage unavailable
    }
  }

  /** Switches the choropleth metric; the highlight threshold resets because scales differ between metrics. */
  setDistrictMetric(metric: ViewParams['districtsMetric']) {
    if (metric === this.params().districtsMetric) return;
    this.params.update(p => ({ ...p, districtsMetric: metric, districtsThreshold: 0 }));
  }

  setParam<K extends keyof ViewParams>(key: K, value: ViewParams[K]) {
    this.params.update(p => (p[key] === value ? p : { ...p, [key]: value }));
    if (key === 'cyberPalette') {
      try {
        localStorage.setItem(PALETTE_STORAGE_KEY, String(value));
      } catch {
        // localStorage unavailable
      }
    }
  }

  private readStoredWalk(): boolean {
    try {
      return localStorage.getItem(WALK_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private readStoredPalette(): CyberPalette {
    try {
      const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
      if ((CYBER_PALETTES as readonly string[]).includes(stored ?? '')) return stored as CyberPalette;
    } catch {
      // localStorage unavailable
    }
    return DEFAULT_VIEW_PARAMS.cyberPalette;
  }

  private readStoredView(): ViewId {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (isViewId(stored)) return stored;
    } catch {
      // localStorage unavailable
    }
    return 'buildings';
  }
}
