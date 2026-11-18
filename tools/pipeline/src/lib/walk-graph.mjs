/**
 * Pedestrian graph for the walking-reach view ("15-minute city"), written as one gzip-compressed binary.
 *
 * Nodes are intersections and way ends (OSM nodes shared by two or more walkable ways); every edge keeps
 * its simplified interior geometry so the app can draw reached streets. Places of interest are snapped to
 * their nearest node. Coordinates are Uint16 offsets inside the file's bbox (~0.4 m resolution).
 *
 * Layout (little-endian, sections 4-byte aligned):
 *   Uint32[8]  header: MAGIC, nodes, edges, geometry points, places, flags (bit 0: edge kinds), reserved…
 *   Float64[4] quantisation box: minLon, minLat, maxLon, maxLat (extent of all stored points)
 *   Uint16     nodeX[nodes], nodeY[nodes]      (Morton-ordered, delta-coded mod 2^16)
 *   Uint32     edgeA[edges] (delta from previous edge), edgeB[edges] (B − A); edges sorted by A, A ≤ B
 *   Uint16     edgeLenDm[edges]        (decimetres, capped at 6553.5 m)
 *   Uint8      edgeInterior[edges]     (number of interior points of each edge, ≤ 255)
 *   Uint16     geomX[points], geomY[points]   (interior points in edge order, delta from the previous point, first from A)
 *   Uint32     placeNode[places]       (sorted, delta-coded)
 *   Uint16     placeX[places], placeY[places]
 *   Uint8      placeCat[places]
 *   Uint8      edgeKind[edges]         (only when header flag bit 0 is set: kind of the way each edge came from)
 */
import { gzipSync } from 'node:zlib';

export const WALK_MAGIC = 0x31474b57; // "WKG1"

/** Categories of places counted in walking reach (index = value stored in placeCat). */
export const PLACE_CATS = ['shop', 'food', 'education', 'health', 'culture', 'services', 'tram', 'park'];

const M_LAT = 110540;

/** Perpendicular distance (metres) of p from segment ab, equirectangular. */
function segDist(p, a, b, mLon) {
  const ax = a[0] * mLon, ay = a[1] * M_LAT, bx = b[0] * mLon, by = b[1] * M_LAT, px = p[0] * mLon, py = p[1] * M_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker on a polyline, keeping both ends. */
function simplifyLine(pts, tol, mLon) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j], mLon);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * @param {{ ways: Int32Array[], kinds?: number[], lon: Float64Array, lat: Float64Array, nodeCount: number, bbox: number[],
 *           places: { lon: number, lat: number, cat: number }[] }} input
 *   kinds: optional Uint8 kind per way, stored per edge (e.g. street vs cycleway for weighted routing).
 */
