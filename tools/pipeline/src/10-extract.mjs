/**
 * Step 10: stream the PBF once, keep everything inside the Wrocław bbox, assemble way/relation
 * geometries and write thematic GeoJSON layers to data/work together with a tag-coverage audit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BBOX_MARGIN_DEG, BOUNDARY_FILE, CITY_RELATION_ID, PBF_FILE, WORK_DIR } from './lib/config.mjs';
import {
  bboxContainsPoint,
  bboxOfGeometry,
  bboxOfRing,
  buildMultipolygon,
  orientRing,
  pathLengthMeters,
  pointInGeometry,
  pointInRing,
  representativePoint
} from './lib/osm-geometry.mjs';

const require = createRequire(import.meta.url);
const parseOSM = require('osm-pbf-parser');

const t0 = Date.now();
const log = msg => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

// ─── City boundary & bbox ────────────────────────────────────────────────────

const boundaryFc = JSON.parse(fs.readFileSync(BOUNDARY_FILE, 'utf8'));
const cityFeature = boundaryFc.features[0];
const cityGeom = cityFeature.geometry;
const cityBbox = bboxOfGeometry(cityGeom);
const keepBbox = [
  cityBbox[0] - BBOX_MARGIN_DEG,
  cityBbox[1] - BBOX_MARGIN_DEG,
  cityBbox[2] + BBOX_MARGIN_DEG,
  cityBbox[3] + BBOX_MARGIN_DEG
];
const inCity = pt => bboxContainsPoint(cityBbox, pt) && pointInGeometry(pt, cityGeom);

// ─── Node store (typed arrays + id index) ────────────────────────────────────

let cap = 1 << 22;
let nodeLon = new Float64Array(cap);
let nodeLat = new Float64Array(cap);
let nodeCount = 0;
const nodeIndex = new Map();

function addNode(id, lon, lat) {
  if (nodeCount === cap) {
    cap *= 2;
    const nl = new Float64Array(cap);
    nl.set(nodeLon);
    nodeLon = nl;
    const na = new Float64Array(cap);
    na.set(nodeLat);
    nodeLat = na;
  }
  nodeLon[nodeCount] = lon;
  nodeLat[nodeCount] = lat;
  nodeIndex.set(id, nodeCount++);
}

/** @type {Array<{id:number,lon:number,lat:number,tags:Record<string,string>}>} */
const taggedNodes = [];
/** @type {Map<number,{tags:Record<string,string>|null,coords:Float64Array,first:number,last:number}>} */
const ways = new Map();
/** @type {Array<{id:number,tags:Record<string,string>,members:Array<{type:string,id:number,role:string}>}>} */
const relations = [];

// ─── Tag predicates ──────────────────────────────────────────────────────────

const POI_AMENITY = {
  food: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'food_court', 'biergarten'],
  education: ['school', 'kindergarten', 'university', 'college', 'library', 'language_school', 'music_school', 'driving_school', 'childcare'],
  health: ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'veterinary'],
  culture: ['theatre', 'cinema', 'arts_centre', 'community_centre', 'nightclub', 'social_centre', 'exhibition_centre', 'events_venue'],
  worship: ['place_of_worship'],
  finance: ['bank', 'atm', 'bureau_de_change'],
  public: ['police', 'post_office', 'townhall', 'courthouse', 'fire_station', 'embassy', 'social_facility', 'public_building'],
  transport: ['fuel', 'charging_station', 'bicycle_rental', 'car_rental', 'car_sharing', 'taxi', 'bus_station']
};
const AMENITY_CAT = new Map();
for (const [cat, values] of Object.entries(POI_AMENITY)) for (const v of values) AMENITY_CAT.set(v, cat);
const TOURISM_CULTURE = new Set(['museum', 'gallery', 'attraction', 'artwork', 'viewpoint', 'zoo', 'theme_park', 'aquarium']);
const LEISURE_SPORT = new Set(['fitness_centre', 'sports_centre', 'swimming_pool', 'stadium', 'ice_rink', 'bowling_alley', 'climbing', 'water_park']);

