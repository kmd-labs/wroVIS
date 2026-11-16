/**
 * Step 40: slice the heavy layers into vector tiles (geojson-vt + vt-pbf), pack them into one
 * PMTiles archive, verify it with the pmtiles reader and write the data manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import GeoJSONVT from 'geojson-vt';
import { fromGeojsonVt } from 'vt-pbf';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Protobuf } from 'pbf';
import { OUT_DIR, RAW_MANIFEST_FILE, TILE_EXTENT, TILE_MAX_ZOOM, TILE_MIN_ZOOM, WORK_DIR } from './lib/config.mjs';
import { lonLatToTile } from './lib/osm-geometry.mjs';
import { FileSource, PMTilesWriter } from './lib/pmtiles-writer.mjs';

const t0 = Date.now();
const log = msg => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

/** Thematic layers of the archive. `maxzoom` is the last generated zoom (MapLibre overzooms beyond it). */
const LAYERS = [
  { id: 'buildings', minzoom: 13, maxzoom: 14, tolerance: 1 },
  { id: 'bridge_areas', minzoom: 12, maxzoom: 14, tolerance: 1 },
  { id: 'water', minzoom: 10, maxzoom: 14, tolerance: 2 },
  { id: 'waterways', minzoom: 10, maxzoom: 14, tolerance: 2 },
  { id: 'green', minzoom: 10, maxzoom: 14, tolerance: 2 },
  { id: 'tram_tracks', minzoom: 10, maxzoom: 14, tolerance: 1 },
  { id: 'cycleways', minzoom: 11, maxzoom: 14, tolerance: 1 },
  { id: 'bridges', minzoom: 11, maxzoom: 14, tolerance: 1 },
  { id: 'poi', minzoom: 12, maxzoom: 14, tolerance: 0 }
];

const summary = JSON.parse(fs.readFileSync(path.join(WORK_DIR, 'extract-summary.json'), 'utf8'));
const rawManifest = fs.existsSync(RAW_MANIFEST_FILE) ? JSON.parse(fs.readFileSync(RAW_MANIFEST_FILE, 'utf8')) : {};
const bbox = summary.bbox;

const indexes = [];
const vectorLayers = [];
for (const layer of LAYERS) {
  const fc = JSON.parse(fs.readFileSync(path.join(WORK_DIR, `${layer.id}.geojson`), 'utf8'));
  const fields = {};
  for (const f of fc.features.slice(0, 500)) {
    for (const [k, v] of Object.entries(f.properties)) fields[k] = typeof v === 'number' ? 'Number' : typeof v === 'boolean' ? 'Boolean' : 'String';
  }
  vectorLayers.push({ id: layer.id, minzoom: layer.minzoom, maxzoom: layer.maxzoom, fields, features: fc.features.length });
  indexes.push({
    layer,
    index: new GeoJSONVT(fc, {
      maxZoom: layer.maxzoom,
      indexMaxZoom: Math.min(layer.maxzoom, 12),
      indexMaxPoints: 100000,
      tolerance: layer.tolerance,
      extent: TILE_EXTENT,
      buffer: 64
    })
  });
  log(`indexed ${layer.id}: ${fc.features.length} features`);
}

const writer = new PMTilesWriter({
  minZoom: TILE_MIN_ZOOM,
  maxZoom: TILE_MAX_ZOOM,
  bounds: bbox,
  center: { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2, zoom: 12 },
  metadata: {
    name: 'wroVIS — Wrocław OSM thematic layers',
    description: 'Buildings, water, green areas, bridges, tram tracks, cycleways and POI of Wrocław extracted from OpenStreetMap.',
    attribution: '© OpenStreetMap contributors (ODbL)',
    format: 'pbf',
    type: 'overlay',
    version: '1',
    generated: new Date().toISOString(),
    osm_last_modified: rawManifest.pbfLastModified ?? null,
    vector_layers: vectorLayers.map(({ id, minzoom, maxzoom, fields }) => ({ id, minzoom, maxzoom, fields }))
  }
});

