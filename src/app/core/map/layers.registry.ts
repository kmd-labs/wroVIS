import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Building2, LayoutGrid, LucideIconData, TramFront, Waves, Zap } from 'lucide-angular';
import {
  MAP_FONT_BOLD,
  MAP_FONT_REGULAR,
  SRC_BIKE_POINTS,
  SRC_BIKE_ROUTE,
  SRC_DISTRICTS,
  SRC_DISTRICT_LABELS,
  SRC_TRAM_STOPS,
  SRC_WALK_ORIGIN,
  SRC_WALK_PLACES,
  SRC_WALK_STREETS,
  SRC_WROVIS
} from './map.config';
import { BRIDGE_ALL_M, CameraSpec, DistrictMetric, LegendCategory, LegendLabelKey, LegendSpec, SliderSpec, StyleContext, ViewId } from './map.types';
import { Expr, HOVER, LIST_HOVER, SELECTED, StyleTools, byZoom, highlight, matchGroups, metersToPixels, withVisibility } from './style.expr';
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
  /** Legend entries that switch whole layers off (category entries filter features inside `layers` instead). */
  legendLayers?: Partial<Record<LegendLabelKey, string[]>>;
  /** Layers the view hides in its current mode (e.g. the stop radius while planning a bike route). */
  modeHidden?: (ctx: StyleContext) => string[];
}

/** True when the user switched this legend entry off in this view. */
export function isHidden(ctx: Pick<StyleContext, 'hidden'>, view: ViewId, key: LegendLabelKey): boolean {
  return ctx.hidden.has(`${view}:${key}`);
}

/** Filter dropping features whose `prop` is one of `values`; null when nothing is dropped. */
function excludeValues(prop: string, values: string[]): Expr | null {
  return values.length ? (['!', ['match', ['get', prop], values, true, false]] as Expr) : null;
}

/** Combines optional filters with `all`; undefined when there is none. */
function allOf(...filters: (Expr | null | undefined)[]): Expr | undefined {
  const list = filters.filter((f): f is Expr => !!f);
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : (['all', ...list] as Expr);
}

/** Keys of `map` (feature property values) whose legend entry is switched off in this view. */
function hiddenValues<T extends string>(ctx: StyleContext, view: ViewId, legend: [LegendLabelKey, T][], map: Record<string, T>): string[] {
  const off = new Set(legend.filter(([key]) => isHidden(ctx, view, key)).map(([, v]) => v));
  return Object.keys(map).filter(k => off.has(map[k]));
}

/** District metrics available to the choropleth and the slider, with their stats key. */
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

const LEVELS_EXPR: Expr = ['coalesce', ['get', 'levels'], ['/', ['coalesce', ['get', 'height'], 0], 3]];

/** Legend entries of the 3D buildings view and the categorical slot each one stands for. */
const BUILDING_LEGEND: [LegendLabelKey, CategoricalSlot][] = [
  ['bldResidential', 'orange'],
  ['bldCommercial', 'blue'],
  ['bldPublic', 'green'],
  ['bldIndustrial', 'dark'],
  ['bldOther', 'light']
];

/** Walking minutes of a building, written as feature-state by WalkService for buildings within the reach. */
const WALK_TIME_STATE: Expr = ['coalesce', ['feature-state', 'wt'], 9999];

