/**
 * Groups bridge segments (one OSM way each: road lanes, sidewalks, tracks…) into bridges.
 * A bridge is all segments sharing a name; unnamed segments join neighbours whose ends lie within
 * JOIN_M. Every segment gets `bid` (bridge id) and `blen` (bridge length = its longest segment, m),
 * so the map and the dock filter whole bridges by the same length.
 */

const JOIN_M = 30;
const M_LAT = 110540;

export function groupBridges(features) {
  const mLon = 111320 * Math.cos((51.11 * Math.PI) / 180);
  const parent = features.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byName = new Map();
  const ends = [];
  features.forEach((f, i) => {
    const name = (f.properties.name ?? '').trim();
    if (name) {
      if (byName.has(name)) union(byName.get(name), i);
      else byName.set(name, i);
      return;
    }
    const c = f.geometry.coordinates;
    for (const [x, y] of [c[0], c[c.length - 1]]) ends.push({ i, x, y });
  });

  const cellX = JOIN_M / mLon, cellY = JOIN_M / M_LAT;
  const grid = new Map();
  ends.forEach((e, k) => {
    const key = `${Math.floor(e.x / cellX)}:${Math.floor(e.y / cellY)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(k);
  });
  for (const e of ends) {
    const cx = Math.floor(e.x / cellX), cy = Math.floor(e.y / cellY);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const k of grid.get(`${i}:${j}`) ?? []) {
          const o = ends[k];
          if (o.i !== e.i && Math.hypot((o.x - e.x) * mLon, (o.y - e.y) * M_LAT) <= JOIN_M) union(e.i, o.i);
        }
      }
    }
  }

  // Dense bridge ids and the longest segment of each bridge.
  const ids = new Map();
  const longest = new Map();
  features.forEach((f, i) => {
    const root = find(i);
    if (!ids.has(root)) ids.set(root, ids.size);
    longest.set(root, Math.max(longest.get(root) ?? 0, f.properties.length_m ?? 0));
  });
  features.forEach((f, i) => {
    const root = find(i);
    f.properties.bid = ids.get(root);
    f.properties.blen = longest.get(root);
  });
  return ids.size;
}
