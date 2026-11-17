import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Lang } from '../i18n/i18n.types';
import { WROCLAW_LAT } from './map.config';

/** Shorthand for MapLibre expressions; literal arrays need the cast because TS infers `string[]`. */
export type Expr = ExpressionSpecification;

/**
 * Design-token accessors handed to the style builders. Colours are CSS strings read from
 * `--color-<token>` on `:root`, opacities are numbers read from `--opacity-<token>`.
 */
export interface StyleTools {
  color: (token: string) => string;
  opacity: (token: string) => number;
}

export const HOVER: Expr = ['boolean', ['feature-state', 'hover'], false];
export const SELECTED: Expr = ['boolean', ['feature-state', 'selected'], false];
/** Set on a district while its row in the ranking panel is hovered or focused. */
export const LIST_HOVER: Expr = ['boolean', ['feature-state', 'listHover'], false];

/** Wraps a base colour so selected features turn accent and hovered features turn the cool highlight. */
export function highlight(base: Expr | string, tools: StyleTools): Expr {
  return ['case', SELECTED, tools.color('accent'), HOVER, tools.color('cool'), base];
}

/** Localised OSM name: `name:<lang>` with a fallback to `name`. */
export function nameField(lang: Lang): Expr {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
}

/** Zoom-interpolated number with an exponential base (1 = linear). */
export function byZoom(stops: [number, number | Expr][], base = 1.5): Expr {
  const expr: unknown[] = ['interpolate', base === 1 ? ['linear'] : ['exponential', base], ['zoom']];
  for (const [z, v] of stops) expr.push(z, v);
  return expr as Expr;
}

/** Metres per screen pixel at zoom 0 for Wrocław's latitude (MapLibre world = 512 px at z0). */
const METERS_PER_PX_Z0 = (40075016.686 * Math.cos((WROCLAW_LAT * Math.PI) / 180)) / 512;

/** Circle radius expression that keeps a true ground distance (metres) at every zoom. */
export function metersToPixels(meters: number): Expr {
  return ['interpolate', ['exponential', 2], ['zoom'], 0, meters / METERS_PER_PX_Z0, 22, (meters * 2 ** 22) / METERS_PER_PX_Z0];
}

/** `match` on a string property: each group of values maps to one output, the rest to `fallback`. */
export function matchGroups(prop: string, groups: [string[], string][], fallback: string): Expr {
  const expr: unknown[] = ['match', ['get', prop]];
  for (const [values, output] of groups) expr.push(values, output);
  expr.push(fallback);
  return expr as unknown as Expr;
}

export function geometryIs(type: 'Polygon' | 'LineString' | 'Point'): Expr {
  const types = type === 'Polygon' ? ['Polygon', 'MultiPolygon'] : type === 'LineString' ? ['LineString', 'MultiLineString'] : ['Point', 'MultiPoint'];
  return ['match', ['geometry-type'], types, true, false];
}

/** Returns a copy of the layer with its layout visibility set. */
export function withVisibility<T extends LayerSpecification>(layer: T, visible: boolean): T {
  const layout = { ...('layout' in layer && layer.layout ? layer.layout : {}), visibility: visible ? 'visible' : 'none' };
  return { ...layer, layout } as T;
}
