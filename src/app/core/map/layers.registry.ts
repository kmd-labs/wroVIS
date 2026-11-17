import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Building2, LayoutGrid, LucideIconData, TramFront, Waves, Zap } from 'lucide-angular';
import {
  MAP_FONT_BOLD,
  MAP_FONT_REGULAR,
  SRC_DISTRICTS,
  SRC_DISTRICT_LABELS,
  SRC_TRAM_STOPS,
  SRC_WROVIS
} from './map.config';
import { CameraSpec, DistrictMetric, LegendSpec, SliderSpec, StyleContext, ViewId } from './map.types';
import { Expr, HOVER, SELECTED, StyleTools, byZoom, highlight, matchGroups, metersToPixels, withVisibility } from './style.expr';
import { BRIDGE_KIND_SLOT, BUILDING_CLASS_SLOT, CategoricalSlot, categoricalToken, equalBreaks, ordinalTokens } from '../../shared/scales';
import { CYBER_BUILDING_ROLE, CyberRole, cyberToken } from '../../shared/cyber-palette';

/** Declarative definition of one visualization mode. */
export interface ViewDefinition {
  id: ViewId;
  icon: LucideIconData;
  camera: CameraSpec;
  slider: (ctx: StyleContext) => SliderSpec;
  legend: (ctx: StyleContext) => LegendSpec;
  /** Thematic layers in draw order; the builder inserts them between basemap lines and basemap labels. */
  layers: (ctx: StyleContext, tools: StyleTools) => LayerSpecification[];
  /** Layer ids that respond to hover and click (queried with `queryRenderedFeatures`). */
  interactive: string[];
}

/** District metrics available to the choropleth and the slider, with their stats key. */
export const DISTRICT_METRICS: readonly DistrictMetric[] = ['buildings_per_km2', 'buildings', 'poi_per_km2', 'green_pct', 'tram_stops'];

// ─── Buildings 3D ───────────────────────────────────────────────────────────

const LEVELS_EXPR: Expr = ['coalesce', ['get', 'levels'], ['/', ['coalesce', ['get', 'height'], 0], 3]];