const perZoom = {};
let rawBytes = 0;
for (let z = TILE_MIN_ZOOM; z <= TILE_MAX_ZOOM; z++) {
  const [x0, y0] = lonLatToTile(bbox[0], bbox[3], z);
  const [x1, y1] = lonLatToTile(bbox[2], bbox[1], z);
  let count = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const tileLayers = {};
      for (const { layer, index } of indexes) {
        if (z < layer.minzoom || z > layer.maxzoom) continue;
        const tile = index.getTile(z, x, y);
        if (tile && tile.features.length) tileLayers[layer.id] = tile;
      }
      if (!Object.keys(tileLayers).length) continue;
      const pbf = Buffer.from(fromGeojsonVt(tileLayers, { version: 2, extent: TILE_EXTENT }));
      rawBytes += pbf.length;
      writer.addTile(z, x, y, gzipSync(pbf, { level: 9 }));
      count++;
    }
  }
  perZoom[z] = count;
  log(`z${z}: ${count} tiles`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const archive = path.join(OUT_DIR, 'wroclaw.pmtiles');
const result = writer.write(archive);
log(`archive written: ${(result.fileBytes / 1e6).toFixed(2)} MB (${result.addressedTiles} tiles, ${result.tileContents} unique, raw mvt ${(rawBytes / 1e6).toFixed(1)} MB) ${JSON.stringify(result)}`);

// ─── Verification with the reference reader ──────────────────────────────────

const source = new FileSource(archive);
const reader = new PMTiles(source);
const header = await reader.getHeader();
const metadata = await reader.getMetadata();
const centerZxy = [14, ...lonLatToTile(17.0319, 51.11, 14)];
const tileResp = await reader.getZxy(...centerZxy);
if (!tileResp) throw new Error(`center tile ${centerZxy} missing`);
// The pmtiles reader already applies tileCompression, so the payload is raw MVT.
const vt = new VectorTile(new Protobuf(new Uint8Array(tileResp.data)));
const layerCounts = Object.fromEntries(Object.entries(vt.layers).map(([k, l]) => [k, l.length]));
const sampleBuilding = vt.layers.buildings?.feature(0);
log(`verify: header zoom ${header.minZoom}-${header.maxZoom}, entries ${header.numTileEntries}, metadata layers ${metadata.vector_layers.length}`);
log(`verify: tile z${centerZxy[0]}/${centerZxy[1]}/${centerZxy[2]} layers ${JSON.stringify(layerCounts)}`);
if (sampleBuilding) log(`verify: sample building id=${sampleBuilding.id} props=${JSON.stringify(sampleBuilding.properties)}`);
let checked = 0;
for (let z = TILE_MIN_ZOOM; z <= TILE_MAX_ZOOM; z++) {
  const [x, y] = lonLatToTile(17.0319, 51.11, z);
  const r = await reader.getZxy(z, x, y);
  if (!r || !r.data.byteLength) throw new Error(`tile z${z}/${x}/${y} missing`);
  checked++;
}
source.close();
log(`verify: ${checked} centre tiles readable at every zoom`);

// ─── Manifest ────────────────────────────────────────────────────────────────

const files = fs.readdirSync(OUT_DIR).filter(f => f !== 'manifest.json');
const manifest = {
  generatedAt: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright',
  source: {
    extract: rawManifest.pbfUrl ?? null,
    extractLastModified: rawManifest.pbfLastModified ?? null,
    extractMd5: rawManifest.pbfMd5 ?? null,
    boundary: 'OSM relation 451516 via Nominatim'
  },
  bbox,
  tiles: { file: 'wroclaw.pmtiles', minzoom: TILE_MIN_ZOOM, maxzoom: TILE_MAX_ZOOM, perZoom, layers: vectorLayers },
  layers: summary.layers,
  audit: summary.audit,
  files: Object.fromEntries(files.map(f => [f, fs.statSync(path.join(OUT_DIR, f)).size]))
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
const totalMb = files.reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1e6;
log(`manifest written; assets/data total ${totalMb.toFixed(2)} MB`);
