/**
 * Pedestrian graph of Wrocław (`assets/data/walk.bin.gz`, built by tools/pipeline/src/lib/walk-graph.mjs)
 * and the walking-reach computation: Dijkstra from a clicked point, then the reached streets cut into
 * short pieces timed in minutes, and the reached places. Pure functions, no Angular or MapLibre.
 */

export const WALK_MAGIC = 0x31474b57;

/** Place categories, in the order of `placeCat` values in the file. */
export const PLACE_CATS = ['shop', 'food', 'education', 'health', 'culture', 'services', 'tram', 'park'] as const;
export type PlaceCat = (typeof PLACE_CATS)[number];

/** Walking speed: 5 km/h. */
export const WALK_M_PER_MIN = 5000 / 60;

export interface WalkGraph {
  /** Vertex coordinates (degrees). */
  x: Float64Array;
  y: Float64Array;
  /** CSR adjacency: neighbours of v are adjTo[adjStart[v] .. adjStart[v+1]), via edge adjEdge[…]. */
  adjStart: Uint32Array;
  adjTo: Uint32Array;
  adjEdge: Uint32Array;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  /** Edge length in metres. */
  edgeLen: Float32Array;
  /** Interior points of edge e: geomX/geomY[geomStart[e] .. geomStart[e+1]) (degrees), ordered from A. */
  geomStart: Uint32Array;
  geomX: Float64Array;
  geomY: Float64Array;
  placeNode: Uint32Array;
  placeX: Float64Array;
  placeY: Float64Array;
  placeCat: Uint8Array;
  /** Vertex grid for snapping (cell → vertices). */
  grid: Map<number, number[]>;
}

const CELL = 0.002;
const cellKey = (x: number, y: number) => Math.floor(x / CELL) * 100000 + Math.floor(y / CELL);

export function decodeWalkGraph(buffer: ArrayBuffer): WalkGraph {
  let off = 0;
  const align = (n: number) => (n + 3) & ~3;
  const u32 = (n: number) => { const a = new Uint32Array(buffer, off, n); off += n * 4; return a; };
  const u16 = (n: number) => { const a = new Uint16Array(buffer, off, n); off = align(off + n * 2); return a; };
  const u8 = (n: number) => { const a = new Uint8Array(buffer, off, n); off = align(off + n); return a; };
  const f64 = (n: number) => { const a = new Float64Array(buffer, off, n); off += n * 8; return a; };

  const [magic, nNodes, nEdges, nPoints, nPlaces] = u32(8);
  if (magic !== WALK_MAGIC) throw new Error('walk graph: bad magic');
  const [minLon, minLat, maxLon, maxLat] = f64(4);
  const sx = (maxLon - minLon) / 65535;
  const sy = (maxLat - minLat) / 65535;

  // Vertices: running sums modulo 2^16 of the stored deltas.
  const dx = u16(nNodes), dy = u16(nNodes);
  const qx = new Uint16Array(nNodes), qy = new Uint16Array(nNodes);
  const x = new Float64Array(nNodes), y = new Float64Array(nNodes);
  for (let v = 0; v < nNodes; v++) {
    qx[v] = (v ? qx[v - 1] : 0) + dx[v];
    qy[v] = (v ? qy[v - 1] : 0) + dy[v];
    x[v] = minLon + qx[v] * sx;
    y[v] = minLat + qy[v] * sy;
  }

  const da = u32(nEdges), db = u32(nEdges);
  const edgeA = new Uint32Array(nEdges), edgeB = new Uint32Array(nEdges);
  for (let e = 0; e < nEdges; e++) {
    edgeA[e] = (e ? edgeA[e - 1] : 0) + da[e];
    edgeB[e] = edgeA[e] + db[e];
  }
  const lenDm = u16(nEdges);
  const edgeLen = new Float32Array(nEdges);
  for (let e = 0; e < nEdges; e++) edgeLen[e] = lenDm[e] / 10;
  const interior = u8(nEdges);
  const geomStart = new Uint32Array(nEdges + 1);
  for (let e = 0; e < nEdges; e++) geomStart[e + 1] = geomStart[e] + interior[e];

  const gdx = u16(nPoints), gdy = u16(nPoints);
  const geomX = new Float64Array(nPoints), geomY = new Float64Array(nPoints);
  for (let e = 0; e < nEdges; e++) {
    let lx = qx[edgeA[e]], ly = qy[edgeA[e]];
    for (let p = geomStart[e]; p < geomStart[e + 1]; p++) {
      lx = (lx + gdx[p]) & 0xffff;
      ly = (ly + gdy[p]) & 0xffff;
      geomX[p] = minLon + lx * sx;
      geomY[p] = minLat + ly * sy;
    }
  }

  const pd = u32(nPlaces);
  const placeNode = new Uint32Array(nPlaces);
  for (let i = 0; i < nPlaces; i++) placeNode[i] = (i ? placeNode[i - 1] : 0) + pd[i];
  const pqx = u16(nPlaces), pqy = u16(nPlaces);
  const placeX = new Float64Array(nPlaces), placeY = new Float64Array(nPlaces);
  for (let i = 0; i < nPlaces; i++) {
    placeX[i] = minLon + pqx[i] * sx;
    placeY[i] = minLat + pqy[i] * sy;
  }
  const placeCat = u8(nPlaces).slice();

  // Undirected CSR adjacency.
  const degree = new Uint32Array(nNodes + 1);
  for (let e = 0; e < nEdges; e++) { degree[edgeA[e] + 1]++; degree[edgeB[e] + 1]++; }
  const adjStart = new Uint32Array(nNodes + 1);
  for (let v = 0; v < nNodes; v++) adjStart[v + 1] = adjStart[v] + degree[v + 1];
  const fill = adjStart.slice(0, nNodes);
  const adjTo = new Uint32Array(nEdges * 2), adjEdge = new Uint32Array(nEdges * 2);
  for (let e = 0; e < nEdges; e++) {
    const a = edgeA[e], b = edgeB[e];
    adjTo[fill[a]] = b; adjEdge[fill[a]++] = e;
    adjTo[fill[b]] = a; adjEdge[fill[b]++] = e;
  }

  const grid = new Map<number, number[]>();
  for (let v = 0; v < nNodes; v++) {
    const k = cellKey(x[v], y[v]);
    const list = grid.get(k);
    if (list) list.push(v);
    else grid.set(k, [v]);
  }

  return { x, y, adjStart, adjTo, adjEdge, edgeA, edgeB, edgeLen, geomStart, geomX, geomY, placeNode, placeX, placeY, placeCat, grid };
}

