/**
 * Step 30: per-district (osiedle) statistics + light GeoJSON artefacts for the app
 * (districts with metrics, tram routes/stops, bridges, city outline).
 */
import fs from 'node:fs';
import path from 'node:path';
import area from '@turf/area';
import union from '@turf/union';
import intersect from '@turf/intersect';
import simplify from '@turf/simplify';
import { featureCollection } from '@turf/helpers';
import { OUT_DIR, WORK_DIR } from './lib/config.mjs';
import { bboxContainsPoint, bboxIntersects, bboxOfGeometry, pointInGeometry, representativePoint } from './lib/osm-geometry.mjs';

const t0 = Date.now();
const log = msg => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const read = name => JSON.parse(fs.readFileSync(path.join(WORK_DIR, `${name}.geojson`), 'utf8'));

const districts = read('districts');
const buildings = read('buildings');
const poi = read('poi');
const green = read('green');
const water = read('water');
const tramStops = read('tram_stops');
const bridges = read('bridges');
const tramRoutes = read('tram_routes');
const city = read('city');

const POI_CATS = ['food', 'shop', 'education', 'health', 'culture', 'worship', 'finance', 'public', 'transport', 'sport'];

const D = districts.features.map(f => ({
  f,
  id: f.properties.id,
  name: f.properties.name,
  bbox: bboxOfGeometry(f.geometry),
  area_km2: area(f) / 1e6,
  buildings: 0,
  levelsSum: 0,
  levelsKnown: 0,
  maxHeight: 0,
  tallest: null,
  poi: 0,
  poiByCat: Object.fromEntries(POI_CATS.map(c => [c, 0])),
  tramStopNames: new Set(),
  bridges: 0,
  green_m2: 0,
  water_m2: 0
}));

function districtOf(pt) {
  for (const d of D) {
    if (bboxContainsPoint(d.bbox, pt) && pointInGeometry(pt, d.f.geometry)) return d;
  }
  return null;
}

for (const b of buildings.features) {
  const d = districtOf(representativePoint(b.geometry));
  if (!d) continue;
  d.buildings++;
  const p = b.properties;
  if (p.levels) {
    d.levelsSum += p.levels;
    d.levelsKnown++;
  }
  if (p.hsrc !== 'estimated' && p.height > d.maxHeight) {
    d.maxHeight = p.height;
    d.tallest = p.name ?? null;
  }
}
log('buildings assigned');

for (const f of poi.features) {
  const d = districtOf(f.geometry.coordinates);
  if (!d) continue;
  d.poi++;
  if (f.properties.cat in d.poiByCat) d.poiByCat[f.properties.cat]++;
}
for (const f of tramStops.features) {
  const d = districtOf(f.geometry.coordinates);
  if (d) d.tramStopNames.add(f.properties.name ?? `#${f.properties.osm}`);
}
for (const f of bridges.features) {
  const d = districtOf(representativePoint(f.geometry));
  if (d) d.bridges++;
}
log('poi, stops, bridges assigned');

/** Area of (union of polygons intersecting d) ∩ d, in m². Falls back to a per-polygon sum if clipping fails. */
function coverage(d, polygons) {
  const inside = polygons.filter(p => bboxIntersects(d.bbox, p.bbox)).map(p => p.f);
  if (!inside.length) return 0;
  try {
    const merged = inside.length === 1 ? inside[0] : union(featureCollection(inside));
    if (!merged) return 0;
    const clipped = intersect(featureCollection([d.f, merged]));
    return clipped ? area(clipped) : 0;
  } catch (err) {
    let sum = 0;
    for (const p of inside) {
      try {
        const clipped = intersect(featureCollection([d.f, p]));
        if (clipped) sum += area(clipped);
      } catch {
        /* skip invalid polygon */
      }
    }
    return Math.min(sum, d.area_km2 * 1e6);
  }
}

const greenIdx = green.features.map(f => ({ f, bbox: bboxOfGeometry(f.geometry) }));
const waterIdx = water.features.map(f => ({ f, bbox: bboxOfGeometry(f.geometry) }));
for (const d of D) {
  d.green_m2 = coverage(d, greenIdx);
  d.water_m2 = coverage(d, waterIdx);
}
log('green/water coverage computed');

