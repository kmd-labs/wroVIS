/**
 * Geometry helpers for assembling OSM ways/relations into GeoJSON and for cheap spatial tests.
 * Coordinates are [lon, lat] pairs; ring tests are planar (fine at city scale).
 */

export function signedRingArea(ring) {
  let sum = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    sum += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  }
  // Shoelace variant: negative sum => counter-clockwise
  return -sum / 2;
}

/** Orients a closed ring counter-clockwise (outer) or clockwise (inner) per the GeoJSON right-hand rule. */
export function orientRing(ring, counterClockwise) {
  const ccw = signedRingArea(ring) > 0;
  return ccw === counterClockwise ? ring : ring.slice().reverse();
}

export function bboxOfRing(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function bboxOfGeometry(geom) {
  const rings = flattenRings(geom);
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) {
    const rb = bboxOfRing(r);
    b = [Math.min(b[0], rb[0]), Math.min(b[1], rb[1]), Math.max(b[2], rb[2]), Math.max(b[3], rb[3])];
  }
  return b;
}

export function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function bboxContainsPoint(b, pt) {
  return pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
}

/** All coordinate rings/lines of a geometry as a flat list of coordinate arrays. */
export function flattenRings(geom) {
  switch (geom.type) {
    case 'Point':
      return [[geom.coordinates]];
    case 'LineString':
      return [geom.coordinates];
    case 'MultiLineString':
    case 'Polygon':
      return geom.coordinates;
    case 'MultiPolygon':
      return geom.coordinates.flat();
    default:
      return [];
  }
}

export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonCoords(pt, polygon) {
  if (!pointInRing(pt, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(pt, polygon[i])) return false;
  }
  return true;
}

export function pointInGeometry(pt, geom) {
  if (geom.type === 'Polygon') return pointInPolygonCoords(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInPolygonCoords(pt, p));
  return false;
}

/** A cheap representative point: polygons -> first outer vertex, lines -> middle vertex, points -> itself. */
export function representativePoint(geom) {
  switch (geom.type) {
    case 'Point':
      return geom.coordinates;
    case 'LineString':
      return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    case 'MultiLineString':
      return representativePoint({ type: 'LineString', coordinates: geom.coordinates[0] });
    case 'Polygon':
      return ringInteriorPoint(geom.coordinates[0]);
    case 'MultiPolygon':
      return ringInteriorPoint(geom.coordinates[0][0]);
    default:
      return null;
  }
}

/** Centroid of the ring's vertices if it lies inside the ring, otherwise the first vertex. */
function ringInteriorPoint(ring) {
  let sx = 0, sy = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  const c = [sx / n, sy / n];
  return pointInRing(c, ring) ? c : ring[0];
}

/**
 * Joins way segments into closed rings by matching end node ids.
 * @param {Array<{first:number,last:number,coords:number[][]}>} segments
 * @returns {number[][][]} closed rings (first == last)
 */
export function assembleRings(segments) {
  const pending = segments.filter(s => s.coords.length >= 2).map(s => ({ ...s, coords: s.coords.slice() }));
  const rings = [];
  while (pending.length) {
    const seed = pending.pop();
    let first = seed.first;
    let last = seed.last;
    let coords = seed.coords;
    let guard = 0;
    while (first !== last && guard++ < 10000) {
      let extended = false;
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i];
        if (s.first === last) {
          coords = coords.concat(s.coords.slice(1));
          last = s.last;
        } else if (s.last === last) {
          coords = coords.concat(s.coords.slice(0, -1).reverse());
          last = s.first;
        } else if (s.last === first) {
          coords = s.coords.slice(0, -1).concat(coords);
          first = s.first;
        } else if (s.first === first) {
          coords = s.coords.slice(1).reverse().concat(coords);
          first = s.last;
        } else {
          continue;
        }
        pending.splice(i, 1);
        extended = true;
        break;
      }
      if (!extended) break;
    }
    if (first === last && coords.length >= 4) {
      const c0 = coords[0], cn = coords[coords.length - 1];
      if (c0[0] !== cn[0] || c0[1] !== cn[1]) coords.push([c0[0], c0[1]]);
      rings.push(coords);
    }
    // otherwise: incomplete ring (way missing from the extract) -> dropped
  }
  return rings;
}

/**
 * Builds a Polygon/MultiPolygon from outer and inner way segments (multipolygon / boundary relations).
 * Returns null when no valid outer ring can be assembled.
 */
export function buildMultipolygon(outerSegments, innerSegments) {
  const outers = assembleRings(outerSegments).map(r => orientRing(r, true));
  if (!outers.length) return null;
  const inners = assembleRings(innerSegments).map(r => orientRing(r, false));
  const polygons = outers.map(o => [o]);
  const outerBoxes = outers.map(bboxOfRing);
  for (const inner of inners) {
    const pt = inner[0];
    let placed = false;
    for (let i = 0; i < outers.length; i++) {
      if (bboxContainsPoint(outerBoxes[i], pt) && pointInRing(pt, outers[i])) {
        polygons[i].push(inner);
        placed = true;
        break;
      }
    }
    if (!placed && outers.length === 1) polygons[0].push(inner);
  }
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

/** Haversine length of a coordinate path in metres. */
export function pathLengthMeters(coords) {
  const R = 6371008.8;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const dφ = φ2 - φ1, dλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(a));
  }
  return total;
}

/** Web Mercator tile coordinates of a lon/lat at zoom z. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}