const M_LAT = 110540;
const M_LON = 111320 * Math.cos((51.11 * Math.PI) / 180);
const metres = (ax: number, ay: number, bx: number, by: number) => Math.hypot((bx - ax) * M_LON, (by - ay) * M_LAT);

/** Nearest vertex to a point and its straight-line distance (m); null when nothing within ~400 m. */
export function nearestVertex(g: WalkGraph, lon: number, lat: number): { v: number; d: number } | null {
  let best = -1, bestD = Infinity;
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  for (let i = cx - 2; i <= cx + 2; i++) {
    for (let j = cy - 2; j <= cy + 2; j++) {
      for (const v of g.grid.get(i * 100000 + j) ?? []) {
        const d = metres(lon, lat, g.x[v], g.y[v]);
        if (d < bestD) { bestD = d; best = v; }
      }
    }
  }
  return best >= 0 && bestD <= 400 ? { v: best, d: bestD } : null;
}

/** Walking distance (m) from `source` to every vertex, explored up to `maxMetres`; unreached = Infinity. */
export function shortestPaths(g: WalkGraph, source: number, startMetres: number, maxMetres: number): Float64Array {
  const n = g.x.length;
  // Float64 on purpose: a Float32 store rounds distances, so "d > dist[v]" would drop valid heap entries.
  const dist = new Float64Array(n).fill(Infinity);
  // Binary heap of (distance, vertex).
  const hd: number[] = [], hv: number[] = [];
  const push = (d: number, v: number) => {
    let i = hd.length;
    hd.push(d); hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= d) break;
      hd[i] = hd[p]; hv[i] = hv[p];
      i = p;
    }
    hd[i] = d; hv[i] = v;
  };
  const pop = (): [number, number] => {
    const d0 = hd[0], v0 = hv[0];
    const dl = hd.pop()!, vl = hv.pop()!;
    if (hd.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, md = dl;
        if (l < hd.length && hd[l] < md) { m = l; md = hd[l]; }
        if (r < hd.length && hd[r] < md) { m = r; md = hd[r]; }
        if (m === i) break;
        hd[i] = hd[m]; hv[i] = hv[m];
        i = m;
      }
      hd[i] = dl; hv[i] = vl;
    }
    return [d0, v0];
  };

  dist[source] = startMetres;
  push(startMetres, source);
  while (hd.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
      const nd = d + g.edgeLen[g.adjEdge[k]];
      const to = g.adjTo[k];
      if (nd < dist[to] && nd <= maxMetres) {
        dist[to] = nd;
        push(nd, to);
      }
    }
  }
  return dist;
}

