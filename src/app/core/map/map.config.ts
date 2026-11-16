import type { LngLatBoundsLike, LngLatLike } from 'maplibre-gl';

/** Wrocław city centre (Rynek). */
export const WROCLAW_CENTER: LngLatLike = [17.0319, 51.1100];

/**
 * City extent (OSM relation 451516: ~16.81–17.18 E, ~51.04–51.21 N) with a margin,
 * used as `maxBounds` so the user cannot pan away from the city.
 */
export const WROCLAW_MAX_BOUNDS: LngLatBoundsLike = [
  [16.62, 50.95],
  [17.38, 51.30]
];

export const MAP_DEFAULT_ZOOM = 12;
export const MAP_MIN_ZOOM = 10;
export const MAP_MAX_ZOOM = 18;

/**
 * Basemap: OpenFreeMap (OpenStreetMap data, OpenMapTiles schema, no API key).
 * Etap 2 replaces this URL with a style JSON generated from KMD design tokens.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
