import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { LucideAngularModule, ChevronDown, X } from 'lucide-angular';
import { BreakpointService } from '@kmd/design-system';
import { DataService } from '../../core/data/data.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { DISTRICT_METRICS } from '../../core/map/layers.registry';
import { SRC_DISTRICTS } from '../../core/map/map.config';
import { MapService } from '../../core/map/map.service';
import { DistrictMetric, METRIC_FORMAT } from '../../core/map/map.types';
import { AppState } from '../../core/state/app.state';
import { METRIC_LABEL } from '../../shared/legend/legend.component';

interface RankRow {
  id: number;
  rank: number | null;
  name: string;
  value: string;
}

/**
 * Right-hand panel of the districts layer: every numeric district attribute as an accordion section.
 * Opening a section switches the choropleth to that metric (one open at a time, in sync with the dock)
 * and lists the 48 districts from the highest to the lowest value. Hovering or focusing a row
 * highlights the district on the map; clicking it frames the district and opens its card.
 * On phones the panel is a bottom sheet opened from the dock.
 */
@Component({
  selector: 'app-district-ranking',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @let t = i18n.t();
    @if (visible()) {
      <aside
        class="ranking glass-panel"
        #panel
        [class.ranking--sheet]="bp.mobile()"
        [class.palette-glass]="state.palette() !== 'normal'"
        [attr.aria-label]="t.rankingTitle">
        <header class="ranking__head">
          <div>
            <h2 class="ranking__title">{{ t.rankingTitle }}</h2>
            <p class="ranking__hint">{{ t.rankingHint }}</p>
          </div>
          @if (bp.mobile()) {
            <button type="button" class="ranking__close" [attr.aria-label]="t.close" (click)="state.rankingSheetOpen.set(false)">
              <lucide-icon [img]="closeIcon" [size]="16"></lucide-icon>
            </button>
          }
        </header>

        <div class="ranking__body">
          @for (m of metrics; track m) {
            @let isOpen = open() === m;
            <section class="ranking__section" [class.ranking__section--open]="isOpen">
              <button
                type="button"
                class="ranking__toggle"
                [id]="'rank-h-' + m"
                [attr.aria-expanded]="isOpen"
                [attr.aria-controls]="'rank-l-' + m"
                (click)="toggle(m)">
                <lucide-icon class="ranking__chevron" [img]="chevronIcon" [size]="14"></lucide-icon>
                <span>{{ t[label[m]] }}</span>
                @if (unit(m); as u) {
                  <span class="ranking__unit">{{ u }}</span>
                }
              </button>
              @if (isOpen) {
                <ol class="ranking__list" [id]="'rank-l-' + m" [attr.aria-labelledby]="'rank-h-' + m">
                  @for (row of rows(); track row.id) {
                    <li>
                      <button
                        type="button"
                        class="ranking__row"
                        [class.ranking__row--selected]="row.id === selectedId()"
                        (mouseenter)="highlight(row.id)"
                        (mouseleave)="unhighlight(row.id)"
                        (focus)="highlight(row.id)"
                        (blur)="unhighlight(row.id)"
                        (click)="pick(row.id)">
                        <span class="ranking__rank">{{ row.rank ?? '–' }}</span>
                        <span class="ranking__name">{{ row.name }}</span>
                        <span class="ranking__value">{{ row.value }}</span>
                      </button>
                    </li>
                  }
                </ol>
              }
            </section>
          }
        </div>
      </aside>
    }
  `,
  styleUrl: './district-ranking.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DistrictRankingComponent {
  readonly i18n = inject(I18nService);
  readonly state = inject(AppState);
  readonly bp = inject(BreakpointService);
  private readonly data = inject(DataService);
  private readonly mapService = inject(MapService);

  readonly metrics = DISTRICT_METRICS;
  readonly label = METRIC_LABEL;
  readonly chevronIcon = ChevronDown;
  readonly closeIcon = X;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  /** True after the user folded the open section; the choropleth metric stays as it was. */
  private readonly collapsed = signal(false);

  readonly visible = computed(
    () => this.state.layers().has('districts') && this.data.stats() !== null && (!this.bp.mobile() || this.state.rankingSheetOpen())
  );

  readonly open = computed<DistrictMetric | null>(() => (this.collapsed() ? null : this.state.params().districtsMetric));

  readonly selectedId = computed(() => {
    const s = this.state.selected();
    return s && s.source === SRC_DISTRICTS ? Number(s.id) : null;
  });

  readonly rows = computed<RankRow[]>(() => {
    const metric = this.open();
    const stats = this.data.stats();
    if (!metric || !stats) return [];
    const fmt = METRIC_FORMAT[metric];
    const nf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: fmt.digits });
    const value = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const sorted = [...stats.districts].sort((a, b) => {
      const va = value(a[metric]);
      const vb = value(b[metric]);
      if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1;
      return vb - va || a.name.localeCompare(b.name, this.i18n.lang());
    });
    let rank = 0;
    return sorted.map(d => {
      const v = value(d[metric]);
      if (v !== null) rank++;
      return { id: d.id, rank: v === null ? null : rank, name: d.name, value: v === null ? '–' : `${nf.format(v)}${fmt.unit ? ` ${fmt.unit}` : ''}` };
    });
  });

  constructor() {
    // Keep the camera centred in the map area that the panel leaves free (desktop and tablet).
    const observer = new ResizeObserver(() => this.reportInset());
    effect(() => {
      const el = this.panel()?.nativeElement;
      const sheet = this.bp.mobile();
      untracked(() => {
        observer.disconnect();
        if (el && !sheet) observer.observe(el);
        this.reportInset();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      this.mapService.setRightInset(0);
    });
  }

  unit(metric: DistrictMetric): string {
    return METRIC_FORMAT[metric].unit;
  }

  toggle(metric: DistrictMetric) {
    if (this.open() === metric) {
      this.collapsed.set(true);
      return;
    }
    this.collapsed.set(false);
    this.state.setDistrictMetric(metric);
  }

  highlight(id: number) {
    this.state.highlightedDistrict.set(id);
  }

  unhighlight(id: number) {
    if (this.state.highlightedDistrict() === id) this.state.highlightedDistrict.set(null);
  }

  /** Frames the district on the map and opens its details card. */
  pick(id: number) {
    const feature = this.data.districts()?.features.find(f => f.properties?.['id'] === id);
    if (!feature) return;
    this.mapService.focusDistrict(id);
    if (this.bp.mobile()) this.state.rankingSheetOpen.set(false);
    this.state.highlightedDistrict.set(null);
    this.state.selected.set({ layerId: 'di-fill', source: SRC_DISTRICTS, id, properties: feature.properties ?? {}, x: 0, y: 0, lngLat: [0, 0] });
  }

  private insetPx(): number {
    const el = this.panel()?.nativeElement;
    return el && !this.bp.mobile() ? Math.round(window.innerWidth - el.getBoundingClientRect().left) : 0;
  }

  private reportInset() {
    this.mapService.setRightInset(this.insetPx());
  }
}