const buildingsView: ViewDefinition = {
  id: 'buildings',
  icon: Building2,
  camera: { center: [17.0325, 51.109], zoom: 15.1, pitch: 56, bearing: -18 },
  slider: () => ({ param: 'buildingsMinLevels', min: 0, max: 30, step: 1, presets: [3, 5, 11, 20], unit: 'levels' }),
  legend: ctx => ({
    kind: 'categorical',
    items: [
      { labelKey: 'bldResidential', token: categoricalToken('orange', ctx.mode) },
      { labelKey: 'bldCommercial', token: categoricalToken('blue', ctx.mode) },
      { labelKey: 'bldPublic', token: categoricalToken('green', ctx.mode) },
      { labelKey: 'bldIndustrial', token: categoricalToken('dark', ctx.mode) },
      { labelKey: 'bldOther', token: categoricalToken('light', ctx.mode) }
    ]
  }),
  interactive: ['bld-extrusion'],
  layers: (ctx, tools) => {
    const classColor = matchGroups('class', slotGroups(BUILDING_CLASS_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const min = ctx.params.buildingsMinLevels;
    return [
      {
        id: 'bld-extrusion',
        type: 'fill-extrusion',
        source: SRC_WROVIS,
        'source-layer': 'buildings',
        minzoom: 13,
        ...(min > 0 ? { filter: ['>=', LEVELS_EXPR, min] as Expr } : {}),
        paint: {
          'fill-extrusion-color': highlight(classColor, tools),
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true
        }
      }
    ];
  }
};

// ─── Bridges & water ────────────────────────────────────────────────────────

const BRIDGE_WIDTH_FACTOR: Expr = ['match', ['get', 'kind'], ['road', 'tram'], 1, ['rail'], 0.85, ['foot'], 0.7, 0.6];

const bridgesView: ViewDefinition = {
  id: 'bridges',
  icon: Waves,
  camera: { center: [17.047, 51.115], zoom: 13.6, pitch: 0, bearing: 0 },
  slider: () => ({ param: 'bridgesMinLength', min: 0, max: 400, step: 10, presets: [50, 100, 200, 300], unit: 'meters' }),
  legend: ctx => ({
    kind: 'categorical',
    items: [
      { labelKey: 'brRoad', token: categoricalToken('blue', ctx.mode), shape: 'line' },
      { labelKey: 'brTram', token: categoricalToken('orange', ctx.mode), shape: 'line' },
      { labelKey: 'brFoot', token: categoricalToken('green', ctx.mode), shape: 'line' },
      { labelKey: 'brRail', token: categoricalToken('dark', ctx.mode), shape: 'dash' },
      { labelKey: 'brOther', token: categoricalToken('light', ctx.mode), shape: 'line' },
      { labelKey: 'brWater', token: 'cool', shape: 'fill' }
    ]
  }),
  interactive: ['br-lines', 'br-lines-rail', 'br-areas'],
  layers: (ctx, tools) => {
    const kindColor = matchGroups('kind', slotGroups(BRIDGE_KIND_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const min = ctx.params.bridgesMinLength;
    const lengthFilter: Expr = ['>=', ['coalesce', ['get', 'length_m'], 0], min];
    const notRail: Expr = ['!=', ['get', 'kind'], 'rail'];
    const isRail: Expr = ['==', ['get', 'kind'], 'rail'];
    const width = (extra: number): Expr =>
      byZoom(
        [
          [11, ['+', ['*', 1.6, BRIDGE_WIDTH_FACTOR], extra]],
          [14, ['+', ['*', 3.2, BRIDGE_WIDTH_FACTOR], extra]],
          [17, ['+', ['*', 8, BRIDGE_WIDTH_FACTOR], extra]]
        ],
        1.4
      );
    const line = (id: string, filter: Expr, extra: Partial<Extract<LayerSpecification, { type: 'line' }>['paint']> = {}): LayerSpecification => ({
      id,
      type: 'line',
      source: SRC_WROVIS,
      'source-layer': 'bridges',
      minzoom: 11,
      filter: ['all', lengthFilter, filter] as Expr,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': highlight(kindColor, tools), 'line-width': width(0), ...extra }
    });
    return [
      {
        id: 'br-water',
        type: 'fill',
        source: SRC_WROVIS,
        'source-layer': 'water',
        paint: { 'fill-color': tools.color('cool'), 'fill-opacity': tools.opacity('muted'), 'fill-antialias': false }
      },
      {
        id: 'br-waterways',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'waterways',
        filter: ['match', ['get', 'kind'], ['river', 'canal', 'stream'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': tools.color('cool'),
          'line-opacity': tools.opacity('medium'),
          'line-width': byZoom([[10, ['match', ['get', 'kind'], ['river'], 1.4, ['canal'], 1, 0.5]], [16, ['match', ['get', 'kind'], ['river'], 6, ['canal'], 4, 1.5]]])
        }
      },
      {
        id: 'br-areas',
        type: 'fill',
        source: SRC_WROVIS,
        'source-layer': 'bridge_areas',
        minzoom: 12,
        paint: {
          'fill-color': highlight(tools.color('panel-bg-solid'), tools),
          'fill-opacity': tools.opacity('medium'),
          'fill-outline-color': tools.color('line-strong')
        }
      },
      {
        id: 'br-casing',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'bridges',
        minzoom: 11,
        filter: lengthFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tools.color('map-bg'), 'line-width': width(2.5) }
      },
      line('br-lines', notRail),
      line('br-lines-rail', isRail, { 'line-dasharray': [2.2, 1.4] }),
      {
        id: 'br-labels',
        type: 'symbol',
        source: SRC_WROVIS,
        'source-layer': 'bridges',
        minzoom: 14,
        filter: ['all', lengthFilter, ['has', 'name'], ['match', ['get', 'kind'], ['road', 'tram', 'foot'], true, false]],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': MAP_FONT_REGULAR,
          'text-size': byZoom([[14, 10], [17, 13]], 1),
          'text-max-angle': 30,
          'symbol-spacing': 400
        },
        paint: {
          'text-color': tools.color('text-main'),
          'text-halo-color': tools.color('map-bg'),
          'text-halo-width': 1.2
        }
      }
    ];
  }
};

// ─── Transport ──────────────────────────────────────────────────────────────

const transitView: ViewDefinition = {
  id: 'transit',
  icon: TramFront,
  camera: { center: [17.028, 51.108], zoom: 12.6, pitch: 0, bearing: 0 },
  slider: () => ({ param: 'transitRadius', min: 100, max: 1000, step: 50, presets: [300, 500, 800], unit: 'meters' }),
  legend: ctx => ({
    kind: 'categorical',
    items: [
      { labelKey: 'trTramTrack', token: categoricalToken('orange', ctx.mode), shape: 'line' },
      { labelKey: 'trTramStop', token: categoricalToken('orange', ctx.mode), shape: 'point' },
      { labelKey: 'trCycleway', token: categoricalToken('green', ctx.mode), shape: 'line' },
      { labelKey: 'trWalkRadius', token: 'cool', shape: 'fill' }
    ]
  }),
  interactive: ['tr-stops', 'tr-tracks'],
  layers: (ctx, tools) => {
    const tram = tools.color(categoricalToken('orange', ctx.mode));
    return [
      {
        id: 'tr-radius',
        type: 'circle',
        source: SRC_TRAM_STOPS,
        paint: {
          'circle-radius': metersToPixels(ctx.params.transitRadius),
          'circle-color': tools.color('cool'),
          'circle-opacity': tools.opacity('semi-faint'),
          'circle-stroke-color': tools.color('cool'),
          'circle-stroke-width': 1,
          'circle-stroke-opacity': tools.opacity('muted'),
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map'
        }
      },
      {
        id: 'tr-cycleways',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'cycleways',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': tools.color(categoricalToken('green', ctx.mode)),
          'line-opacity': tools.opacity('strong'),
          'line-width': byZoom([[11, 0.6], [14, 1.4], [17, 3]])
        }
      },
      {
        id: 'tr-tracks-casing',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'tram_tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tools.color('map-bg'), 'line-width': byZoom([[10, 2.6], [14, 4.5], [17, 8]]) }
      },
      {
        id: 'tr-tracks',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'tram_tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': highlight(tram, tools), 'line-width': byZoom([[10, 1.1], [14, 2.4], [17, 5]]) }
      },
      {
        id: 'tr-stops',
        type: 'circle',
        source: SRC_TRAM_STOPS,
        minzoom: 11,
        paint: {
          'circle-radius': byZoom([[11, 2.2], [14, 4.5], [17, 7]], 1),
          'circle-color': tools.color('panel-bg-solid'),
          'circle-stroke-color': highlight(tram, tools),
          'circle-stroke-width': byZoom([[11, 1.2], [14, 2], [17, 2.5]], 1)
        }
      },
      {
        id: 'tr-stop-labels',
        type: 'symbol',
        source: SRC_TRAM_STOPS,
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': MAP_FONT_REGULAR,
          'text-size': byZoom([[14, 10], [17, 12]], 1),
          'text-anchor': 'top',
          'text-offset': [0, 0.7],
          'text-optional': true
        },
        paint: {
          'text-color': tools.color('text-main'),
          'text-halo-color': tools.color('map-bg'),
          'text-halo-width': 1.2
        }
      }
    ];
  }
};

