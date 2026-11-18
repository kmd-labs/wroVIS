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
  /** Kind of every edge (bike graph: 0 calm street, 1 cycle infrastructure, 2 busy street), or null when the file has none. */
  edgeKind: Uint8Array | null;
  /** Vertex grid for snapping (see `VertexGrid`). */
  grid: VertexGrid;
}

/**
 * Flat (CSR) grid of vertices for snapping points to the network: cells of 0.0005° (~35 m × 55 m), vertices of
 * cell c are items[start[c] .. start[c+1]). Fine cells and a ring search outwards find the nearest vertex after
 * a few cells; the former 0.002° Map grid scanned 25 big cells per lookup, which made marking thousands of
 * buildings in a walking reach take ~170 ms.
 */
export interface VertexGrid {
  x0: number;
  y0: number;
  w: number;
  h: number;
  start: Uint32Array;
  items: Uint32Array;
}

const CELL = 0.0005;
/** Shortest side of a cell in metres (longitude side at Wrocław's latitude), for ring-search stopping. */
const CELL_MIN_M = CELL * 111320 * Math.cos((51.11 * Math.PI) / 180);

function buildGrid(x: Float64Array, y: Float64Array): VertexGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let v = 0; v < x.length; v++) {
    if (x[v] < minX) minX = x[v];
    if (x[v] > maxX) maxX = x[v];
    if (y[v] < minY) minY = y[v];
    if (y[v] > maxY) maxY = y[v];
  }
  const x0 = Math.floor(minX / CELL), y0 = Math.floor(minY / CELL);
  const w = Math.floor(maxX / CELL) - x0 + 1, h = Math.floor(maxY / CELL) - y0 + 1;
  const cellOf = (v: number) => (Math.floor(y[v] / CELL) - y0) * w + (Math.floor(x[v] / CELL) - x0);
  const start = new Uint32Array(w * h + 1);
  for (let v = 0; v < x.length; v++) start[cellOf(v) + 1]++;
  for (let c = 0; c < w * h; c++) start[c + 1] += start[c];
  const fill = start.slice(0, w * h);
  const items = new Uint32Array(x.length);
  for (let v = 0; v < x.length; v++) items[fill[cellOf(v)]++] = v;
  return { x0, y0, w, h, start, items };
}

/**
 * Nearest vertex accepted by `accept`, searching rings of cells outwards from the point and stopping once no
 * unvisited cell can hold anything closer; null when nothing within `maxMetres`.
 */
function nearestInGrid(g: WalkGraph, lon: number, lat: number, maxMetres: number, accept?: (v: number) => boolean): { v: number; d: number } | null {
  const grid = g.grid;
  const cx = Math.floor(lon / CELL) - grid.x0, cy = Math.floor(lat / CELL) - grid.y0;
  const maxRing = Math.ceil(maxMetres / CELL_MIN_M) + 1;
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    for (let j = cy - r; j <= cy + r; j++) {
      if (j < 0 || j >= grid.h) continue;
      const edge = j === cy - r || j === cy + r;
      for (let i = cx - r; i <= cx + r; i += edge ? 1 : 2 * r || 1) {
        if (i < 0 || i >= grid.w) continue;
        const c = j * grid.w + i;
        for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
          const v = grid.items[k];
          if (accept && !accept(v)) continue;
          const d = metres(lon, lat, g.x[v], g.y[v]);
          if (d < bestD) { bestD = d; best = v; }
        }
      }
    }
    // Every vertex in ring r+1 or further is at least r cells away.
    if (best >= 0 && bestD <= r * CELL_MIN_M) break;
  }
  return best >= 0 && bestD <= maxMetres ? { v: best, d: bestD } : null;
}

export function decodeWalkGraph(buffer: ArrayBuffer): WalkGraph {
  let off = 0;
  const align = (n: number) => (n + 3) & ~3;
  const u32 = (n: number) => { const a = new Uint32Array(buffer, off, n); off += n * 4; return a; };
  const u16 = (n: number) => { const a = new Uint16Array(buffer, off, n); off = align(off + n * 2); return a; };
  const u8 = (n: number) => { const a = new Uint8Array(buffer, off, n); off = align(off + n); return a; };
  const f64 = (n: number) => { const a = new Float64Array(buffer, off, n); off += n * 8; return a; };

  const [magic, nNodes, nEdges, nPoints, nPlaces, flags] = u32(8);
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
  const edgeKind = flags & 1 ? u8(nEdges).slice() : null;

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

  const grid = buildGrid(x, y);

  return { x, y, adjStart, adjTo, adjEdge, edgeA, edgeB, edgeLen, geomStart, geomX, geomY, placeNode, placeX, placeY, placeCat, edgeKind, grid };
}

