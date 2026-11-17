import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ThemeMode } from '@kmd/design-system';
import {
  BASEMAP_GLYPHS_URL,
  BASEMAP_TILEJSON_URL,
  DATA_PATHS,
  MAP_FONT_BOLD,
  MAP_FONT_ITALIC,
  MAP_FONT_REGULAR,
  SRC_BASEMAP,
  SRC_CITY,
  SRC_DISTRICTS,
  SRC_DISTRICT_LABELS,
  SRC_TRAM_STOPS,
  SRC_WROVIS,
  assetUrl
} from './map.config';
import { StyleContext } from './map.types';
import { Expr, StyleTools, byZoom, geometryIs, nameField } from './style.expr';
import { thematicLayers } from './layers.registry';

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** GeoJSON data owned by the app (loaded by `DataService`) and injected into the style as inline sources. */
export interface StyleData {
  districts: FeatureCollection | null;
  districtLabels: FeatureCollection | null;
}

/**
 * Basemap roles mapped to design tokens per theme. Only the token *choice* depends on the mode;
 * every colour is still read from `--color-*` at build time, so Midnight restyles the whole map.
 */
const BASE_TOKENS: Record<ThemeMode, Record<'road' | 'roadCasing' | 'rail' | 'path', string>> = {
  light: { road: 'panel-bg-solid', roadCasing: 'line', rail: 'line-strong', path: 'line-strong' },
  dark: { road: 'surface-muted', roadCasing: 'line', rail: 'line-strong', path: 'line-strong' }
};

/**
 * Produces the complete MapLibre style for the current context: OpenFreeMap basemap layers coloured
 * with KMD tokens, the wroVIS PMTiles overlay layers of every view (hidden unless active) and labels on top.
 * The result is deterministic for a given context, which lets `map.setStyle(style, { diff: true })`
 * apply only the changed properties.
 */
export function buildMapStyle(ctx: StyleContext, data: StyleData, tools: StyleTools): StyleSpecification {
  return {
    version: 8,
    glyphs: BASEMAP_GLYPHS_URL,
    sources: {
      [SRC_BASEMAP]: { type: 'vector', url: BASEMAP_TILEJSON_URL },
      [SRC_WROVIS]: {
        type: 'vector',
        url: `pmtiles://${assetUrl(DATA_PATHS.pmtiles)}`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      },
      [SRC_CITY]: { type: 'geojson', data: assetUrl(DATA_PATHS.city) },
      [SRC_TRAM_STOPS]: { type: 'geojson', data: assetUrl(DATA_PATHS.tramStops), generateId: true },
      [SRC_DISTRICTS]: { type: 'geojson', data: data.districts ?? EMPTY_FC, promoteId: 'id' },
      [SRC_DISTRICT_LABELS]: { type: 'geojson', data: data.districtLabels ?? EMPTY_FC }
    },
    layers: [...basemapGround(ctx, tools), ...thematicLayers(ctx, tools), ...basemapLabels(ctx, tools)]
  };
}

