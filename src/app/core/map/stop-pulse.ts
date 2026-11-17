import type { Map as MapLibreMap } from 'maplibre-gl';
import { CY_PULSE_LAYER, CY_PULSE_RADIUS } from './layers.registry';
import { byZoom } from './style.expr';

/** One pulse cycle in milliseconds. */
const PERIOD_MS = 1800;
/** Paint updates per second; a smooth ring needs far fewer than the display refresh rate. */
const FPS = 30;
/** The ring grows from 1× to (1 + GROWTH)× its resting radius. */
const GROWTH = 2;

/**
 * Expanding, fading ring around tram stops in the neon view. Drives two paint properties of
 * `cy-stop-pulse` with `setPaintProperty` from a throttled `requestAnimationFrame` loop. A style diff
 * may reset them to the resting frame; the next tick simply overwrites them again.
 */
export class StopPulse {
  private frame = 0;
  private last = 0;

  constructor(private readonly map: MapLibreMap) {}

  get running(): boolean {
    return this.frame !== 0;
  }

  start() {
    if (this.running) return;
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      if (now - this.last < 1000 / FPS) return;
      this.last = now;
      this.paint((now % PERIOD_MS) / PERIOD_MS);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.running) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.paint(1);
  }

  /** `phase` 0 → 1: the ring expands and fades out (phase 1 = invisible resting frame). */
  private paint(phase: number) {
    if (!this.map.getLayer(CY_PULSE_LAYER)) return;
    const eased = 1 - (1 - phase) ** 2;
    const scale = 1 + GROWTH * eased;
    this.map.setPaintProperty(CY_PULSE_LAYER, 'circle-radius', byZoom(CY_PULSE_RADIUS.map(([z, r]) => [z, r * scale] as [number, number]), 1));
    this.map.setPaintProperty(CY_PULSE_LAYER, 'circle-stroke-opacity', 0.85 * (1 - phase));
  }
}