const buildingsView: ViewDefinition = {
  id: 'buildings',
  icon: Building2,
  camera: { center: [17.0325, 51.109], zoom: 15.1, pitch: 56, bearing: -18 },
  // The dock slider sets the walking-time limit of the reach started by a click (see WalkService).
  slider: () => ({ param: 'walkMinutes', min: 5, max: 20, step: 5, presets: [5, 10, 15, 20], unit: 'minutes' }),
  legend: ctx => ({
    kind: 'categorical',
    wide: true,
    items: [
      ...BUILDING_LEGEND.map(([labelKey, slot]) => ({ labelKey, token: categoricalToken(slot, ctx.mode) })),
      ...(ctx.walkEnabled ? walkLegend(ctx) : [])
    ]
  }),
  interactive: ['bld-extrusion', 'wk-places'],
  legendLayers: { wkPlace: ['wk-places'], wkOrigin: ['wk-origin', 'wk-origin-halo'] },
  layers: (ctx, tools) => {
    const classColor = matchGroups('class', slotGroups(BUILDING_CLASS_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const walk = walkLayers(ctx, tools);
    // With a reach shown, buildings outside it turn grey; those within keep their category colour.
    const color: Expr = ctx.walkActive
      ? ['case', ['<=', WALK_TIME_STATE, ctx.params.walkMinutes], classColor, tools.color(OUTSIDE_TOKEN[ctx.mode])]
      : classColor;
    const classFilter = excludeValues('class', hiddenValues(ctx, 'buildings', BUILDING_LEGEND, BUILDING_CLASS_SLOT));
    return [
      // Reached streets lie on the ground, so buildings hide the ones behind them; places and the origin stay on top.
      ...walk.ground,
      {
        id: 'bld-extrusion',
        type: 'fill-extrusion',
        source: SRC_WROVIS,
        'source-layer': 'buildings',
        minzoom: 13,
        ...(classFilter ? { filter: classFilter } : {}),
        paint: {
          'fill-extrusion-color': highlight(color, tools),
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 6],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true
        }
      },
      ...walk.top
    ];
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

const bridgesView: ViewDefinition = {
  id: 'bridges',
  icon: Waves,
  camera: { center: [17.047, 51.115], zoom: 13.6, pitch: 0, bearing: 0 },
  // "Bridges up to X m": moving right adds longer bridges, so the count in the dock grows with the slider.
  slider: () => ({ param: 'bridgesMaxLength', min: 10, max: BRIDGE_ALL_M, step: 10, presets: [50, 100, 200, 300], unit: 'meters' }),
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
  legendLayers: { brWater: ['br-water', 'br-waterways'] },
  layers: (ctx, tools) => {
    const kindColor = matchGroups('kind', slotGroups(BRIDGE_KIND_SLOT, ctx, tools), tools.color(categoricalToken('light', ctx.mode)));
    const max = ctx.params.bridgesMaxLength;
    const hiddenKinds = BRIDGE_LEGEND.filter(([key]) => isHidden(ctx, 'bridges', key)).map(([, kind]) => kind);
    // Length limit (none at the end of the slider) plus the bridge kinds switched off in the legend.
    const lengthFilter = (allOf(
      // Whole bridges: `blen` is the bridge's length (its longest segment), shared by all its segments.
      max < BRIDGE_ALL_M ? (['<=', ['coalesce', ['get', 'blen'], ['get', 'length_m'], 0], max] as Expr) : null,
      excludeValues('kind', hiddenKinds)
    ) ?? true) as Expr;
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
      ...(ctx.transitMode === 'bike'
        ? [
            { labelKey: 'bkRoute' as const, token: 'accent', shape: 'line' as const },
            { labelKey: 'bkPoint' as const, token: 'accent', shape: 'point' as const }
          ]
        : [{ labelKey: 'trWalkRadius' as const, token: 'cool', shape: 'fill' as const }])
    ]
  }),
  interactive: ['tr-stops', 'tr-tracks'],
  modeHidden: ctx => (ctx.transitMode === 'bike' ? ['tr-radius'] : BIKE_LAYERS),
  legendLayers: {
    trTramTrack: ['tr-tracks', 'tr-tracks-casing'],
    trTramStop: ['tr-stops', 'tr-stop-labels'],
    trCycleway: ['tr-cycleways'],
    trWalkRadius: ['tr-radius'],
    bkRoute: ['bk-route', 'bk-route-casing', 'bk-approach', 'bk-gap'],
    bkPoint: ['bk-points', 'bk-labels']
  },
  layers: (ctx, tools) => {
    const tram = tools.color(categoricalToken('orange', ctx.mode));
    const bike = ctx.transitMode === 'bike';
    // While planning a bike route the tram network steps back and the cycleways come forward.
    const tramOpacity = bike ? 0.3 : 1;
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
          'line-width': bike ? byZoom([[11, 1.2], [14, 2.6], [17, 5]]) : byZoom([[11, 0.6], [14, 1.4], [17, 3]])
        }
      },
      {
        id: 'tr-tracks-casing',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'tram_tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': tools.color('map-bg'), 'line-opacity': tramOpacity, 'line-width': byZoom([[10, 2.6], [14, 4.5], [17, 8]]) }
      },
      {
        id: 'tr-tracks',
        type: 'line',
        source: SRC_WROVIS,
        'source-layer': 'tram_tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': highlight(tram, tools), 'line-opacity': tramOpacity, 'line-width': byZoom([[10, 1.1], [14, 2.4], [17, 5]]) }
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
          'circle-stroke-width': byZoom([[11, 1.2], [14, 2], [17, 2.5]], 1),
          'circle-opacity': tramOpacity,
          'circle-stroke-opacity': tramOpacity
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
          'text-halo-width': 1.2,
          'text-opacity': tramOpacity
        }
      },
      ...bikeLayers(tools)
    ];
  }
};

