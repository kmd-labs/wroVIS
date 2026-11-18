import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Bike, Building2, CircleDashed, LayoutGrid, LucideIconData, TramFront, Waves } from 'lucide-angular';
import {
  MAP_FONT_BOLD,
  MAP_FONT_REGULAR,
  SRC_DISTRICTS,
  SRC_DISTRICT_LABELS,
  SRC_ROUTE,
  SRC_ROUTE_POINTS,
  SRC_SEARCH,
  SRC_TRAM_STOPS,
  SRC_WALK_ORIGIN,
  SRC_WALK_PLACES,
  SRC_WALK_STREETS,
  SRC_WROVIS
} from './map.config';
import {
  CameraSpec,
  DistrictMetric,
  LayerId,
  LegendCategory,
  LegendGroup,
  LegendLabelKey,
  LegendSpec,
  RouteProfile,
  SliderSpec,
  StyleContext
} from './map.types';
import { Expr, HOVER, LIST_HOVER, SELECTED, StyleTools, byZoom, highlight, matchGroups, metersToPixels, withVisibility } from './style.expr';
import { BRIDGE_KIND_SLOT, BUILDING_CLASS_SLOT, CategoricalSlot, categoricalToken, equalBreaks, ordinalTokens } from '../../shared/scales';
import { CYBER_BUILDING_ROLE, CyberRole, PALETTE_LOOK, cyberToken, styledPalette } from '../../shared/cyber-palette';
import { labelLooks } from './label-style';

type L = LayerSpecification;

/** Layers of a group by draw slot: on the ground (under the 3D buildings), the buildings, and on top. */
interface LayerSlots {
  ground?: L[];
  mid?: L[];
  top?: L[];
}

/** Declarative definition of one thematic layer group of the dock. */
export interface LayerGroup {
  id: LayerId;
  icon: LucideIconData;
  /** Dock slider shown under the group while it is on. */
  slider?: (ctx: StyleContext) => SliderSpec | null;
  /** Legend pills shown under the group while it is on. */
  legend?: (ctx: StyleContext) => LegendSpec | null;
  layers: (ctx: StyleContext, tools: StyleTools) => LayerSlots;
  /** Layer ids that respond to hover and click (queried with `queryRenderedFeatures`). */
  interactive: string[];
  /** Legend entries that switch whole layers off (category entries filter features inside `layers` instead). */
  legendLayers?: Partial<Record<LegendLabelKey, string[]>>;
}

/** Camera of the map at start: the Market Square in 3D (where the intro flight ends). */
export const START_CAMERA: CameraSpec = { center: [17.0325, 51.109], zoom: 15.1, pitch: 56, bearing: -18 };

/** First frame of the intro flight: the whole city from above. */
export const INTRO_CAMERA: CameraSpec = { center: [17.03, 51.108], zoom: 11.4, pitch: 0, bearing: 0 };

/**
 * Intro flight after the splash (~8 s): dive towards the Odra and Ostrów Tumski with the cathedral spires, sweep
 * along the river past the islands, then settle over the Market Square.
 */
export const INTRO_STOPS: { camera: CameraSpec; duration: number; fly: boolean }[] = [
  { camera: { center: [17.0465, 51.1145], zoom: 14.6, pitch: 58, bearing: 42 }, duration: 3400, fly: true },
  { camera: { center: [17.0395, 51.1135], zoom: 15.2, pitch: 62, bearing: 8 }, duration: 2400, fly: false },
  { camera: START_CAMERA, duration: 2600, fly: false }
];

/** True when the user switched this legend entry off. */
export function isHidden(ctx: Pick<StyleContext, 'hidden'>, group: LegendGroup, key: LegendLabelKey): boolean {
  return ctx.hidden.has(`${group}:${key}`);
}

/** Filter dropping features whose `prop` is one of `values`; null when nothing is dropped. */
function excludeValues(prop: string, values: string[]): Expr | null {
  return values.length ? (['!', ['match', ['get', prop], values, true, false]] as Expr) : null;
}

/** Keys of `map` (feature property values) whose legend entry is switched off in this group. */
function hiddenValues<T extends string>(ctx: StyleContext, group: LegendGroup, legend: [LegendLabelKey, T][], map: Record<string, T>): string[] {
  const off = new Set(legend.filter(([key]) => isHidden(ctx, group, key)).map(([, v]) => v));
  return Object.keys(map).filter(k => off.has(map[k]));
}

/**
 * Shows the layer only on the regular map (`normal`) or only on the styled palettes (`styled`: neon, sunset).
 * Both variants stay in the style, so switching palettes only toggles visibility.
 */
function onPalette<T extends L>(ctx: StyleContext, variant: 'normal' | 'styled', layer: T): T {
  return withVisibility(layer, variant === 'normal' ? ctx.palette === 'normal' : ctx.palette !== 'normal');
}

