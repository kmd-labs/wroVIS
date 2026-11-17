import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { LucideAngularModule, Globe, BookOpen, ListOrdered, Trash2, Undo2 } from 'lucide-angular';
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
import { I18nService } from './core/i18n/i18n.service';
import { Dict, Lang } from './core/i18n/i18n.types';
import { DataService } from './core/data/data.service';
import { MapStageComponent } from './core/map/map-stage.component';
import { MapService } from './core/map/map.service';
import { DISTRICT_METRICS, VIEWS } from './core/map/layers.registry';
import { CyberPalette, DistrictMetric, METRIC_FORMAT, SliderParam, StyleContext, VIEW_IDS, ViewId } from './core/map/map.types';
import { AppState } from './core/state/app.state';
import { FeatureDetailsComponent } from './features/inspector/feature-details.component';
import { MapTooltipComponent } from './features/inspector/map-tooltip.component';
import { describeFeature } from './features/inspector/feature-format';
import { LegendComponent, METRIC_LABEL } from './shared/legend/legend.component';
import { CARD_VIEWS, CyberScanCardComponent } from './features/inspector/cyber-scan-card.component';
import { DistrictRankingComponent } from './features/districts/district-ranking.component';
import { WalkService } from './core/walk/walk.service';
import { BikeRouteService, pointLabel } from './core/bike/bike-route.service';
import { BridgeCountService } from './core/data/bridge-count.service';
import type { TransitMode } from './core/map/map.types';
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

const VIEW_LABEL: Record<ViewId, { title: keyof Dict; desc: keyof Dict }> = {
  buildings: { title: 'viewBuildings', desc: 'viewBuildingsDesc' },
  bridges: { title: 'viewBridges', desc: 'viewBridgesDesc' },
  transit: { title: 'viewTransit', desc: 'viewTransitDesc' },
  districts: { title: 'viewDistricts', desc: 'viewDistrictsDesc' },
  cyberpunk: { title: 'viewCyberpunk', desc: 'viewCyberpunkDesc' }
};

