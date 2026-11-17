import { Injectable, computed, signal } from '@angular/core';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { DATA_PATHS, assetUrl } from '../map/map.config';
import { CityStats, DataManifest, DistrictStats } from './stats.model';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Loads the data-pipeline artefacts the app needs in memory: `stats.json`, `manifest.json` and the
 * district polygons (used as an inline map source so district labels can be placed once per district).
 * Heavy layers stay out of memory: MapLibre streams the PMTiles archive and the other GeoJSON files itself.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  readonly status = signal<DataStatus>('idle');
  readonly stats = signal<CityStats | null>(null);
  readonly manifest = signal<DataManifest | null>(null);
  readonly districts = signal<FeatureCollection | null>(null);

  /** One point per district (area-weighted centroid of its largest ring) carrying the district properties. */
  readonly districtLabels = computed<FeatureCollection | null>(() => {
    const fc = this.districts();
    if (!fc) return null;
    const features: Feature<Point>[] = [];
    for (const f of fc.features) {
      const ring = largestOuterRing(f.geometry as Polygon | MultiPolygon);
      if (!ring) continue;
      features.push({ type: 'Feature', id: f.id, properties: f.properties, geometry: { type: 'Point', coordinates: centroid(ring) } });
    }
    return { type: 'FeatureCollection', features };
  });

  /** Districts keyed by OSM relation id for quick lookups from map features. */
  readonly districtsById = computed(() => {
    const map = new Map<number, DistrictStats>();
    for (const d of this.stats()?.districts ?? []) map.set(d.id, d);
    return map;
  });

  async load(): Promise<void> {
    if (this.status() !== 'idle') return;
    this.status.set('loading');
    try {
      const [stats, manifest, districts] = await Promise.all([
        this.fetchJson<CityStats>(DATA_PATHS.stats),
        this.fetchJson<DataManifest>(DATA_PATHS.manifest),
        this.fetchJson<FeatureCollection>(DATA_PATHS.districts)
      ]);
      this.stats.set(stats);
      this.manifest.set(manifest);
      this.districts.set(districts);
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] data artefacts failed to load', err);
      this.status.set('error');
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(assetUrl(path));
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

function largestOuterRing(geometry: Polygon | MultiPolygon): Position[] | null {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map(poly => poly[0]);
  let best: Position[] | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    if (!ring || ring.length < 4) continue;
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return sum / 2;
}

/** Area-weighted centroid of a simple ring (shoelace formula); falls back to the vertex mean for degenerate rings. */
function centroid(ring: Position[]): Position {
  const area = signedArea(ring);
  if (Math.abs(area) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  // signedArea() uses the opposite vertex order sign convention, hence the negative factor.
  const k = -1 / (6 * area);
  return [cx * k, cy * k];
}