/** Layers of the bike route planner (hidden outside bike mode). */
const BIKE_LAYERS = ['bk-approach', 'bk-gap', 'bk-route-casing', 'bk-route', 'bk-points', 'bk-labels'];

/**
 * Bike route: legs along the cycle network (`kind: leg`), dashed approaches from each clicked point to the
 * network (`approach`), dashed straight lines where two points share no connected cycleway (`gap`), and
 * lettered waypoints A, B, C… (draggable, see BikeRouteService).
 */
function bikeLayers(tools: StyleTools): LayerSpecification[] {
  const kind = (k: string): Expr => ['==', ['get', 'kind'], k];
  return [
    {
      id: 'bk-approach',
      type: 'line',
      source: SRC_BIKE_ROUTE,
      filter: kind('approach'),
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tools.color('text-dim'), 'line-width': 1.5, 'line-dasharray': [1, 2] }
    },
    {
      id: 'bk-gap',
      type: 'line',
      source: SRC_BIKE_ROUTE,
      filter: kind('gap'),
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tools.color('danger'), 'line-width': 2, 'line-dasharray': [2, 2] }
    },
    {
      id: 'bk-route-casing',
      type: 'line',
      source: SRC_BIKE_ROUTE,
      filter: kind('leg'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': tools.color('panel-bg-solid'), 'line-width': byZoom([[11, 5], [14, 8], [17, 13]]) }
    },
    {
      id: 'bk-route',
      type: 'line',
      source: SRC_BIKE_ROUTE,
      filter: kind('leg'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': tools.color('accent'), 'line-width': byZoom([[11, 3], [14, 5], [17, 9]]) }
    },
    {
      id: 'bk-points',
      type: 'circle',
      source: SRC_BIKE_POINTS,
      paint: {
        'circle-radius': 10,
        'circle-color': tools.color('accent'),
        'circle-stroke-color': tools.color('panel-bg-solid'),
        'circle-stroke-width': 2.5
      }
    },
    {
      id: 'bk-labels',
      type: 'symbol',
      source: SRC_BIKE_POINTS,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': MAP_FONT_BOLD,
        'text-size': 11,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: { 'text-color': tools.color('panel-bg-solid') }
    }
  ];
}

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

// ─── Walking reach ("15-minute city") ───────────────────────────────────────


/** Minute bands of the reach, nearest first; each band takes the next-lighter step of the ordinal ramp. */
export const WALK_BANDS = [5, 10, 15, 20] as const;

/** Street pieces up to `minutes`, minus the minute bands switched off in the legend. */
export function walkFilter(minutes: number, hiddenBands: readonly number[] = []): Expr {
  const within: Expr = ['<=', ['get', 't'], minutes];
  if (!hiddenBands.length) return within;
  const bands: Expr[] = hiddenBands.map(b => ['all', ['>', ['get', 't'], b - 5], ['<=', ['get', 't'], b]]);
  return ['all', within, ['!', ['any', ...bands]]];
}

/** Minute bands (5, 10, 15, 20) switched off in the 3D buildings legend. */
export function hiddenWalkBands(hidden: ReadonlySet<string>): number[] {
  return WALK_BANDS.filter(b => hidden.has(`buildings:wk${b}`));
}

/** Colour of buildings outside the reach: a quiet neutral on each theme. */
const OUTSIDE_TOKEN = { light: 'neutral-200', dark: 'neutral-700' } as const;

function walkBandTokens(ctx: StyleContext): string[] {
  // Purple: a hue no building category uses, so reached streets never read as blue (commercial) buildings.
  // Nearest band first: darkest on the light map, brightest on Midnight.
  return ctx.mode === 'dark' ? ['purple-300', 'purple-400', 'purple-500', 'purple-600'] : ['purple-600', 'purple-500', 'purple-400', 'purple-300'];
}