const M_LAT = 110540;
const M_LON = 111320 * Math.cos((51.11 * Math.PI) / 180);
const metres = (ax: number, ay: number, bx: number, by: number) => Math.hypot((bx - ax) * M_LON, (by - ay) * M_LAT);

/** Nearest vertex to a point and its straight-line distance (m); null when nothing within ~400 m. */
export function nearestVertex(g: WalkGraph, lon: number, lat: number): { v: number; d: number } | null {
  return nearestInGrid(g, lon, lat, 400);
}

const sizeCache = new WeakMap<Int32Array, Uint32Array>();

/** Number of vertices of each connected component (memoised per component array). */
export function componentSizes(comp: Int32Array): Uint32Array {
  const cached = sizeCache.get(comp);
  if (cached) return cached;
  let max = -1;
  for (let i = 0; i < comp.length; i++) if (comp[i] > max) max = comp[i];
  const sizes = new Uint32Array(max + 1);
  for (let i = 0; i < comp.length; i++) sizes[comp[i]]++;
  sizeCache.set(comp, sizes);
  return sizes;
}

/** Components smaller than this are stray fragments (courtyards, footpaths not joined to the street network in OSM). */
const MIN_NETWORK_VERTICES = 200;

/**
 * Nearest vertex of the street network proper: fragments that OSM leaves unconnected (a footway inside a
 * courtyard, a path around a building) would trap a walking reach in a few metres, so they are skipped
 * whenever a vertex of a large component lies within ~400 m; otherwise the plain nearest vertex is used.
 */
