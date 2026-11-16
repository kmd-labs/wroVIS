import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** tools/pipeline */
export const PIPELINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW_DIR = path.join(PIPELINE_DIR, 'data', 'raw');
export const WORK_DIR = path.join(PIPELINE_DIR, 'data', 'work');
/** Final artefacts consumed by the Angular app. */
export const OUT_DIR = path.resolve(PIPELINE_DIR, '..', '..', 'src', 'assets', 'data');

export const PBF_URL = 'https://download.geofabrik.de/europe/poland/dolnoslaskie-latest.osm.pbf';
export const PBF_FILE = path.join(RAW_DIR, 'dolnoslaskie-latest.osm.pbf');
export const PBF_MD5_FILE = `${PBF_FILE}.md5`;
export const RAW_MANIFEST_FILE = path.join(RAW_DIR, 'raw-manifest.json');

/** OSM relation of the city boundary (Wrocław, gmina/powiat). */
export const CITY_RELATION_ID = 451516;
export const BOUNDARY_FILE = path.join(RAW_DIR, 'wroclaw-boundary.geojson');
export const NOMINATIM_LOOKUP_URL = `https://nominatim.openstreetmap.org/lookup?osm_ids=R${CITY_RELATION_ID}&polygon_geojson=1&format=geojson`;

export const USER_AGENT = 'wroVIS-pipeline/0.1 (+https://github.com/kmd-labs/wroVIS)';

/** Nodes are kept inside the city bbox plus this margin so ways crossing the edge keep their geometry. */
export const BBOX_MARGIN_DEG = 0.03;

/** Zoom range of the thematic PMTiles archive. Layers overzoom in MapLibre above TILE_MAX_ZOOM. */
export const TILE_MIN_ZOOM = 10;
export const TILE_MAX_ZOOM = 14;
export const TILE_EXTENT = 4096;