export interface ReachResult {
  /** Street pieces (≤ PIECE_M long) with `t` = walking minutes at their midpoint. */
  streets: GeoJSON.FeatureCollection<GeoJSON.LineString, { t: number }>;
  /** Reached places with category and minutes. */
  places: GeoJSON.FeatureCollection<GeoJSON.Point, { cat: PlaceCat; t: number }>;
}

/** Street pieces are at most this long (~1 minute of walking), so the reach edge is drawn minute by minute. */
const PIECE_M = 80;

export function reach(g: WalkGraph, dist: Float64Array, maxMetres: number): ReachResult {
  const streets: ReachResult['streets']['features'] = [];
  for (let e = 0; e < g.edgeA.length; e++) {
    const da = dist[g.edgeA[e]], db = dist[g.edgeB[e]];
    if (!(da <= maxMetres) && !(db <= maxMetres)) continue;
    const len = g.edgeLen[e];
    // Polyline A → interior → B, with the distance from A at every vertex.
    const pts: [number, number][] = [[g.x[g.edgeA[e]], g.y[g.edgeA[e]]]];
    for (let p = g.geomStart[e]; p < g.geomStart[e + 1]; p++) pts.push([g.geomX[p], g.geomY[p]]);
    pts.push([g.x[g.edgeB[e]], g.y[g.edgeB[e]]]);
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + metres(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    const scale = along[along.length - 1] > 0 ? len / along[along.length - 1] : 1;
    const timeAt = (s: number) => Math.min(da + s, db + (len - s)) / WALK_M_PER_MIN;
    const pointAt = (s: number): [number, number] => {
      const target = s / scale;
      let i = 1;
      while (i < along.length - 1 && along[i] < target) i++;
      const span = along[i] - along[i - 1];
      const f = span > 0 ? (target - along[i - 1]) / span : 0;
      return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
    };
    const pieces = Math.max(1, Math.ceil(len / PIECE_M));
    for (let k = 0; k < pieces; k++) {
      const s0 = (len * k) / pieces, s1 = (len * (k + 1)) / pieces;
      const t = timeAt((s0 + s1) / 2);
      if (t * WALK_M_PER_MIN > maxMetres) continue;
      const coords: [number, number][] = [pointAt(s0)];
      for (let i = 1; i < pts.length - 1; i++) {
        const s = along[i] * scale;
        if (s > s0 && s < s1) coords.push(pts[i]);
      }
      coords.push(pointAt(s1));
      streets.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { t: Math.round(t * 10) / 10 } });
    }
  }

  const places: ReachResult['places']['features'] = [];
  for (let i = 0; i < g.placeNode.length; i++) {
    const d = dist[g.placeNode[i]];
    if (!(d <= maxMetres)) continue;
    // The last stretch from the street to the place is counted as a straight line.
    const last = metres(g.x[g.placeNode[i]], g.y[g.placeNode[i]], g.placeX[i], g.placeY[i]);
    const t = (d + last) / WALK_M_PER_MIN;
    places.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.placeX[i], g.placeY[i]] },
      properties: { cat: PLACE_CATS[g.placeCat[i]], t: Math.round(t * 10) / 10 }
    });
  }
  return { streets: { type: 'FeatureCollection', features: streets }, places: { type: 'FeatureCollection', features: places } };
}

/** Polyline of edge `e` from vertex `from` to its other end (interior points reversed when walking B → A). */
function edgeCoords(g: WalkGraph, e: number, from: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let p = g.geomStart[e]; p < g.geomStart[e + 1]; p++) pts.push([g.geomX[p], g.geomY[p]]);
  if (from !== g.edgeA[e]) pts.reverse();
  const to = from === g.edgeA[e] ? g.edgeB[e] : g.edgeA[e];
  return [[g.x[from], g.y[from]], ...pts, [g.x[to], g.y[to]]];
}

/**
 * Shortest path between two vertices along the network (Dijkstra stopping at the target).
 * Returns its length in metres and its geometry, or null when the vertices are not connected.
 */
