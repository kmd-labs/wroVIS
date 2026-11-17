import type { FeatureCollection } from 'geojson';

/**
 * Last data written into GeoJSON sources that services fill at runtime (walking reach).
 *
 * The style is rebuilt and applied with `setStyle(style, { diff: true })` on every theme, language, view or
 * legend change. MapLibre diffs GeoJSON sources by their `data`, so a style carrying an empty collection
 * would wipe what a service wrote with `setData`. The style builder therefore reads the current data here.
 */
export const liveSourceData = new Map<string, FeatureCollection>();
