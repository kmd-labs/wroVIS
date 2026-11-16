import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  viewChild
} from '@angular/core';
import { MapService } from './map.service';

/**
 * Full-viewport host element for the MapLibre canvas (the "stage" of the KMD HUD layout).
 * Everything else (HUD, dock, popups) floats above it.
 */
@Component({
  selector: 'app-map-stage',
  standalone: true,
  template: `<div class="map-stage__canvas" #container></div>`,
  styleUrl: './map-stage.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MapStageComponent implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly mapService = inject(MapService);

  ngAfterViewInit() {
    this.mapService.init(this.container().nativeElement);
  }

  ngOnDestroy() {
    this.mapService.destroy();
  }
}