/** Colour reader of the active styled palette (neon roles while the regular map is shown; those layers are hidden). */
function neonColors(ctx: StyleContext, tools: StyleTools) {
  const palette = styledPalette(ctx.palette);
  return (role: CyberRole) => tools.color(cyberToken(role, palette));
}

function neonHighlight(base: Expr | string, c: (role: CyberRole) => string): Expr {
  return ['case', SELECTED, c('select'), HOVER, c('hover'), base];
}

/** District choropleth ramp (low → high): the KMD blue ramp on the regular map, the palette's own ramp otherwise. */
function districtRamp(ctx: StyleContext): string[] {
  if (ctx.palette === 'normal') return ordinalTokens(ctx.mode);
  const p = ctx.palette;
  return (['ramp-1', 'ramp-2', 'ramp-3', 'ramp-4'] as const).map(r => cyberToken(r, p));
}

/** District metrics available to the choropleth and the slider. */
export const DISTRICT_METRICS: readonly DistrictMetric[] = [
  'buildings_per_km2',
  'buildings',
  'poi_per_km2',
  'green_pct',
  'tram_stops',
  'streets_km_per_km2',
  'tram_street_pct',
  'pedestrian_km',
  'slow_street_pct',
  'streets_km',
  'area_km2',
  'poi',
  'water_pct',
  'bridges',
  'levels_mean',
  'max_height_m'
];

// ─── Buildings 3D ───────────────────────────────────────────────────────────

/** Building height in metres (the pipeline always writes `height`, estimated if not tagged). */
const HEIGHT_EXPR: Expr = ['coalesce', ['get', 'height'], 6];

/** Legend entries of the buildings on the regular map and the categorical slot each one stands for. */
const BUILDING_LEGEND: [LegendLabelKey, CategoricalSlot][] = [
  ['bldResidential', 'orange'],
  ['bldCommercial', 'blue'],
  ['bldPublic', 'green'],
  ['bldIndustrial', 'dark'],
  ['bldOther', 'light']
];

/** Building legend entries of the neon map and the colour role each one stands for. */
const NEON_BUILDING_LEGEND: [LegendLabelKey, CyberRole][] = [
  ['bldResidential', 'res'],
  ['bldCommercial', 'com'],
  ['bldIndustrial', 'ind'],
  ['bldPublicOnly', 'pub'],
  ['bldReligious', 'rel'],
  ['bldOther', 'oth']
];

/** Walking minutes of a building, written as feature-state by WalkService for buildings within the reach. */
const WALK_TIME_STATE: Expr = ['coalesce', ['feature-state', 'wt'], 9999];

/** Colour of buildings outside the reach: a quiet neutral on each theme. */
const OUTSIDE_TOKEN = { light: 'neutral-200', dark: 'neutral-700' } as const;

/**
 * Neon category colour whose brightness grows with height: interpolating from the background colour
 * (at −4 m) to the full neon (at 45 m) leaves low houses dim and lets towers glow, while the hue still tells the category.
 */
function glowByHeight(neon: string, bg: string, from: number): Expr {
  return ['interpolate', ['linear'], HEIGHT_EXPR, from, bg, 45, neon];
}

