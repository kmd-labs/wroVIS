import type { ThemeMode } from '@kmd/design-system';
import type { Lang } from '../i18n/i18n.types';
import type { CityStats } from '../data/stats.model';

/**
 * Thematic layer groups of the single 3D map, switched on and off in the left dock.
 * The former views (3D buildings, bridges, transport, districts) are now layers drawn together.
 */
export type LayerId = 'buildings' | 'trams' | 'stopRadius' | 'cycleways' | 'bridges' | 'districts';

/** Dock order of the layer groups (also their draw order inside each slot). */
export const LAYER_IDS: readonly LayerId[] = ['buildings', 'trams', 'stopRadius', 'cycleways', 'bridges', 'districts'];

/** Layers switched on at the first visit. */
export const DEFAULT_LAYERS: readonly LayerId[] = ['buildings'];

/** Map palette, switched from the header pill: the regular KMD map, the neon night map or the golden-hour "Sunset" map. */
export type Palette = 'normal' | 'neon' | 'sunset';

export const PALETTES: readonly Palette[] = ['normal', 'neon', 'sunset'];

/** What a click on the map does: inspect features, the "15-minute city" tools, or the bike route planner. */
export type Tool = 'explore' | 'walk' | 'bike';

export const TOOLS: readonly Tool[] = ['explore', 'walk', 'bike'];

/** "15-minute city" sub-mode: walking reach from a point, or the shortest walking route between points. */
export type WalkMode = 'reach' | 'route';

/** Bike routing: via streets (with a preference for cycle infrastructure) or strictly along cycleways. */
export type BikeMode = 'streets' | 'cycleways';

export const BIKE_MODES: readonly BikeMode[] = ['streets', 'cycleways'];

/** Network the route planner runs on: the pedestrian graph, or one of the two bike graphs. */
export type RouteProfile = 'walk' | 'bikeStreets' | 'bikeCycleways';

/** Choropleth metrics of the districts layer (numeric keys of `DistrictStats`). */
export type DistrictMetric =
  | 'buildings_per_km2'
  | 'buildings'
  | 'poi_per_km2'
  | 'green_pct'
  | 'tram_stops'
  | 'streets_km_per_km2'
  | 'tram_street_pct'
  | 'pedestrian_km'
  | 'slow_street_pct'
  | 'area_km2'
  | 'poi'
  | 'water_pct'
  | 'bridges'
  | 'levels_mean'
  | 'max_height_m'
  | 'streets_km';

/** Display unit and precision of each district metric (slider readout, legend, details). */
export const METRIC_FORMAT: Record<DistrictMetric, { unit: '' | '%' | 'km' | 'km/km²' | 'km²' | 'm'; digits: number }> = {
  area_km2: { unit: 'km²', digits: 1 },
  poi: { unit: '', digits: 0 },
  water_pct: { unit: '%', digits: 1 },
  bridges: { unit: '', digits: 0 },
  levels_mean: { unit: '', digits: 1 },
  max_height_m: { unit: 'm', digits: 0 },
  streets_km: { unit: 'km', digits: 1 },
  buildings_per_km2: { unit: '', digits: 0 },
  buildings: { unit: '', digits: 0 },
  poi_per_km2: { unit: '', digits: 0 },
  green_pct: { unit: '%', digits: 1 },
  tram_stops: { unit: '', digits: 0 },
  streets_km_per_km2: { unit: 'km/km²', digits: 1 },
  tram_street_pct: { unit: '%', digits: 1 },
  pedestrian_km: { unit: 'km', digits: 1 },
  slow_street_pct: { unit: '%', digits: 1 }
};

/** Parameters driven by the dock sliders and selectors. */
export interface MapParams {
  /** Walking radius around tram stops in metres. */
  transitRadius: number;
  /** Districts at or above this metric value are highlighted. */
  districtsThreshold: number;
  districtsMetric: DistrictMetric;
  /** Walking time limit of the "15-minute city" reach, minutes. */
  walkMinutes: number;
}

export const DEFAULT_PARAMS: MapParams = {
  transitRadius: 400,
  districtsThreshold: 0,
  districtsMetric: 'buildings_per_km2',
  walkMinutes: 15
};

/** Everything the style builder needs to produce the complete current map style. */
export interface StyleContext {
  mode: ThemeMode;
  lang: Lang;
  palette: Palette;
  /** Layer groups switched on in the dock. */
  layers: ReadonlySet<LayerId>;
  tool: Tool;
  walkMode: WalkMode;
  params: MapParams;
  stats: CityStats | null;
  /** Legend entries switched off by the user, as `group:labelKey`. */
  hidden: ReadonlySet<string>;
  /** A walking reach is shown (reach tool and a point clicked): buildings outside it are greyed out. */
  walkActive: boolean;
  /** Street picked in the address search (OSM name), highlighted on the map; null when none. */
  searchStreet: string | null;
}

/** Numeric parameters a dock slider can drive. */
export type SliderParam = Exclude<keyof MapParams, 'districtsMetric'>;

/** Declarative description of a dock slider. */
export interface SliderSpec {
  param: SliderParam;
  min: number;
  max: number;
  step: number;
  presets: number[];
  /** Unit of the readout, resolved to an i18n label by the dock. */
  unit: 'meters' | 'minutes' | 'none';
}

/** Namespace of legend entries: a layer group, or the walking reach / route of the tools. */
export type LegendGroup = LayerId | 'walk' | 'route';

export type LegendLabelKey =
  | 'bldResidential'
  | 'bldCommercial'
  | 'bldPublic'
  | 'bldIndustrial'
  | 'bldOther'
  | 'bldPublicOnly'
  | 'bldReligious'
  | 'brRoad'
  | 'brTram'
  | 'brRail'
  | 'brFoot'
  | 'brOther'
  | 'brWater'
  | 'trTramTrack'
  | 'trTramStop'
  | 'trCycleway'
  | 'trWalkRadius'
  | 'wk5'
  | 'wk10'
  | 'wk15'
  | 'wk20'
  | 'wkPlace'
  | 'wkOrigin'
  | 'wkOutside'
  | 'bkRoute'
  | 'bkStreet'
  | 'bkPoint'
  | 'wrRoute';

export interface LegendCategory {
  /** i18n key of the label. */
  labelKey: LegendLabelKey;
  /** Design token (`--color-<token>`) of the swatch. */
  token: string;
  shape?: 'fill' | 'line' | 'dash' | 'point';
  /** Shown but not switchable (e.g. "outside the reach", which depends on feature state). */
  fixed?: boolean;
}

export type LegendSpec =
  | { kind: 'categorical'; items: LegendCategory[]; /** Two-column layout for long legends. */ wide?: boolean }
  | { kind: 'ordinal'; tokens: string[]; low: number; high: number; metric: DistrictMetric };

/** Camera preset of the single map. */
export interface CameraSpec {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** A thematic feature under the pointer or clicked by the user. */
export interface PickedFeature {
  /** Style layer id the feature was rendered by. */
  layerId: string;
  /** MapLibre source id and (for vector sources) source-layer, needed for `feature-state`. */
  source: string;
  sourceLayer?: string;
  /** Feature id (stable OSM-derived id in tiles, generated id in GeoJSON sources). */
  id: number | string;
  properties: Record<string, unknown>;
  /** Pointer position in container pixels. */
  x: number;
  y: number;
  /** Geographic position of the pointer, so overlays can stay pinned while the camera moves. */
  lngLat: [number, number];
}