function poiCategory(tags) {
  if (tags.shop && tags.shop !== 'no') return { cat: 'shop', sub: tags.shop };
  if (tags.amenity && AMENITY_CAT.has(tags.amenity)) return { cat: AMENITY_CAT.get(tags.amenity), sub: tags.amenity };
  if (tags.tourism && TOURISM_CULTURE.has(tags.tourism)) return { cat: 'culture', sub: tags.tourism };
  if (tags.leisure && LEISURE_SPORT.has(tags.leisure)) return { cat: 'sport', sub: tags.leisure };
  return null;
}

const RESIDENTIAL = new Set(['apartments', 'residential', 'house', 'detached', 'semidetached_house', 'terrace', 'dormitory', 'bungalow', 'cabin', 'farm', 'static_caravan', 'allotment_house']);
const HOUSE_LIKE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm', 'allotment_house', 'static_caravan']);
const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'supermarket', 'hotel', 'kiosk', 'shop', 'mall', 'restaurant']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'service', 'storage_tank', 'silo', 'transformer_tower', 'barn', 'farm_auxiliary', 'cowshed', 'stable', 'greenhouse', 'sty', 'digester', 'boathouse']);
const PUBLIC = new Set(['public', 'school', 'university', 'college', 'hospital', 'kindergarten', 'civic', 'government', 'train_station', 'transportation', 'fire_station', 'sports_hall', 'sports_centre', 'stadium', 'grandstand', 'pavilion', 'museum', 'library', 'townhall', 'courthouse', 'police', 'prison', 'riding_hall', 'clinic']);
const RELIGIOUS = new Set(['church', 'chapel', 'cathedral', 'synagogue', 'mosque', 'temple', 'religious', 'monastery', 'shrine', 'presbytery', 'convent']);
const UTILITY = new Set(['garage', 'garages', 'carport', 'shed', 'hut', 'roof', 'toilets', 'bunker', 'container', 'parking', 'gatehouse', 'guardhouse']);
const PUBLIC_AMENITY = new Set(['school', 'kindergarten', 'university', 'college', 'hospital', 'clinic', 'townhall', 'police', 'library', 'theatre', 'cinema', 'fire_station', 'courthouse', 'community_centre', 'social_facility', 'arts_centre', 'post_office']);
const COMMERCIAL_AMENITY = new Set(['restaurant', 'cafe', 'bank', 'fast_food', 'bar', 'pub', 'fuel', 'car_wash', 'marketplace']);
const ESTIMATED_LEVELS = { residential: 5, commercial: 3, industrial: 2, public: 3, religious: 4, utility: 1, other: 2 };

function buildingClass(tags) {
  const b = tags.building;
  if (RESIDENTIAL.has(b)) return 'residential';
  if (COMMERCIAL.has(b)) return 'commercial';
  if (INDUSTRIAL.has(b)) return 'industrial';
  if (PUBLIC.has(b)) return 'public';
  if (RELIGIOUS.has(b)) return 'religious';
  if (UTILITY.has(b)) return 'utility';
  if (tags.amenity === 'place_of_worship') return 'religious';
  if (PUBLIC_AMENITY.has(tags.amenity)) return 'public';
  if (tags.shop || tags.office || COMMERCIAL_AMENITY.has(tags.amenity)) return 'commercial';
  return 'other';
}