const buildingsGroup: LayerGroup = {
  id: 'buildings',
  icon: Building2,
  legend: ctx =>
    ctx.palette !== 'normal'
      ? { kind: 'categorical', wide: true, items: NEON_BUILDING_LEGEND.map(([labelKey, role]) => ({ labelKey, token: cyberToken(role, styledPalette(ctx.palette)) })) }
      : { kind: 'categorical', wide: true, items: BUILDING_LEGEND.map(([labelKey, slot]) => ({ labelKey, token: categoricalToken(slot, ctx.mode) })) },
  interactive: ['bld-extrusion', 'cy-bld'],
  layers: (ctx, tools) => {
    // Normal map: 5 colour groups; a shown walking reach greys out the buildings outside it.
    const classColor = matchGroups('class', slotGroups(BUILDING_CLASS_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const within = (inside: Expr | string, outside: string): Expr =>
      ctx.walkActive ? (['case', ['<=', WALK_TIME_STATE, ctx.params.walkMinutes], inside, outside] as Expr) : (inside as Expr);
    const classFilter = excludeValues('class', hiddenValues(ctx, 'buildings', BUILDING_LEGEND, BUILDING_CLASS_SLOT));

    // Styled maps (neon, sunset): 6 categories whose colour deepens with height.
    const c = neonColors(ctx, tools);
    const glowFrom = PALETTE_LOOK[styledPalette(ctx.palette)].glowFrom;
    const bg = c('bg');
    const groups = new Map<CyberRole, string[]>();
    for (const [cls, role] of Object.entries(CYBER_BUILDING_ROLE)) groups.set(role, [...(groups.get(role) ?? []), cls]);
    const neonClass: unknown[] = ['match', ['get', 'class']];
    for (const [role, classes] of groups) neonClass.push(classes, glowByHeight(c(role), bg, glowFrom));
    neonClass.push(glowByHeight(c('oth'), bg, glowFrom));
    const neonFilter = excludeValues('class', hiddenValues(ctx, 'buildings', NEON_BUILDING_LEGEND, CYBER_BUILDING_ROLE));

    return {
      mid: [
        onPalette(ctx, 'normal', {
          id: 'bld-extrusion',
          type: 'fill-extrusion',
          source: SRC_WROVIS,
          'source-layer': 'buildings',
          minzoom: 13,
          ...(classFilter ? { filter: classFilter } : {}),
          paint: {
            'fill-extrusion-color': highlight(within(classColor, tools.color(OUTSIDE_TOKEN[ctx.mode])), tools),
            'fill-extrusion-height': HEIGHT_EXPR,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.92,
            'fill-extrusion-vertical-gradient': true
          }
        }),
        onPalette(ctx, 'styled', {
          id: 'cy-bld',
          type: 'fill-extrusion',
          source: SRC_WROVIS,
          'source-layer': 'buildings',
          minzoom: 13,
          ...(neonFilter ? { filter: neonFilter } : {}),
          paint: {
            'fill-extrusion-color': neonHighlight(within(neonClass as Expr, c('road-major')), c),
            'fill-extrusion-height': HEIGHT_EXPR,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.9,
            'fill-extrusion-vertical-gradient': true
          }
        })
      ]
    };
  }
};

// ─── Trams ──────────────────────────────────────────────────────────────────

const TRAM_LAYERS = ['tr-tracks-casing', 'tr-tracks', 'cy-tram-glow', 'cy-tram'];
const STOP_LAYERS = ['tr-stops', 'tr-stop-labels', 'cy-stop-halo', 'cy-stop-glow', 'cy-stops', 'cy-stop-labels'];

/** Soft glow under a neon line (a fainter halo on the light sunset map). */
function glowLine(id: string, sourceLayer: string, color: string, widths: [number, number][], opacity: number, minzoom = 10): L {
  return {
    id,
    type: 'line',
    source: SRC_WROVIS,
    'source-layer': sourceLayer,
    minzoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-opacity': opacity,
      'line-width': byZoom(widths),
      'line-blur': byZoom(widths.map(([z, w]) => [z, w * 0.6] as [number, number]))
    }
  };
}

const tramsGroup: LayerGroup = {
  id: 'trams',
  icon: TramFront,
  legend: ctx => {
    const styled = ctx.palette !== 'normal';
    const p = styledPalette(ctx.palette);
    return {
      kind: 'categorical',
      items: [
        { labelKey: 'trTramTrack', token: styled ? cyberToken('tram', p) : categoricalToken('orange', ctx.mode), shape: 'line' },
        { labelKey: 'trTramStop', token: styled ? cyberToken('stop', p) : categoricalToken('orange', ctx.mode), shape: 'point' }
      ]
    };
  },
  interactive: ['tr-stops', 'tr-tracks', 'cy-stops', 'cy-tram'],
  legendLayers: { trTramTrack: TRAM_LAYERS, trTramStop: STOP_LAYERS },
  layers: (ctx, tools) => {
    const tram = tools.color(categoricalToken('orange', ctx.mode));
    // While planning a bike route the tram network steps back and the cycleways come forward.
    const dim = ctx.tool === 'bike' ? 0.3 : 1;
    const c = neonColors(ctx, tools);
    const bg = c('bg');
    const glow = PALETTE_LOOK[styledPalette(ctx.palette)].glowOpacity;
    const normal = <T extends L>(layer: T) => onPalette(ctx, 'normal', layer);
    const neon = <T extends L>(layer: T) => onPalette(ctx, 'styled', layer);
    return {
      ground: [
        normal({
          id: 'tr-tracks-casing',
          type: 'line',
          source: SRC_WROVIS,
          'source-layer': 'tram_tracks',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': tools.color('map-bg'), 'line-opacity': dim, 'line-width': byZoom([[10, 2.6], [14, 4.5], [17, 8]]) }
        }),
        normal({
          id: 'tr-tracks',
          type: 'line',
          source: SRC_WROVIS,
          'source-layer': 'tram_tracks',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': highlight(tram, tools), 'line-opacity': dim, 'line-width': byZoom([[10, 1.1], [14, 2.4], [17, 5]]) }
        }),
        neon(glowLine('cy-tram-glow', 'tram_tracks', c('tram'), [[10, 5], [14, 10], [17, 20]], glow)),
        neon({
          id: 'cy-tram',
          type: 'line',
          source: SRC_WROVIS,
          'source-layer': 'tram_tracks',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': neonHighlight(c('tram'), c), 'line-opacity': dim, 'line-width': byZoom([[10, 1], [14, 2], [17, 4]]) }
        })
      ],
      top: [
        normal({
          id: 'tr-stops',
          type: 'circle',
          source: SRC_TRAM_STOPS,
          minzoom: 11,
          paint: {
            'circle-radius': byZoom([[11, 2.2], [14, 4.5], [17, 7]], 1),
            'circle-color': tools.color('panel-bg-solid'),
            'circle-stroke-color': highlight(tram, tools),
            'circle-stroke-width': byZoom([[11, 1.2], [14, 2], [17, 2.5]], 1),
            'circle-opacity': dim,
            'circle-stroke-opacity': dim
          }
        }),
        normal({
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
          paint: { 'text-color': tools.color('text-main'), 'text-halo-color': tools.color('map-bg'), 'text-halo-width': 1.2, 'text-opacity': dim }
        }),
        neon({
          // Quiet static ring around each stop (no animation).
          id: 'cy-stop-halo',
          type: 'circle',
          source: SRC_TRAM_STOPS,
          minzoom: 11,
          paint: {
            'circle-radius': byZoom([[11, 6], [14, 11], [17, 18]], 1),
            'circle-color': c('stop'),
            'circle-opacity': 0,
            'circle-stroke-color': c('stop'),
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.45 * dim,
            'circle-pitch-alignment': 'map'
          }
        }),
        neon({
          id: 'cy-stop-glow',
          type: 'circle',
          source: SRC_TRAM_STOPS,
          minzoom: 11,
          paint: { 'circle-radius': byZoom([[11, 5], [14, 9], [17, 15]], 1), 'circle-color': c('stop'), 'circle-opacity': 0.3 * dim, 'circle-blur': 1 }
        }),
        neon({
          id: 'cy-stops',
          type: 'circle',
          source: SRC_TRAM_STOPS,
          minzoom: 11,
          paint: {
            'circle-radius': byZoom([[11, 2], [14, 3.5], [17, 6]], 1),
            'circle-color': neonHighlight(c('stop'), c),
            'circle-stroke-color': bg,
            'circle-stroke-width': 1,
            'circle-opacity': dim
          }
        }),
        neon({
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
          paint: { 'text-color': c('stop'), 'text-halo-color': bg, 'text-halo-width': 1.4, 'text-opacity': dim }
        })
      ]
    };
  }
};

// ─── Tram stop reach ────────────────────────────────────────────────────────

const stopRadiusGroup: LayerGroup = {
  id: 'stopRadius',
  icon: CircleDashed,
  // Presets evenly spread over the rail (25 / 50 / 75 %).
  slider: () => ({ param: 'transitRadius', min: 200, max: 1000, step: 50, presets: [400, 600, 800], unit: 'meters' }),
  interactive: [],
  layers: (ctx, tools) => ({
    ground: [
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
      }
    ]
  })
};

