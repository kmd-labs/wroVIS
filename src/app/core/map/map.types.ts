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
export type DistrictMetric = 'buildings_per_km2' | 'buildings' | 'poi_per_km2' | 'green_pct' | 'tram_stops';

/** Per-view parameters driven by the bottom dock. */
export interface ViewParams {
  /** Minimum number of storeys a building needs to stay visible. */
  buildingsMinLevels: number;
  /** Minimum bridge length in metres. */
  bridgesMinLength: number;
  /** Walking radius around tram stops in metres. */
  transitRadius: number;
  /** Districts at or above this metric value are highlighted. */
  districtsThreshold: number;
  districtsMetric: DistrictMetric;
  /** Minimum number of storeys a building needs to stay visible in the neon view. */
  cyberMinLevels: number;
  cyberPalette: CyberPalette;
}

export const DEFAULT_VIEW_PARAMS: ViewParams = {
  buildingsMinLevels: 0,
  bridgesMinLength: 0,
  transitRadius: 400,
  districtsThreshold: 0,
  districtsMetric: 'buildings_per_km2',
  cyberMinLevels: 0,
  cyberPalette: 'neon'
};

/** Everything the style builder needs to produce the complete current map style. */
export interface StyleContext {
  mode: ThemeMode;
  lang: Lang;
  view: ViewId;
  params: ViewParams;
  stats: CityStats | null;
}

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
  unit: 'levels' | 'meters' | 'none';
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
  | 'trWalkRadius';

export interface LegendCategory {
  /** i18n key of the label. */
  labelKey: LegendLabelKey;
  /** Design token (`--color-<token>`) of the swatch. */
  token: string;
  shape?: 'fill' | 'line' | 'dash' | 'point';
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
}