function parseHeight(s) {
  if (!s) return null;
  const m = String(s).replace(',', '.').match(/(-?\d+(?:\.\d+)?)\s*(m|ft|')?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (/ft|'/.test(m[2] ?? '')) v *= 0.3048;
  return v > 0 && v < 400 ? Math.round(v * 10) / 10 : null;
}

function parseLevels(s) {
  if (!s) return null;
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v < 80 ? Math.round(v) : null;
}

function parseYear(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1000 && y <= 2030 ? y : null;
}

function isBuilding(tags) {
  return tags.building && tags.building !== 'no';
}
function isWaterArea(tags) {
  return tags.natural === 'water' || tags.landuse === 'reservoir' || tags.landuse === 'basin' || tags.waterway === 'riverbank' || tags.waterway === 'dock';
}
function waterKind(tags) {
  return tags.water || (tags.landuse === 'reservoir' ? 'reservoir' : tags.waterway === 'riverbank' ? 'river' : 'other');
}
const WATERWAY_LINES = new Set(['river', 'canal', 'stream', 'ditch', 'drain']);
const GREEN_LEISURE = { park: 'park', garden: 'park', dog_park: 'park', nature_reserve: 'nature', golf_course: 'park', playground: 'park' };
const GREEN_LANDUSE = { grass: 'grass', forest: 'forest', meadow: 'grass', allotments: 'allotments', cemetery: 'cemetery', recreation_ground: 'park', village_green: 'park', orchard: 'grass', vineyard: 'grass', flowerbed: 'grass', greenfield: 'grass' };
const GREEN_NATURAL = { wood: 'forest', scrub: 'grass', grassland: 'grass', heath: 'grass', wetland: 'nature', fell: 'grass' };
function greenKind(tags) {
  return GREEN_LEISURE[tags.leisure] ?? GREEN_LANDUSE[tags.landuse] ?? GREEN_NATURAL[tags.natural] ?? null;
}
function isBridgeLine(tags) {
  return tags.bridge && tags.bridge !== 'no' && (tags.highway || tags.railway);
}
const FOOT_HIGHWAY = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway']);
const RAIL = new Set(['rail', 'light_rail', 'narrow_gauge', 'subway', 'monorail']);
function bridgeKind(tags) {
  if (tags.railway === 'tram') return 'tram';
  if (RAIL.has(tags.railway)) return 'rail';
  if (FOOT_HIGHWAY.has(tags.highway)) return 'foot';
  if (tags.highway) return 'road';
  return 'other';
}
function cyclewayKind(tags) {
  if (tags.highway === 'cycleway') return 'cycleway';
  if (tags.highway === 'path' && tags.bicycle === 'designated') return 'path';
  const cw = [tags.cycleway, tags['cycleway:left'], tags['cycleway:right'], tags['cycleway:both']].filter(Boolean);
  if (cw.some(v => v === 'track' || v === 'opposite_track')) return 'track';
  if (cw.some(v => v === 'lane' || v === 'shared_lane' || v === 'opposite_lane')) return 'lane';
  return null;
}

const isTaggedNodeOfInterest = tags => tags.railway === 'tram_stop' || poiCategory(tags) !== null;

function isRelationOfInterest(tags) {
  if (tags.type === 'boundary' && tags.boundary === 'administrative' && (tags.admin_level === '9' || tags.admin_level === '8')) return true;
  if (tags.type === 'route' && tags.route === 'tram') return true;
  if (tags.type === 'multipolygon') {
    return isBuilding(tags) || isWaterArea(tags) || greenKind(tags) !== null || tags.man_made === 'bridge' || poiCategory(tags) !== null;
  }
  return false;
}

// ─── Streaming pass ──────────────────────────────────────────────────────────

let seenNodes = 0, seenWays = 0, seenRels = 0;

await pipeline(
  fs.createReadStream(PBF_FILE),
  parseOSM(),
  new Writable({
    objectMode: true,
    highWaterMark: 4,
    write(items, _enc, next) {
      for (const it of items) {
        if (it.type === 'node') {
          seenNodes++;
          if (it.lon < keepBbox[0] || it.lon > keepBbox[2] || it.lat < keepBbox[1] || it.lat > keepBbox[3]) continue;
          addNode(it.id, it.lon, it.lat);
          if (it.tags && isTaggedNodeOfInterest(it.tags)) taggedNodes.push({ id: it.id, lon: it.lon, lat: it.lat, tags: it.tags });
        } else if (it.type === 'way') {
          seenWays++;
          const refs = it.refs;
          const coords = new Float64Array(refs.length * 2);
          let n = 0;
          for (const ref of refs) {
            const idx = nodeIndex.get(ref);
            if (idx === undefined) continue;
            coords[n * 2] = nodeLon[idx];
            coords[n * 2 + 1] = nodeLat[idx];
            n++;
          }
          if (n < 2) continue;
          const tags = it.tags && Object.keys(it.tags).length ? it.tags : null;
          ways.set(it.id, { tags, coords: n === refs.length ? coords : coords.slice(0, n * 2), first: refs[0], last: refs[refs.length - 1] });
        } else if (it.type === 'relation') {
          seenRels++;
          if (it.tags && isRelationOfInterest(it.tags)) relations.push({ id: it.id, tags: it.tags, members: it.members });
        }
      }
      next();
    }
  })
);

log(`stream done: nodes ${seenNodes} (kept ${nodeCount}), ways ${seenWays} (kept ${ways.size}), relations ${seenRels} (kept ${relations.length})`);
nodeIndex.clear();

// ─── Geometry builders ───────────────────────────────────────────────────────

function wayCoords(way) {
  const c = way.coords;
  const out = new Array(c.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = [c[i * 2], c[i * 2 + 1]];
  return out;
}

function wayIsClosed(way) {
  return way.first === way.last && way.coords.length >= 8;
}

function wayPolygon(way) {
  const ring = wayCoords(way);
  const a = ring[0], b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return { type: 'Polygon', coordinates: [orientRing(ring, true)] };
}

function segmentsForRoles(rel, roles) {
  const segs = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || !roles.has(m.role)) continue;
    const w = ways.get(m.id);
    if (w) segs.push({ first: w.first, last: w.last, coords: wayCoords(w) });
  }
  return segs;
}

