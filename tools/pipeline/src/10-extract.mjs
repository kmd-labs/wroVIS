/**
 * Step 10: stream the PBF once, keep everything inside the Wrocław bbox, assemble way/relation
 * geometries and write thematic GeoJSON layers to data/work together with a tag-coverage audit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
import { BBOX_MARGIN_DEG, BOUNDARY_FILE, CITY_RELATION_ID, OUT_DIR, PBF_FILE, WORK_DIR } from './lib/config.mjs';
import { PLACE_CATS, buildWalkGraph } from './lib/walk-graph.mjs';
import { groupBridges } from './lib/bridge-groups.mjs';
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

/** Pedestrian network for the walking-reach view: every way a person may walk along. */
const WALK_HIGHWAY = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'service', 'unclassified', 'road', 'cycleway',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link'
]);
function isWalkable(tags) {
  if (!WALK_HIGHWAY.has(tags.highway) || tags.area === 'yes') return false;
  if (tags.foot === 'no' || tags.access === 'no' || tags.access === 'private') return tags.foot === 'yes' || tags.foot === 'designated';
  return true;
}
/**
 * Bike network "via streets": cycle infrastructure plus every street a bike may use, with a kind per way
 * (0 calm street or path, 1 cycle infrastructure, 2 busy street) that the app weighs when routing.
 */
const BIKE_STREET = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'track', 'path']);
const BIKE_BUSY = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const BIKE_YES = new Set(['yes', 'designated', 'permissive']);
function bikeKind(tags) {
  if (!tags.highway || tags.area === 'yes') return -1;
  if (cyclewayKind(tags)) return 1;
  if (tags.bicycle === 'no' || tags.bicycle === 'dismount') return -1;
  if ((tags.access === 'no' || tags.access === 'private') && !BIKE_YES.has(tags.bicycle)) return -1;
  if (tags.highway === 'footway' || tags.highway === 'pedestrian') {
    if (tags.bicycle === 'designated') return 1;
    return tags.bicycle === 'yes' || tags.bicycle === 'permissive' ? 0 : -1;
  }
  if (!BIKE_STREET.has(tags.highway)) return -1;
  return BIKE_BUSY.has(tags.highway) ? 2 : 0;
}
/** @type {Int32Array[]} node indices of bikeable ways, and their kinds */
const bikeWays = [];
const bikeKinds = [];
/** @type {Int32Array[]} node indices of walkable ways */
const walkWays = [];
/** @type {Int32Array[]} node indices of cycle ways (the `cycleways` layer: cycleways, designated paths, lanes and tracks) */
const cycleWays = [];

/** Street network: `highway` values kept in the `streets` layer (service roads only when named). */
const STREET_HIGHWAY = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'pedestrian', 'road', 'service'
]);
function isStreet(tags) {
  if (!STREET_HIGHWAY.has(tags.highway) || tags.area === 'yes') return false;
  return tags.highway !== 'service' || Boolean(tags.name);
}
/** Coarse street class for styling: major roads, local streets, pedestrian zones and named service roads. */
function streetClass(highway) {
  const base = highway.replace(/_link$/, '');
  if (['motorway', 'trunk', 'primary'].includes(base)) return 'primary';
  if (['secondary', 'tertiary'].includes(base)) return 'secondary';
  if (base === 'pedestrian' || base === 'living_street') return 'pedestrian';
  if (base === 'service') return 'service';
  return 'local';
}
function brunnel(tags) {
  if (tags.bridge && tags.bridge !== 'no') return 'bridge';
  if (tags.tunnel && tags.tunnel !== 'no') return 'tunnel';
  return undefined;
}

