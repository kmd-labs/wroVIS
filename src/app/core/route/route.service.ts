import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, MapLayerMouseEvent, MapLayerTouchEvent, Map as MapLibreMap } from 'maplibre-gl';
import { SRC_ROUTE, SRC_ROUTE_POINTS } from '../map/map.config';
import { MapService } from '../map/map.service';
import { liveSourceData } from '../map/live-sources';
import type { RouteProfile } from '../map/map.types';
import { AppState } from '../state/app.state';
import { GraphStore, LoadedGraph, PROFILE_GRAPH } from '../walk/graph-store';
import { Leg, WALK_M_PER_MIN, routeLeg } from '../walk/walk-graph';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Waypoint letters A, B, C… (after Z: 27, 28…). */
export function pointLabel(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}

/** Edge kinds of the bike graph (see tools/pipeline/src/10-extract.mjs, `bikeKind`). */
export const EDGE_CALM_STREET = 0;
export const EDGE_CYCLEWAY = 1;
export const EDGE_BUSY_STREET = 2;

/**
 * Cost multiplier per edge kind for "via streets": a street metre counts as 1.25 cycleway metres and a busy
 * street metre as 1.7, so the route takes a cycleway when it costs at most a modest detour.
 */
const BIKE_STREET_COST = [1.25, 1, 1.7];

/** Cycling speed used for the time estimate, km/h. */
const BIKE_KMH = 15;

/** Totals of the current route for the dock. */
export interface RouteSummary {
  metres: number;
  minutes: number;
  /** Bike via streets: metres on cycle infrastructure and on streets. */
  cycleMetres: number;
  streetMetres: number;
}

/**
 * Route planner of the "15-minute city" (shortest walking route) and bike tools. Loads the network of the
 * active profile on first use; every click adds a waypoint, waypoints can be dragged, and each leg is the
 * shortest path along the network. Profiles share the waypoints, so one route can be compared on foot,
 * by bike via streets and strictly along cycleways. Legs whose points share no connected piece of the
 * network are drawn as a dashed straight line and reported in the dock.
 */