const OUTER_ROLES = new Set(['outer', '']);
const INNER_ROLES = new Set(['inner']);

/** Polygon for a multipolygon/boundary relation; `undefined` when none of its ways lie in the extract bbox. */
function relationPolygon(rel) {
  const outer = segmentsForRoles(rel, OUTER_ROLES);
  if (!outer.length) return undefined;
  return buildMultipolygon(outer, segmentsForRoles(rel, INNER_ROLES));
}

const featureId = (type, id) => (type === 'way' ? id * 2 : id * 2 + 1);
const osmRef = (type, id) => `${type === 'way' ? 'w' : type === 'node' ? 'n' : 'r'}${id}`;

function feature(type, id, geometry, properties) {
  return { type: 'Feature', id: featureId(type, id), geometry, properties: { osm: osmRef(type, id), ...properties } };
}

const clean = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ─── Layers ──────────────────────────────────────────────────────────────────

const layers = {
  districts: [],
  buildings: [],
  water: [],
  waterways: [],
  green: [],
  bridges: [],
  bridge_areas: [],
  tram_tracks: [],
  tram_routes: [],
  tram_stops: [],
  cycleways: [],
  poi: []
};

const audit = {
  buildings: { total: 0, withLevels: 0, withHeight: 0, withStartDate: 0, withName: 0, byClass: {}, byHeightSource: {} },
  relationsDropped: 0
};

function buildingFeature(type, id, tags, geometry) {
  const cls = buildingClass(tags);
  const levels = parseLevels(tags['building:levels']);
  const height = parseHeight(tags.height);
  let heightM, hsrc;
  if (height !== null) {
    heightM = height;
    hsrc = 'height';
  } else if (levels !== null) {
    heightM = levels * 3;
    hsrc = 'levels';
  } else {
    const est = HOUSE_LIKE.has(tags.building) ? 2 : ESTIMATED_LEVELS[cls];
    heightM = est * 3;
    hsrc = 'estimated';
  }
  const year = parseYear(tags.start_date);
  const a = audit.buildings;
  a.total++;
  if (levels !== null) a.withLevels++;
  if (height !== null) a.withHeight++;
  if (year !== null) a.withStartDate++;
  if (tags.name) a.withName++;
  a.byClass[cls] = (a.byClass[cls] ?? 0) + 1;
  a.byHeightSource[hsrc] = (a.byHeightSource[hsrc] ?? 0) + 1;
  return feature(type, id, geometry, clean({
    class: cls,
    type: tags.building,
    levels,
    height: heightM,
    hsrc,
    year,
    name: tags.name
  }));
}

function addPolygonThemes(type, id, tags, geometry, rep) {
  if (!inCity(rep)) return;
  if (isBuilding(tags)) layers.buildings.push(buildingFeature(type, id, tags, geometry));
  if (isWaterArea(tags)) layers.water.push(feature(type, id, geometry, clean({ kind: waterKind(tags), name: tags.name })));
  const g = greenKind(tags);
  if (g) layers.green.push(feature(type, id, geometry, clean({ kind: g, name: tags.name })));
  if (tags.man_made === 'bridge') layers.bridge_areas.push(feature(type, id, geometry, clean({ name: tags.name ?? tags['bridge:name'] })));
}

