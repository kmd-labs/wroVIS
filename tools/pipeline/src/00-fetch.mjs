/**
 * Step 00: download the Geofabrik Lower Silesia extract (with MD5 check) and the Wrocław boundary polygon.
 * Idempotent: existing, verified files are reused.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  BOUNDARY_FILE,
  NOMINATIM_LOOKUP_URL,
  PBF_FILE,
  PBF_MD5_FILE,
  PBF_URL,
  RAW_DIR,
  RAW_MANIFEST_FILE,
  USER_AGENT,
  WORK_DIR
} from './lib/config.mjs';

const headers = { 'User-Agent': USER_AGENT };

async function md5OfFile(file) {
  const hash = createHash('md5');
  await pipeline(fs.createReadStream(file), async function* (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest('hex');
}

async function download(url, file) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  return res.headers.get('last-modified');
}

async function ensurePbf() {
  const md5Res = await fetch(`${PBF_URL}.md5`, { headers });
  if (!md5Res.ok) throw new Error(`MD5 download failed: HTTP ${md5Res.status}`);
  const md5Text = await md5Res.text();
  const expected = md5Text.trim().split(/\s+/)[0];
  fs.writeFileSync(PBF_MD5_FILE, md5Text);

  if (fs.existsSync(PBF_FILE)) {
    const actual = await md5OfFile(PBF_FILE);
    if (actual === expected) {
      console.log(`✔ PBF already present and verified (${(fs.statSync(PBF_FILE).size / 1e6).toFixed(1)} MB)`);
      return { md5: expected, lastModified: fs.existsSync(RAW_MANIFEST_FILE) ? readManifest().pbfLastModified : null };
    }
    console.log('PBF checksum mismatch, re-downloading…');
  }
  console.log(`⬇ downloading ${PBF_URL}`);
  const lastModified = await download(PBF_URL, PBF_FILE);
  const actual = await md5OfFile(PBF_FILE);
  if (actual !== expected) throw new Error(`MD5 mismatch after download: ${actual} != ${expected}`);
  console.log(`✔ PBF downloaded (${(fs.statSync(PBF_FILE).size / 1e6).toFixed(1)} MB)`);
  return { md5: expected, lastModified };
}

async function ensureBoundary() {
  if (fs.existsSync(BOUNDARY_FILE)) {
    console.log('✔ boundary already present');
    return;
  }
  console.log('⬇ downloading city boundary from Nominatim');
  await download(NOMINATIM_LOOKUP_URL, BOUNDARY_FILE);
  const fc = JSON.parse(fs.readFileSync(BOUNDARY_FILE, 'utf8'));
  const f = fc.features?.[0];
  if (!f || !/Polygon/.test(f.geometry?.type)) throw new Error('Unexpected boundary response');
  console.log(`✔ boundary: ${f.properties?.name} (${f.geometry.type})`);
}

function readManifest() {
  return JSON.parse(fs.readFileSync(RAW_MANIFEST_FILE, 'utf8'));
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const pbf = await ensurePbf();
  await ensureBoundary();
  let pbfLastModified = pbf.lastModified;
  if (!pbfLastModified) {
    const head = await fetch(PBF_URL, { method: 'HEAD', headers });
    pbfLastModified = head.headers.get('last-modified');
  }
  const manifest = {
    pbfUrl: PBF_URL,
    pbfMd5: pbf.md5,
    pbfLastModified,
    pbfBytes: fs.statSync(PBF_FILE).size,
    boundarySource: NOMINATIM_LOOKUP_URL,
    fetchedAt: new Date().toISOString()
  };
  fs.writeFileSync(RAW_MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log('✔ raw manifest written', manifest);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
