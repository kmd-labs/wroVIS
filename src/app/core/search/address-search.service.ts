import { Injectable, signal } from '@angular/core';
import { DATA_PATHS } from '../map/map.config';
import { fetchGunzip } from '../walk/graph-store';

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/** One suggestion of the search box: a whole street (narrows to its numbers when picked) or one address. */
export type SearchResult =
  | { kind: 'street'; street: string; streetIdx: number; count: number; lngLat: [number, number]; bounds: [number, number, number, number] }
  | { kind: 'address'; street: string; number: string; lngLat: [number, number] };

/** `addresses.json.gz` written by tools/pipeline/src/10-extract.mjs. */
interface AddressFile {
  v: 1;
  /** Origin of the integer coordinates (degrees); x, y are offsets in 1e-5 degrees. */
  o: [number, number];
  streets: string[];
  s: number[];
  n: string[];
  x: number[];
  y: number[];
}

interface Index {
  streets: string[];
  /** Normalised words of every street name. */
  words: string[][];
  /** Address range of every street: addresses are sorted by street, so each street is one slice. */
  from: Int32Array;
  to: Int32Array;
  numbers: string[];
  numbersNorm: string[];
  lon: Float64Array;
  lat: Float64Array;
}

/** Lower case without diacritics or punctuation: "Plac Grunwaldzki 12a" → "plac grunwaldzki 12a". */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_RESULTS = 8;

/**
 * Address search of the dock: ~76 thousand OpenStreetMap addresses on ~2.2 thousand streets, loaded on
 * first focus of the search box and matched in the browser. Every word typed must start a word of the
 * street name ("pl grun" finds "plac Grunwaldzki"); a trailing number narrows the list to house numbers.
 * A street on its own is a result too (the map frames and highlights it).
 */
@Injectable({ providedIn: 'root' })
export class AddressSearchService {
  readonly status = signal<SearchStatus>('idle');
  private index: Index | null = null;

  async ensureLoaded(): Promise<void> {
    if (this.status() === 'ready' || this.status() === 'loading') return;
    this.status.set('loading');
    try {
      const bytes = await fetchGunzip(DATA_PATHS.addresses);
      this.index = buildIndex(JSON.parse(new TextDecoder().decode(bytes)) as AddressFile);
      this.status.set('ready');
    } catch (err) {
      console.error('[wroVIS] address index failed to load', err);
      this.status.set('error');
    }
  }

  search(query: string): SearchResult[] {
    const idx = this.index;
    const q = normalise(query);
    if (!idx || !q) return [];
    const tokens = q.split(' ');
    // A last token starting with a digit is the house number ("12", "12a", "1-9").
    const number = tokens.length > 1 && /^\d/.test(tokens[tokens.length - 1]) ? tokens.pop()! : null;

    const streets: { i: number; rank: number }[] = [];
    for (let i = 0; i < idx.streets.length; i++) {
      const words = idx.words[i];
      if (!tokens.every(t => words.some(w => w.startsWith(t)))) continue;
      // Streets whose name starts with the first typed word come first, then shorter names.
      const rank = (words[0].startsWith(tokens[0]) ? 0 : words.some(w => w === tokens[0]) ? 1 : 2) * 1000 + idx.streets[i].length;
      streets.push({ i, rank });
    }
    streets.sort((a, b) => a.rank - b.rank);

    if (number === null) {
      return streets.slice(0, MAX_RESULTS).map(({ i }) => ({
        kind: 'street' as const,
        street: idx.streets[i],
        streetIdx: i,
        count: idx.to[i] - idx.from[i],
        lngLat: centre(idx, i),
        bounds: extent(idx, i)
      }));
    }
    const out: SearchResult[] = [];
    for (const { i } of streets) {
      for (let a = idx.from[i]; a < idx.to[i] && out.length < MAX_RESULTS; a++) {
        if (idx.numbersNorm[a].startsWith(number)) out.push({ kind: 'address', street: idx.streets[i], number: idx.numbers[a], lngLat: [idx.lon[a], idx.lat[a]] });
      }
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
}

function buildIndex(file: AddressFile): Index {
  const nStreets = file.streets.length;
  const from = new Int32Array(nStreets).fill(0);
  const to = new Int32Array(nStreets).fill(0);
  for (let a = file.s.length - 1; a >= 0; a--) from[file.s[a]] = a;
  for (let a = 0; a < file.s.length; a++) to[file.s[a]] = a + 1;
  const lon = new Float64Array(file.x.length);
  const lat = new Float64Array(file.y.length);
  for (let a = 0; a < file.x.length; a++) {
    lon[a] = file.o[0] + file.x[a] / 1e5;
    lat[a] = file.o[1] + file.y[a] / 1e5;
  }
  return {
    streets: file.streets,
    words: file.streets.map(s => normalise(s).split(' ')),
    from,
    to,
    numbers: file.n,
    numbersNorm: file.n.map(n => normalise(n)),
    lon,
    lat
  };
}

/** Extent of a street's addresses: [west, south, east, north]. */
function extent(idx: Index, street: number): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let a = idx.from[street]; a < idx.to[street]; a++) {
    w = Math.min(w, idx.lon[a]);
    e = Math.max(e, idx.lon[a]);
    s = Math.min(s, idx.lat[a]);
    n = Math.max(n, idx.lat[a]);
  }
  return [w, s, e, n];
}

/** Mean position of a street's addresses. */
function centre(idx: Index, street: number): [number, number] {
  let x = 0, y = 0;
  const n = idx.to[street] - idx.from[street];
  for (let a = idx.from[street]; a < idx.to[street]; a++) {
    x += idx.lon[a];
    y += idx.lat[a];
  }
  return n ? [x / n, y / n] : [0, 0];
}
