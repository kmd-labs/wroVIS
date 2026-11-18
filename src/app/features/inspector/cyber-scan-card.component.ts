import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { LucideAngularModule, BookOpen, ExternalLink, X } from 'lucide-angular';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { BreakpointService, ThemeService } from '@kmd/design-system';
import { DataService } from '../../core/data/data.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MapService } from '../../core/map/map.service';
import { AppState } from '../../core/state/app.state';
import { CYBER_BUILDING_ROLE, CyberRole, cyberToken } from '../../shared/cyber-palette';
import { BUILDING_CLASS_SLOT, categoricalToken } from '../../shared/scales';
import type { Dict } from '../../core/i18n/i18n.types';
import type { PickedFeature } from '../../core/map/map.types';
import { describeFeature } from './feature-format';

/** Kind of the picked feature, by the style layer it was drawn with. */
type PickKind = 'building' | 'stop' | 'track' | 'bridge' | 'district' | 'place';

function pickKind(pick: PickedFeature): PickKind {
  const id = pick.layerId;
  if (id === 'bld-extrusion' || id === 'cy-bld') return 'building';
  if (id === 'tr-stops' || id === 'cy-stops') return 'stop';
  if (id === 'tr-tracks' || id === 'cy-tram') return 'track';
  if (id.startsWith('br-')) return 'bridge';
  if (id.startsWith('di-')) return 'district';
  return 'place';
}

const KICKER: Record<PickKind, keyof Dict> = {
  building: 'inspBuilding',
  stop: 'inspTramStop',
  track: 'inspTramTrack',
  bridge: 'inspBridge',
  district: 'inspDistrict',
  place: 'wkPlace'
};

/** Horizontal gap between the pinned point and the card, px. */
const GAP = 36;
/** Minimum distance of the card from the viewport edges, px. */
const MARGIN = 12;

/**
 * Details card of any clicked feature, pinned to the clicked point with a leader line and framed in the colour of
 * the feature's category. On the neon map it is dark "neon glass" with a gradient outline; otherwise it takes the
 * KMD look. A building card lists the shops, restaurants and other places inside. The card follows the camera by
 * re-projecting the point on every map `move`, writing transforms directly to the DOM outside Angular.
 */