// ─── Districts ──────────────────────────────────────────────────────────────

function metricRange(ctx: StyleContext): { min: number; max: number } {
  const range = ctx.stats?.ranges[ctx.params.districtsMetric];
  return range && range.max > range.min ? range : { min: 0, max: 1 };
}

/** Slider span rounded to a friendly step for the active metric. */
function metricSliderSpec(ctx: StyleContext): SliderSpec {
  const { max } = metricRange(ctx);
  const step = max > 1000 ? 25 : max > 200 ? 5 : 1;
  const top = Math.ceil(max / step) * step;
  const presets = [0.25, 0.5, 0.75].map(q => Math.round((top * q) / step) * step);
  return { param: 'districtsThreshold', min: 0, max: top, step, presets, unit: ctx.params.districtsMetric === 'green_pct' ? 'none' : 'none' };
}

const districtsView: ViewDefinition = {
  id: 'districts',
  icon: LayoutGrid,
  camera: { center: [17.005, 51.122], zoom: 11.15, pitch: 0, bearing: 0 },
  slider: metricSliderSpec,
  legend: ctx => {
    const { min, max } = metricRange(ctx);
    return { kind: 'ordinal', tokens: ordinalTokens(ctx.mode), low: min, high: max, metric: ctx.params.districtsMetric };
  },
  interactive: ['di-fill'],
  layers: (ctx, tools) => {
    const metric: Expr = ['coalesce', ['get', ctx.params.districtsMetric], 0];
    const { min, max } = metricRange(ctx);
    const tokens = ordinalTokens(ctx.mode);
    const breaks = equalBreaks(min, max, tokens.length);
    const ramp: Expr = ['step', metric, tools.color(tokens[0]), ...breaks.flatMap((b, i) => [b, tools.color(tokens[i + 1])])] as Expr;
    const threshold = ctx.params.districtsThreshold;
    return [
      {
        id: 'di-fill',
        type: 'fill',
        source: SRC_DISTRICTS,
        paint: {
          'fill-color': ramp,
          'fill-opacity': ['case', HOVER, tools.opacity('strong'), ['>=', metric, threshold], tools.opacity('medium'), tools.opacity('faint')],
          'fill-antialias': false
        }
      },
      {
        id: 'di-outline',
        type: 'line',
        source: SRC_DISTRICTS,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tools.color('map-bg'), 'line-width': byZoom([[10, 1], [14, 2.5]], 1) }
      },
      {
        id: 'di-highlight',
        type: 'line',
        source: SRC_DISTRICTS,
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['case', SELECTED, tools.color('accent'), tools.color('text-bright')],
          'line-width': ['case', ['any', HOVER, SELECTED], 2.5, 0]
        }
      },
      {
        id: 'di-labels',
        type: 'symbol',
        source: SRC_DISTRICT_LABELS,
        minzoom: 10.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': MAP_FONT_BOLD,
          'text-size': byZoom([[10.5, 9], [13, 12.5]], 1),
          'text-max-width': 7,
          'text-padding': 4
        },
        paint: {
          'text-color': tools.color('text-bright'),
          'text-halo-color': tools.color('map-bg'),
          'text-halo-width': 1.4
        }
      }
    ];
  }
};