// Districts and tram routes/stops first (they enrich other layers).
const districtGeoms = [];
const wayRouteRefs = new Map();
const nodeRouteRefs = new Map();
for (const rel of relations) {
  const t = rel.tags;
  if (t.type === 'boundary') {
    if (t.admin_level !== '9') continue;
    const geom = relationPolygon(rel);
    if (!geom) {
      if (geom === null) audit.relationsDropped++;
      continue;
    }
    const rep = representativePoint(geom);
    if (!inCity(rep)) continue;
    layers.districts.push(feature('relation', rel.id, geom, clean({ id: rel.id, name: t.name, wikidata: t.wikidata, teryt: t['teryt:simc'] ?? t['teryt:terc'] })));
    districtGeoms.push({ id: rel.id, geom, bbox: bboxOfGeometry(geom) });
  } else if (t.type === 'route') {
    const lines = [];
    for (const m of rel.members) {
      const role = m.role ?? '';
      if (m.type === 'way' && !/^(platform|stop)/.test(role)) {
        const w = ways.get(m.id);
        if (w) {
          lines.push(wayCoords(w));
          if (t.ref) {
            if (!wayRouteRefs.has(m.id)) wayRouteRefs.set(m.id, new Set());
            wayRouteRefs.get(m.id).add(t.ref);
          }
        }
      } else if (m.type === 'node' && t.ref) {
        if (!nodeRouteRefs.has(m.id)) nodeRouteRefs.set(m.id, new Set());
        nodeRouteRefs.get(m.id).add(t.ref);
      }
    }
    if (!lines.length) continue;
    const geom = { type: 'MultiLineString', coordinates: lines };
    layers.tram_routes.push(feature('relation', rel.id, geom, clean({
      ref: t.ref,
      name: t.name,
      colour: t.colour,
      from: t.from,
      to: t.to,
      operator: t.operator,
      network: t.network,
      length_m: Math.round(lines.reduce((s, l) => s + pathLengthMeters(l), 0))
    })));
  }
}
log(`districts ${layers.districts.length}, tram routes ${layers.tram_routes.length}`);

// Multipolygon relations.
for (const rel of relations) {
  if (rel.tags.type !== 'multipolygon') continue;
  const geom = relationPolygon(rel);
  if (!geom) {
    if (geom === null) audit.relationsDropped++; // ways present but no closed outer ring
    continue;
  }
  addPolygonThemes('relation', rel.id, rel.tags, geom, representativePoint(geom));
}
log(`multipolygon relations processed (dropped ${audit.relationsDropped})`);

// Ways.
const sortedRefs = set => [...set].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b)).join(';');
const polygonPois = [];
for (const [id, way] of ways) {
  const tags = way.tags;
  if (!tags) continue;
  const closed = wayIsClosed(way) && tags.area !== 'no';
  const isAreaTagged = isBuilding(tags) || isWaterArea(tags) || greenKind(tags) !== null || tags.man_made === 'bridge' || tags.area === 'yes';

  if (closed && isAreaTagged && tags.type !== 'multipolygon') {
    const geom = wayPolygon(way);
    addPolygonThemes('way', id, tags, geom, representativePoint(geom));
  }

  if (closed && poiCategory(tags) && !tags.highway) {
    const geom = wayPolygon(way);
    const rep = representativePoint(geom);
    if (inCity(rep)) polygonPois.push({ id, tags, geom, rep, bbox: bboxOfRing(geom.coordinates[0]) });
  }

  const line = () => ({ type: 'LineString', coordinates: wayCoords(way) });
  if (isBridgeLine(tags)) {
    const geom = line();
    const rep = representativePoint(geom);
    if (inCity(rep)) {
      layers.bridges.push(feature('way', id, geom, clean({
        kind: bridgeKind(tags),
        sub: tags.railway ?? tags.highway,
        name: tags.name ?? tags['bridge:name'],
        bridge: tags.bridge,
        length_m: Math.round(pathLengthMeters(geom.coordinates))
      })));
    }
  }
  if (tags.railway === 'tram') {
    const geom = line();
    if (inCity(representativePoint(geom))) {
      const refs = wayRouteRefs.get(id);
      layers.tram_tracks.push(feature('way', id, geom, clean({ name: tags.name, routes: refs ? sortedRefs(refs) : undefined })));
    }
  }
  const ck = cyclewayKind(tags);
  if (ck) {
    const geom = line();
    if (inCity(representativePoint(geom))) layers.cycleways.push(feature('way', id, geom, clean({ kind: ck, name: tags.name })));
  }
  if (WATERWAY_LINES.has(tags.waterway)) {
    const geom = line();
    if (inCity(representativePoint(geom))) layers.waterways.push(feature('way', id, geom, clean({ kind: tags.waterway, name: tags.name })));
  }
}
log(`ways processed: buildings ${layers.buildings.length}, water ${layers.water.length}, green ${layers.green.length}, bridges ${layers.bridges.length}, tram tracks ${layers.tram_tracks.length}, cycleways ${layers.cycleways.length}`);