/** Background, land cover, water and the road network of the OpenMapTiles basemap. */
function basemapGround(ctx: StyleContext, tools: StyleTools): LayerSpecification[] {
  const tk = BASE_TOKENS[ctx.mode];
  const c = tools.color;
  const roadClass = (classes: string[]): Expr => ['all', geometryIs('LineString'), ['match', ['get', 'class'], classes, true, false]];
  const majorClasses = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
  return [
    { id: 'bg', type: 'background', paint: { 'background-color': c('map-bg') } },
    {
      id: 'base-park',
      type: 'fill',
      source: SRC_BASEMAP,
      'source-layer': 'park',
      filter: geometryIs('Polygon'),
      paint: { 'fill-color': c('success-soft'), 'fill-antialias': false }
    },
    {
      id: 'base-landcover',
      type: 'fill',
      source: SRC_BASEMAP,
      'source-layer': 'landcover',
      filter: ['all', geometryIs('Polygon'), ['match', ['get', 'class'], ['wood', 'grass'], true, false]],
      paint: { 'fill-color': c('success-soft'), 'fill-opacity': byZoom([[9, 0.4], [13, 0.8]], 1), 'fill-antialias': false }
    },
    {
      id: 'base-water',
      type: 'fill',
      source: SRC_BASEMAP,
      'source-layer': 'water',
      filter: ['all', geometryIs('Polygon'), ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': c('cool'), 'fill-opacity': tools.opacity('faint'), 'fill-antialias': false }
    },
    {
      id: 'base-waterway',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'waterway',
      filter: ['all', geometryIs('LineString'), ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c('cool'), 'line-opacity': tools.opacity('muted'), 'line-width': byZoom([[10, 0.6], [14, 1.6], [18, 5]]) }
    },
    {
      id: 'base-road-minor',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: roadClass(['minor', 'service', 'track']),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c(tk.road), 'line-width': byZoom([[12, 0.5], [14, 1.4], [18, 10]]) }
    },
    {
      id: 'base-road-major-casing',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'transportation',
      filter: roadClass(majorClasses),
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': c(tk.roadCasing), 'line-width': byZoom([[10, 1.6], [14, 3.8], [18, 17]]) }
    },
    {
      id: 'base-road-major',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'transportation',
      filter: roadClass(majorClasses),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c(tk.road), 'line-width': byZoom([[10, 1], [14, 2.6], [18, 15]]) }
    },
    {
      id: 'base-path',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'transportation',
      minzoom: 14,
      filter: roadClass(['path']),
      paint: { 'line-color': c(tk.path), 'line-opacity': tools.opacity('half'), 'line-dasharray': [2, 2], 'line-width': byZoom([[14, 0.7], [18, 2]], 1) }
    },
    {
      id: 'base-rail',
      type: 'line',
      source: SRC_BASEMAP,
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['all', geometryIs('LineString'), ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']]],
      paint: { 'line-color': c(tk.rail), 'line-dasharray': [3, 2], 'line-width': byZoom([[11, 0.6], [16, 2.2]], 1) }
    },
    {
      id: 'city-outline',
      type: 'line',
      source: SRC_CITY,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': c('text-dim'), 'line-opacity': tools.opacity('medium'), 'line-dasharray': [4, 3], 'line-width': byZoom([[10, 1.2], [14, 2]], 1) }
    }
  ];
}

/** Road, water and place labels of the basemap; drawn above every thematic layer. */
function basemapLabels(ctx: StyleContext, tools: StyleTools): LayerSpecification[] {
  const c = tools.color;
  const name = nameField(ctx.lang);
  // Districts draw their own labels, so the basemap keeps only city-level place names in that view.
  const placeClasses = ctx.view === 'districts' ? ['city', 'town', 'village'] : ['city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter'];
  return [
    {
      id: 'base-label-road',
      type: 'symbol',
      source: SRC_BASEMAP,
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      layout: {
        'symbol-placement': 'line',
        'text-field': name,
        'text-font': MAP_FONT_REGULAR,
        'text-size': byZoom([[13, 10], [16, 12.5]], 1),
        'text-rotation-alignment': 'map',
        'symbol-spacing': 320
      },
      paint: { 'text-color': c('text-dim'), 'text-halo-color': c('map-bg'), 'text-halo-width': 1 }
    },
    {
      id: 'base-label-water',
      type: 'symbol',
      source: SRC_BASEMAP,
      'source-layer': 'water_name',
      filter: geometryIs('LineString'),
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 380,
        'text-field': name,
        'text-font': MAP_FONT_ITALIC,
        'text-size': 12,
        'text-letter-spacing': 0.15
      },
      paint: { 'text-color': c('link-color'), 'text-halo-color': c('map-bg'), 'text-halo-width': 1.2 }
    },
    {
      id: 'base-label-place',
      type: 'symbol',
      source: SRC_BASEMAP,
      'source-layer': 'place',
      filter: ['match', ['get', 'class'], placeClasses, true, false],
      layout: {
        'text-field': name,
        'text-font': ['match', ['get', 'class'], ['city', 'town'], ['literal', MAP_FONT_BOLD], ['literal', MAP_FONT_REGULAR]],
        // Zoom must be the outermost input, so the per-class sizes live inside the interpolation stops.
        'text-size': byZoom(
          [
            [10, ['match', ['get', 'class'], ['city'], 15, ['town'], 12, ['village'], 10, 9]],
            [14, ['match', ['get', 'class'], ['city'], 17, ['town'], 14, ['village'], 12, 11.5]]
          ],
          1
        ),
        'text-transform': ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], 'uppercase', 'none'],
        'text-letter-spacing': ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], 0.08, 0],
        'text-max-width': 8
      },
      paint: {
        'text-color': ['match', ['get', 'class'], ['city', 'town'], c('text-bright'), c('text-main')],
        'text-halo-color': c('map-bg'),
        'text-halo-width': 1.3
      }
    }
  ];
}
