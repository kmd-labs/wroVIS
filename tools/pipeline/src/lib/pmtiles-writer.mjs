/**
 * Minimal PMTiles v3 writer (spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md).
 * Tiles are deduplicated by content, stored clustered in tile-id order, directories gzip-compressed.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import { zxyToTileId } from 'pmtiles';

const HEADER_SIZE = 127;
const ROOT_DIR_MAX_BYTES = 16384;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_MVT = 1;

function writeVarint(bytes, value) {
  // Unsigned LEB128 without 32-bit bit ops so offsets above 2^31 stay correct.
  let v = value;
  while (v >= 128) {
    bytes.push((v % 128) | 128);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
}

function serializeEntries(entries) {
  const bytes = [];
  writeVarint(bytes, entries.length);
  let lastId = 0;
  for (const e of entries) {
    writeVarint(bytes, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(bytes, e.runLength);
  for (const e of entries) writeVarint(bytes, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = entries[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) writeVarint(bytes, 0);
    else writeVarint(bytes, e.offset + 1);
  }
  return Buffer.from(bytes);
}

export class PMTilesWriter {
  /**
   * @param {{minZoom:number,maxZoom:number,bounds:number[],center:{lon:number,lat:number,zoom:number},metadata:object}} opts
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {Map<string,{offset:number,length:number}>} content hash -> location in tile data */
    this.byHash = new Map();
    /** @type {Array<{tileId:number,offset:number,length:number}>} */
    this.tiles = [];
    this.chunks = [];
    this.dataLength = 0;
  }

  /** @param {Buffer} data already tile-compressed (gzip) MVT bytes */
  addTile(z, x, y, data) {
    const tileId = zxyToTileId(z, x, y);
    const hash = createHash('sha1').update(data).digest('hex');
    let loc = this.byHash.get(hash);
    if (!loc) {
      loc = { offset: this.dataLength, length: data.length };
      this.byHash.set(hash, loc);
      this.chunks.push(data);
      this.dataLength += data.length;
    }
    this.tiles.push({ tileId, offset: loc.offset, length: loc.length });
  }

  /** Sorted, run-length merged directory entries. */
  buildEntries() {
    const sorted = this.tiles.slice().sort((a, b) => a.tileId - b.tileId);
    const entries = [];
    for (const t of sorted) {
      const last = entries[entries.length - 1];
      if (last && last.offset === t.offset && last.length === t.length && last.tileId + last.runLength === t.tileId) {
        last.runLength++;
      } else {
        entries.push({ tileId: t.tileId, offset: t.offset, length: t.length, runLength: 1 });
      }
    }
    return entries;
  }

  write(filePath) {
    const entries = this.buildEntries();
    let rootBytes = gzipSync(serializeEntries(entries));
    let leafBytes = Buffer.alloc(0);

    if (rootBytes.length > ROOT_DIR_MAX_BYTES) {
      // Split into leaf directories; root entries (runLength 0) point into the leaf section.
      let leafSize = 4096;
      for (;;) {
        const leaves = [];
        const rootEntries = [];
        let leafOffset = 0;
        for (let i = 0; i < entries.length; i += leafSize) {
          const chunk = entries.slice(i, i + leafSize);
          const bytes = gzipSync(serializeEntries(chunk));
          rootEntries.push({ tileId: chunk[0].tileId, offset: leafOffset, length: bytes.length, runLength: 0 });
          leaves.push(bytes);
          leafOffset += bytes.length;
        }
        rootBytes = gzipSync(serializeEntries(rootEntries));
        leafBytes = Buffer.concat(leaves);
        if (rootBytes.length <= ROOT_DIR_MAX_BYTES || leafSize >= entries.length) break;
        leafSize *= 2;
      }
    }

    const metadataBytes = gzipSync(Buffer.from(JSON.stringify(this.opts.metadata ?? {}), 'utf8'));

    const rootOffset = HEADER_SIZE;
    const metadataOffset = rootOffset + rootBytes.length;
    const leafOffset = metadataOffset + metadataBytes.length;
    const dataOffset = leafOffset + leafBytes.length;

    const header = Buffer.alloc(HEADER_SIZE);
    header.write('PMTiles', 0, 'latin1');
    header.writeUInt8(3, 7);
    header.writeBigUInt64LE(BigInt(rootOffset), 8);
    header.writeBigUInt64LE(BigInt(rootBytes.length), 16);
    header.writeBigUInt64LE(BigInt(metadataOffset), 24);
    header.writeBigUInt64LE(BigInt(metadataBytes.length), 32);
    header.writeBigUInt64LE(BigInt(leafOffset), 40);
    header.writeBigUInt64LE(BigInt(leafBytes.length), 48);
    header.writeBigUInt64LE(BigInt(dataOffset), 56);
    header.writeBigUInt64LE(BigInt(this.dataLength), 64);
    header.writeBigUInt64LE(BigInt(this.tiles.length), 72); // addressed tiles
    header.writeBigUInt64LE(BigInt(entries.length), 80); // tile entries
    header.writeBigUInt64LE(BigInt(this.byHash.size), 88); // tile contents
    header.writeUInt8(1, 96); // clustered
    header.writeUInt8(COMPRESSION_GZIP, 97);
    header.writeUInt8(COMPRESSION_GZIP, 98);
    header.writeUInt8(TILE_TYPE_MVT, 99);
    header.writeUInt8(this.opts.minZoom, 100);
    header.writeUInt8(this.opts.maxZoom, 101);
    const [minLon, minLat, maxLon, maxLat] = this.opts.bounds;
    header.writeInt32LE(Math.round(minLon * 1e7), 102);
    header.writeInt32LE(Math.round(minLat * 1e7), 106);
    header.writeInt32LE(Math.round(maxLon * 1e7), 110);
    header.writeInt32LE(Math.round(maxLat * 1e7), 114);
    header.writeUInt8(this.opts.center.zoom, 118);
    header.writeInt32LE(Math.round(this.opts.center.lon * 1e7), 119);
    header.writeInt32LE(Math.round(this.opts.center.lat * 1e7), 123);

    const fd = fs.openSync(filePath, 'w');
    try {
      fs.writeSync(fd, header);
      fs.writeSync(fd, rootBytes);
      fs.writeSync(fd, metadataBytes);
      if (leafBytes.length) fs.writeSync(fd, leafBytes);
      for (const chunk of this.chunks) fs.writeSync(fd, chunk);
    } finally {
      fs.closeSync(fd);
    }

    return {
      addressedTiles: this.tiles.length,
      tileEntries: entries.length,
      tileContents: this.byHash.size,
      rootDirBytes: rootBytes.length,
      leafDirBytes: leafBytes.length,
      tileDataBytes: this.dataLength,
      fileBytes: dataOffset + this.dataLength
    };
  }
}

/** Node fs-backed Source for the `pmtiles` reader, used to verify written archives. */
export class FileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, 'r');
  }
  getKey() {
    return this.filePath;
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  close() {
    fs.closeSync(this.fd);
  }
}
