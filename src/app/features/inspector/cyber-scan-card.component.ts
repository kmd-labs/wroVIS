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
import type { ViewId } from '../../core/map/map.types';

/** Views that show a card pinned next to the clicked feature instead of the modal details popup. */
export const CARD_VIEWS: readonly ViewId[] = ['cyberpunk', 'buildings'];
import { describeFeature } from './feature-format';

/** Horizontal gap between the pinned point and the card, px. */
const GAP = 36;
/** Minimum distance of the card from the viewport edges, px. */
const MARGIN = 12;

/**
 * Details card pinned to the clicked point with a leader line, framed in the colour of the feature's category.
 * In the Neon View it is dark "neon glass" with a gradient outline; in the 3D buildings view it takes the KMD look,
 * so the map stays visible while the walking reach plays (unlike the modal details popup). It follows the camera
 * by re-projecting the point on every map `move`, writing transforms directly to the DOM outside Angular.
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
    const view = this.state.currentView();
    if (!pick || !CARD_VIEWS.includes(view)) return null;
    const t = this.i18n.t();
    const d = describeFeature(pick, t, this.i18n.lang(), this.data.stats());
    if (view === 'buildings') {
      // KMD look: glass panel in the theme, framed in the building's category colour.
      const slot = BUILDING_CLASS_SLOT[String(pick.properties['class'])] ?? 'light';
      return {
        ...d,
        neon: false,
        kicker: t.inspBuilding,
        accent: `var(--color-${categoricalToken(slot, this.theme.mode())})`,
        hl: `var(--color-${categoricalToken(slot, this.theme.mode())})`,
        bg: 'var(--color-panel-bg-solid)',
        ink: 'var(--color-text-main)',
        lngLat: pick.lngLat
      };
    }
    const isBuilding = pick.layerId === 'cy-bld';
    const role: CyberRole = isBuilding ? (CYBER_BUILDING_ROLE[String(pick.properties['class'])] ?? 'oth') : pick.layerId === 'cy-stops' ? 'stop' : 'tram';
    const typeLabel = isBuilding ? t.inspBuilding : pick.layerId === 'cy-stops' ? t.inspTramStop : t.inspTramTrack;
    const palette = this.state.params().cyberPalette;
    const token = (r: CyberRole) => `var(--color-${cyberToken(palette, r)})`;
    return {
      ...d,
      neon: true,
      kicker: typeLabel,
      accent: token(role),
      hl: token('select'),
      bg: token('bg'),
      ink: token('hover'),
      lngLat: pick.lngLat
    };
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

  /** Places pin, leader and card for the current camera; the card flips sides and clamps between header and dock. */
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
    const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? vh;
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
    const right = x + GAP + w <= vw - MARGIN;
    const cardX = right ? x + GAP : Math.max(MARGIN, x - GAP - w);
    const minY = headerBottom + MARGIN;
    const maxY = Math.max(minY, dockTop - MARGIN - h);
    const cardY = Math.min(maxY, Math.max(minY, y - 56));

    card.style.transform = `translate(${Math.round(cardX)}px, ${Math.round(cardY)}px)`;
    const visible = x >= 0 && x <= vw && y >= headerBottom && y <= dockTop;
    pin.style.opacity = visible ? '1' : '0';
    pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    leader.style.opacity = visible ? '1' : '0';
    leader.setAttribute('x1', String(Math.round(x)));
    leader.setAttribute('y1', String(Math.round(y)));
    leader.setAttribute('x2', String(Math.round(right ? cardX : cardX + w)));
    leader.setAttribute('y2', String(Math.round(Math.min(cardY + h - 16, Math.max(cardY + 16, y)))));
  }
}