const SLIDER_LABEL: Record<SliderParam, keyof Dict> = {
  bridgesMaxLength: 'sliderBridgesMaxLength',
  transitRadius: 'sliderTransitRadius',
  districtsThreshold: 'sliderDistrictsThreshold',
  cyberMinLevels: 'sliderBuildingsMinLevels',
  walkMinutes: 'sliderWalkMinutes'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
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
    DistrictRankingComponent
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
  readonly bike = inject(BikeRouteService);
  private readonly bridgeCount = inject(BridgeCountService);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly rankingIcon = ListOrdered;
  readonly undoIcon = Undo2;
  readonly clearIcon = Trash2;

  private readonly header = viewChild.required<ElementRef<HTMLElement>>('header');
  private readonly dock = viewChild.required<ElementRef<HTMLElement>>('dock');
  private resizeObserver: ResizeObserver | null = null;

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

    // A clicked thematic feature opens the details popup; closing it clears the selection.
    // The neon and 3D buildings views show a card pinned next to the feature instead (FeatureCardComponent).
    effect(() => {
      const pick = this.state.selected();
      if (!pick || CARD_VIEWS.includes(this.state.currentView())) {
        if (this.popup.config()?.id === 'feature') this.popup.close();
        return;
      }
      const t = this.i18n.t();
      const d = describeFeature(pick, t, this.i18n.lang(), this.data.stats());
      this.popup.open({
        id: 'feature',
        title: d.title,
        subtitle: d.subtitle,
        component: FeatureDetailsComponent,
        componentInputs: { rows: d.rows, osmUrl: d.osmUrl, osmLabel: t.openInOsm, wikiUrl: d.wikiUrl ?? null, wikiLabel: t.openInWikipedia },
        size: 'sm',
        actions: [{ label: computed(() => this.i18n.t().close), variant: 'default' }],
        onClose: () => this.state.selected.set(null)
      });
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

  readonly viewOptions = computed<DropdownOption<ViewId>[]>(() => {
    const t = this.i18n.t();
    return VIEW_IDS.map(id => ({ value: id, label: t[VIEW_LABEL[id].title], icon: VIEWS[id].icon }));
  });

  readonly currentViewIcon = computed(() => VIEWS[this.state.currentView()].icon);

  readonly isPopupOpen = computed(() => this.popup.config() !== null);

  // ─── Dock ─────────────────────────────────────────────────────────────────

  private readonly styleCtx = computed<StyleContext>(() => ({
    mode: this.theme.mode(),
    lang: this.i18n.lang(),
    view: this.state.currentView(),
    params: this.state.params(),
    stats: this.data.stats(),
    hidden: this.state.hiddenLegend(),
    walkEnabled: this.state.walkEnabled(),
    walkActive: this.state.walkActive(),
      transitMode: this.state.transitMode()
  }));

  readonly viewTitle = computed(() => this.i18n.t()[VIEW_LABEL[this.state.currentView()].title]);
  readonly viewDesc = computed(() => this.i18n.t()[VIEW_LABEL[this.state.currentView()].desc]);

  readonly slider = computed(() => VIEWS[this.state.currentView()].slider(this.styleCtx()));
  readonly legend = computed(() => VIEWS[this.state.currentView()].legend(this.styleCtx()));
  readonly legendWide = computed(() => {
    const spec = this.legend();
    return spec.kind === 'categorical' && spec.wide === true;
  });

  readonly sliderValue = computed(() => {
    const spec = this.slider();
    const value = this.state.params()[spec.param];
    return Math.min(spec.max, Math.max(spec.min, value));
  });

  readonly sliderLabel = computed(() => this.i18n.t()[SLIDER_LABEL[this.slider().param]]);

  readonly sliderReadout = computed(() => {
    const spec = this.slider();
    const value = this.sliderValue();
    // Filters read "all" at their neutral end: the start for minimum thresholds, the end for the bridge length limit.
    const neutral = spec.param === 'bridgesMaxLength' ? value === spec.max : value === spec.min && spec.param !== 'transitRadius' && spec.param !== 'walkMinutes';
    const base = neutral ? this.i18n.t().presetAll : this.formatValue(value, spec.param);
    if (spec.param === 'bridgesMaxLength') {
      // Bridges visible at this threshold (and legend), counted as bridges and as their segments.
      const c = this.bridgeCount.counts();
      if (c) return `${base} · ${this.countLabel(c.bridges, 'bridge')} · ${this.countLabel(c.segments, 'segment')}`;
    }
    return base;
  });

  /** "1 most / 3 mosty / 12 mostów": Polish plural forms via Intl.PluralRules. */
  private countLabel(n: number, noun: 'bridge' | 'segment'): string {
    const t = this.i18n.t();
    const form = new Intl.PluralRules(this.i18n.lang()).select(n);
    const words = noun === 'bridge' ? { one: t.bridgeOne, few: t.bridgeFew, many: t.bridgeMany } : { one: t.segmentOne, few: t.segmentFew, many: t.segmentMany };
    const word = form === 'one' ? words.one : form === 'few' ? words.few : words.many;
    return `${new Intl.NumberFormat(this.i18n.lang()).format(n)} ${word}`;
  }

  // ─── Transport: bike route planner ───────────────────────────────────────

  readonly isBikeMode = computed(() => this.state.currentView() === 'transit' && this.state.transitMode() === 'bike');

  readonly transitModeOptions = computed<SwitcherOption<TransitMode>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'radius', label: t.transitModeRadius },
      { value: 'bike', label: t.transitModeBike }
    ];
  });

  onTransitMode(mode: TransitMode | undefined) {
    if (mode) this.state.transitMode.set(mode);
  }

  /** Legs of the bike route with letters and distances for the dock. */
  readonly bikeLegs = computed(() => {
    const t = this.i18n.t();
    const nf = new Intl.NumberFormat(this.i18n.lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return this.bike.legs().map((leg, i) => ({
      label: `${pointLabel(i)} → ${pointLabel(i + 1)}`,
      value: leg.metres === null ? t.bikeNoLink : `${nf.format(leg.metres / 1000)} ${t.unitKm}`,
      broken: leg.metres === null
    }));
  });

  readonly bikeTotal = computed(() => {
    const nf = new Intl.NumberFormat(this.i18n.lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${nf.format(this.bike.totalKm())} ${this.i18n.t().unitKm}`;
  });

  readonly sliderMarkers = computed<TimelineMarker[]>(() => {
    const spec = this.slider();
    const current = this.sliderValue();
    return spec.presets.map(v => ({ id: String(v), value: v, label: this.formatValue(v, spec.param), active: v === current }));
  });

  readonly paletteOptions = computed<SwitcherOption<CyberPalette>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'neon', label: t.paletteNeon, tooltip: t.paletteNeonHint },
      { value: 'kmd', label: t.paletteKmd, tooltip: t.paletteKmdHint }
    ];
  });

  // ─── Walking reach ────────────────────────────────────────────────────────

  readonly isBuildings = computed(() => this.state.currentView() === 'buildings');
  /** The 3D buildings view carries the walking reach when it is switched on (stats in the dock, slider = time limit). */
  readonly isWalk = computed(() => this.isBuildings() && this.state.walkEnabled());
  /** The buildings view's only slider is the walking time, so it goes away with the reach. */
  readonly showSlider = computed(() => (!this.isBuildings() || this.state.walkEnabled()) && !this.isBikeMode());

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

  readonly metricOptions = computed<DropdownOption<DistrictMetric>[]>(() => {
    const t = this.i18n.t();
    return DISTRICT_METRICS.map(m => ({ value: m, label: t[METRIC_LABEL[m]] }));
  });

  onMetricChange(metric: DistrictMetric) {
    this.state.setDistrictMetric(metric);
  }

  onPaletteChange(palette: CyberPalette | undefined) {
    if (palette) this.state.setParam('cyberPalette', palette);
  }

  onSliderChange(value: number) {
    this.state.setParam(this.slider().param, value);
  }

  onMarkerClick(marker: TimelineMarker) {
    const spec = this.slider();
    // Clicking the active preset again releases the filter (bridges: back to "all", at the end of the slider).
    const release = spec.param === 'bridgesMaxLength' ? spec.max : spec.min;
    this.state.setParam(spec.param, marker.value === this.sliderValue() ? release : marker.value);
  }

  private formatValue(value: number, param: SliderParam): string {
    const t = this.i18n.t();
    const nf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 1 });
    switch (param) {
      case 'cyberMinLevels':
        return `${nf.format(value)} ${t.unitLevels}`;
      case 'walkMinutes':
        return `${nf.format(value)} ${t.unitMinutes}`;
      case 'bridgesMaxLength':
        return `${t.upTo} ${nf.format(value)} ${t.unitMeters}`;
      case 'transitRadius':
        return `${nf.format(value)} ${t.unitMeters}`;
      case 'districtsThreshold': {
        const unit = METRIC_FORMAT[this.state.params().districtsMetric].unit;
        return unit ? `${nf.format(value)} ${unit}` : nf.format(value);
      }
    }
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
      const bottom = window.innerHeight - dockEl.getBoundingClientRect().top + 12;
      this.mapService.setHudPadding(Math.round(top), Math.round(bottom));
      // Side HUD panels (district ranking) fit between the header and the dock.
      const root = document.documentElement.style;
      root.setProperty('--hud-top', `${Math.round(top)}px`);
      root.setProperty('--hud-bottom', `${Math.round(bottom)}px`);
    };
    this.resizeObserver = new ResizeObserver(apply);
    this.resizeObserver.observe(headerEl);
    this.resizeObserver.observe(dockEl);
    apply();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
}