/** Legend rows of the walking reach: minute bands up to the current limit, places and the origin. */
function walkLegend(ctx: StyleContext): LegendCategory[] {
  const tokens = walkBandTokens(ctx);
  const keys = ['wk5', 'wk10', 'wk15', 'wk20'] as const;
  return [
    ...WALK_BANDS.filter(b => b <= ctx.params.walkMinutes).map((_, i) => ({ labelKey: keys[i], token: tokens[i], shape: 'line' as const })),
    { labelKey: 'wkPlace', token: 'accent', shape: 'point' },
    { labelKey: 'wkOrigin', token: 'accent', shape: 'fill' },
    ...(ctx.walkActive ? [{ labelKey: 'wkOutside' as const, token: OUTSIDE_TOKEN[ctx.mode], fixed: true }] : [])
  ];
}

/** Walking-reach layers: reached streets (ground) and reached places with the origin marker (top). */
function walkLayers(ctx: StyleContext, tools: StyleTools): { ground: LayerSpecification[]; top: LayerSpecification[] } {
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
        id: 'wk-places',
        type: 'circle',
        source: SRC_WALK_PLACES,
        filter,
        // Places only when zoomed in: around the Market Square there are hundreds within 15 minutes.
        minzoom: 13.5,
        paint: {
          'circle-radius': byZoom([[13.5, 1.6], [15, 3], [17, 5]], 1),
          'circle-color': highlight(tools.color('panel-bg-solid'), tools),
          'circle-stroke-color': tools.color('accent'),
          'circle-stroke-width': byZoom([[13.5, 0.8], [16, 1.6]], 1),
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

// ─── CyberPunk (neon night map) ─────────────────────────────────────────────


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

/** Building legend entries of the neon view and the colour role each one stands for. */
const CYBER_LEGEND: [LegendLabelKey, CyberRole][] = [
  ['bldResidential', 'res'],
  ['bldCommercial', 'com'],
  ['bldIndustrial', 'ind'],
  ['bldPublicOnly', 'pub'],
  ['bldReligious', 'rel'],
  ['bldOther', 'oth']
];

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
  legendLayers: {
    trTramTrack: ['cy-tram', 'cy-tram-glow'],
    trTramStop: ['cy-stops', 'cy-stop-glow', 'cy-stop-halo', 'cy-stop-labels'],
    trCycleway: ['cy-cycle', 'cy-cycle-glow']
  },
  layers: (ctx, tools) => {
    const c = cyberColors(ctx, tools);
    const bg = c('bg');
    const groups = new Map<CyberRole, string[]>();
    for (const [cls, role] of Object.entries(CYBER_BUILDING_ROLE)) groups.set(role, [...(groups.get(role) ?? []), cls]);
    const classColor: unknown[] = ['match', ['get', 'class']];
    for (const [role, classes] of groups) classColor.push(classes, glowByHeight(c(role), bg));
    classColor.push(glowByHeight(c('oth'), bg));
    const min = ctx.params.cyberMinLevels;
    const cyFilter = allOf(
      min > 0 ? (['>=', LEVELS_EXPR, min] as Expr) : null,
      excludeValues('class', hiddenValues(ctx, 'cyberpunk', CYBER_LEGEND, CYBER_BUILDING_ROLE))
    );

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
        ...(cyFilter ? { filter: cyFilter } : {}),
        paint: {
          'fill-extrusion-color': cyberHighlight(classColor as Expr, c),
          'fill-extrusion-height': HEIGHT_EXPR,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true
        }
      },
      {
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
          'circle-stroke-opacity': 0.45,
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
  return Object.values(VIEWS).flatMap(view => {
    const off = new Set([
      ...Object.entries(view.legendLayers ?? {})
        .filter(([key]) => isHidden(ctx, view.id, key as LegendLabelKey))
        .flatMap(([, ids]) => ids ?? []),
      ...(view.modeHidden?.(ctx) ?? [])
    ]);
    return view.layers(ctx, tools).map(layer => withVisibility(layer, view.id === ctx.view && !off.has(layer.id)));
  });
}

/** Inverts a `value → slot` map into `[values[], colour]` groups for `matchGroups`, resolving each slot's token. */
function slotGroups(map: Record<string, CategoricalSlot>, ctx: StyleContext, tools: StyleTools): [string[], string][] {
  const bySlot = new Map<CategoricalSlot, string[]>();
  for (const [key, slot] of Object.entries(map)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), key]);
  return [...bySlot.entries()].map(([slot, values]) => [values, tools.color(categoricalToken(slot, ctx.mode))]);
}
