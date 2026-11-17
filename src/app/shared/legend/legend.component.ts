import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Dict } from '../../core/i18n/i18n.types';
import type { DistrictMetric, LegendSpec } from '../../core/map/map.types';

export const METRIC_LABEL: Record<DistrictMetric, keyof Dict> = {
  buildings_per_km2: 'metricBuildingsPerKm2',
  buildings: 'metricBuildings',
  poi_per_km2: 'metricPoiPerKm2',
  green_pct: 'metricGreenPct',
  tram_stops: 'metricTramStops'
};

/**
 * Map legend driven by design tokens: swatches are painted with `var(--color-<token>)`, so they follow
 * the theme exactly like the map layers built from the same tokens.
 */
@Component({
  selector: 'app-legend',
  standalone: true,
  template: `
    @let t = i18n.t();
    @if (categorical(); as items) {
      <ul class="legend legend--categorical" [attr.aria-label]="t.legend">
        @for (item of items; track item.labelKey) {
          <li class="legend__item">
            <span class="legend__swatch" [class]="'legend__swatch legend__swatch--' + (item.shape ?? 'fill')" [style.--swatch]="'var(--color-' + item.token + ')'" aria-hidden="true"></span>
            <span class="legend__label">{{ t[item.labelKey] }}</span>
          </li>
        }
      </ul>
    }
    @if (ordinal(); as o) {
      <div class="legend legend--ordinal" role="img" [attr.aria-label]="t.legend + ': ' + o.metricLabel + ' ' + o.low + ' – ' + o.high">
        <span class="legend__metric">{{ o.metricLabel }}</span>
        <div class="legend__ramp" aria-hidden="true">
          @for (token of o.tokens; track token) {
            <span class="legend__step" [style.background]="'var(--color-' + token + ')'"></span>
          }
        </div>
        <div class="legend__range" aria-hidden="true">
          <span>{{ o.low }}</span>
          <span>{{ o.high }}</span>
        </div>
      </div>
    }
  `,
  styleUrl: './legend.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LegendComponent {
  readonly i18n = inject(I18nService);
  readonly spec = input.required<LegendSpec>();

  readonly categorical = computed(() => {
    const spec = this.spec();
    return spec.kind === 'categorical' ? spec.items : null;
  });

  readonly ordinal = computed(() => {
    const spec = this.spec();
    if (spec.kind !== 'ordinal') return null;
    const nf = new Intl.NumberFormat(this.i18n.lang(), { maximumFractionDigits: spec.metric === 'green_pct' ? 1 : 0 });
    const unit = spec.metric === 'green_pct' ? ' %' : '';
    return {
      tokens: spec.tokens,
      low: nf.format(spec.low) + unit,
      high: nf.format(spec.high) + unit,
      metricLabel: this.i18n.t()[METRIC_LABEL[spec.metric]]
    };
  });
}
