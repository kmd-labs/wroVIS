import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { LucideAngularModule, MapPin, Search, Signpost, X } from 'lucide-angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { AddressSearchService, SearchResult } from '../../core/search/address-search.service';

/** A chosen address: its label and position. */
export interface PickedAddress {
  label: string;
  lngLat: [number, number];
}

/** A chosen street: its name (as in OpenStreetMap) and the extent of its addresses. */
export interface PickedStreet {
  name: string;
  bounds: [number, number, number, number];
}

/**
 * Address search at the top of the dock (combobox pattern). The suggestion list narrows with every letter typed.
 * Picking a street emits it (the map flies over it and highlights it) and keeps its name in the box, so typing a
 * house number narrows to its addresses; picking an address emits it. Arrow keys move through the list, Enter
 * picks, Escape closes. The address index loads on first focus.
 */
@Component({
  selector: 'app-address-search',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @let t = i18n.t();
    <div class="search" [class.search--open]="open()">
      <lucide-icon class="search__icon" [img]="searchIcon" [size]="15" aria-hidden="true"></lucide-icon>
      <input
        #input
        class="search__input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-controls="address-search-list"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="open() && active() >= 0 ? 'address-search-opt-' + active() : null"
        [attr.aria-label]="t.searchLabel"
        [placeholder]="t.searchPlaceholder"
        [value]="query()"
        (input)="onInput($event)"
        (focus)="onFocus()"
        (blur)="focused.set(false)"
        (keydown)="onKey($event)" />
      @if (query()) {
        <button type="button" class="search__clear" [attr.aria-label]="t.searchClear" [title]="t.searchClear" (click)="clear()">
          <lucide-icon [img]="clearIcon" [size]="14"></lucide-icon>
        </button>
      }
      @if (open()) {
        <ul class="search__list" id="address-search-list" role="listbox" [attr.aria-label]="t.searchLabel">
          @switch (search.status()) {
            @case ('loading') {
              <li class="search__note" role="presentation">{{ t.searchLoading }}</li>
            }
            @case ('error') {
              <li class="search__note" role="presentation">{{ t.searchError }}</li>
            }
            @default {
              @for (r of results(); track $index) {
                <li
                  class="search__option"
                  role="option"
                  [id]="'address-search-opt-' + $index"
                  [class.search__option--active]="$index === active()"
                  [attr.aria-selected]="$index === active()"
                  (mousedown)="$event.preventDefault()"
                  (mouseenter)="active.set($index)"
                  (click)="choose(r)">
                  @if (r.kind === 'street') {
                    <lucide-icon class="search__kind" [img]="streetIcon" [size]="13" aria-hidden="true"></lucide-icon>
                    <span class="search__name">{{ r.street }}</span>
                    <span class="search__meta">{{ countLabel(r.count) }}</span>
                  } @else {
                    <lucide-icon class="search__kind" [img]="pinIcon" [size]="13" aria-hidden="true"></lucide-icon>
                    <span class="search__name">{{ r.street }} <strong>{{ r.number }}</strong></span>
                  }
                </li>
              } @empty {
                <li class="search__note" role="presentation">{{ t.searchNoResults }}</li>
              }
              @if (results()[0]?.kind === 'street') {
                <li class="search__note search__note--hint" role="presentation">{{ t.searchStreetHint }}</li>
              }
            }
          }
        </ul>
      }
    </div>
  `,
  styleUrl: './address-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddressSearchComponent {
  readonly i18n = inject(I18nService);
  readonly search = inject(AddressSearchService);

  /** An address was picked (Enter or click on an address suggestion). */
  readonly picked = output<PickedAddress>();
  /** A whole street was picked. */
  readonly streetPicked = output<PickedStreet>();
  /** The search was cleared (the map marker goes away). */
  readonly cleared = output<void>();

  readonly searchIcon = Search;
  readonly clearIcon = X;
  readonly pinIcon = MapPin;
  readonly streetIcon = Signpost;

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  readonly query = signal('');
  readonly focused = signal(false);
  readonly active = signal(0);
  /** Set after a pick so the list closes until the user types again. */
  private readonly closed = signal(false);

  readonly results = computed<SearchResult[]>(() => (this.search.status() === 'ready' ? this.search.search(this.query()) : []));
  readonly open = computed(() => this.focused() && !this.closed() && this.query().trim().length > 0);

  onFocus() {
    this.focused.set(true);
    void this.search.ensureLoaded();
  }

  onInput(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.closed.set(false);
    this.active.set(0);
  }

  onKey(event: KeyboardEvent) {
    const n = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.closed.set(false);
        if (n) this.active.set((this.active() + 1) % n);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (n) this.active.set((this.active() - 1 + n) % n);
        break;
      case 'Enter': {
        const r = this.results()[this.active()];
        if (r && this.open()) {
          event.preventDefault();
          this.choose(r);
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.closed.set(true);
        }
        break;
    }
  }

  choose(r: SearchResult) {
    if (r.kind === 'street') {
      // The street itself is the result; its name stays in the box, so a house number can still be typed after it.
      this.query.set(`${r.street} `);
      this.active.set(0);
      this.closed.set(true);
      this.input().nativeElement.focus();
      this.streetPicked.emit({ name: r.street, bounds: r.bounds });
      return;
    }
    const label = `${r.street} ${r.number}`;
    this.query.set(label);
    this.closed.set(true);
    this.picked.emit({ label, lngLat: r.lngLat });
  }

  clear() {
    this.query.set('');
    this.closed.set(false);
    this.cleared.emit();
    this.input().nativeElement.focus();
  }

  /** "1 adres / 3 adresy / 12 adresów": Polish plural forms via Intl.PluralRules. */
  countLabel(n: number): string {
    const t = this.i18n.t();
    const form = new Intl.PluralRules(this.i18n.lang()).select(n);
    const word = form === 'one' ? t.addressOne : form === 'few' ? t.addressFew : t.addressMany;
    return `${new Intl.NumberFormat(this.i18n.lang()).format(n)} ${word}`;
  }
}
