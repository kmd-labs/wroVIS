import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DataService } from '../../core/data/data.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MapService } from '../../core/map/map.service';
import { AppState } from '../../core/state/app.state';
import { describeFeature } from './feature-format';
import { CARD_VIEWS } from './cyber-scan-card.component';

/** Pointer-following glass pill naming the hovered map feature (title + one-line summary). */
@Component({
  selector: 'app-map-tooltip',
  standalone: true,
  template: `
    @if (description(); as d) {
      <div class="map-tooltip" [class.map-tooltip--flip-x]="flipX()" [class.map-tooltip--flip-y]="flipY()" [style.transform]="transform()" role="status" aria-live="polite">
        <span class="map-tooltip__title">{{ d.title }}</span>
        @if (d.subtitle) {
          <span class="map-tooltip__sub">{{ d.subtitle }}</span>
        }
      </div>
    }
  `,
  styleUrl: './map-tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapTooltipComponent {
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);
  private readonly i18n = inject(I18nService);
  private readonly data = inject(DataService);

  readonly description = computed(() => {
    const pick = this.state.hovered();
    // An open feature card already describes the feature; a pill under it is noise.
    if (CARD_VIEWS.includes(this.state.currentView()) && this.state.selected()) return null;
    return pick ? describeFeature(pick, this.i18n.t(), this.i18n.lang(), this.data.stats()) : null;
  });

  readonly flipX = computed(() => this.mapService.pointer().x > window.innerWidth - 300);
  readonly flipY = computed(() => this.mapService.pointer().y > window.innerHeight - 180);

  readonly transform = computed(() => {
    const { x, y } = this.mapService.pointer();
    const dx = this.flipX() ? -18 : 18;
    const dy = this.flipY() ? -18 : 18;
    return `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px)`;
  });
}