// ─── Cycleways ──────────────────────────────────────────────────────────────

const cyclewaysGroup: LayerGroup = {
  id: 'cycleways',
  icon: Bike,
  interactive: [],
  layers: (ctx, tools) => {
    const bike = ctx.tool === 'bike';
    const c = neonColors(ctx, tools);
    const glow = PALETTE_LOOK[styledPalette(ctx.palette)].glowOpacity;
    return {
      ground: [
        onPalette(ctx, 'normal', {
          id: 'tr-cycleways',
          type: 'line',
          source: SRC_WROVIS,
          'source-layer': 'cycleways',
          minzoom: 11,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': tools.color(categoricalToken('green', ctx.mode)),
            'line-opacity': tools.opacity('strong'),
            'line-width': bike ? byZoom([[11, 1.2], [14, 2.6], [17, 5]]) : byZoom([[11, 0.6], [14, 1.4], [17, 3]])
          }
        }),
        onPalette(ctx, 'styled', glowLine('cy-cycle-glow', 'cycleways', c('cycle'), [[11, 3], [14, 6], [17, 12]], glow, 11)),
        onPalette(ctx, 'styled', {
          id: 'cy-cycle',
          type: 'line',
          source: SRC_WROVIS,
          'source-layer': 'cycleways',
          minzoom: 11,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c('cycle'), 'line-opacity': 0.9, 'line-width': bike ? byZoom([[11, 1], [14, 2], [17, 4]]) : byZoom([[11, 0.5], [14, 1.1], [17, 2.4]]) }
        })
      ]
    };
  }
};

// ─── Bridges & water ────────────────────────────────────────────────────────

const BRIDGE_WIDTH_FACTOR: Expr = ['match', ['get', 'kind'], ['road', 'tram'], 1, ['rail'], 0.85, ['foot'], 0.7, 0.6];

export const BRIDGE_LEGEND: [LegendLabelKey, string][] = [
  ['brRoad', 'road'],
  ['brTram', 'tram'],
  ['brFoot', 'foot'],
  ['brRail', 'rail'],
  ['brOther', 'other']
];

