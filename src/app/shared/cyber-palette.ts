import type { Palette } from '../core/map/map.types';

/**
 * Styled map palettes: the neon night map and the "Sunset" golden-hour map. They share one set of colour roles;
 * each role resolves to the design token `--color-cy-<palette>-<role>`, defined once in `styles.scss`. Both
 * keep their own look regardless of the Light / Midnight theme, so the tokens do not change with `data-theme`.
 */
export type StyledPalette = Exclude<Palette, 'normal'>;

export type CyberRole =
  | 'bg'
  | 'panel'
  | 'park'
  | 'road'
  | 'road-major'
  | 'water'
  | 'waterway'
  | 'outline'
  | 'res'
  | 'com'
  | 'ind'
  | 'pub'
  | 'rel'
  | 'oth'
  | 'tram'
  | 'cycle'
  | 'stop'
  | 'hover'
  | 'select'
  /** Walking and bike routes. */
  | 'route'
  /** District choropleth, low → high. */
  | 'ramp-1'
  | 'ramp-2'
  | 'ramp-3'
  | 'ramp-4';

export function cyberToken(role: CyberRole, palette: StyledPalette = 'neon'): string {
  return `cy-${palette}-${role}`;
}

/** The styled palette in use, or neon as the default set of roles while the regular map is shown. */
export function styledPalette(palette: Palette): StyledPalette {
  return palette === 'normal' ? 'neon' : palette;
}

/** Look of each styled palette that is not a colour: dark or light base, glow strength. */
export const PALETTE_LOOK: Record<StyledPalette, { dark: boolean; glowOpacity: number; glowFrom: number }> = {
  // Dark night map: strong glow; low houses fade into the background (colour interpolated from −4 m).
  neon: { dark: true, glowOpacity: 0.35, glowFrom: -4 },
  // Light golden-hour map: soft halo; low houses stay pastel (interpolation starts far below ground).
  sunset: { dark: false, glowOpacity: 0.22, glowFrom: -30 }
};

/** Building classes emitted by the pipeline (`class` property) mapped to the six category roles. */
export const CYBER_BUILDING_ROLE: Record<string, CyberRole> = {
  residential: 'res',
  commercial: 'com',
  industrial: 'ind',
  utility: 'ind',
  public: 'pub',
  religious: 'rel',
  other: 'oth'
};

/**
 * Theme tokens that layers shared by every palette (bridges, districts, walking reach, routes, basemap labels)
 * read for casings, halos and highlights, mapped to palette roles: on the neon map a light `map-bg` casing
 * would glare, on the sunset map the casing takes its warm cream.
 */
export const PALETTE_TOKEN_ROLE: Readonly<Record<string, CyberRole>> = {
  'map-bg': 'bg',
  'panel-bg-solid': 'panel',
  'text-main': 'hover',
  'text-bright': 'hover',
  'text-dim': 'oth',
  'line-strong': 'road-major',
  'link-color': 'waterway',
  accent: 'select',
  cool: 'tram'
};
