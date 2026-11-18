import { NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, BookOpen, ChevronDown, Footprints, Globe, ListOrdered, MousePointerClick, Bike, Trash2, Undo2 } from 'lucide-angular';
import {
  BrandComponent,
  ButtonComponent,
  DropdownComponent,
  DropdownOption,
  PopupComponent,
  PopupService,
  SplashComponent,
  SplashService,
  AboutService,
  ThemeService,
  TimelineMarker,
  TimelineSliderComponent,
  TooltipComponent,
  BreakpointService,
  SeoService,
  SwitcherComponent,
  SwitcherOption,
  ToggleComponent
} from '@kmd/design-system';
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import { I18nService } from './core/i18n/i18n.service';
import { Dict, Lang } from './core/i18n/i18n.types';
import { DataService } from './core/data/data.service';
import { MapStageComponent } from './core/map/map-stage.component';
import { MapService } from './core/map/map.service';
import { DISTRICT_METRICS, GROUPS, routeLegend, walkLegend } from './core/map/layers.registry';
import { SRC_SEARCH } from './core/map/map.config';
import { liveSourceData } from './core/map/live-sources';
import {
  BikeMode,
  DistrictMetric,
  LAYER_IDS,
  LayerId,
  LegendSpec,
  METRIC_FORMAT,
  Palette,
  SliderParam,
  SliderSpec,
  StyleContext,
  Tool,
  WalkMode
} from './core/map/map.types';
import { AppState } from './core/state/app.state';
import { MapTooltipComponent } from './features/inspector/map-tooltip.component';
import { LegendComponent, METRIC_LABEL } from './shared/legend/legend.component';
import { CyberScanCardComponent } from './features/inspector/cyber-scan-card.component';
import { cyberToken, CyberRole, styledPalette } from './shared/cyber-palette';
import { DistrictRankingComponent } from './features/districts/district-ranking.component';
import { AddressSearchComponent, PickedAddress, PickedStreet } from './features/search/address-search.component';
import { WalkService } from './core/walk/walk.service';
import { RouteService, pointLabel } from './core/route/route.service';
import type { PlaceCat } from './core/walk/walk-graph';

const PLACE_LABEL: Record<PlaceCat, keyof Dict> = {
  shop: 'placeShop',
  food: 'placeFood',
  education: 'placeEducation',
  health: 'placeHealth',
  culture: 'placeCulture',
  services: 'placeServices',
  tram: 'placeTram',
  park: 'placePark'
};

const LAYER_LABEL: Record<LayerId, { title: keyof Dict; hint: keyof Dict }> = {
  buildings: { title: 'layerBuildings', hint: 'layerBuildingsHint' },
  trams: { title: 'layerTrams', hint: 'layerTramsHint' },
  stopRadius: { title: 'layerStopRadius', hint: 'layerStopRadiusHint' },
  cycleways: { title: 'layerCycleways', hint: 'layerCyclewaysHint' },
  bridges: { title: 'layerBridges', hint: 'layerBridgesHint' },
  districts: { title: 'layerDistricts', hint: 'layerDistrictsHint' }
};

const SLIDER_LABEL: Record<SliderParam, keyof Dict> = {
  transitRadius: 'sliderTransitRadius',
  districtsThreshold: 'sliderDistrictsThreshold',
  walkMinutes: 'sliderWalkMinutes'
};

/** Everything the dock needs to draw one slider. */
interface SliderView {
  spec: SliderSpec;
  value: number;
  label: string;
  readout: string;
  markers: TimelineMarker[];
}