// ─── CyberPunk (neon night map) ─────────────────────────────────────────────

/** Animated by `StopPulse` in MapService; its static paint here is the resting frame. */
export const CY_PULSE_LAYER = 'cy-stop-pulse';

/** Pulse ring radius at the zoom stops below; the animation scales it up to ×3. */
export const CY_PULSE_RADIUS: [number, number][] = [
  [11, 3],
  [14, 6],
  [17, 10]
];

/** Building height in metres (the pipeline always writes `height`, estimated if not tagged). */
const HEIGHT_EXPR: Expr = ['coalesce', ['get', 'height'], 6];

/**
 * Category colour whose brightness grows with height: interpolating from the background colour
 * (at −4 m) to the full neon (at 45 m) leaves low houses dim (~25 % at 10 m) and lets towers glow,
 * while the hue still tells the category.
 */
function glowByHeight(neon: string, bg: string): Expr {
  return ['interpolate', ['linear'], HEIGHT_EXPR, -4, bg, 45, neon];
}

function cyberColors(ctx: StyleContext, tools: StyleTools) {
  const p = ctx.params.cyberPalette;
  return (role: CyberRole) => tools.color(cyberToken(p, role));
}

function cyberHighlight(base: Expr | string, c: (role: CyberRole) => string): Expr {
  return ['case', SELECTED, c('select'), HOVER, c('hover'), base];
}

