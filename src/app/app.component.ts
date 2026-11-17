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
import { LucideAngularModule, Globe, BookOpen } from 'lucide-angular';
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
  SwitcherOption
} from '@kmd/design-system';
import { I18nService } from './core/i18n/i18n.service';
import { Dict, Lang } from './core/i18n/i18n.types';
import { DataService } from './core/data/data.service';
import { MapStageComponent } from './core/map/map-stage.component';
import { MapService } from './core/map/map.service';
import { VIEWS } from './core/map/layers.registry';
import { CyberPalette, SliderParam, StyleContext, VIEW_IDS, ViewId } from './core/map/map.types';
import { AppState } from './core/state/app.state';
import { FeatureDetailsComponent } from './features/inspector/feature-details.component';
import { MapTooltipComponent } from './features/inspector/map-tooltip.component';
import { describeFeature } from './features/inspector/feature-format';
import { LegendComponent } from './shared/legend/legend.component';

const VIEW_LABEL: Record<ViewId, { title: keyof Dict; desc: keyof Dict }> = {
  buildings: { title: 'viewBuildings', desc: 'viewBuildingsDesc' },
  bridges: { title: 'viewBridges', desc: 'viewBridgesDesc' },
  transit: { title: 'viewTransit', desc: 'viewTransitDesc' },
  districts: { title: 'viewDistricts', desc: 'viewDistrictsDesc' },
  cyberpunk: { title: 'viewCyberpunk', desc: 'viewCyberpunkDesc' }
};

const SLIDER_LABEL: Record<SliderParam, keyof Dict> = {
  buildingsMinLevels: 'sliderBuildingsMinLevels',
  bridgesMinLength: 'sliderBridgesMinLength',
  transitRadius: 'sliderTransitRadius',
  districtsThreshold: 'sliderDistrictsThreshold',
  cyberMinLevels: 'sliderBuildingsMinLevels'
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
    SwitcherComponent
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

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;

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
    effect(() => {
      const pick = this.state.selected();
      if (!pick) {
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
        componentInputs: { rows: d.rows, osmUrl: d.osmUrl, osmLabel: t.openInOsm },
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
    stats: this.data.stats()
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
    if (value === spec.min && spec.param !== 'transitRadius') return this.i18n.t().presetAll;
    return this.formatValue(value, spec.param);
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

  onPaletteChange(palette: CyberPalette | undefined) {
    if (palette) this.state.setParam('cyberPalette', palette);
  }

  onSliderChange(value: number) {
    this.state.setParam(this.slider().param, value);
  }

  onMarkerClick(marker: TimelineMarker) {
    const spec = this.slider();
    // Clicking the active preset again releases the filter back to the slider minimum.
    this.state.setParam(spec.param, marker.value === this.sliderValue() ? spec.min : marker.value);
  }

  private formatValue(value: number, param: SliderParam): string {
    const t = this.i18n.t();
    const nf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: 1 });
    switch (param) {
      case 'buildingsMinLevels':
      case 'cyberMinLevels':
        return `${nf.format(value)} ${t.unitLevels}`;
      case 'bridgesMinLength':
      case 'transitRadius':
        return `${nf.format(value)} ${t.unitMeters}`;
      case 'districtsThreshold':
        return this.state.params().districtsMetric === 'green_pct' ? `${nf.format(value)} %` : nf.format(value);
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