// POI nodes, then polygon POIs that have no node POI of the same kind inside (avoids double counting).
const nodePoisBySub = new Map();
for (const n of taggedNodes) {
  const pt = [n.lon, n.lat];
  if (!inCity(pt)) continue;
  if (n.tags.railway === 'tram_stop') {
    const refs = nodeRouteRefs.get(n.id);
    layers.tram_stops.push(feature('node', n.id, { type: 'Point', coordinates: pt }, clean({ name: n.tags.name, routes: refs ? sortedRefs(refs) : undefined })));
  }
  const cat = poiCategory(n.tags);
  if (cat) {
    layers.poi.push(feature('node', n.id, { type: 'Point', coordinates: pt }, clean({ cat: cat.cat, sub: cat.sub, name: n.tags.name })));
    if (!nodePoisBySub.has(cat.sub)) nodePoisBySub.set(cat.sub, []);
    nodePoisBySub.get(cat.sub).push(pt);
  }
}
let polygonPoiSkipped = 0;
for (const p of polygonPois) {
  const cat = poiCategory(p.tags);
  const candidates = nodePoisBySub.get(cat.sub) ?? [];
  const ring = p.geom.coordinates[0];
  const duplicate = candidates.some(pt => bboxContainsPoint(p.bbox, pt) && pointInRing(pt, ring));
  if (duplicate) {
    polygonPoiSkipped++;
    continue;
  }
  layers.poi.push(feature('way', p.id, { type: 'Point', coordinates: p.rep }, clean({ cat: cat.cat, sub: cat.sub, name: p.tags.name })));
}
log(`poi ${layers.poi.length} (polygon duplicates skipped ${polygonPoiSkipped}), tram stops ${layers.tram_stops.length}`);

// ─── Output ──────────────────────────────────────────────────────────────────

fs.mkdirSync(WORK_DIR, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  bbox: cityBbox,
  seen: { nodes: seenNodes, ways: seenWays, relations: seenRels },
  kept: { nodes: nodeCount, ways: ways.size, relations: relations.length },
  layers: {},
  audit
};
for (const [name, features] of Object.entries(layers)) {
  const fc = { type: 'FeatureCollection', features };
  const file = path.join(WORK_DIR, `${name}.geojson`);
  fs.writeFileSync(file, JSON.stringify(fc));
  summary.layers[name] = { features: features.length, bytes: fs.statSync(file).size };
}
fs.writeFileSync(
  path.join(WORK_DIR, 'city.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: [feature('relation', CITY_RELATION_ID, cityGeom, { id: CITY_RELATION_ID, name: cityFeature.properties?.name ?? 'Wrocław' })] })
);
const a = audit.buildings;
summary.audit.buildings.coverage = {
  levelsPct: +((100 * a.withLevels) / a.total).toFixed(1),
  heightPct: +((100 * a.withHeight) / a.total).toFixed(1),
  startDatePct: +((100 * a.withStartDate) / a.total).toFixed(1),
  namePct: +((100 * a.withName) / a.total).toFixed(1)
};
fs.writeFileSync(path.join(WORK_DIR, 'extract-summary.json'), JSON.stringify(summary, null, 2));
log(`done. ${JSON.stringify(summary.layers)}`);
console.log('buildings audit:', JSON.stringify(summary.audit.buildings));