@Component({
  selector: 'app-cyber-scan-card',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (card(); as c) {
      <div class="scan" [class.scan--kmd]="!c.neon" [class.scan--docked]="bp.mobile()" [style.--scan-accent]="c.accent" [style.--scan-hl]="c.hl" [style.--scan-bg]="c.bg" [style.--scan-ink]="c.ink">
        <svg class="scan__leader" aria-hidden="true"><line #leader x1="0" y1="0" x2="0" y2="0" /></svg>
        <span class="scan__pin" #pin aria-hidden="true"></span>
        <section class="scan__card" #card role="dialog" [attr.aria-label]="c.title">
          <header class="scan__head">
            <span class="scan__kicker">{{ c.kicker }}</span>
            <button type="button" class="scan__close" [attr.aria-label]="t().close" [title]="t().close" (click)="close()">
              <lucide-icon [img]="closeIcon" [size]="14"></lucide-icon>
            </button>
          </header>
          <h2 class="scan__title">{{ c.title }}</h2>
          @if (c.subtitle) {
            <p class="scan__sub">{{ c.subtitle }}</p>
          }
          @if (c.rows.length) {
            <dl class="scan__rows">
              @for (row of c.rows; track row.label) {
                <div class="scan__row">
                  <dt>{{ row.label }}</dt>
                  <dd [class.scan__mono]="row.mono">
                    {{ row.value }}
                    @if (row.note) {
                      <span class="scan__note">{{ row.note }}</span>
                    }
                  </dd>
                </div>
              }
            </dl>
          }
          @if (c.places?.length) {
            <section class="scan__places" [attr.aria-label]="t().inspPlacesTitle">
              <h3 class="scan__places-title">
                {{ t().inspPlacesTitle }}
                <span class="scan__places-count">{{ c.placeCount }}</span>
              </h3>
              @for (group of c.places; track group.label) {
                <div class="scan__place-group">
                  <span class="scan__place-cat">{{ group.label }}</span>
                  <ul class="scan__place-list">
                    @for (item of group.items; track $index) {
                      <li>
                        <span class="scan__place-name">{{ item.name }}</span>
                        @if (item.tag) {
                          <span class="scan__place-tag">{{ item.tag }}</span>
                        }
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (c.placeCount && c.placeCount > c.listed) {
                <p class="scan__note">{{ t().andMore }} {{ c.placeCount - c.listed }}</p>
              }
            </section>
          }
          @if (c.osmUrl || c.wikiUrl) {
            <div class="scan__links">
              @if (c.osmUrl) {
                <a [href]="c.osmUrl" target="_blank" rel="noopener noreferrer">
                  <lucide-icon [img]="externalIcon" [size]="13"></lucide-icon>{{ t().openInOsm }}
                </a>
              }
              @if (c.wikiUrl) {
                <a [href]="c.wikiUrl" target="_blank" rel="noopener noreferrer">
                  <lucide-icon [img]="bookIcon" [size]="13"></lucide-icon>{{ t().openInWikipedia }}
                </a>
              }
            </div>
          }
        </section>
      </div>
    }
  `,
  styleUrl: './cyber-scan-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' }
})
export class CyberScanCardComponent {
  private readonly state = inject(AppState);
  private readonly mapService = inject(MapService);
  private readonly i18n = inject(I18nService);
  private readonly data = inject(DataService);
  private readonly zone = inject(NgZone);
  readonly bp = inject(BreakpointService);
  private readonly theme = inject(ThemeService);

  readonly closeIcon = X;
  readonly externalIcon = ExternalLink;
  readonly bookIcon = BookOpen;

  readonly t = this.i18n.t;

  private readonly cardEl = viewChild<ElementRef<HTMLElement>>('card');
  private readonly pinEl = viewChild<ElementRef<HTMLElement>>('pin');
  private readonly leaderEl = viewChild<ElementRef<SVGLineElement>>('leader');

  readonly card = computed(() => {
    const pick = this.state.selected();
    if (!pick) return null;
    const t = this.i18n.t();
    const d = describeFeature(pick, t, this.i18n.lang(), this.data.stats());
    const kind = pickKind(pick);
    const listed = (d.places ?? []).reduce((n, g) => n + g.items.length, 0);
    const base = { ...d, listed, kicker: t[KICKER[kind]], lngLat: pick.lngLat };
    const palette = this.state.palette();
    if (palette === 'normal') {
      // KMD look: glass panel in the theme, framed in the building's category colour (accent for the rest).
      const slot = BUILDING_CLASS_SLOT[String(pick.properties['class'])] ?? 'light';
      const accent = kind === 'building' ? `var(--color-${categoricalToken(slot, this.theme.mode())})` : 'var(--color-accent)';
      return { ...base, neon: false, accent, hl: accent, bg: 'var(--color-panel-bg-solid)', ink: 'var(--color-text-main)' };
    }
    const role: CyberRole =
      kind === 'building' ? (CYBER_BUILDING_ROLE[String(pick.properties['class'])] ?? 'oth') : kind === 'stop' ? 'stop' : kind === 'track' ? 'tram' : 'outline';
    const token = (r: CyberRole) => `var(--color-${cyberToken(r, palette)})`;
    return { ...base, neon: true, accent: token(role), hl: token('select'), bg: token('panel'), ink: token('hover') };
  });

  constructor() {
    const update = () => this.position();
    let attached: MapLibreMap | null = null;

    // While a card is open, keep it pinned: re-project on every camera move and viewport resize.
    effect(() => {
      const open = this.card() !== null && this.cardEl() !== undefined;
      this.bp.mobile();
      untracked(() => {
        const map = this.mapService.instance;
        if (open && map && !attached) {
          this.zone.runOutsideAngular(() => {
            map.on('move', update);
            window.addEventListener('resize', update);
          });
          attached = map;
        } else if (!open && attached) {
          attached.off('move', update);
          window.removeEventListener('resize', update);
          attached = null;
        }
        if (open) requestAnimationFrame(update);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.mapService.instance?.off('move', update);
      window.removeEventListener('resize', update);
    });
  }

  close() {
    if (this.card()) this.state.selected.set(null);
  }

  /** Places pin, leader and card for the current camera; the card flips sides and stays clear of the header and the dock. */
  private position() {
    const card = this.cardEl()?.nativeElement;
    const pin = this.pinEl()?.nativeElement;
    const leader = this.leaderEl()?.nativeElement;
    const map = this.mapService.instance;
    const c = untracked(this.card);
    if (!card || !pin || !leader || !map || !c) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const headerBottom = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 64;
    // The dock is a left column (a bottom sheet on phones, handled below).
    const dockRight = document.querySelector('.dock')?.getBoundingClientRect().right ?? 0;
    const rankingLeft = document.querySelector('.ranking')?.getBoundingClientRect().left ?? vw;
    const w = card.offsetWidth;
    const h = card.offsetHeight;

    if (untracked(this.bp.mobile)) {
      // Phones: the card docks under the header, no pin.
      card.style.transform = `translate(${MARGIN}px, ${Math.round(headerBottom + 8)}px)`;
      pin.style.opacity = '0';
      leader.style.opacity = '0';
      return;
    }

    const p = map.project(c.lngLat);
    const container = map.getContainer().getBoundingClientRect();
    const x = p.x + container.left;
    const y = p.y + container.top;
    const minX = dockRight + MARGIN;
    const maxX = rankingLeft - MARGIN;
    const right = x + GAP + w <= maxX;
    const cardX = right ? x + GAP : Math.max(minX, x - GAP - w);
    const minY = headerBottom + MARGIN;
    const maxY = Math.max(minY, vh - MARGIN - h);
    const cardY = Math.min(maxY, Math.max(minY, y - 56));

    card.style.transform = `translate(${Math.round(cardX)}px, ${Math.round(cardY)}px)`;
    const visible = x >= dockRight && x <= rankingLeft && y >= headerBottom && y <= vh;
    pin.style.opacity = visible ? '1' : '0';
    pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    leader.style.opacity = visible ? '1' : '0';
    leader.setAttribute('x1', String(Math.round(x)));
    leader.setAttribute('y1', String(Math.round(y)));
    leader.setAttribute('x2', String(Math.round(right ? cardX : cardX + w)));
    leader.setAttribute('y2', String(Math.round(Math.min(cardY + h - 16, Math.max(cardY + 16, y)))));
  }
}