export function buildWalkGraph({ ways, kinds, lon, lat, nodeCount, bbox, places }) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const mLon = 111320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const inBox = i => lon[i] >= minLon && lon[i] <= maxLon && lat[i] >= minLat && lat[i] <= maxLat;
  const segLen = (a, b) => Math.hypot((b[0] - a[0]) * mLon, (b[1] - a[1]) * M_LAT);

  // A node becomes a graph vertex when it ends a way or is shared by several ways.
  const uses = new Uint8Array(nodeCount);
  for (const w of ways) for (const i of w) if (uses[i] < 255) uses[i]++;
  const vertex = new Int32Array(nodeCount).fill(-1);
  const vx = [], vy = [];
  const vertexOf = i => {
    if (vertex[i] < 0) {
      vertex[i] = vx.length;
      vx.push(lon[i]);
      vy.push(lat[i]);
    }
    return vertex[i];
  };

  const edgeA = [], edgeB = [], edgeLen = [], edgeGeom = [], edgeKind = [];
  const pushEdge = (idxs, from, to, kind) => {
    // Edges fully outside the area are dropped; edges crossing its edge are kept whole.
    let inside = false;
    for (let k = from; k <= to && !inside; k++) inside = inBox(idxs[k]);
    if (!inside) return;
    const pts = [];
    for (let k = from; k <= to; k++) pts.push([lon[idxs[k]], lat[idxs[k]]]);
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += segLen(pts[k - 1], pts[k]);
    if (len < 0.1) return;
    let interior = simplifyLine(pts, 1.0, mLon).slice(1, -1);
    // Interior point count is stored in a byte; very long edges are split at a kept vertex.
    if (interior.length > 255) interior = interior.filter((_, k) => k % Math.ceil(interior.length / 255) === 0).slice(0, 255);
    edgeA.push(vertexOf(idxs[from]));
    edgeB.push(vertexOf(idxs[to]));
    edgeLen.push(len);
    edgeGeom.push(interior);
    edgeKind.push(kind);
  };
  ways.forEach((w, wi) => {
    let start = 0;
    for (let k = 1; k < w.length; k++) {
      if (k === w.length - 1 || uses[w[k]] >= 2) {
        pushEdge(w, start, k, kinds ? kinds[wi] : 0);
        start = k;
      }
    }
  });

  // Snap places to their nearest vertex through a 100 m grid.
  const CELL = 0.001;
  const grid = new Map();
  vx.forEach((x, v) => {
    const key = `${Math.floor(x / CELL)}:${Math.floor(vy[v] / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(v);
  });
  const nearest = (x, y) => {
    let best = -1, bestD = Infinity;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          for (const v of grid.get(`${i}:${j}`) ?? []) {
            const d = segLen([x, y], [vx[v], vy[v]]);
            if (d < bestD) { bestD = d; best = v; }
          }
        }
      }
    }
    return { v: best, d: bestD };
  };
  const snapped = [];
  for (const p of places) {
    if (p.lon < minLon || p.lon > maxLon || p.lat < minLat || p.lat > maxLat) continue;
    const n = nearest(p.lon, p.lat);
    if (n.v >= 0 && n.d <= 250) snapped.push({ ...p, v: n.v });
  }

  // ─── Serialise ──────────────────────────────────────────────────────────────
  // Quantisation box = the true extent of everything stored: edges crossing the area edge are kept whole,
  // so some vertices lie just outside `bbox`, and a negative Uint16 offset would wrap to the far side.
  const qb = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x, y) => {
    if (x < qb[0]) qb[0] = x;
    if (y < qb[1]) qb[1] = y;
    if (x > qb[2]) qb[2] = x;
    if (y > qb[3]) qb[3] = y;
  };
  vx.forEach((x, v) => grow(x, vy[v]));
  for (const g of edgeGeom) for (const [x, y] of g) grow(x, y);
  for (const s of snapped) grow(s.lon, s.lat);
  const qx = x => Math.round(((x - qb[0]) / (qb[2] - qb[0])) * 65535);
  const qy = y => Math.round(((y - qb[1]) / (qb[3] - qb[1])) * 65535);

  // Vertices in Morton (Z-order) so neighbours get close indices; edges sorted by their first vertex.
  // With delta coding below this makes the arrays highly repetitive, which gzip compresses well.
  const morton = (x, y) => {
    let m = 0;
    for (let b = 15; b >= 0; b--) m = m * 4 + ((((x >> b) & 1) << 1) | ((y >> b) & 1));
    return m;
  };
  const keys = vx.map((x, v) => morton(qx(x), qy(vy[v])));
  const order = vx.map((_, v) => v).sort((a, b) => keys[a] - keys[b]);
  const rank = new Int32Array(vx.length);
  order.forEach((v, i) => (rank[v] = i));
  const sx = order.map(v => vx[v]), sy = order.map(v => vy[v]);
  for (let i = 0; i < sx.length; i++) { vx[i] = sx[i]; vy[i] = sy[i]; }
  const edgeOrder = edgeA.map((_, e) => e).map(e => {
    // Store each edge from its lower vertex; reverse the geometry when flipping it.
    let a = rank[edgeA[e]], b = rank[edgeB[e]], g = edgeGeom[e];
    if (b < a) { [a, b] = [b, a]; g = [...g].reverse(); }
    return { a, b, len: edgeLen[e], g, k: edgeKind[e] };
  }).sort((p, q) => p.a - q.a || p.b - q.b);
  edgeA.length = edgeB.length = edgeLen.length = edgeGeom.length = edgeKind.length = 0;
  for (const e of edgeOrder) { edgeA.push(e.a); edgeB.push(e.b); edgeLen.push(e.len); edgeGeom.push(e.g); edgeKind.push(e.k); }
  for (const s of snapped) s.v = rank[s.v];
  snapped.sort((p, q) => p.v - q.v);

  const nNodes = vx.length, nEdges = edgeA.length, nPoints = edgeGeom.reduce((s, g) => s + g.length, 0), nPlaces = snapped.length;
  const align = n => (n + 3) & ~3;
  // Every Uint16/Uint8 array is padded to 4 bytes on its own, so pairs are counted twice.
  const size =
    32 + 32 + 2 * align(nNodes * 2) + nEdges * 8 + align(nEdges * 2) + align(nEdges) + 2 * align(nPoints * 2) + nPlaces * 4 + 2 * align(nPlaces * 2) + align(nPlaces) + (kinds ? align(nEdges) : 0);
  const buf = new ArrayBuffer(size);
  let off = 0;
  const u32 = n => { const a = new Uint32Array(buf, off, n); off += n * 4; return a; };
  const u16 = n => { const a = new Uint16Array(buf, off, n); off = align(off + n * 2); return a; };
  const u8 = n => { const a = new Uint8Array(buf, off, n); off = align(off + n); return a; };
  const f64 = n => { const a = new Float64Array(buf, off, n); off += n * 8; return a; };

  u32(8).set([WALK_MAGIC, nNodes, nEdges, nPoints, nPlaces, kinds ? 1 : 0, 0, 0]);
  f64(4).set(qb);
  // Deltas wrap modulo 2^16 / 2^32, so decoding is a running sum in the same integer width.
  const nx = u16(nNodes), ny = u16(nNodes);
  for (let v = 0; v < nNodes; v++) {
    nx[v] = (qx(vx[v]) - (v ? qx(vx[v - 1]) : 0)) & 0xffff;
    ny[v] = (qy(vy[v]) - (v ? qy(vy[v - 1]) : 0)) & 0xffff;
  }
  const ea = u32(nEdges), eb = u32(nEdges);
  for (let e = 0; e < nEdges; e++) {
    ea[e] = edgeA[e] - (e ? edgeA[e - 1] : 0); // non-negative: edges sorted by A
    eb[e] = edgeB[e] - edgeA[e]; // non-negative: A ≤ B
  }
  const el = u16(nEdges);
  edgeLen.forEach((l, e) => (el[e] = Math.min(65535, Math.round(l * 10))));
  const ei = u8(nEdges);
  edgeGeom.forEach((g, e) => (ei[e] = g.length));
  // Interior points: delta from the previous point of the same edge (the first from vertex A).
  const gx = u16(nPoints), gy = u16(nPoints);
  let p = 0;
  edgeGeom.forEach((g, e) => {
    let lx = qx(vx[edgeA[e]]), ly = qy(vy[edgeA[e]]);
    for (const [x, y] of g) {
      const cx = qx(x), cy = qy(y);
      gx[p] = (cx - lx) & 0xffff;
      gy[p] = (cy - ly) & 0xffff;
      lx = cx; ly = cy;
      p++;
    }
  });
  const pn = u32(nPlaces);
  snapped.forEach((s, i) => (pn[i] = s.v - (i ? snapped[i - 1].v : 0)));
  const px = u16(nPlaces), py = u16(nPlaces);
  snapped.forEach((s, i) => { px[i] = qx(s.lon); py[i] = qy(s.lat); });
  u8(nPlaces).set(snapped.map(s => s.cat));
  if (kinds) u8(nEdges).set(edgeKind);
  if (off !== size) throw new Error(`walk graph size mismatch ${off} != ${size}`);

  const raw = Buffer.from(buf);
  const placesByCat = Object.fromEntries(PLACE_CATS.map((c, i) => [c, snapped.filter(s => s.cat === i).length]));
  return {
    gz: gzipSync(raw, { level: 9 }),
    stats: { nodes: nNodes, edges: nEdges, points: nPoints, places: nPlaces, placesByCat, rawBytes: raw.length, km: Math.round(edgeLen.reduce((s, l) => s + l, 0) / 1000), ...(kinds ? { kmByKind: [0, 1, 2].map(k => Math.round(edgeLen.reduce((s, l, e) => s + (edgeKind[e] === k ? l : 0), 0) / 1000)) } : {}) }
  };
}
