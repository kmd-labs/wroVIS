import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { FeatureCollection, LineString } from 'geojson';
import { BRIDGE_LEGEND, isHidden } from '../map/layers.registry';
import { DATA_PATHS, assetUrl } from '../map/map.config';
import { AppState } from '../state/app.state';
import { BRIDGE_ALL_M } from '../map/map.types';

interface Segment {
  kind: string;
  /** Length of the whole bridge (its longest segment), m. */
  length: number;
  /** Bridge the segment belongs to (index into the grouping). */
  group: number;
}

/**
 * Counts bridges for the dock of the bridges view from `bridges.geojson` (one feature per OSM way on a
 * bridge). The pipeline groups segments into bridges (same name, or unnamed ends within 30 m) and gives
 * each its bridge id and length, so whole bridges are counted and filtered by length exactly like the map,
 * together with the bridge kinds switched off in the legend.
 */
@Injectable({ providedIn: 'root' })
export class BridgeCountService {
  private readonly state = inject(AppState);
  private readonly segments = signal<Segment[] | null>(null);
  private loading = false;

  /** Visible bridges and segments, or null before the data is loaded. */
  readonly counts = computed(() => {
    const segments = this.segments();
    if (!segments) return null;
    const max = this.state.params().bridgesMaxLength;
    const limit = max < BRIDGE_ALL_M ? max : Infinity;
    const ctx = { hidden: this.state.hiddenLegend() };
    const hiddenKinds = new Set(BRIDGE_LEGEND.filter(([key]) => isHidden(ctx, 'bridges', key)).map(([, kind]) => kind));
    const groups = new Set<number>();
    let visible = 0;
    for (const s of segments) {
      if (s.length > limit || hiddenKinds.has(s.kind)) continue;
      visible++;
      groups.add(s.group);
    }
    return { bridges: groups.size, segments: visible };
  });

  constructor() {
    effect(() => {
      if (this.state.currentView() === 'bridges' && !this.segments() && !this.loading) untracked(() => this.load());
    });
  }

  private async load() {
    this.loading = true;
    try {
      const res = await fetch(assetUrl(DATA_PATHS.bridges));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.segments.set(toSegments((await res.json()) as FeatureCollection<LineString>));
    } catch (err) {
      console.error('[wroVIS] bridges failed to load', err);
    } finally {
      this.loading = false;
    }
  }
}

/** Segments with the bridge id and length computed by the pipeline (tools/pipeline/src/lib/bridge-groups.mjs). */
function toSegments(fc: FeatureCollection<LineString>): Segment[] {
  return fc.features.map(f => ({
    kind: String(f.properties?.['kind'] ?? 'other'),
    length: Number(f.properties?.['blen'] ?? f.properties?.['length_m'] ?? 0),
    group: Number(f.properties?.['bid'] ?? -1)
  }));
}
