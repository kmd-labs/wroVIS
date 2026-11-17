import { Injectable, computed, signal } from '@angular/core';
import { DEFAULT_VIEW_PARAMS, PickedFeature, VIEW_IDS, ViewId, ViewParams } from '../map/map.types';

const VIEW_STORAGE_KEY = 'wrovis.view';

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
  readonly params = signal<ViewParams>({ ...DEFAULT_VIEW_PARAMS });

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
