import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import { SRC_WALK_ORIGIN, SRC_WALK_PLACES, SRC_WALK_STREETS, SRC_WROVIS } from '../map/map.config';
import { MapService } from '../map/map.service';
import { hiddenWalkBands, walkFilter } from '../map/layers.registry';
import { liveSourceData } from '../map/live-sources';
import { AppState } from '../state/app.state';
import { PLACE_CATS, PlaceCat, WALK_M_PER_MIN, WalkGraph, componentSizes, nearestNetworkVertex, nearestVertex, reach, shortestPaths } from './walk-graph';
import { GraphStore } from './graph-store';

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
 * Walking reach of the "15-minute city" tool: loads the pedestrian graph when the tool opens, and on every click (or change of the
 * time limit) runs Dijkstra from the clicked point, writes the reached streets and places into GeoJSON
 * sources once, and plays a short wave that grows the reach from the origin. Nothing runs in between.
 */
@Injectable({ providedIn: 'root' })
export class WalkService {
  private readonly zone = inject(NgZone);
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);
  private readonly graphs = inject(GraphStore);

  readonly status = signal<WalkStatus>('idle');
  private readonly graph = signal<WalkGraph | null>(null);
  /** Component of every vertex and component sizes, for snapping a click to the connected street network. */
  private network: { comp: Int32Array; sizes: Uint32Array } | null = null;
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
  /** Buildings carrying the `wt` feature-state (ids in the wroVIS tiles) and their minutes. */
  private marked = new Map<number | string, number>();
  /** Verdict per building for the reach in `judgedFor`: minutes, or null when outside it. */
  private judged = new Map<number | string, number | null>();
  private judgedFor: object | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Load the graph as soon as the "15 minutes" tool opens (not at page load), so the first click answers at once.
    effect(() => {
      if ((this.state.tool() === 'walk' || this.state.walkOrigin()) && this.status() === 'idle') untracked(() => this.load());
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
      const { g, comp } = await this.graphs.load('walk');
      this.network = { comp, sizes: componentSizes(comp) };
      this.graph.set(g);
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] walk graph failed to load', err);
      this.status.set('error');
    }
  }

  private compute(graph: WalkGraph, [lon, lat]: [number, number], minutes: number, animate: boolean) {
    const start = this.network ? nearestNetworkVertex(graph, this.network.comp, this.network.sizes, lon, lat) : nearestVertex(graph, lon, lat);
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
      // A new reach starts a new verdict cache; after a pan only the newly loaded buildings are computed.
      const fresh = this.judgedFor !== last;
      if (fresh) {
        this.judged.clear();
        this.judgedFor = last;
      }
      const next = new Map<number | string, number>();
      const [ox, oy] = origin;
      for (const f of map.querySourceFeatures(SRC_WROVIS, { sourceLayer: 'buildings' })) {
        const id = f.id;
        if (id === undefined || id === null || next.has(id)) continue;
        let t = this.judged.get(id);
        if (t === undefined) {
          t = null;
          const c = ringCentre(f.geometry);
          // Cheap straight-line cut first: nothing beyond the walking limit can be within it.
          if (c && Math.hypot((c[0] - ox) * M_LON, (c[1] - oy) * M_LAT) <= maxMetres + 60) {
            const v = nearestVertex(graph, c[0], c[1]);
            const metres = v ? dist[v.v] + v.d : Infinity;
            if (metres <= maxMetres) t = metres / WALK_M_PER_MIN;
          }
          this.judged.set(id, t);
        }
        if (t !== null) next.set(id, t);
      }
      const ref = (id: number | string) => ({ source: SRC_WROVIS, sourceLayer: 'buildings', id });
      // Feature state changes re-upload the 3D buildings, so only the differences are written.
      if (fresh) {
        for (const id of this.marked.keys()) {
          if (next.has(id)) continue;
          map.removeFeatureState(ref(id), 'wt');
          this.marked.delete(id);
        }
      }
      for (const [id, t] of next) {
        if (this.marked.get(id) === t) continue;
        map.setFeatureState(ref(id), { wt: t });
        this.marked.set(id, t);
      }
    });
  }

  private unmarkBuildings() {
    const map = this.mapService.instance;
    if (map && map.getSource(SRC_WROVIS)) {
      for (const id of this.marked.keys()) map.removeFeatureState({ source: SRC_WROVIS, sourceLayer: 'buildings', id }, 'wt');
    }
    this.marked.clear();
    this.judged.clear();
    this.judgedFor = null;
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