/** Street (addr:place for addresses without a street) and house number from addr:* tags, or null. */
function addressParts(tags) {
  const number = tags['addr:housenumber']?.trim();
  const street = (tags['addr:street'] ?? tags['addr:place'])?.trim();
  return number && street ? { street, number } : null;
}
/** `Street 12a` from addr:* tags, or undefined. */
function formatAddress(tags) {
  const a = addressParts(tags);
  return a ? `${a.street} ${a.number}` : undefined;
}
/** Address points for the address search (building outlines and address nodes), first occurrence wins. */
const addressPoints = new Map();
function addAddressPoint(tags, pt) {
  const a = addressParts(tags);
  if (!a) return;
  const key = `${a.street.toLowerCase()}|${a.number.toLowerCase()}`;
  if (!addressPoints.has(key)) addressPoints.set(key, { ...a, lon: pt[0], lat: pt[1] });
}
/** `pl:Hala Stulecia` → Wikipedia article URL. */
function wikipediaUrl(value) {
  const m = /^([a-z-]{2,12}):(.+)$/.exec(value ?? '');
  return m ? `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].trim().replace(/ /g, '_'))}` : undefined;
}

const isTaggedNodeOfInterest = tags => tags.railway === 'tram_stop' || poiCategory(tags) !== null || Boolean(formatAddress(tags));

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
          if (tags && cyclewayKind(tags)) {
            // Cycle network for the bike route planner: same topology rule as the walk network.
            const idxs = new Int32Array(refs.length);
            let k = 0;
            for (const ref of refs) {
              const idx = nodeIndex.get(ref);
              if (idx !== undefined) idxs[k++] = idx;
            }
            if (k >= 2) cycleWays.push(k === refs.length ? idxs : idxs.slice(0, k));
          }
          const bk = tags ? bikeKind(tags) : -1;
          if (bk >= 0) {
            const idxs = new Int32Array(refs.length);
            let k = 0;
            for (const ref of refs) {
              const idx = nodeIndex.get(ref);
              if (idx !== undefined) idxs[k++] = idx;
            }
            if (k >= 2) {
              bikeWays.push(k === refs.length ? idxs : idxs.slice(0, k));
              bikeKinds.push(bk);
            }
          }
          if (tags && isWalkable(tags)) {
            // Walk network keeps node indices (shared nodes = topology) rather than plain coordinates.
            const idxs = new Int32Array(refs.length);
            let k = 0;
            for (const ref of refs) {
              const idx = nodeIndex.get(ref);
              if (idx !== undefined) idxs[k++] = idx;
            }
            if (k >= 2) walkWays.push(k === refs.length ? idxs : idxs.slice(0, k));
          }
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
  streets: [],
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
    name: tags.name,
    addr: formatAddress(tags),
    architect: tags.architect,
    style: tags['building:architecture'] ?? tags.architecture,
    heritage: tags.heritage ? 1 : undefined,
    heritage_ref: tags['heritage:ref'] ?? tags['ref:zabytek'] ?? tags['ref:nid'],
    wiki: wikipediaUrl(tags.wikipedia)
  }));
}

function addPolygonThemes(type, id, tags, geometry, rep) {
  if (!inCity(rep)) return;
  if (isBuilding(tags)) {
    layers.buildings.push(buildingFeature(type, id, tags, geometry));
    addAddressPoint(tags, rep);
  }
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
  if (isStreet(tags)) {
    const geom = line();
    if (inCity(representativePoint(geom))) {
      layers.streets.push(feature('way', id, geom, clean({
        class: streetClass(tags.highway),
        kind: tags.highway,
        name: tags.name,
        ref: tags.ref,
        brunnel: brunnel(tags),
        oneway: tags.oneway === 'yes' || tags.oneway === '-1' ? 1 : undefined,
        lanes: parseLevels(tags.lanes) ?? undefined,
        maxspeed: /^\d+$/.test(tags.maxspeed ?? '') ? parseInt(tags.maxspeed, 10) : undefined,
        length_m: Math.round(pathLengthMeters(geom.coordinates))
      })));
    }
  }
}

