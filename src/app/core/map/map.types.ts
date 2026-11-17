import type { ThemeMode } from '@kmd/design-system';
import type { Lang } from '../i18n/i18n.types';
import type { CityStats } from '../data/stats.model';

/** Primary visualization modes, switched from the top-right view pill. */
export type ViewId = 'buildings' | 'bridges' | 'transit' | 'districts' | 'cyberpunk';

export const VIEW_IDS: readonly ViewId[] = ['buildings', 'bridges', 'transit', 'districts', 'cyberpunk'];

/** Colour sets of the neon (CyberPunk) view: red & cyan on black, or neon with the KMD orange accent. */
export type CyberPalette = 'neon' | 'kmd';

export const CYBER_PALETTES: readonly CyberPalette[] = ['neon', 'kmd'];

/** Choropleth metrics of the districts view (numeric keys of `DistrictStats`). */
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

/** End of the bridge length slider: "all bridges", including the few longer than this. */
export const BRIDGE_ALL_M = 400;

/** Per-view parameters driven by the bottom dock. */
export interface ViewParams {
  /** Maximum bridge length in metres; at BRIDGE_ALL_M (the end of the slider) every bridge is shown. */
  bridgesMaxLength: number;
  /** Walking radius around tram stops in metres. */
  transitRadius: number;
  /** Districts at or above this metric value are highlighted. */
  districtsThreshold: number;
  districtsMetric: DistrictMetric;
  /** Minimum number of storeys a building needs to stay visible in the neon view. */
  cyberMinLevels: number;
  cyberPalette: CyberPalette;
  /** Walking time limit of the reach shown in the 3D buildings view, minutes. */
  walkMinutes: number;
}

export const DEFAULT_VIEW_PARAMS: ViewParams = {
  bridgesMaxLength: BRIDGE_ALL_M,
  transitRadius: 400,
  districtsThreshold: 0,
  districtsMetric: 'buildings_per_km2',
  cyberMinLevels: 0,
  cyberPalette: 'neon',
  walkMinutes: 15
};

/** Everything the style builder needs to produce the complete current map style. */
export interface StyleContext {
  mode: ThemeMode;
  lang: Lang;
  view: ViewId;
  params: ViewParams;
  stats: CityStats | null;
  /** Legend entries switched off by the user, as `view:labelKey`. */
  hidden: ReadonlySet<string>;
  /** Walking reach switched on in the 3D buildings view. */
  walkEnabled: boolean;
  /** A reach is shown (enabled and a point clicked): buildings outside it are greyed out. */
  walkActive: boolean;
  /** Transport view mode: tram stop walking radius, or the bike route planner. */
  transitMode: TransitMode;
}

export type TransitMode = 'radius' | 'bike';

/** Numeric dock parameters (the slider never drives the metric or palette selectors). */
export type SliderParam = Exclude<keyof ViewParams, 'districtsMetric' | 'cyberPalette'>;

/** Declarative description of the dock slider of a view. */
export interface SliderSpec {
  param: SliderParam;
  min: number;
  max: number;
  step: number;
  presets: number[];
  /** Unit of the readout, resolved to an i18n label by the dock. */
  unit: 'levels' | 'meters' | 'minutes' | 'none';
}

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
  | 'bkPoint';

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

/** Camera preset applied with `easeTo` when a view is entered. */
export interface CameraSpec {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** A thematic feature under the pointer or clicked by the user. */
export interface PickedFeature {
  /** Registry layer id the feature was rendered by. */
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
