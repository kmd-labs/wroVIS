import { Injectable, computed, signal } from '@angular/core';
import { CYBER_PALETTES, CyberPalette, DEFAULT_VIEW_PARAMS, PickedFeature, VIEW_IDS, ViewId, ViewParams } from '../map/map.types';

const VIEW_STORAGE_KEY = 'wrovis.view';
const PALETTE_STORAGE_KEY = 'wrovis.cyberPalette';

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

  setView(view: ViewId) {
    if (view === this.currentView()) return;
    this.currentView.set(view);
    this.hovered.set(null);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage unavailable
    }
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