// Streets carrying tram tracks: a street is flagged `tram` when at least half of its sampled points lie
// within TRAM_NEAR_M of a tram track (tracks are separate ways in OSM, usually drawn in the street axis).
const TRAM_NEAR_M = 14;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((((cityBbox[1] + cityBbox[3]) / 2) * Math.PI) / 180);
const CELL_M = 100;
const cellKey = (x, y) => `${Math.floor(x / CELL_M)}:${Math.floor(y / CELL_M)}`;
const toXY = ([lon, lat]) => [(lon - cityBbox[0]) * M_PER_DEG_LON, (lat - cityBbox[1]) * M_PER_DEG_LAT];
/** Tram track segments indexed by every 100 m grid cell their bounding box touches. */
const tramGrid = new Map();
for (const f of layers.tram_tracks) {
  const pts = f.geometry.coordinates.map(toXY);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const seg = [ax, ay, bx, by];
    for (let cx = Math.floor((Math.min(ax, bx) - TRAM_NEAR_M) / CELL_M); cx <= Math.floor((Math.max(ax, bx) + TRAM_NEAR_M) / CELL_M); cx++) {
      for (let cy = Math.floor((Math.min(ay, by) - TRAM_NEAR_M) / CELL_M); cy <= Math.floor((Math.max(ay, by) + TRAM_NEAR_M) / CELL_M); cy++) {
        const k = `${cx}:${cy}`;
        if (!tramGrid.has(k)) tramGrid.set(k, []);
        tramGrid.get(k).push(seg);
      }
    }
  }
}
function distToSegment(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const nearTram = ([x, y]) => (tramGrid.get(cellKey(x, y)) ?? []).some(seg => distToSegment(x, y, seg) <= TRAM_NEAR_M);
/** Points every ~10 m along a polyline (in metres), so long straight segments are sampled too. */
function samplePoints(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  return out;
}
let tramStreets = 0;
for (const f of layers.streets) {
  const samples = samplePoints(f.geometry.coordinates.map(toXY));
  const near = samples.filter(nearTram).length;
  if (near / samples.length >= 0.5) {
    f.properties.tram = 1;
    tramStreets++;
  }
}
const streetAudit = { total: layers.streets.length, named: 0, tram: tramStreets, kmByClass: {} };
for (const f of layers.streets) {
  const p = f.properties;
  if (p.name) streetAudit.named++;
  streetAudit.kmByClass[p.class] = +((streetAudit.kmByClass[p.class] ?? 0) + p.length_m / 1000).toFixed(1);
}
audit.streets = streetAudit;
log(`streets ${layers.streets.length} (named ${streetAudit.named}, with tram tracks ${tramStreets})`);
const bridgeCount = groupBridges(layers.bridges);
log(`bridges grouped: ${layers.bridges.length} segments → ${bridgeCount} bridges`);
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

// ─── Buildings ⨝ address points and POI ──────────────────────────────────────
// Addresses in OSM sit either on the building outline or on a separate node inside it; POIs inside a
// building tell what is there. Both are joined by point-in-polygon through a 200 m grid of building bboxes.

const BLD_CELL_DEG = 0.002;
const bldGrid = new Map();
const bldBoxes = layers.buildings.map(f => bboxOfGeometry(f.geometry));
layers.buildings.forEach((_, i) => {
  const [x0, y0, x1, y1] = bldBoxes[i];
  for (let cx = Math.floor(x0 / BLD_CELL_DEG); cx <= Math.floor(x1 / BLD_CELL_DEG); cx++) {
    for (let cy = Math.floor(y0 / BLD_CELL_DEG); cy <= Math.floor(y1 / BLD_CELL_DEG); cy++) {
      const k = `${cx}:${cy}`;
      if (!bldGrid.has(k)) bldGrid.set(k, []);
      bldGrid.get(k).push(i);
    }
  }
});
/** Index of the building containing the point (smallest bbox wins for nested outlines), or -1. */
function buildingAt(pt) {
  let best = -1, bestArea = Infinity;
  for (const i of bldGrid.get(`${Math.floor(pt[0] / BLD_CELL_DEG)}:${Math.floor(pt[1] / BLD_CELL_DEG)}`) ?? []) {
    const b = bldBoxes[i];
    if (!bboxContainsPoint(b, pt) || !pointInGeometry(pt, layers.buildings[i].geometry)) continue;
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    if (a < bestArea) {
      best = i;
      bestArea = a;
    }
  }
  return best;
}

const MAX_ADDRESSES = 3;
const nodeAddresses = new Map();
for (const n of taggedNodes) {
  const addr = formatAddress(n.tags);
  if (!addr) continue;
  if (inCity([n.lon, n.lat])) addAddressPoint(n.tags, [n.lon, n.lat]);
  const i = buildingAt([n.lon, n.lat]);
  if (i < 0) continue;
  if (!nodeAddresses.has(i)) nodeAddresses.set(i, new Set());
  nodeAddresses.get(i).add(addr);
}
let addrFromNodes = 0;
for (const [i, set] of nodeAddresses) {
  const p = layers.buildings[i].properties;
  if (p.addr) continue;
  const list = [...set].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
  p.addr = list.slice(0, MAX_ADDRESSES).join('; ');
  if (list.length > MAX_ADDRESSES) p.addr_more = list.length - MAX_ADDRESSES;
  addrFromNodes++;
}
let poiJoined = 0;
const poiByBuilding = new Map();
for (const f of layers.poi) {
  const i = buildingAt(f.geometry.coordinates);
  if (i < 0) continue;
  if (!poiByBuilding.has(i)) poiByBuilding.set(i, []);
  poiByBuilding.get(i).push(f.properties);
  poiJoined++;
}
/** Places listed in a building's card; the card groups them by category. */
const MAX_POI_LIST = 40;
const POI_ORDER = ['shop', 'food', 'health', 'finance', 'public', 'education', 'culture', 'sport', 'worship', 'transport'];
const poiField = v => String(v ?? '').replace(/[|;]/g, ' ').trim();
for (const [i, list] of poiByBuilding) {
  const p = layers.buildings[i].properties;
  p.poi_n = list.length;
  const sorted = [...list].sort(
    (a, b) =>
      POI_ORDER.indexOf(a.cat) - POI_ORDER.indexOf(b.cat) ||
      (a.name ? 0 : 1) - (b.name ? 0 : 1) ||
      poiField(a.name).localeCompare(poiField(b.name), 'pl')
  );
  // "cat|sub|name;…" — sub is the OSM value (shop=bakery → bakery), name may be empty.
  p.pois = sorted.slice(0, MAX_POI_LIST).map(x => [x.cat, poiField(x.sub), poiField(x.name)].join('|')).join(';');
}
const bAudit = audit.buildings;
bAudit.withAddress = layers.buildings.filter(f => f.properties.addr).length;
bAudit.addressFromNodes = addrFromNodes;
bAudit.withPoi = poiByBuilding.size;
bAudit.withHeritage = layers.buildings.filter(f => f.properties.heritage).length;
bAudit.withArchitect = layers.buildings.filter(f => f.properties.architect).length;
bAudit.withWikipedia = layers.buildings.filter(f => f.properties.wiki).length;
log(`buildings: address ${bAudit.withAddress} (${addrFromNodes} from address nodes), with POI ${poiByBuilding.size} (${poiJoined} POI joined), heritage ${bAudit.withHeritage}, architect ${bAudit.withArchitect}, wikipedia ${bAudit.withWikipedia}`);

// ─── Pedestrian graph (walking reach) ────────────────────────────────────────

const POI_TO_PLACE = { shop: 'shop', food: 'food', education: 'education', health: 'health', culture: 'culture', sport: 'culture', finance: 'services', public: 'services' };
const placeCat = name => PLACE_CATS.indexOf(name);
const walkPlaces = [];
for (const f of layers.poi) {
  const cat = POI_TO_PLACE[f.properties.cat];
  if (cat) walkPlaces.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], cat: placeCat(cat) });
}
for (const f of layers.tram_stops) walkPlaces.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], cat: placeCat('tram') });
for (const f of layers.green) {
  if (f.properties.kind !== 'park' || !f.properties.name) continue; // named parks and gardens, not every lawn or playground
  const [lon, lat] = representativePoint(f.geometry);
  walkPlaces.push({ lon, lat, cat: placeCat('park') });
}
const WALK_MARGIN_DEG = 0.005;
const walk = buildWalkGraph({
  ways: walkWays,
  lon: nodeLon,
  lat: nodeLat,
  nodeCount,
  bbox: [cityBbox[0] - WALK_MARGIN_DEG, cityBbox[1] - WALK_MARGIN_DEG, cityBbox[2] + WALK_MARGIN_DEG, cityBbox[3] + WALK_MARGIN_DEG],
  places: walkPlaces
});
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'walk.bin.gz'), walk.gz);
audit.walk = walk.stats;

