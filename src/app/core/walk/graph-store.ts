import { Injectable } from '@angular/core';
import { DATA_PATHS, assetUrl } from '../map/map.config';
import type { RouteProfile } from '../map/map.types';
import { WalkGraph, components, decodeWalkGraph } from './walk-graph';

/** A decoded network graph with the connected component of every vertex (used to snap route points). */
export interface LoadedGraph {
  g: WalkGraph;
  comp: Int32Array;
}

export type GraphName = 'walk' | 'cycle' | 'bike';

/** Graph file behind each route profile. */
export const PROFILE_GRAPH: Record<RouteProfile, GraphName> = {
  walk: 'walk',
  bikeStreets: 'bike',
  bikeCycleways: 'cycle'
};

const GRAPH_PATH: Record<GraphName, string> = {
  walk: DATA_PATHS.walkGraph,
  cycle: DATA_PATHS.cycleGraph,
  bike: DATA_PATHS.bikeGraph
};

/**
 * Downloads a gzip artefact and returns its raw bytes. A server that already sent
 * `Content-Encoding: gzip` hands over the decompressed file, so the gzip magic is checked first.
 */
export async function fetchGunzip(path: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return bytes;
}

/** Loads each network graph once, on first use, and shares it between the walking reach and the route planner. */
@Injectable({ providedIn: 'root' })
export class GraphStore {
  private readonly cache = new Map<GraphName, Promise<LoadedGraph>>();

  load(name: GraphName): Promise<LoadedGraph> {
    let pending = this.cache.get(name);
    if (!pending) {
      pending = fetchGunzip(GRAPH_PATH[name]).then(bytes => {
        const g = decodeWalkGraph(bytes);
        return { g, comp: components(g) };
      });
      // A failed download may be retried later.
      pending.catch(() => this.cache.delete(name));
      this.cache.set(name, pending);
    }
    return pending;
  }
}
