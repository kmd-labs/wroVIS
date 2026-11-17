import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule, ExternalLink } from 'lucide-angular';
import type { DetailRow } from './feature-format';

/** Body of the feature details popup: attribute rows plus a link to the object on openstreetmap.org. */
@Component({
  selector: 'app-feature-details',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (rows().length) {
      <dl class="details">
        @for (row of rows(); track row.label) {
          <div class="details__row">
            <dt class="details__label">{{ row.label }}</dt>
            <dd class="details__value" [class.details__value--mono]="row.mono">
              {{ row.value }}
              @if (row.note) {
                <span class="details__note">{{ row.note }}</span>
              }
            </dd>
          </div>
        }
      </dl>
    }
    @if (osmUrl(); as url) {
      <a class="details__link" [href]="url" target="_blank" rel="noopener noreferrer">
        <lucide-icon [img]="externalIcon" [size]="14"></lucide-icon>
        <span>{{ osmLabel() }}</span>
      </a>
    }
  `,
  styleUrl: './feature-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeatureDetailsComponent {
  readonly rows = input<DetailRow[]>([]);
  readonly osmUrl = input<string | null>(null);
  readonly osmLabel = input<string>('');
  readonly externalIcon = ExternalLink;
}
