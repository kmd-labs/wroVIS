import type { LngLatBoundsLike, LngLatLike } from 'maplibre-gl';

/** Wrocław city centre (Rynek). */
export const WROCLAW_CENTER: LngLatLike = [17.0319, 51.11];

/** Latitude used for metre → pixel conversions in style expressions (city centre). */
export const WROCLAW_LAT = 51.11;

/**
 * City extent (OSM relation 451516: ~16.81–17.18 E, ~51.04–51.21 N) with a margin,
 * used as `maxBounds` so the user cannot pan away from the city.
 */
export const WROCLAW_MAX_BOUNDS: LngLatBoundsLike = [
  [16.62, 50.95],
  [17.38, 51.3]
];

export const MAP_DEFAULT_ZOOM = 12;
export const MAP_MIN_ZOOM = 10;
export const MAP_MAX_ZOOM = 18;

/**
 * Basemap: OpenFreeMap (OpenStreetMap data, OpenMapTiles schema, no API key).
 * The style itself is generated from KMD design tokens in `style.builder.ts`.
 */
export const BASEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const BASEMAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
/** Glyph stacks served by OpenFreeMap (Inter is not available there as SDF glyphs). */
export const MAP_FONT_REGULAR = ['Noto Sans Regular'];
export const MAP_FONT_BOLD = ['Noto Sans Bold'];
export const MAP_FONT_ITALIC = ['Noto Sans Italic'];

/** Source ids shared by the style builder and the layer registry. */
export const SRC_BASEMAP = 'basemap';
export const SRC_WROVIS = 'wrovis';
export const SRC_DISTRICTS = 'districts';
export const SRC_CITY = 'city';
export const SRC_TRAM_STOPS = 'tram_stops';
export const SRC_DISTRICT_LABELS = 'district_labels';

/** Data artefacts produced by `tools/pipeline` (paths relative to the document base). */
export const DATA_PATHS = {
  pmtiles: 'assets/data/wroclaw.pmtiles',
  districts: 'assets/data/districts.geojson',
  city: 'assets/data/city.geojson',
  tramStops: 'assets/data/tram_stops.geojson',
  tramRoutes: 'assets/data/tram_routes.geojson',
  bridges: 'assets/data/bridges.geojson',
  stats: 'assets/data/stats.json',
  manifest: 'assets/data/manifest.json'
} as const;

/** Resolves an asset path against `<base href>` so it stays correct under `/wroVIS/` on GitHub Pages. */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}