export function shortestPath(g: WalkGraph, source: number, target: number): { metres: number; coords: [number, number][] } | null {
  if (source === target) return { metres: 0, coords: [[g.x[source], g.y[source]]] };
  const n = g.x.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevVertex = new Int32Array(n).fill(-1);
  const hd: number[] = [], hv: number[] = [];
  const push = (d: number, v: number) => {
    let i = hd.length;
    hd.push(d); hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= d) break;
      hd[i] = hd[p]; hv[i] = hv[p];
      i = p;
    }
    hd[i] = d; hv[i] = v;
  };
  const pop = (): [number, number] => {
    const d0 = hd[0], v0 = hv[0];
    const dl = hd.pop()!, vl = hv.pop()!;
    if (hd.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, md = dl;
        if (l < hd.length && hd[l] < md) { m = l; md = hd[l]; }
        if (r < hd.length && hd[r] < md) { m = r; md = hd[r]; }
        if (m === i) break;
        hd[i] = hd[m]; hv[i] = hv[m];
        i = m;
      }
      hd[i] = dl; hv[i] = vl;
    }
    return [d0, v0];
  };
  dist[source] = 0;
  push(0, source);
  while (hd.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    if (v === target) break;
    for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
      const e = g.adjEdge[k], to = g.adjTo[k];
      const nd = d + g.edgeLen[e];
      if (nd < dist[to]) {
        dist[to] = nd;
        prevEdge[to] = e;
        prevVertex[to] = v;
        push(nd, to);
      }
    }
  }
  if (!(dist[target] < Infinity)) return null;
  // Walk back from the target, then emit the edges in travel order.
  const chain: [number, number][] = [];
  for (let v = target; v !== source; v = prevVertex[v]) chain.push([prevEdge[v], prevVertex[v]]);
  chain.reverse();
  const coords: [number, number][] = [];
  for (const [e, from] of chain) {
    const part = edgeCoords(g, e, from);
    coords.push(...(coords.length ? part.slice(1) : part));
  }
  return { metres: dist[target], coords };
}

/** Connected component id of every vertex (computed once per graph). */
export function components(g: WalkGraph): Int32Array {
  const n = g.x.length;
  const comp = new Int32Array(n).fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const v = stack.pop()!;
      for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
        const t = g.adjTo[k];
        if (comp[t] < 0) {
          comp[t] = id;
          stack.push(t);
        }
      }
    }
    id++;
  }
  return comp;
}

/** Nearest vertex of each component within `maxMetres` of a point. */
function nearestByComponent(g: WalkGraph, comp: Int32Array, lon: number, lat: number, maxMetres: number): Map<number, { v: number; d: number }> {
  const out = new Map<number, { v: number; d: number }>();
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  for (let i = cx - 2; i <= cx + 2; i++) {
    for (let j = cy - 2; j <= cy + 2; j++) {
      for (const v of g.grid.get(i * 100000 + j) ?? []) {
        const d = metres(lon, lat, g.x[v], g.y[v]);
        if (d > maxMetres) continue;
        const best = out.get(comp[v]);
        if (!best || d < best.d) out.set(comp[v], { v, d });
      }
    }
  }
  return out;
}

export interface Leg {
  /** Metres along the network, or null when the two points share no connected piece of it. */
  metres: number | null;
  coords: [number, number][];
  /** Snapped start and end on the network (for drawing the short approach from each clicked point). */
  from: [number, number] | null;
  to: [number, number] | null;
}

/**
 * Route between two clicked points strictly along the network: both points are attached to the piece of
 * the network (connected component) they are both close to, choosing the one with the shortest approaches,
 * so a point next to an isolated stub still routes along the main network nearby.
 */
export function routeLeg(g: WalkGraph, comp: Int32Array, a: [number, number], b: [number, number], snapMetres = 400): Leg {
  const na = nearestByComponent(g, comp, a[0], a[1], snapMetres);
  const nb = nearestByComponent(g, comp, b[0], b[1], snapMetres);
  let best: { va: number; vb: number; cost: number } | null = null;
  for (const [c, pa] of na) {
    const pb = nb.get(c);
    if (pb && (!best || pa.d + pb.d < best.cost)) best = { va: pa.v, vb: pb.v, cost: pa.d + pb.d };
  }
  if (!best) return { metres: null, coords: [a, b], from: null, to: null };
  const path = shortestPath(g, best.va, best.vb);
  if (!path) return { metres: null, coords: [a, b], from: null, to: null };
  return { metres: path.metres, coords: path.coords, from: [g.x[best.va], g.y[best.va]], to: [g.x[best.vb], g.y[best.vb]] };
}