const cyberView: ViewDefinition = {
  id: 'cyberpunk',
  icon: Zap,
  camera: { center: [17.0335, 51.1085], zoom: 14.6, pitch: 58, bearing: -28 },
  slider: () => ({ param: 'cyberMinLevels', min: 0, max: 30, step: 1, presets: [3, 5, 11, 20], unit: 'levels' }),
  legend: ctx => {
    const tk = (role: CyberRole) => cyberToken(ctx.params.cyberPalette, role);
    return {
      kind: 'categorical',
      wide: true,
      items: [
        { labelKey: 'bldResidential', token: tk('res') },
        { labelKey: 'trTramTrack', token: tk('tram'), shape: 'line' },
        { labelKey: 'bldCommercial', token: tk('com') },
        { labelKey: 'trTramStop', token: tk('stop'), shape: 'point' },
        { labelKey: 'bldIndustrial', token: tk('ind') },
        { labelKey: 'trCycleway', token: tk('cycle'), shape: 'line' },
        { labelKey: 'bldPublicOnly', token: tk('pub') },
        { labelKey: 'bldReligious', token: tk('rel') },
        { labelKey: 'bldOther', token: tk('oth') }
      ]
    };
  },
  interactive: ['cy-stops', 'cy-bld', 'cy-tram'],
  layers: (ctx, tools) => {
    const c = cyberColors(ctx, tools);
    const bg = c('bg');
    const groups = new Map<CyberRole, string[]>();
    for (const [cls, role] of Object.entries(CYBER_BUILDING_ROLE)) groups.set(role, [...(groups.get(role) ?? []), cls]);
    const classColor: unknown[] = ['match', ['get', 'class']];
    for (const [role, classes] of groups) classColor.push(classes, glowByHeight(c(role), bg));
    classColor.push(glowByHeight(c('oth'), bg));
    const min = ctx.params.cyberMinLevels;

    const glowLine = (id: string, sourceLayer: string, color: string, widths: [number, number][], minzoom = 10): LayerSpecification => ({
      id,
      type: 'line',
      source: SRC_WROVIS,
      'source-layer': sourceLayer,
      minzoom,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-opacity': 0.35,
        'line-width': byZoom(widths),
        'line-blur': byZoom(widths.map(([z, w]) => [z, w * 0.6] as [number, number]))
      }
    });

    return [
      {
        id: 'cy-water',
        type: 'fill',
        source: SRC_WROVIS,
        'source-layer': 'water',
        paint: { 'fill-color': c('water'), 'fill-antialias': false }
      },
      {
        id: 'cy-waterways',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'waterways',
        filter: ['match', ['get', 'kind'], ['river', 'canal'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c('waterway'), 'line-width': byZoom([[10, 1], [16, 4]]) }
      },
      glowLine('cy-cycle-glow', 'cycleways', c('cycle'), [[11, 3], [14, 6], [17, 12]], 11),
      {
        id: 'cy-cycle',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'cycleways',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c('cycle'), 'line-opacity': 0.9, 'line-width': byZoom([[11, 0.5], [14, 1.1], [17, 2.4]]) }
      },
      glowLine('cy-tram-glow', 'tram_tracks', c('tram'), [[10, 5], [14, 10], [17, 20]]),
      {
        id: 'cy-tram',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'tram_tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': cyberHighlight(c('tram'), c), 'line-width': byZoom([[10, 1], [14, 2], [17, 4]]) }
      },
      {
        id: 'cy-bld',
        type: 'fill-extrusion',
        source: SRC_WROVIS,
        'source-layer': 'buildings',
        minzoom: 13,
        ...(min > 0 ? { filter: ['>=', LEVELS_EXPR, min] as Expr } : {}),
        paint: {
          'fill-extrusion-color': cyberHighlight(classColor as Expr, c),
          'fill-extrusion-height': HEIGHT_EXPR,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true
        }
      },
      {
        id: CY_PULSE_LAYER,
        type: 'circle',
        source: SRC_TRAM_STOPS,
        minzoom: 11,
        paint: {
          'circle-radius': byZoom(CY_PULSE_RADIUS, 1),
          'circle-color': c('stop'),
          'circle-opacity': 0,
          'circle-stroke-color': c('stop'),
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0,
          'circle-pitch-alignment': 'map'
        }
      },
      {
        id: 'cy-stop-glow',
        type: 'circle',
        source: SRC_TRAM_STOPS,
        minzoom: 11,
        paint: {
          'circle-radius': byZoom([[11, 5], [14, 9], [17, 15]], 1),
          'circle-color': c('stop'),
          'circle-opacity': 0.3,
          'circle-blur': 1
        }
      },
      {
        id: 'cy-stops',
        type: 'circle',
        source: SRC_TRAM_STOPS,
        minzoom: 11,
        paint: {
          'circle-radius': byZoom([[11, 2], [14, 3.5], [17, 6]], 1),
          'circle-color': cyberHighlight(c('stop'), c),
          'circle-stroke-color': bg,
          'circle-stroke-width': 1
        }
      },
      {
        id: 'cy-stop-labels',
        type: 'symbol',
        source: SRC_TRAM_STOPS,
        minzoom: 15,
        layout: {
          'text-field': ['upcase', ['get', 'name']],
          'text-font': MAP_FONT_BOLD,
          'text-size': byZoom([[15, 9], [17, 11]], 1),
          'text-letter-spacing': 0.12,
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-optional': true
        },
        paint: { 'text-color': c('stop'), 'text-halo-color': bg, 'text-halo-width': 1.4 }
      }
    ];
  }
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const VIEWS: Record<ViewId, ViewDefinition> = {
  buildings: buildingsView,
  bridges: bridgesView,
  transit: transitView,
  districts: districtsView,
  cyberpunk: cyberView
};

/** All thematic layers of every view; only the active view's layers are visible (switching never rebuilds sources). */
export function thematicLayers(ctx: StyleContext, tools: StyleTools): LayerSpecification[] {
  return Object.values(VIEWS).flatMap(view => view.layers(ctx, tools).map(layer => withVisibility(layer, view.id === ctx.view)));
}

/** Inverts a `value → slot` map into `[values[], colour]` groups for `matchGroups`, resolving each slot's token. */
function slotGroups(map: Record<string, CategoricalSlot>, ctx: StyleContext, tools: StyleTools): [string[], string][] {
  const bySlot = new Map<CategoricalSlot, string[]>();
  for (const [key, slot] of Object.entries(map)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), key]);
  return [...bySlot.entries()].map(([slot, values]) => [values, tools.color(categoricalToken(slot, ctx.mode))]);
}