const bridgesGroup: LayerGroup = {
  id: 'bridges',
  icon: Waves,
  legend: ctx => ({
    kind: 'categorical',
    wide: true,
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
  legendLayers: { brWater: ['br-water', 'br-waterways'] },
  layers: (ctx, tools) => {
    const kindColor = matchGroups('kind', slotGroups(BRIDGE_KIND_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const hiddenKinds = BRIDGE_LEGEND.filter(([key]) => isHidden(ctx, 'bridges', key)).map(([, kind]) => kind);
    // Bridge kinds switched off in the legend.
    const lengthFilter = (excludeValues('kind', hiddenKinds) ?? true) as Expr;
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
    const line = (id: string, filter: Expr, extra: Partial<Extract<L, { type: 'line' }>['paint']> = {}): L => ({
      id,
      type: 'line',
      source: SRC_WROVIS,
      'source-layer': 'bridges',
      minzoom: 11,
      filter: ['all', lengthFilter, filter] as Expr,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': highlight(kindColor, tools), 'line-width': width(0), ...extra }
    });
    return {
      ground: [
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
        line('br-lines-rail', isRail, { 'line-dasharray': [2.2, 1.4] })
      ],
      top: [
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
          paint: { 'text-color': tools.color('text-main'), 'text-halo-color': tools.color('map-bg'), 'text-halo-width': 1.2 }
        }
      ]
    };
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
  const step = max > 1000 ? 25 : max > 200 ? 5 : max > 30 ? 1 : 0.5;
  const top = Math.ceil(max / step) * step;
  const presets = [0.25, 0.5, 0.75].map(q => Math.round((top * q) / step) * step);
  return { param: 'districtsThreshold', min: 0, max: top, step, presets, unit: 'none' };
}

const districtsGroup: LayerGroup = {
  id: 'districts',
  icon: LayoutGrid,
  slider: metricSliderSpec,
  legend: ctx => {
    const { min, max } = metricRange(ctx);
    return { kind: 'ordinal', tokens: districtRamp(ctx), low: min, high: max, metric: ctx.params.districtsMetric };
  },
  interactive: ['di-fill'],
  layers: (ctx, tools) => {
    const metric: Expr = ['coalesce', ['get', ctx.params.districtsMetric], 0];
    const { min, max } = metricRange(ctx);
    const tokens = districtRamp(ctx);
    const breaks = equalBreaks(min, max, tokens.length);
    const ramp: Expr = ['step', metric, tools.color(tokens[0]), ...breaks.flatMap((b, i) => [b, tools.color(tokens[i + 1])])] as Expr;
    const threshold = ctx.params.districtsThreshold;
    const look = labelLooks(ctx, tools).district;
    return {
      ground: [
        {
          id: 'di-fill',
          type: 'fill',
          source: SRC_DISTRICTS,
          paint: {
            'fill-color': ramp,
            'fill-opacity': ['case', ['any', HOVER, LIST_HOVER], tools.opacity('strong'), ['>=', metric, threshold], tools.opacity('medium'), tools.opacity('faint')],
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
            'line-color': ['case', SELECTED, tools.color('accent'), LIST_HOVER, tools.color('accent'), tools.color('text-bright')],
            'line-width': ['case', ['any', HOVER, SELECTED, LIST_HOVER], ['case', LIST_HOVER, 3.5, 2.5], 0]
          }
        }
      ],
      top: [
        {
          id: 'di-labels',
          type: 'symbol',
          source: SRC_DISTRICT_LABELS,
          minzoom: 10.5,
          // With 3D buildings drawn, the labels give way to the street level when zoomed in.
          maxzoom: 15,
          layout: {
            'text-field': ['get', 'name'],
            // Lettering of the palette (label-style.ts): neon signage, sunset italics, or KMD bold.
            'text-font': look.font,
            'text-transform': look.transform,
            'text-letter-spacing': look.spacing,
            'text-size': byZoom([[10.5, 9], [13, 12.5]], 1),
            'text-max-width': 7,
            'text-padding': 4
          },
          paint: { 'text-color': look.color, 'text-halo-color': look.halo, 'text-halo-width': look.haloWidth, 'text-halo-blur': look.haloBlur }
        }
      ]
    };
  }
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const GROUPS: Record<LayerId, LayerGroup> = {
  buildings: buildingsGroup,
  trams: tramsGroup,
  stopRadius: stopRadiusGroup,
  cycleways: cyclewaysGroup,
  bridges: bridgesGroup,
  districts: districtsGroup
};

/** Draw order of the groups inside each slot (bottom first): broad fills, then lines, then points. */
const DRAW_ORDER: readonly LayerId[] = ['districts', 'stopRadius', 'bridges', 'cycleways', 'trams', 'buildings'];

// ─── Walking reach ("15-minute city") ───────────────────────────────────────

/** Minute bands of the reach, nearest first; each band takes the next-lighter step of the ramp. */
export const WALK_BANDS = [5, 10, 15, 20] as const;

/** Street pieces up to `minutes`, minus the minute bands switched off in the legend. */
export function walkFilter(minutes: number, hiddenBands: readonly number[] = []): Expr {
  const within: Expr = ['<=', ['get', 't'], minutes];
  if (!hiddenBands.length) return within;
  const bands: Expr[] = hiddenBands.map(b => ['all', ['>', ['get', 't'], b - 5], ['<=', ['get', 't'], b]]);
  return ['all', within, ['!', ['any', ...bands]]];
}

/** Minute bands (5, 10, 15, 20) switched off in the reach legend. */
export function hiddenWalkBands(hidden: ReadonlySet<string>): number[] {
  return WALK_BANDS.filter(b => hidden.has(`walk:wk${b}`));
}

function walkBandTokens(ctx: StyleContext): string[] {
  // Purple: a hue no building category uses, so reached streets never read as blue (commercial) buildings.
  // Nearest band first: darkest on the light maps (normal, sunset), brightest on Midnight and on the neon map.
  return ctx.mode === 'dark' || ctx.palette === 'neon'
    ? ['purple-300', 'purple-400', 'purple-500', 'purple-600']
    : ['purple-600', 'purple-500', 'purple-400', 'purple-300'];
}

/** Legend of the walking reach: minute bands up to the current limit, places, the origin and the greyed buildings. */
export function walkLegend(ctx: StyleContext): LegendSpec {
  const tokens = walkBandTokens(ctx);
  const keys = ['wk5', 'wk10', 'wk15', 'wk20'] as const;
  const items: LegendCategory[] = [
    ...WALK_BANDS.filter(b => b <= ctx.params.walkMinutes).map((_, i) => ({ labelKey: keys[i], token: tokens[i], shape: 'line' as const })),
    { labelKey: 'wkPlace', token: 'accent', shape: 'point' },
    { labelKey: 'wkOrigin', token: 'accent', shape: 'fill' },
    ...(ctx.walkActive && ctx.layers.has('buildings') ? [{ labelKey: 'wkOutside' as const, token: OUTSIDE_TOKEN[ctx.mode], fixed: true }] : [])
  ];
  return { kind: 'categorical', wide: true, items };
}

const WALK_LEGEND_LAYERS: Partial<Record<LegendLabelKey, string[]>> = { wkPlace: ['wk-places'], wkOrigin: ['wk-origin', 'wk-origin-halo'] };

/** Walking-reach layers: reached streets (ground) and reached places with the origin marker (top). */
function walkLayers(ctx: StyleContext, tools: StyleTools): Required<Pick<LayerSlots, 'ground' | 'top'>> {
  const tokens = walkBandTokens(ctx).map(tools.color);
  const band: Expr = ['step', ['get', 't'], tokens[0], 5, tokens[1], 10, tokens[2], 15, tokens[3]];
  const filter = walkFilter(ctx.params.walkMinutes);
  const streetFilter = walkFilter(ctx.params.walkMinutes, hiddenWalkBands(ctx.hidden));
  return {
    ground: [
      {
        id: 'wk-streets',
        type: 'line',
        source: SRC_WALK_STREETS,
        filter: streetFilter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // Farther bands also fade, so the minute rings read apart even where the ramp steps are close.
        paint: { 'line-color': band, 'line-width': byZoom([[11, 1.2], [14, 3], [17, 7]]), 'line-opacity': ['step', ['get', 't'], 1, 5, 0.8, 10, 0.6, 15, 0.42] }
      }
    ],
    top: [
      {
        // Subtle place pins: a small dot in the accent with a thin halo, only when zoomed in
        // (around the Market Square there are hundreds within 15 minutes).
        id: 'wk-places',
        type: 'circle',
        source: SRC_WALK_PLACES,
        filter,
        minzoom: 14.5,
        paint: {
          'circle-radius': byZoom([[14.5, 1.4], [16, 2.2], [18, 3.4]], 1),
          'circle-color': highlight(tools.color('accent'), tools),
          'circle-opacity': ['case', ['any', HOVER, SELECTED], 1, 0.7],
          'circle-stroke-color': tools.color('panel-bg-solid'),
          'circle-stroke-width': byZoom([[14.5, 0.5], [17, 1]], 1),
          'circle-stroke-opacity': 0.8,
          'circle-pitch-alignment': 'map'
        }
      },
      {
        id: 'wk-origin-halo',
        type: 'circle',
        source: SRC_WALK_ORIGIN,
        paint: { 'circle-radius': 16, 'circle-color': tools.color('accent'), 'circle-opacity': 0.18, 'circle-pitch-alignment': 'map' }
      },
      {
        id: 'wk-origin',
        type: 'circle',
        source: SRC_WALK_ORIGIN,
        paint: {
          'circle-radius': 7,
          'circle-color': tools.color('accent'),
          'circle-stroke-color': tools.color('panel-bg-solid'),
          'circle-stroke-width': 3,
          'circle-pitch-alignment': 'map'
        }
      }
    ]
  };
}

// ─── Routes (walking and bike) ──────────────────────────────────────────────

/**
 * Colour of routes and waypoints, a hue no other layer of the palette uses: purple on the regular map (the KMD
 * orange accent would vanish among orange residential buildings and tram tracks), hot magenta on the neon map,
 * electric indigo on the sunset map (its pinks would swallow a pink route). The walking reach also uses purple,
 * but the two never show together (reach and route are separate modes).
 */
export function routeToken(ctx: Pick<StyleContext, 'mode' | 'palette'>): string {
  if (ctx.palette !== 'normal') return cyberToken('route', ctx.palette);
  return ctx.mode === 'dark' ? 'purple-400' : 'purple-600';
}

/** Legend of the route planner for the active profile. */
export function routeLegend(profile: RouteProfile, ctx: Pick<StyleContext, 'mode' | 'palette'>): LegendSpec {
  const token = routeToken(ctx);
  const items: LegendCategory[] =
    profile === 'walk'
      ? [{ labelKey: 'wrRoute', token, shape: 'line' }]
      : profile === 'bikeStreets'
        ? [
            { labelKey: 'bkRoute', token, shape: 'line' },
            { labelKey: 'bkStreet', token, shape: 'dash' }
          ]
        : [{ labelKey: 'bkRoute', token, shape: 'line' }];
  return { kind: 'categorical', items: [...items, { labelKey: 'bkPoint', token, shape: 'point' }] };
}

const ROUTE_LEGEND_LAYERS: Partial<Record<LegendLabelKey, string[]>> = {
  wrRoute: ['rt-line', 'rt-line-street', 'rt-casing', 'rt-approach', 'rt-gap'],
  bkRoute: ['rt-line', 'rt-casing', 'rt-approach', 'rt-gap'],
  bkStreet: ['rt-line-street'],
  bkPoint: ['rt-points', 'rt-labels']
};

/**
 * Route legs along the network (`kind: leg`; stretches on streets of a bike route carry `street: 1` and are
 * dashed), dashed approaches from each point to the network (`approach`), dashed straight lines where two
 * points share no connected network (`gap`), and lettered waypoints A, B, C… (draggable, see RouteService).
 */
function routeLayers(ctx: StyleContext, tools: StyleTools): L[] {
  const kind = (k: string): Expr => ['==', ['get', 'kind'], k];
  const street: Expr = ['==', ['get', 'street'], 1];
  const color = tools.color(routeToken(ctx));
  const width = byZoom([[11, 3.5], [14, 5.5], [17, 10]]);
  return [
    {
      id: 'rt-approach',
      type: 'line',
      source: SRC_ROUTE,
      filter: kind('approach'),
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tools.color('text-dim'), 'line-width': 1.5, 'line-dasharray': [1, 2] }
    },
    {
      id: 'rt-gap',
      type: 'line',
      source: SRC_ROUTE,
      filter: kind('gap'),
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tools.color('danger'), 'line-width': 2, 'line-dasharray': [2, 2] }
    },
    {
      id: 'rt-casing',
      type: 'line',
      source: SRC_ROUTE,
      filter: kind('leg'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Wide light casing, so the route reads over the 3D buildings and the coloured layers under it.
      paint: { 'line-color': tools.color('panel-bg-solid'), 'line-width': byZoom([[11, 7], [14, 10], [17, 16]]) }
    },
    {
      id: 'rt-line',
      type: 'line',
      source: SRC_ROUTE,
      filter: ['all', kind('leg'), ['!', street]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width }
    },
    {
      id: 'rt-line-street',
      type: 'line',
      source: SRC_ROUTE,
      filter: ['all', kind('leg'), street],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width, 'line-dasharray': [1.2, 0.9] }
    },
    {
      id: 'rt-points',
      type: 'circle',
      source: SRC_ROUTE_POINTS,
      paint: {
        'circle-radius': 9,
        'circle-color': color,
        'circle-stroke-color': tools.color('panel-bg-solid'),
        'circle-stroke-width': 2
      }
    },
    {
      id: 'rt-labels',
      type: 'symbol',
      source: SRC_ROUTE_POINTS,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': MAP_FONT_BOLD,
        'text-size': 10.5,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: { 'text-color': tools.color('panel-bg-solid') }
    }
  ];
}

/**
 * Marker of the address picked in the search box (a quiet ring with a small dot) and the street picked in it:
 * a wide soft glow under a solid line, both in the accent of the palette. MapService pulses the glow for a few
 * seconds after the pick, then it stays as a steady halo.
 */
function searchLayers(ctx: StyleContext, tools: StyleTools): L[] {
  const street: Expr = ['==', ['get', 'name'], ctx.searchStreet ?? ''];
  const shown = ctx.searchStreet !== null;
  const color = tools.color('accent');
  return [
    withVisibility(
      {
        id: 'search-street-glow',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'streets',
        minzoom: 12,
        filter: street,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-opacity': SEARCH_GLOW_OPACITY, 'line-width': byZoom([[12, 10], [15, 22], [18, 44]]), 'line-blur': byZoom([[12, 6], [15, 12], [18, 22]]) }
      },
      shown
    ),
    withVisibility(
      {
        id: 'search-street',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'streets',
        minzoom: 12,
        filter: street,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': byZoom([[12, 2.5], [15, 5], [18, 10]]) }
      },
      shown
    ),
    {
      id: 'search-ring',
      type: 'circle',
      source: SRC_SEARCH,
      paint: {
        'circle-radius': 11,
        'circle-color': tools.color('accent'),
        'circle-opacity': 0.12,
        'circle-stroke-color': tools.color('accent'),
        'circle-stroke-width': 1.2,
        'circle-stroke-opacity': 0.7,
        'circle-pitch-alignment': 'map'
      }
    },
    {
      id: 'search-dot',
      type: 'circle',
      source: SRC_SEARCH,
      paint: { 'circle-radius': 3, 'circle-color': tools.color('accent'), 'circle-pitch-alignment': 'map' }
    }
  ];
}

/** Water of the styled maps from the wroVIS tiles (finer than the basemap), shown whenever a styled palette is on. */
function neonBaseLayers(ctx: StyleContext, tools: StyleTools): L[] {
  const c = neonColors(ctx, tools);
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
    }
  ].map(layer => withVisibility(layer as L, ctx.palette !== 'normal'));
}

/** Resting opacity of the picked street's glow (MapService pulses it around this value after a pick). */
export const SEARCH_GLOW_OPACITY = 0.35;

/** Whether the route planner (walking or bike) is the active tool. */
export function routeActive(ctx: Pick<StyleContext, 'tool' | 'walkMode'>): boolean {
  return ctx.tool === 'bike' || (ctx.tool === 'walk' && ctx.walkMode === 'route');
}

/**
 * All thematic layers in draw order. Every layer of every group stays in the style; switching a group, the
 * palette or a tool only toggles visibility, so MapLibre never reloads sources.
 */
export function thematicLayers(ctx: StyleContext, tools: StyleTools): LayerSpecification[] {
  const slots: Record<'ground' | 'mid' | 'top', L[]> = { ground: [], mid: [], top: [] };
  const place = (layers: L[] | undefined, slot: keyof typeof slots, on: boolean, off: Set<string>) => {
    for (const layer of layers ?? []) {
      const shown = on && !off.has(layer.id) && ('layout' in layer ? layer.layout?.visibility !== 'none' : true);
      slots[slot].push(withVisibility(layer, shown));
    }
  };
  const offFor = (group: LegendGroup, map: Partial<Record<LegendLabelKey, string[]>> | undefined) =>
    new Set(
      Object.entries(map ?? {})
        .filter(([key]) => isHidden(ctx, group, key as LegendLabelKey))
        .flatMap(([, ids]) => ids ?? [])
    );

  place(neonBaseLayers(ctx, tools), 'ground', true, new Set());
  for (const id of DRAW_ORDER) {
    const group = GROUPS[id];
    const out = group.layers(ctx, tools);
    const on = ctx.layers.has(id);
    const off = offFor(id, group.legendLayers);
    place(out.ground, 'ground', on, off);
    place(out.mid, 'mid', on, off);
    place(out.top, 'top', on, off);
  }
  const walk = walkLayers(ctx, tools);
  const walkOn = ctx.tool === 'walk' && ctx.walkMode === 'reach';
  const walkOff = offFor('walk', WALK_LEGEND_LAYERS);
  // Reached streets lie on the ground, so buildings hide the ones behind them; places and the origin stay on top.
  slots.ground.push(...walk.ground.map(l => withVisibility(l, walkOn && !walkOff.has(l.id))));
  place(walk.top, 'top', walkOn, walkOff);
  place(searchLayers(ctx, tools), 'top', true, new Set());
  // Routes are drawn over the buildings, so the whole route stays readable in 3D.
  place(routeLayers(ctx, tools), 'top', routeActive(ctx), offFor('route', ROUTE_LEGEND_LAYERS));
  return [...slots.ground, ...slots.mid, ...slots.top];
}

/** Layers that answer hover and click: those of the groups switched on, plus reached places of the walking reach. */
export function interactiveLayers(ctx: Pick<StyleContext, 'layers' | 'tool' | 'walkMode'>): string[] {
  const ids = [...ctx.layers].flatMap(id => GROUPS[id].interactive);
  if (ctx.tool === 'walk' && ctx.walkMode === 'reach') ids.unshift('wk-places');
  return ids;
}

/** Inverts a `value → slot` map into `[values[], colour]` groups for `matchGroups`, resolving each slot's token. */
function slotGroups(map: Record<string, CategoricalSlot>, ctx: StyleContext, tools: StyleTools): [string[], string][] {
  const bySlot = new Map<CategoricalSlot, string[]>();
  for (const [key, slot] of Object.entries(map)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), key]);
  return [...bySlot.entries()].map(([slot, values]) => [values, tools.color(categoricalToken(slot, ctx.mode))]);
}
