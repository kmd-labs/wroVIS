import type { ThemeMode } from '@kmd/design-system';

/**
 * Colour scales of the thematic layers, expressed as KMD design-token names (`--color-<token>`).
 * Steps differ per theme so every palette sits inside the dataviz lightness band of its surface
 * (`map-bg`): validated with the dataviz palette validator on 2026-11-16 (light `#e5ecf2`,
 * Midnight `#0f1c31`, all-pairs CVD check). Three hues (orange, blue, green) plus two neutrals is the
 * largest categorical set that passes on a map, so wider classifications are folded into these slots
 * and the exact class is always available in the tooltip and the details popup.
 */

export type CategoricalSlot = 'orange' | 'blue' | 'green' | 'dark' | 'light';

const CATEGORICAL_TOKENS: Record<ThemeMode, Record<CategoricalSlot, string>> = {
  light: { orange: 'warning-600', blue: 'primary-600', green: 'success-700', dark: 'neutral-600', light: 'neutral-400' },
  dark: { orange: 'warning-500', blue: 'primary-500', green: 'success-600', dark: 'neutral-300', light: 'neutral-500' }
};

export function categoricalToken(slot: CategoricalSlot, mode: ThemeMode): string {
  return CATEGORICAL_TOKENS[mode][slot];
}

/** Building classes emitted by the pipeline (`class` property) folded into legend slots. */
export const BUILDING_CLASS_SLOT: Record<string, CategoricalSlot> = {
  residential: 'orange',
  commercial: 'blue',
  public: 'green',
  religious: 'green',
  industrial: 'dark',
  utility: 'dark',
  other: 'light'
};

/** Bridge kinds emitted by the pipeline (`kind` property). */
export const BRIDGE_KIND_SLOT: Record<string, CategoricalSlot> = {
  road: 'blue',
  tram: 'orange',
  foot: 'green',
  rail: 'dark',
  other: 'light'
};

/** One-hue ordinal ramp (4 steps, low → high) for choropleths; the dark ramp runs dim → bright. */
const ORDINAL_TOKENS: Record<ThemeMode, string[]> = {
  light: ['primary-400', 'primary-500', 'primary-600', 'primary-800'],
  dark: ['primary-600', 'primary-500', 'primary-400', 'primary-300']
};

export function ordinalTokens(mode: ThemeMode): string[] {
  return ORDINAL_TOKENS[mode];
}

/** Equal-interval inner class breaks (`classes - 1` values) between `min` and `max`. */
export function equalBreaks(min: number, max: number, classes = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const breaks: number[] = [];
  for (let i = 1; i < classes; i++) breaks.push(min + (span * i) / classes);
  return breaks;
}
