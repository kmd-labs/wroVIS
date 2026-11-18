import { MAP_FONT_BOLD, MAP_FONT_ITALIC, MAP_FONT_REGULAR } from './map.config';
import type { StyleContext } from './map.types';
import type { StyleTools } from './style.expr';
import { cyberToken, type CyberRole } from '../../shared/cyber-palette';

/**
 * Look of one kind of place label. Only Noto Sans Regular, Bold and Italic exist as map glyphs (OpenFreeMap),
 * so each palette expresses its character through case, letter spacing, weight, colour and glow.
 */
export interface LabelLook {
  font: string[];
  transform: 'none' | 'uppercase';
  spacing: number;
  color: string;
  halo: string;
  haloWidth: number;
  haloBlur: number;
}

/** Label looks of the palette: the city name, district names, and minor place names (suburbs, neighbourhoods). */
export interface LabelLooks {
  city: LabelLook;
  district: LabelLook;
  minor: LabelLook;
}

/** `#rrggbb` or `rgb(r, g, b)` with an alpha, for soft glows. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map(v => v.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function labelLooks(ctx: Pick<StyleContext, 'palette'>, tools: StyleTools): LabelLooks {
  if (ctx.palette === 'neon') {
    // Neon signage: capitals, wide tracking, a white core with a coloured glow around it.
    const c = (role: CyberRole) => tools.color(cyberToken(role, 'neon'));
    return {
      city: { font: MAP_FONT_BOLD, transform: 'uppercase', spacing: 0.28, color: c('hover'), halo: withAlpha(c('tram'), 0.6), haloWidth: 2.6, haloBlur: 2.2 },
      district: { font: MAP_FONT_BOLD, transform: 'uppercase', spacing: 0.16, color: c('hover'), halo: withAlpha(c('outline'), 0.55), haloWidth: 2, haloBlur: 1.8 },
      minor: { font: MAP_FONT_REGULAR, transform: 'uppercase', spacing: 0.12, color: withAlpha(c('hover'), 0.7), halo: withAlpha(c('bg'), 0.9), haloWidth: 1.2, haloBlur: 0.5 }
    };
  }
  if (ctx.palette === 'sunset') {
    // Holiday postcard: the city in widely tracked hot-pink capitals, districts in plum italics, cream outlines.
    const c = (role: CyberRole) => tools.color(cyberToken(role, 'sunset'));
    return {
      city: { font: MAP_FONT_BOLD, transform: 'uppercase', spacing: 0.32, color: c('select'), halo: c('panel'), haloWidth: 2.2, haloBlur: 0.4 },
      district: { font: MAP_FONT_ITALIC, transform: 'none', spacing: 0.05, color: c('hover'), halo: withAlpha(c('panel'), 0.95), haloWidth: 1.6, haloBlur: 0.3 },
      minor: { font: MAP_FONT_ITALIC, transform: 'none', spacing: 0.04, color: withAlpha(c('hover'), 0.75), halo: withAlpha(c('panel'), 0.9), haloWidth: 1.2, haloBlur: 0.3 }
    };
  }
  // Regular KMD map: as before (bold city, uppercase tracked minor places, bold district names).
  const halo = tools.color('map-bg');
  return {
    city: { font: MAP_FONT_BOLD, transform: 'none', spacing: 0, color: tools.color('text-bright'), halo, haloWidth: 1.3, haloBlur: 0 },
    district: { font: MAP_FONT_BOLD, transform: 'none', spacing: 0, color: tools.color('text-bright'), halo, haloWidth: 1.4, haloBlur: 0 },
    minor: { font: MAP_FONT_REGULAR, transform: 'uppercase', spacing: 0.08, color: tools.color('text-main'), halo, haloWidth: 1.3, haloBlur: 0 }
  };
}
