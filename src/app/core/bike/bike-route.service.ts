import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, MapLayerMouseEvent, MapLayerTouchEvent, Map as MapLibreMap } from 'maplibre-gl';
import { DATA_PATHS, SRC_BIKE_POINTS, SRC_BIKE_ROUTE, assetUrl } from '../map/map.config';
import { MapService } from '../map/map.service';
import { liveSourceData } from '../map/live-sources';
import { AppState } from '../state/app.state';
import { Leg, WalkGraph, components, decodeWalkGraph, routeLeg } from '../walk/walk-graph';

export type BikeStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Waypoint letters A, B, C… (after Z: 27, 28…). */
export function pointLabel(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}

/**
 * Bike route planner of the transport view. Loads the cycle network (`cycle.bin.gz`) when the planner is
 * opened; every click adds a waypoint, waypoints can be dragged, and each leg is routed strictly along
 * cycleways connected in OpenStreetMap (no stretches on ordinary streets). Legs that share no connected
 * cycleway are drawn as a dashed straight line and reported in the dock.
 */
@Injectable({ providedIn: 'root' })
export class BikeRouteService {
  private readonly zone = inject(NgZone);
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);

  readonly status = signal<BikeStatus>('idle');
  private readonly graph = signal<{ g: WalkGraph; comp: Int32Array } | null>(null);
  /** Routed legs between consecutive waypoints. */
  readonly legs = signal<Leg[]>([]);
  readonly totalKm = computed(() => this.legs().reduce((s, l) => s + (l.metres ?? 0), 0) / 1000);

  private dragIndex: number | null = null;

  constructor() {
    const active = computed(() => this.state.currentView() === 'transit' && this.state.transitMode() === 'bike');

    effect(() => {
      if (active() && this.status() === 'idle') untracked(() => this.load());
    });

    // Re-route whenever the waypoints change (clicks, drag end, undo, clear).
    effect(() => {
      const points = this.state.bikePoints();
      const graph = this.graph();
      if (this.mapService.status() !== 'ready') return;
      untracked(() => this.route(points, graph));
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
    this.state.bikePoints.update(p => p.slice(0, -1));
  }

  clear() {
    this.state.bikePoints.set([]);
  }

  private async load() {
    this.status.set('loading');
    try {
      const res = await fetch(assetUrl(DATA_PATHS.cycleGraph));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = await res.arrayBuffer();
      const head = new Uint8Array(bytes, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) {
        bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
      const g = decodeWalkGraph(bytes);
      this.graph.set({ g, comp: components(g) });
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] cycle graph failed to load', err);
      this.status.set('error');
    }
  }

  /** Routes all legs and writes the route and waypoint sources. */
  private route(points: [number, number][], graph: { g: WalkGraph; comp: Int32Array } | null) {
    const legs: Leg[] = [];
    if (graph) for (let i = 1; i < points.length; i++) legs.push(routeLeg(graph.g, graph.comp, points[i - 1], points[i]));
    this.zone.run(() => this.legs.set(legs));
    this.write(points, legs);
  }

  private write(points: [number, number][], legs: Leg[]) {
    const route: Feature[] = [];
    legs.forEach((leg, i) => {
      if (leg.metres === null) {
        route.push(line(leg.coords, 'gap'));
        return;
      }
      route.push(line(leg.coords, 'leg'));
      if (leg.from) route.push(line([points[i], leg.from], 'approach'));
      if (leg.to) route.push(line([leg.to, points[i + 1]], 'approach'));
    });
    const pts: Feature[] = points.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { i, label: pointLabel(i) } }));
    const routeFc: FeatureCollection = { type: 'FeatureCollection', features: route };
    const pointFc: FeatureCollection = { type: 'FeatureCollection', features: pts };
    liveSourceData.set(SRC_BIKE_ROUTE, routeFc);
    liveSourceData.set(SRC_BIKE_POINTS, pointFc);
    const map = this.mapService.instance;
    (map?.getSource(SRC_BIKE_ROUTE) as GeoJSONSource | undefined)?.setData(routeFc);
    (map?.getSource(SRC_BIKE_POINTS) as GeoJSONSource | undefined)?.setData(pointFc);
  }

  // ─── Dragging waypoints ───────────────────────────────────────────────────

  private bindDrag(map: MapLibreMap) {
    const canvas = map.getCanvas();
    map.on('mouseenter', 'bk-points', () => {
      if (this.dragIndex === null) canvas.style.cursor = 'grab';
    });
    map.on('mouseleave', 'bk-points', () => {
      if (this.dragIndex === null) canvas.style.cursor = '';
    });

    let working: [number, number][] = [];
    const move = (lngLat: { lng: number; lat: number }) => {
      if (this.dragIndex === null) return;
      working[this.dragIndex] = [lngLat.lng, lngLat.lat];
      // Legs route in a few milliseconds, so the route follows the pointer live.
      this.route(working, untracked(this.graph));
    };
    const end = () => {
      if (this.dragIndex === null) return;
      this.dragIndex = null;
      canvas.style.cursor = '';
      map.off('mousemove', onMouseMove);
      map.off('touchmove', onTouchMove);
      const committed = working.slice();
      this.zone.run(() => this.state.bikePoints.set(committed));
    };
    const onMouseMove = (e: MapLayerMouseEvent | { lngLat: { lng: number; lat: number } }) => move(e.lngLat);
    const onTouchMove = (e: MapLayerTouchEvent) => {
      e.preventDefault();
      move(e.lngLat);
    };
    const start = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const i = Number(e.features?.[0]?.properties?.['i']);
      if (!Number.isInteger(i)) return;
      // Keeps the map from panning while a waypoint is dragged.
      e.preventDefault();
      this.dragIndex = i;
      working = untracked(this.state.bikePoints).slice();
      canvas.style.cursor = 'grabbing';
      map.on('mousemove', onMouseMove);
      map.on('touchmove', onTouchMove);
      map.once('mouseup', end);
      map.once('touchend', end);
    };
    map.on('mousedown', 'bk-points', start);
    map.on('touchstart', 'bk-points', e => {
      if (e.points.length === 1) start(e);
    });
  }
}

function line(coords: [number, number][], kind: 'leg' | 'gap' | 'approach'): Feature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind } };
}
