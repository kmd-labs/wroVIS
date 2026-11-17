import type { CyberPalette } from '../core/map/map.types';

/**
 * Colour roles of the neon (CyberPunk) view. Each role resolves to the design token
 * `--color-cy-<palette>-<role>`, defined once in `styles.scss`. The view is always dark,
 * independent of the Light / Midnight theme, so the tokens do not change with `data-theme`.
 */
export type CyberRole =
  | 'bg'
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
  | 'select';

export function cyberToken(palette: CyberPalette, role: CyberRole): string {
  return `cy-${palette}-${role}`;
}

/** Building classes emitted by the pipeline (`class` property) mapped to the six neon category roles. */
export const CYBER_BUILDING_ROLE: Record<string, CyberRole> = {
  residential: 'res',
  commercial: 'com',
  industrial: 'ind',
  utility: 'ind',
  public: 'pub',
  religious: 'rel',
  other: 'oth'
};