/** One row of the layer list: the switch, and while it is on its slider and legend. */
interface LayerRow {
  id: LayerId;
  title: string;
  hint: string;
  on: boolean;
  /** On and unfolded: its slider and legend are shown. */
  expanded: boolean;
  slider: SliderView | null;
  legend: LegendSpec | null;
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    BrandComponent,
    ButtonComponent,
    DropdownComponent,
    PopupComponent,
    SplashComponent,
    TimelineSliderComponent,
    TooltipComponent,
    MapStageComponent,
    MapTooltipComponent,
    LegendComponent,
    SwitcherComponent,
    ToggleComponent,
    CyberScanCardComponent,
    DistrictRankingComponent,
    AddressSearchComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly bp = inject(BreakpointService);
  readonly popup = inject(PopupService);
  readonly about = inject(AboutService);
  readonly splash = inject(SplashService);
  readonly seo = inject(SeoService);
  readonly theme = inject(ThemeService);
  readonly mapService = inject(MapService);
  readonly data = inject(DataService);
  readonly state = inject(AppState);
  readonly walk = inject(WalkService);
  readonly route = inject(RouteService);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly rankingIcon = ListOrdered;
  readonly undoIcon = Undo2;
  readonly clearIcon = Trash2;
  readonly chevronIcon = ChevronDown;
  readonly groupIcon = (id: LayerId) => GROUPS[id].icon;

  private readonly header = viewChild.required<ElementRef<HTMLElement>>('header');
  private readonly dock = viewChild.required<ElementRef<HTMLElement>>('dock');
  private resizeObserver: ResizeObserver | null = null;

  /** Phones: the dock is a bottom sheet that can be folded down to its search row (folded at start, so the map shows). */
  readonly dockOpen = signal(!this.bp.mobile());

  /** Neutral slider rail (the design-system default gradient is the SST thermal scale). */
  readonly sliderRail = 'var(--color-surface-muted-strong)';

  constructor() {
    this.data.load();

    // SEO metadata follows the active language.
    effect(() => {
      const t = this.i18n.t();
      this.seo.update({
        title: t.docTitle,
        description: t.docDescription,
        image: 'assets/design-system/og-image.png',
        currentLang: this.i18n.lang(),
        supportedLangs: this.i18n.langs
      });
    });

    // Styled palettes (neon, sunset): HUD panels with `.palette-glass` read these from :root.
    effect(() => {
      const styled = this.state.palette() !== 'normal';
      const root = document.documentElement.style;
      const vars: [string, CyberRole][] = [['--neon-accent', 'outline'], ['--neon-hl', 'select'], ['--neon-bg', 'panel'], ['--neon-ink', 'hover']];
      for (const [name, role] of vars) {
        if (styled) root.setProperty(name, this.cyberVar(role));
        else root.removeProperty(name);
      }
    });

    // Intro flight over the city as the splash fades out (once).
    effect(() => {
      if (this.mapService.status() === 'ready' && (this.splash.fading() || !this.splash.visible())) this.mapService.playIntro();
    });

    // Splash: basemap first, then data; fade out once the brand reveal finished and the map rendered its first frame.
    effect(() => {
      const t = this.i18n.t();
      const map = this.mapService.status();
      const data = this.data.status();
      if (map === 'error') {
        this.splash.setError(t.splashMapError);
      } else if (map === 'ready' && (data === 'ready' || data === 'error')) {
        this.splash.setProgress(100, t.splashReady);
      } else if (map === 'ready') {
        this.splash.setProgress(70, t.splashLoadingData);
      } else {
        this.splash.setProgress(data === 'ready' ? 45 : 20, t.splashLoadingMap);
      }
      // On a map error the splash stays up with the message; stats failing is non-fatal.
      const finished = map === 'ready' && (data === 'ready' || data === 'error');
      if (this.splash.revealed() && finished) {
        this.splash.finish();
      }
    });
  }

  // ─── Header ───────────────────────────────────────────────────────────────

  readonly langOptions = computed<DropdownOption<Lang>[]>(() =>
    this.i18n.langs.map(l => ({
      value: l,
      label: this.i18n.dicts[l].langName,
      shortLabel: l.toUpperCase(),
      badge: l.toUpperCase()
    }))
  );

