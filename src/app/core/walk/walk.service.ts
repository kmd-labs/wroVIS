import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import { DATA_PATHS, SRC_WALK_ORIGIN, SRC_WALK_PLACES, SRC_WALK_STREETS, SRC_WROVIS, assetUrl } from '../map/map.config';
import { MapService } from '../map/map.service';
import { hiddenWalkBands, walkFilter } from '../map/layers.registry';
import { liveSourceData } from '../map/live-sources';
import { AppState } from '../state/app.state';
import { PLACE_CATS, PlaceCat, WALK_M_PER_MIN, WalkGraph, decodeWalkGraph, nearestVertex, reach, shortestPaths } from './walk-graph';

export type WalkStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlaceStat {
  cat: PlaceCat;
  count: number;
  /** Minutes to the nearest place of the category, or null when none is in reach. */
  nearest: number | null;
}

/** Duration of the reach "wave" after a click, ms. */
const WAVE_MS = 1100;

/**
 * Walking reach in the 3D buildings view: loads the pedestrian graph on the first click, and on every click (or change of the
 * time limit) runs Dijkstra from the clicked point, writes the reached streets and places into GeoJSON
 * sources once, and plays a short wave that grows the reach from the origin. Nothing runs in between.
 */
@Injectable({ providedIn: 'root' })
export class WalkService {
  private readonly zone = inject(NgZone);
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);

  readonly status = signal<WalkStatus>('idle');
  private readonly graph = signal<WalkGraph | null>(null);
  /** Places reached within the current limit (category and minutes). */
  private readonly reached = signal<{ cat: PlaceCat; t: number }[] | null>(null);
  /** True when the clicked point is too far from any footpath. */
  readonly outside = signal(false);

  readonly stats = computed<PlaceStat[] | null>(() => {
    const places = this.reached();
    if (!places) return null;
    return PLACE_CATS.map(cat => {
      const own = places.filter(p => p.cat === cat);
      return { cat, count: own.length, nearest: own.length ? Math.min(...own.map(p => p.t)) : null };
    });
  });

  private lastOrigin: [number, number] | null = null;
  private wave = 0;
  /** Last reach, kept so buildings loaded after a pan can be marked without a new search. */
  private last: { graph: WalkGraph; dist: Float64Array; origin: [number, number]; maxMetres: number } | null = null;
  /** Buildings currently carrying the `wt` feature-state (ids in the wroVIS tiles). */
  private marked = new Set<number | string>();
  private moveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Load the graph on the first click (the 3D buildings view is the start view, so not on open).
    effect(() => {
      if (this.state.walkOrigin() && this.status() === 'idle') untracked(() => this.load());
    });

    // Switching the reach off clears everything it drew.
    effect(() => {
      if (!this.state.walkActive()) untracked(() => this.reset());
    });

    // Buildings come with tiles: after a pan or zoom, mark the newly loaded ones against the last reach.
    effect(() => {
      if (this.mapService.status() !== 'ready') return;
      untracked(() => {
        this.mapService.instance?.on('moveend', () => {
          if (!this.last) return;
          if (this.moveTimer) clearTimeout(this.moveTimer);
          this.moveTimer = setTimeout(() => this.markBuildings(), 250);
        });
      });
    });

    // Recompute on a new origin or time limit; play the wave only for a new origin.
    effect(() => {
      if (!this.state.walkActive()) return;
      const origin = this.state.walkOrigin();
      const minutes = this.state.params().walkMinutes;
      const graph = this.graph();
      const ready = this.mapService.status() === 'ready';
      if (!origin || !graph || !ready) return;
      untracked(() => {
        const isNewOrigin = origin !== this.lastOrigin;
        this.lastOrigin = origin;
        this.compute(graph, origin, minutes, isNewOrigin);
      });
    });
  }

  /** Removes the drawn reach, the counters and the building marks (origin state is left to the caller). */
  private reset() {
    cancelAnimationFrame(this.wave);
    this.lastOrigin = null;
    this.last = null;
    this.reached.set(null);
    this.outside.set(false);
    this.write(EMPTY, EMPTY, EMPTY);
    this.unmarkBuildings();
  }

  private async load() {
    this.status.set('loading');
    try {
      const res = await fetch(assetUrl(DATA_PATHS.walkGraph));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = await res.arrayBuffer();
      // The file is gzip; a server that already sent Content-Encoding: gzip hands over the raw graph instead.
      const head = new Uint8Array(bytes, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) {
        bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
      this.graph.set(decodeWalkGraph(bytes));
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] walk graph failed to load', err);
      this.status.set('error');
    }
  }

  private compute(graph: WalkGraph, [lon, lat]: [number, number], minutes: number, animate: boolean) {
    const start = nearestVertex(graph, lon, lat);
    const origin: FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }] };
    if (!start) {
      this.outside.set(true);
      this.reached.set(null);
      this.last = null;
      this.write(EMPTY, EMPTY, origin);
      this.unmarkBuildings();
      return;
    }
    this.outside.set(false);
    const maxMetres = minutes * WALK_M_PER_MIN;
    // The way from the clicked point to the network is counted as a straight line plus 20 %.
    const dist = shortestPaths(graph, start.v, start.d * 1.2, maxMetres);
    const result = reach(graph, dist, maxMetres);
    this.reached.set(result.places.features.map(f => f.properties));
    this.write(result.streets, result.places, origin);
    this.last = { graph, dist, origin: [lon, lat], maxMetres };
    if (animate) this.playWave(minutes);
    else this.markBuildings();
  }

  /**
   * Marks buildings within the reach with feature-state `wt` (walking minutes); the style greys out the rest.
   * Only buildings in loaded tiles exist on the client, so this runs again after every pan or zoom.
   */
  private markBuildings() {
    const map = this.mapService.instance;
    const last = this.last;
    if (!map || !last || !map.getSource(SRC_WROVIS)) return;
    this.zone.runOutsideAngular(() => {
      const { graph, dist, origin, maxMetres } = last;
      const next = new Map<number | string, number>();
      const [ox, oy] = origin;
      for (const f of map.querySourceFeatures(SRC_WROVIS, { sourceLayer: 'buildings' })) {
        if (f.id === undefined || f.id === null || next.has(f.id)) continue;
        const c = ringCentre(f.geometry);
        if (!c) continue;
        // Cheap straight-line cut first: nothing beyond the walking limit can be within it.
        if (Math.hypot((c[0] - ox) * M_LON, (c[1] - oy) * M_LAT) > maxMetres + 60) continue;
        const v = nearestVertex(graph, c[0], c[1]);
        if (!v) continue;
        const metres = dist[v.v] + v.d;
        if (metres <= maxMetres) next.set(f.id, metres / WALK_M_PER_MIN);
      }
      for (const id of this.marked) if (!next.has(id)) map.removeFeatureState({ source: SRC_WROVIS, sourceLayer: 'buildings', id }, 'wt');
      for (const [id, t] of next) map.setFeatureState({ source: SRC_WROVIS, sourceLayer: 'buildings', id }, { wt: t });
      this.marked = new Set(next.keys());
    });
  }

  private unmarkBuildings() {
    const map = this.mapService.instance;
    if (map && map.getSource(SRC_WROVIS)) {
      for (const id of this.marked) map.removeFeatureState({ source: SRC_WROVIS, sourceLayer: 'buildings', id }, 'wt');
    }
    this.marked.clear();
  }

  /** Grows the reach from 0 to `minutes` by animating the layer filters, then restores the style's own filter. */
  private playWave(minutes: number) {
    const map = this.mapService.instance;
    if (!map) return;
    cancelAnimationFrame(this.wave);
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Streets respect the minute bands switched off in the legend; places only the time.
    const hiddenBands = hiddenWalkBands(this.state.hiddenLegend());
    const setAll = (t: number) => {
      if (map.getLayer('wk-streets')) map.setFilter('wk-streets', walkFilter(t, hiddenBands));
      if (map.getLayer('wk-places')) map.setFilter('wk-places', walkFilter(t));
    };
    if (reduce) {
      setAll(minutes);
      this.markBuildings();
      return;
    }
    this.zone.runOutsideAngular(() => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / WAVE_MS);
        // Ease-out: fast near the origin, slowing towards the limit.
        setAll(minutes * (1 - (1 - p) ** 3));
        if (p < 1) this.wave = requestAnimationFrame(step);
        // Buildings light up once the wave has reached its limit.
        else this.markBuildings();
      };
      this.wave = requestAnimationFrame(step);
    });
  }

  private write(streets: FeatureCollection, places: FeatureCollection, origin: FeatureCollection) {
    liveSourceData.set(SRC_WALK_STREETS, streets);
    liveSourceData.set(SRC_WALK_PLACES, places);
    liveSourceData.set(SRC_WALK_ORIGIN, origin);
    const map = this.mapService.instance;
    (map?.getSource(SRC_WALK_STREETS) as GeoJSONSource | undefined)?.setData(streets);
    (map?.getSource(SRC_WALK_PLACES) as GeoJSONSource | undefined)?.setData(places);
    (map?.getSource(SRC_WALK_ORIGIN) as GeoJSONSource | undefined)?.setData(origin);
  }
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const M_LAT = 110540;
const M_LON = 111320 * Math.cos((51.11 * Math.PI) / 180);

/** Mean of the outer ring's vertices: close enough to a building's centre for snapping to the network. */
function ringCentre(g: Geometry): [number, number] | null {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null;
  if (!ring || !ring.length) return null;
  let x = 0, y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}