// Cycle graph for the bike route planner: strictly the cycle network as connected in OSM (no gap bridging).
const cycle = buildWalkGraph({ ways: cycleWays, lon: nodeLon, lat: nodeLat, nodeCount, bbox: walk.bbox ?? [cityBbox[0] - WALK_MARGIN_DEG, cityBbox[1] - WALK_MARGIN_DEG, cityBbox[2] + WALK_MARGIN_DEG, cityBbox[3] + WALK_MARGIN_DEG], places: [] });
fs.writeFileSync(path.join(OUT_DIR, 'cycle.bin.gz'), cycle.gz);
audit.cycle = cycle.stats;
log(`cycle graph: ${JSON.stringify(cycle.stats)}, gzip ${(cycle.gz.length / 1e6).toFixed(2)} MB`);

// Bike graph "via streets": cycle infrastructure and bikeable streets, with the kind of every edge.
const bikeBbox = [cityBbox[0] - WALK_MARGIN_DEG, cityBbox[1] - WALK_MARGIN_DEG, cityBbox[2] + WALK_MARGIN_DEG, cityBbox[3] + WALK_MARGIN_DEG];
const bike = buildWalkGraph({ ways: bikeWays, kinds: bikeKinds, lon: nodeLon, lat: nodeLat, nodeCount, bbox: bikeBbox, places: [] });
fs.writeFileSync(path.join(OUT_DIR, 'bike.bin.gz'), bike.gz);
audit.bike = bike.stats;
log(`bike graph: ${JSON.stringify(bike.stats)}, gzip ${(bike.gz.length / 1e6).toFixed(2)} MB`);

