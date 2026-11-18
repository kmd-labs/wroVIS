import { Injectable, computed, signal } from '@angular/core';
import {
  BIKE_MODES,
  BikeMode,
  DEFAULT_LAYERS,
  DEFAULT_PARAMS,
  LAYER_IDS,
  LayerId,
  LegendGroup,
  MapParams,
  PALETTES,
  Palette,
  PickedFeature,
  RouteProfile,
  TOOLS,
  Tool,
  WalkMode
} from '../map/map.types';

const LAYERS_KEY = 'wrovis.layers';
const PALETTE_KEY = 'wrovis.palette';
const TOOL_KEY = 'wrovis.tool';
const BIKE_MODE_KEY = 'wrovis.bikeMode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable
  }
}

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return (values as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/**
 * Application state shared between the header, the dock and the map: enabled layers, palette, active tool,
 * dock parameters, hovered and selected features. Plain signals; the map reacts through effects.
 */
@Injectable({ providedIn: 'root' })
export class AppState {
  readonly layers = signal<ReadonlySet<LayerId>>(this.readLayers());
  readonly palette = signal<Palette>(oneOf(PALETTES, read(PALETTE_KEY), 'normal'));
  readonly tool = signal<Tool>(oneOf(TOOLS, read(TOOL_KEY), 'explore'));
  readonly walkMode = signal<WalkMode>('reach');
  readonly bikeMode = signal<BikeMode>(oneOf(BIKE_MODES, read(BIKE_MODE_KEY), 'streets'));
  readonly params = signal<MapParams>({ ...DEFAULT_PARAMS });

  constructor() {
    // Same rules as `setTool` when the tool is restored from the last visit.
    const tool = this.tool();
    if (tool === 'bike' && !this.layers().has('cycleways')) this.layers.set(new Set([...this.layers(), 'cycleways']));
    if (tool !== 'explore' && this.layers().has('districts')) this.layers.set(new Set([...this.layers()].filter(l => l !== 'districts')));
  }

  readonly hovered = signal<PickedFeature | null>(null);
  readonly selected = signal<PickedFeature | null>(null);

  /** District id highlighted from the ranking panel (hover or keyboard focus on its row). */
  readonly highlightedDistrict = signal<number | null>(null);
  /** Ranking bottom sheet on phones (on wider screens the panel is shown whenever the districts layer is on). */
  readonly rankingSheetOpen = signal(false);

  /** Starting point of the walking reach ([lon, lat]), set by a click or an address search. */
  readonly walkOrigin = signal<[number, number] | null>(null);
  /** True while a reach is shown: reach tool active and a point chosen. */
  readonly walkActive = computed(() => this.tool() === 'walk' && this.walkMode() === 'reach' && this.walkOrigin() !== null);

  /** Waypoints of the walking or bike route ([lon, lat]), in order; shared, so profiles can be compared. */
  readonly routePoints = signal<[number, number][]>([]);
  /** Network the route planner uses, or null when no route tool is active. */
  readonly routeProfile = computed<RouteProfile | null>(() => {
    const tool = this.tool();
    if (tool === 'walk') return this.walkMode() === 'route' ? 'walk' : null;
    if (tool === 'bike') return this.bikeMode() === 'streets' ? 'bikeStreets' : 'bikeCycleways';
    return null;
  });

  /** Position of the last address picked in the search box (a subtle marker on the map). */
  readonly searchPoint = signal<[number, number] | null>(null);
  /** Street picked in the search box (OSM name), highlighted on the map. */
  readonly searchStreet = signal<string | null>(null);

  /** Legend entries switched off by the user, as `group:labelKey`; session only (reset on reload). */
  readonly hiddenLegend = signal<ReadonlySet<string>>(new Set());

  isOn(id: LayerId): boolean {
    return this.layers().has(id);
  }

  setLayer(id: LayerId, on: boolean) {
    const current = this.layers();
    if (current.has(id) === on) return;
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    this.layers.set(next);
    // A feature of a layer that was switched off keeps no card open.
    const sel = this.selected();
    if (!on && sel && layerOfStyleLayer(sel.layerId) === id) this.selected.set(null);
    if (!on && id === 'districts') this.rankingSheetOpen.set(false);
    write(LAYERS_KEY, LAYER_IDS.filter(l => next.has(l)).join(','));
  }

  setPalette(palette: Palette) {
    this.palette.set(palette);
    write(PALETTE_KEY, palette);
  }

  setTool(tool: Tool) {
    if (tool === this.tool()) return;
    this.tool.set(tool);
    this.hovered.set(null);
    this.selected.set(null);
    write(TOOL_KEY, tool);
    // Planning a bike route shows the cycleways it runs on.
    if (tool === 'bike') this.setLayer('cycleways', true);
    // The district choropleth would cover the reach and the routes, so the walking and bike tools switch it off.
    if (tool !== 'explore') this.setLayer('districts', false);
  }

  setWalkMode(mode: WalkMode) {
    this.walkMode.set(mode);
    this.selected.set(null);
  }

  setBikeMode(mode: BikeMode) {
    this.bikeMode.set(mode);
    write(BIKE_MODE_KEY, mode);
  }

  toggleLegend(group: LegendGroup, key: string) {
    const id = `${group}:${key}`;
    this.hiddenLegend.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Switches the choropleth metric; the highlight threshold resets because scales differ between metrics. */
  setDistrictMetric(metric: MapParams['districtsMetric']) {
    if (metric === this.params().districtsMetric) return;
    this.params.update(p => ({ ...p, districtsMetric: metric, districtsThreshold: 0 }));
  }

  setParam<K extends keyof MapParams>(key: K, value: MapParams[K]) {
    this.params.update(p => (p[key] === value ? p : { ...p, [key]: value }));
  }

  private readLayers(): ReadonlySet<LayerId> {
    const stored = read(LAYERS_KEY);
    if (stored === null) return new Set(DEFAULT_LAYERS);
    return new Set(stored.split(',').filter((id): id is LayerId => (LAYER_IDS as readonly string[]).includes(id)));
  }
}

/** Layer group a style layer belongs to, by its id prefix. */
export function layerOfStyleLayer(styleLayerId: string): LayerId | null {
  if (styleLayerId === 'bld-extrusion' || styleLayerId === 'cy-bld') return 'buildings';
  if (styleLayerId.startsWith('tr-stop') || styleLayerId.startsWith('tr-track') || styleLayerId.startsWith('cy-stop') || styleLayerId.startsWith('cy-tram')) return 'trams';
  if (styleLayerId === 'tr-radius') return 'stopRadius';
  if (styleLayerId === 'tr-cycleways' || styleLayerId.startsWith('cy-cycle')) return 'cycleways';
  if (styleLayerId.startsWith('br-')) return 'bridges';
  if (styleLayerId.startsWith('di-')) return 'districts';
  return null;
}