  readonly paletteOptions = computed<SwitcherOption<Palette>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'normal', label: t.paletteNormal, tooltip: t.paletteNormalHint },
      { value: 'neon', label: t.paletteNeon, tooltip: t.paletteNeonHint },
      { value: 'sunset', label: t.paletteSunset, tooltip: t.paletteSunsetHint }
    ];
  });

  onPalette(palette: Palette | undefined) {
    if (palette) this.state.setPalette(palette);
  }

  readonly isPopupOpen = computed(() => this.popup.config() !== null);

  // ─── Dock: tools ──────────────────────────────────────────────────────────

  private readonly styleCtx = computed<StyleContext>(() => ({
    mode: this.theme.mode(),
    lang: this.i18n.lang(),
    palette: this.state.palette(),
    layers: this.state.layers(),
    tool: this.state.tool(),
    walkMode: this.state.walkMode(),
    params: this.state.params(),
    stats: this.data.stats(),
    hidden: this.state.hiddenLegend(),
    walkActive: this.state.walkActive(),
    searchStreet: this.state.searchStreet()
  }));

  readonly toolOptions = computed<SwitcherOption<Tool>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'explore', label: t.toolExplore, icon: MousePointerClick, tooltip: t.toolExploreHint },
      { value: 'walk', label: t.toolWalk, icon: Footprints, tooltip: t.toolWalkHint },
      { value: 'bike', label: t.toolBike, icon: Bike, tooltip: t.toolBikeHint }
    ];
  });

  readonly walkModeOptions = computed<SwitcherOption<WalkMode>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'reach', label: t.walkModeReach },
      { value: 'route', label: t.walkModeRoute }
    ];
  });

  readonly bikeModeOptions = computed<SwitcherOption<BikeMode>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'streets', label: t.bikeModeStreets, tooltip: t.bikeModeStreetsHint },
      { value: 'cycleways', label: t.bikeModeCycleways, tooltip: t.bikeModeCyclewaysHint }
    ];
  });

  onTool(tool: Tool | undefined) {
    if (tool) this.state.setTool(tool);
  }

  onWalkMode(mode: WalkMode | undefined) {
    if (mode) this.state.setWalkMode(mode);
  }

  onBikeMode(mode: BikeMode | undefined) {
    if (mode) this.state.setBikeMode(mode);
  }

  readonly isWalkReach = computed(() => this.state.tool() === 'walk' && this.state.walkMode() === 'reach');
  readonly isRoute = computed(() => this.state.routeProfile() !== null);

  readonly walkSlider = computed(() => this.sliderView({ param: 'walkMinutes', min: 5, max: 20, step: 5, presets: [5, 10, 15, 20], unit: 'minutes' }));
  readonly walkLegendSpec = computed(() => walkLegend(this.styleCtx()));

  /** Place counts in reach, with localised labels and the nearest place of each kind. */
  readonly walkStats = computed(() => {
    const stats = this.walk.stats();
    if (!stats) return null;
    const t = this.i18n.t();
    const nf = new Intl.NumberFormat(this.i18n.lang());
    const mf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 0 });
    return stats.map(s => ({
      cat: s.cat,
      label: t[PLACE_LABEL[s.cat]],
      count: nf.format(s.count),
      nearest: s.nearest === null ? t.walkNone : `${t.walkNearest} ${mf.format(Math.max(1, Math.round(s.nearest)))} ${t.unitMinutes}`,
      empty: s.count === 0
    }));
  });

  readonly routeLegendSpec = computed(() => {
    const profile = this.state.routeProfile();
    return profile ? routeLegend(profile, this.styleCtx()) : null;
  });

  readonly routeHint = computed(() => {
    const t = this.i18n.t();
    const profile = this.state.routeProfile();
    return profile === 'walk' ? t.routeHintWalk : profile === 'bikeStreets' ? t.routeHintBikeStreets : t.routeHintBikeCycleways;
  });

  readonly routeLoadingLabel = computed(() => {
    const t = this.i18n.t();
    const profile = this.state.routeProfile();
    return profile === 'walk' ? t.routeLoadingWalk : profile === 'bikeStreets' ? t.routeLoadingBike : t.bikeLoading;
  });

  /** Legs of the route with letters and distances for the dock. */
  readonly routeLegs = computed(() => {
    const t = this.i18n.t();
    const km = this.kmFormat();
    const strict = this.state.routeProfile() === 'bikeCycleways';
    return this.route.legs().map((leg, i) => ({
      label: `${pointLabel(i)} → ${pointLabel(i + 1)}`,
      value: leg.metres === null ? (strict ? t.bikeNoLink : t.routeNoLink) : `${km.format(leg.metres / 1000)} ${t.unitKm}`,
      broken: leg.metres === null
    }));
  });

  readonly routeTotal = computed(() => {
    const t = this.i18n.t();
    const s = this.route.summary();
    const profile = this.state.routeProfile();
    const mf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 0 });
    const km = this.kmFormat();
    return {
      km: `${km.format(s.metres / 1000)} ${t.unitKm}`,
      caption: profile === 'walk' ? t.routeWalkTotal : profile === 'bikeCycleways' ? t.bikeTotal : t.routeBikeTotal,
      time: `${mf.format(Math.max(1, Math.round(s.minutes)))} ${profile === 'walk' ? t.routeTimeWalk : t.routeTimeBike}`,
      split:
        profile === 'bikeStreets' && s.metres > 0
          ? `${km.format(s.cycleMetres / 1000)} ${t.unitKm} ${t.bikeOnCycleways} · ${km.format(s.streetMetres / 1000)} ${t.unitKm} ${t.bikeOnStreets}`
          : null
    };
  });

  private kmFormat() {
    return new Intl.NumberFormat(this.i18n.lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── Dock: address search ────────────────────────────────────────────────

  /** A picked address acts in the active tool: start of the reach, next route point, or the building's card. */
  async onAddress(address: PickedAddress) {
    this.state.searchStreet.set(null);
    this.setSearchPoint(address.lngLat);
    const tool = this.state.tool();
    if (this.state.routeProfile() !== null) {
      this.route.add(address.lngLat);
      // Frame the whole route (all waypoints), not only the new point.
      this.mapService.fitPoints(this.state.routePoints());
      return;
    }
    if (tool === 'walk') this.state.walkOrigin.set(address.lngLat);
    if (this.bp.mobile()) this.dockOpen.set(false);
    await this.mapService.flyToPoint(address.lngLat);
    const building = this.mapService.buildingAt(address.lngLat);
    this.state.selected.set(building);
  }

  /** A whole street: frame it and let its line pulse a few times (see MapService.pulseStreet). */
  onStreet(street: PickedStreet) {
    this.setSearchPoint(null);
    this.state.selected.set(null);
    this.state.searchStreet.set(street.name);
    if (this.bp.mobile()) this.dockOpen.set(false);
    this.mapService.fitStreet(street.bounds);
  }

  onSearchCleared() {
    this.setSearchPoint(null);
    this.state.searchStreet.set(null);
  }

  private setSearchPoint(lngLat: [number, number] | null) {
    this.state.searchPoint.set(lngLat);
    const fc: FeatureCollection = lngLat ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat }, properties: {} }] } : EMPTY_FC;
    liveSourceData.set(SRC_SEARCH, fc);
    (this.mapService.instance?.getSource(SRC_SEARCH) as GeoJSONSource | undefined)?.setData(fc);
  }

  // ─── Dock: layers ─────────────────────────────────────────────────────────

  /** Layers folded in the dock (still on, slider and legend hidden). */
  readonly folded = signal<ReadonlySet<LayerId>>(new Set());

  readonly layerRows = computed<LayerRow[]>(() => {
    const t = this.i18n.t();
    const ctx = this.styleCtx();
    const folded = this.folded();
    return LAYER_IDS.map(id => {
      const group = GROUPS[id];
      const on = ctx.layers.has(id);
      const expanded = on && !folded.has(id);
      const spec = expanded ? (group.slider?.(ctx) ?? null) : null;
      return {
        id,
        title: t[LAYER_LABEL[id].title],
        hint: t[LAYER_LABEL[id].hint],
        on,
        expanded,
        slider: spec ? this.sliderView(spec) : null,
        legend: expanded ? (group.legend?.(ctx) ?? null) : null
      };
    });
  });

  /** A layer switched on unfolds and the others fold, so its controls are in view without scrolling the dock. */
  onLayer(id: LayerId, on: boolean) {
    this.state.setLayer(id, on);
    if (on) this.folded.set(new Set(LAYER_IDS.filter(l => l !== id)));
  }

  toggleExpanded(id: LayerId) {
    this.folded.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  readonly metricOptions = computed<DropdownOption<DistrictMetric>[]>(() => {
    const t = this.i18n.t();
    return DISTRICT_METRICS.map(m => ({ value: m, label: t[METRIC_LABEL[m]] }));
  });

  onMetricChange(metric: DistrictMetric) {
    this.state.setDistrictMetric(metric);
  }

  // ─── Sliders ──────────────────────────────────────────────────────────────

  private sliderView(spec: SliderSpec): SliderView {
    const raw = this.state.params()[spec.param];
    const value = Math.min(spec.max, Math.max(spec.min, raw));
    // The district threshold reads "all" at the start of the slider.
    const neutral = spec.param === 'districtsThreshold' && value === spec.min;
    const readout = neutral ? this.i18n.t().presetAll : this.formatValue(value, spec.param);
    return {
      spec,
      value,
      label: this.i18n.t()[SLIDER_LABEL[spec.param]],
      readout,
      markers: spec.presets.map(v => ({ id: String(v), value: v, label: this.formatValue(v, spec.param, true), active: v === value }))
    };
  }

  onSliderChange(param: SliderParam, value: number) {
    this.state.setParam(param, value);
  }

  onMarkerClick(slider: SliderView, marker: TimelineMarker) {
    const spec = slider.spec;
    // Clicking the active preset again releases it (back to the start of the slider).
    this.state.setParam(spec.param, marker.value === slider.value ? spec.min : marker.value);
  }

  private formatValue(value: number, param: SliderParam, short = false): string {
    const t = this.i18n.t();
    const nf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 1 });
    switch (param) {
      case 'walkMinutes':
        return `${nf.format(value)} ${t.unitMinutes}`;
      case 'transitRadius':
        return `${nf.format(value)} ${t.unitMeters}`;
      case 'districtsThreshold': {
        const unit = METRIC_FORMAT[this.state.params().districtsMetric].unit;
        return unit ? `${nf.format(value)} ${unit}` : nf.format(value);
      }
    }
  }

  // ─── Neon look of the dock ───────────────────────────────────────────────

  /** On the styled maps (neon, sunset) the dock takes the palette's glass look, like the feature card. */
  readonly neonDock = computed(() => this.state.palette() !== 'normal');

  /** CSS reference to a colour role of the active styled palette (`--color-cy-<palette>-<role>`). */
  cyberVar(role: CyberRole): string {
    return `var(--color-${cyberToken(role, styledPalette(this.state.palette()))})`;
  }

  // ─── Glossary ─────────────────────────────────────────────────────────────

  openGlossary() {
    this.popup.open({
      id: 'glossary',
      title: computed(() => this.i18n.t().glossary),
      description: computed(() => {
        const t = this.i18n.t();
        const m = this.data.manifest();
        const date = m?.source.extractLastModified ? new Date(m.source.extractLastModified) : null;
        const extract = date ? ` ${t.dataExtractDate}: ${new Intl.DateTimeFormat(this.i18n.lang(), { dateStyle: 'medium' }).format(date)}.` : '';
        return `${t.glossaryDesc}${extract}`;
      }),
      size: 'md',
      actions: [{ label: computed(() => this.i18n.t().close), variant: 'default' }]
    });
  }

  // ─── HUD padding ──────────────────────────────────────────────────────────

  ngAfterViewInit() {
    const headerEl = this.header().nativeElement;
    const dockEl = this.dock().nativeElement;
    const apply = () => {
      const top = headerEl.getBoundingClientRect().bottom + 12;
      const rect = dockEl.getBoundingClientRect();
      // Phones: the dock is a bottom sheet; wider screens: a column on the left.
      const sheet = rect.left < 16 && rect.width > window.innerWidth * 0.8;
      const bottom = sheet ? window.innerHeight - rect.top + 12 : 12;
      const left = sheet ? 0 : rect.right + 12;
      this.mapService.setHudPadding(Math.round(top), Math.round(bottom), Math.round(left));
      const root = document.documentElement.style;
      root.setProperty('--hud-top', `${Math.round(top)}px`);
      root.setProperty('--hud-bottom', `${Math.round(sheet ? bottom : 12)}px`);
    };
    this.resizeObserver = new ResizeObserver(apply);
    this.resizeObserver.observe(headerEl);
    this.resizeObserver.observe(dockEl);
    window.addEventListener('resize', apply);
    apply();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
}