@Injectable({ providedIn: 'root' })
export class RouteService {
  private readonly zone = inject(NgZone);
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);
  private readonly graphs = inject(GraphStore);

  readonly status = signal<RouteStatus>('idle');
  private readonly loaded = signal<{ profile: RouteProfile; graph: LoadedGraph } | null>(null);
  /** Routed legs between consecutive waypoints. */
  readonly legs = signal<Leg[]>([]);

  readonly summary = computed<RouteSummary>(() => {
    const profile = this.loaded()?.profile;
    let metres = 0, cycleMetres = 0, streetMetres = 0;
    for (const leg of this.legs()) {
      metres += leg.metres ?? 0;
      for (const p of leg.parts) {
        if (p.kind === EDGE_CYCLEWAY) cycleMetres += p.metres;
        else streetMetres += p.metres;
      }
    }
    const minutes = profile === 'walk' ? metres / WALK_M_PER_MIN : metres / ((BIKE_KMH * 1000) / 60);
    return { metres, minutes, cycleMetres, streetMetres };
  });

  private dragIndex: number | null = null;
  private loadToken = 0;

  constructor() {
    // Load the network of the active profile; switching profiles keeps the waypoints and re-routes them.
    effect(() => {
      const profile = this.state.routeProfile();
      if (!profile) return;
      untracked(() => this.load(profile));
    });

    // Re-route whenever the waypoints or the network change (clicks, drag end, undo, clear, profile).
    effect(() => {
      const points = this.state.routePoints();
      const loaded = this.loaded();
      if (this.mapService.status() !== 'ready') return;
      untracked(() => this.route(points, loaded));
    });

    // Waypoint dragging, bound once when the map is ready.
    effect(() => {
      if (this.mapService.status() !== 'ready') return;
      untracked(() => {
        const map = this.mapService.instance;
        if (map) this.zone.runOutsideAngular(() => this.bindDrag(map));
      });
    });
  }

  undo() {
    this.state.routePoints.update(p => p.slice(0, -1));
  }

  clear() {
    this.state.routePoints.set([]);
  }

  /** Appends a waypoint (map click or address search). */
  add(point: [number, number]) {
    this.state.routePoints.update(p => [...p, point]);
  }

  private async load(profile: RouteProfile) {
    if (this.loaded()?.profile === profile) return;
    const token = ++this.loadToken;
    this.status.set('loading');
    try {
      const graph = await this.graphs.load(PROFILE_GRAPH[profile]);
      if (token !== this.loadToken) return;
      this.loaded.set({ profile, graph });
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] route graph failed to load', err);
      if (token === this.loadToken) this.status.set('error');
    }
  }

  /** Routes all legs and writes the route and waypoint sources. */
  private route(points: [number, number][], loaded: { profile: RouteProfile; graph: LoadedGraph } | null) {
    const legs: Leg[] = [];
    if (loaded) {
      const cost = loaded.profile === 'bikeStreets' ? BIKE_STREET_COST : undefined;
      for (let i = 1; i < points.length; i++) legs.push(routeLeg(loaded.graph.g, loaded.graph.comp, points[i - 1], points[i], cost));
    }
    this.zone.run(() => this.legs.set(legs));
    this.write(points, legs, loaded?.profile === 'bikeStreets');
  }

  private write(points: [number, number][], legs: Leg[], markStreets: boolean) {
    const route: Feature[] = [];
    legs.forEach((leg, i) => {
      if (leg.metres === null) {
        route.push(line(leg.coords, 'gap'));
        return;
      }
      if (markStreets) {
        // Stretches on streets are drawn dashed, so the share of cycle infrastructure reads at a glance.
        for (const part of leg.parts) route.push(line(part.coords, 'leg', part.kind !== EDGE_CYCLEWAY));
      } else {
        route.push(line(leg.coords, 'leg'));
      }
      if (leg.from) route.push(line([points[i], leg.from], 'approach'));
      if (leg.to) route.push(line([leg.to, points[i + 1]], 'approach'));
    });
    const pts: Feature[] = points.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { i, label: pointLabel(i) } }));
    const routeFc: FeatureCollection = { type: 'FeatureCollection', features: route };
    const pointFc: FeatureCollection = { type: 'FeatureCollection', features: pts };
    liveSourceData.set(SRC_ROUTE, routeFc);
    liveSourceData.set(SRC_ROUTE_POINTS, pointFc);
    const map = this.mapService.instance;
    (map?.getSource(SRC_ROUTE) as GeoJSONSource | undefined)?.setData(routeFc);
    (map?.getSource(SRC_ROUTE_POINTS) as GeoJSONSource | undefined)?.setData(pointFc);
  }

  // ─── Dragging waypoints ───────────────────────────────────────────────────

  private bindDrag(map: MapLibreMap) {
    const canvas = map.getCanvas();
    map.on('mouseenter', 'rt-points', () => {
      if (this.dragIndex === null) canvas.style.cursor = 'grab';
    });
    map.on('mouseleave', 'rt-points', () => {
      if (this.dragIndex === null) canvas.style.cursor = '';
    });

    let working: [number, number][] = [];
    const move = (lngLat: { lng: number; lat: number }) => {
      if (this.dragIndex === null) return;
      working[this.dragIndex] = [lngLat.lng, lngLat.lat];
      // Legs route in a few milliseconds (A*), so the route follows the pointer live.
      this.route(working, untracked(this.loaded));
    };
    const end = () => {
      if (this.dragIndex === null) return;
      this.dragIndex = null;
      canvas.style.cursor = '';
      map.off('mousemove', onMouseMove);
      map.off('touchmove', onTouchMove);
      const committed = working.slice();
      this.zone.run(() => this.state.routePoints.set(committed));
    };
    const onMouseMove = (e: MapLayerMouseEvent | { lngLat: { lng: number; lat: number } }) => move(e.lngLat);
    const onTouchMove = (e: MapLayerTouchEvent) => {
      e.preventDefault();
      move(e.lngLat);
    };
    const start = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (untracked(this.state.routeProfile) === null) return;
      const i = Number(e.features?.[0]?.properties?.['i']);
      if (!Number.isInteger(i)) return;
      // Keeps the map from panning while a waypoint is dragged.
      e.preventDefault();
      this.dragIndex = i;
      working = untracked(this.state.routePoints).slice();
      canvas.style.cursor = 'grabbing';
      map.on('mousemove', onMouseMove);
      map.on('touchmove', onTouchMove);
      map.once('mouseup', end);
      map.once('touchend', end);
    };
    map.on('mousedown', 'rt-points', start);
    map.on('touchstart', 'rt-points', e => {
      if (e.points.length === 1) start(e);
    });
  }
}

function line(coords: [number, number][], kind: 'leg' | 'gap' | 'approach', street = false): Feature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: street ? { kind, street: 1 } : { kind } };
}