const round = (v, digits = 1) => +v.toFixed(digits);
const rows = D.map(d => ({
  id: d.id,
  name: d.name,
  area_km2: round(d.area_km2, 2),
  buildings: d.buildings,
  buildings_per_km2: round(d.buildings / d.area_km2, 0),
  levels_mean: d.levelsKnown ? round(d.levelsSum / d.levelsKnown, 1) : null,
  levels_known_pct: d.buildings ? round((100 * d.levelsKnown) / d.buildings, 0) : 0,
  max_height_m: round(d.maxHeight, 0),
  tallest_name: d.tallest,
  poi: d.poi,
  poi_per_km2: round(d.poi / d.area_km2, 0),
  ...Object.fromEntries(POI_CATS.map(c => [`poi_${c}`, d.poiByCat[c]])),
  green_pct: round(Math.min(100, (100 * d.green_m2) / (d.area_km2 * 1e6)), 1),
  water_pct: round(Math.min(100, (100 * d.water_m2) / (d.area_km2 * 1e6)), 1),
  tram_stops: d.tramStopNames.size,
  bridges: d.bridges
}));

const median = values => {
  const v = values.filter(x => x !== null && x !== undefined).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};
const METRICS = ['area_km2', 'buildings', 'buildings_per_km2', 'levels_mean', 'max_height_m', 'poi', 'poi_per_km2', 'green_pct', 'water_pct', 'tram_stops', 'bridges'];
const medians = Object.fromEntries(METRICS.map(m => [m, median(rows.map(r => r[m]))]));
const ranges = Object.fromEntries(METRICS.map(m => {
  const v = rows.map(r => r[m]).filter(x => x !== null);
  return [m, { min: Math.min(...v), max: Math.max(...v) }];
}));

const totalArea = D.reduce((s, d) => s + d.area_km2, 0);
const stats = {
  generatedAt: new Date().toISOString(),
  city: {
    name: city.features[0].properties.name,
    area_km2: round(area(city.features[0]) / 1e6, 1),
    districts: rows.length,
    buildings: buildings.features.length,
    poi: poi.features.length,
    tram_routes: tramRoutes.features.length,
    tram_lines: new Set(tramRoutes.features.map(f => f.properties.ref).filter(Boolean)).size,
    tram_stops: new Set(tramStops.features.map(f => f.properties.name)).size,
    bridges: bridges.features.length,
    bridges_by_kind: bridges.features.reduce((acc, f) => ((acc[f.properties.kind] = (acc[f.properties.kind] ?? 0) + 1), acc), {}),
    green_pct: round((100 * D.reduce((s, d) => s + d.green_m2, 0)) / (totalArea * 1e6), 1),
    water_pct: round((100 * D.reduce((s, d) => s + d.water_m2, 0)) / (totalArea * 1e6), 1)
  },
  medians,
  ranges,
  districts: rows
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'stats.json'), JSON.stringify(stats));

// Districts with metrics baked in (so MapLibre expressions can style them directly), simplified ~3 m.
const districtsOut = featureCollection(
  districts.features.map(f => {
    const row = rows.find(r => r.id === f.properties.id);
    const s = simplify(f, { tolerance: 0.00003, highQuality: true });
    return { type: 'Feature', id: f.id, geometry: s.geometry, properties: { ...f.properties, ...row } };
  })
);
fs.writeFileSync(path.join(OUT_DIR, 'districts.geojson'), JSON.stringify(districtsOut));

const simplifyFc = (fc, tolerance) =>
  featureCollection(fc.features.map(f => ({ ...f, geometry: simplify(f, { tolerance, highQuality: false }).geometry })));
fs.writeFileSync(path.join(OUT_DIR, 'tram_routes.geojson'), JSON.stringify(simplifyFc(tramRoutes, 0.00001)));
fs.writeFileSync(path.join(OUT_DIR, 'tram_stops.geojson'), JSON.stringify(tramStops));
fs.writeFileSync(path.join(OUT_DIR, 'bridges.geojson'), JSON.stringify(simplifyFc(bridges, 0.000005)));
fs.writeFileSync(path.join(OUT_DIR, 'city.geojson'), JSON.stringify(simplifyFc(city, 0.00003)));

const sizes = ['stats.json', 'districts.geojson', 'tram_routes.geojson', 'tram_stops.geojson', 'bridges.geojson', 'city.geojson']
  .map(f => `${f} ${(fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(0)} kB`)
  .join(', ');
log(`written: ${sizes}`);
console.log('city:', JSON.stringify(stats.city));
console.log('medians:', JSON.stringify(medians));