export function nearestNetworkVertex(g: WalkGraph, comp: Int32Array, sizes: Uint32Array, lon: number, lat: number): { v: number; d: number } | null {
  return nearestInGrid(g, lon, lat, 400, v => sizes[comp[v]] >= MIN_NETWORK_VERTICES) ?? nearestVertex(g, lon, lat);
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

/** Per-graph A* buffers, reused between searches; `stamp` / `closedStamp` mark the vertices of search `gen`. */
interface Scratch {
  gen: number;
  cost: Float64Array;
  prevEdge: Int32Array;
  prevVertex: Int32Array;
  stamp: Uint32Array;
  closedStamp: Uint32Array;
}

const scratchCache = new WeakMap<WalkGraph, Scratch>();

function scratchFor(g: WalkGraph): Scratch {
  let sc = scratchCache.get(g);
  if (!sc) {
    const n = g.x.length;
    sc = { gen: 0, cost: new Float64Array(n), prevEdge: new Int32Array(n), prevVertex: new Int32Array(n), stamp: new Uint32Array(n), closedStamp: new Uint32Array(n) };
    scratchCache.set(g, sc);
  }
  return sc;
}

/** Route along the network: true length, the geometry, and the same geometry split into runs of one edge kind. */
export interface PathResult {
  metres: number;
  coords: [number, number][];
  /** Consecutive edges of the same kind joined into one polyline (one part when the graph has no kinds). */
  parts: { kind: number; coords: [number, number][]; metres: number }[];
}

/**
 * Shortest path between two vertices along the network (A* with the straight-line distance as heuristic).
 * `costByKind` multiplies the length of an edge of each kind (all ≥ 1, so the heuristic stays admissible):
 * the bike graph prefers cycle infrastructure over streets this way. Null when the vertices are not connected.
 */
export function shortestPath(g: WalkGraph, source: number, target: number, costByKind?: readonly number[]): PathResult | null {
  if (source === target) return { metres: 0, coords: [[g.x[source], g.y[source]]], parts: [] };
  // Buffers are reused between calls and reset lazily: a vertex counts as unvisited unless stamped this search.
  const sc = scratchFor(g);
  const gen = ++sc.gen;
  const { cost, prevEdge, prevVertex, stamp, closedStamp } = sc;
  const seen = (v: number) => stamp[v] === gen;
  const tx = g.x[target], ty = g.y[target];
  const h = (v: number) => metres(g.x[v], g.y[v], tx, ty) * 0.999;
  const kinds = costByKind && g.edgeKind ? g.edgeKind : null;
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
  stamp[source] = gen;
  cost[source] = 0;
  prevVertex[source] = -1;
  push(h(source), source);
  while (hd.length) {
    const [, v] = pop();
    if (closedStamp[v] === gen) continue;
    closedStamp[v] = gen;
    if (v === target) break;
    const d = cost[v];
    for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
      const e = g.adjEdge[k], to = g.adjTo[k];
      if (closedStamp[to] === gen) continue;
      const nd = d + g.edgeLen[e] * (kinds ? costByKind![kinds[e]] ?? 1 : 1);
      if (!seen(to) || nd < cost[to]) {
        stamp[to] = gen;
        cost[to] = nd;
        prevEdge[to] = e;
        prevVertex[to] = v;
        push(nd + h(to), to);
      }
    }
  }
  if (!seen(target)) return null;
  // Walk back from the target, then emit the edges in travel order.
  const chain: [number, number][] = [];
  for (let v = target; v !== source; v = prevVertex[v]) chain.push([prevEdge[v], prevVertex[v]]);
  chain.reverse();
  const coords: [number, number][] = [];
  const parts: PathResult['parts'] = [];
  let total = 0;
  for (const [e, from] of chain) {
    const part = edgeCoords(g, e, from);
    coords.push(...(coords.length ? part.slice(1) : part));
    const kind = g.edgeKind ? g.edgeKind[e] : 0;
    const len = g.edgeLen[e];
    total += len;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) {
      last.coords.push(...part.slice(1));
      last.metres += len;
    } else {
      parts.push({ kind, coords: part, metres: len });
    }
  }
  return { metres: total, coords, parts };
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
  const grid = g.grid;
  const cx = Math.floor(lon / CELL) - grid.x0, cy = Math.floor(lat / CELL) - grid.y0;
  const rx = Math.ceil(maxMetres / CELL_MIN_M), ry = Math.ceil(maxMetres / (CELL * M_LAT));
  for (let j = Math.max(0, cy - ry); j <= Math.min(grid.h - 1, cy + ry); j++) {
    for (let i = Math.max(0, cx - rx); i <= Math.min(grid.w - 1, cx + rx); i++) {
      const c = j * grid.w + i;
      for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
        const v = grid.items[k];
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
  /** The route split by edge kind (see `PathResult.parts`); empty when there is no route. */
  parts: PathResult['parts'];
  /** Snapped start and end on the network (for drawing the short approach from each clicked point). */
  from: [number, number] | null;
  to: [number, number] | null;
}

/**
 * Route between two clicked points strictly along the network: both points are attached to the piece of
 * the network (connected component) they are both close to, choosing the one with the shortest approaches,
 * so a point next to an isolated stub still routes along the main network nearby.
 */
export function routeLeg(g: WalkGraph, comp: Int32Array, a: [number, number], b: [number, number], costByKind?: readonly number[], snapMetres = 400): Leg {
  const na = nearestByComponent(g, comp, a[0], a[1], snapMetres);
  const nb = nearestByComponent(g, comp, b[0], b[1], snapMetres);
  let best: { va: number; vb: number; cost: number } | null = null;
  for (const [c, pa] of na) {
    const pb = nb.get(c);
    if (pb && (!best || pa.d + pb.d < best.cost)) best = { va: pa.v, vb: pb.v, cost: pa.d + pb.d };
  }
  // Two points next to the same stray fragment would otherwise "route" inside it; prefer the network proper
  // when it is reachable from both within the snap distance and costs at most 150 m more of approach.
  if (best) {
    const sizes = componentSizes(comp);
    if (sizes[comp[best.va]] < MIN_NETWORK_VERTICES) {
      for (const [c, pa] of na) {
        const pb = nb.get(c);
        if (pb && sizes[c] >= MIN_NETWORK_VERTICES && pa.d + pb.d <= best.cost + 150) {
          best = { va: pa.v, vb: pb.v, cost: pa.d + pb.d };
          break;
        }
      }
    }
  }
  if (!best) return { metres: null, coords: [a, b], parts: [], from: null, to: null };
  const path = shortestPath(g, best.va, best.vb, costByKind);
  if (!path) return { metres: null, coords: [a, b], parts: [], from: null, to: null };
  return { metres: path.metres, coords: path.coords, parts: path.parts, from: [g.x[best.va], g.y[best.va]], to: [g.x[best.vb], g.y[best.vb]] };
}