// Address index for the search box: streets once, then parallel arrays (street index, number, position).
const addrList = [...addressPoints.values()].sort(
  (a, b) => a.street.localeCompare(b.street, 'pl') || a.number.localeCompare(b.number, 'pl', { numeric: true })
);
const streetNames = [...new Set(addrList.map(a => a.street))];
const streetIndex = new Map(streetNames.map((s, i) => [s, i]));
const AO = [Math.floor(cityBbox[0] * 100) / 100, Math.floor(cityBbox[1] * 100) / 100];
const addressIndex = {
  v: 1,
  o: AO,
  streets: streetNames,
  s: addrList.map(a => streetIndex.get(a.street)),
  n: addrList.map(a => a.number),
  x: addrList.map(a => Math.round((a.lon - AO[0]) * 1e5)),
  y: addrList.map(a => Math.round((a.lat - AO[1]) * 1e5))
};
const addrGz = gzipSync(Buffer.from(JSON.stringify(addressIndex)), { level: 9 });
fs.writeFileSync(path.join(OUT_DIR, 'addresses.json.gz'), addrGz);
audit.addresses = { addresses: addrList.length, streets: streetNames.length };
log(`address index: ${addrList.length} addresses on ${streetNames.length} streets, gzip ${(addrGz.length / 1e6).toFixed(2)} MB`);
log(`walk graph: ${JSON.stringify(walk.stats)}, gzip ${(walk.gz.length / 1e6).toFixed(2)} MB`);

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
  namePct: +((100 * a.withName) / a.total).toFixed(1),
  addressPct: +((100 * a.withAddress) / a.total).toFixed(1)
};
fs.writeFileSync(path.join(WORK_DIR, 'extract-summary.json'), JSON.stringify(summary, null, 2));
log(`done. ${JSON.stringify(summary.layers)}`);
console.log('buildings audit:', JSON.stringify(summary.audit.buildings));
