import type { CityStats, DistrictNumericKey } from '../../core/data/stats.model';
import type { Dict, Lang } from '../../core/i18n/i18n.types';
import type { PickedFeature } from '../../core/map/map.types';

export interface DetailRow {
  label: string;
  value: string;
  /** Secondary text under the value (e.g. height source, city median). */
  note?: string;
  /** Render the value in the monospaced face (raw OSM tag values). */
  mono?: boolean;
}

export interface FeatureDescription {
  title: string;
  subtitle: string;
  rows: DetailRow[];
  osmUrl: string | null;
}

const BUILDING_CLASS_LABEL: Record<string, keyof Dict> = {
  residential: 'classResidential',
  commercial: 'classCommercial',
  industrial: 'classIndustrial',
  public: 'classPublic',
  religious: 'classReligious',
  utility: 'classUtility',
  other: 'classOther'
};

const BRIDGE_KIND_LABEL: Record<string, keyof Dict> = {
  road: 'brRoad',
  tram: 'brTram',
  rail: 'brRail',
  foot: 'brFoot',
  other: 'brOther'
};

/** District rows shown in the details popup: property, label key, unit and whether a city median exists. */
const DISTRICT_ROWS: { key: DistrictNumericKey; label: keyof Dict; unit?: string; digits?: number }[] = [
  { key: 'area_km2', label: 'propArea', unit: 'km²', digits: 1 },
  { key: 'buildings', label: 'propBuildings' },
  { key: 'buildings_per_km2', label: 'propBuildingsPerKm2' },
  { key: 'poi_per_km2', label: 'propPoiPerKm2' },
  { key: 'green_pct', label: 'propGreenPct', unit: '%', digits: 1 },
  { key: 'water_pct', label: 'propWaterPct', unit: '%', digits: 1 },
  { key: 'tram_stops', label: 'propTramStops' },
  { key: 'bridges', label: 'propBridges' },
  { key: 'levels_mean', label: 'propLevelsMean', digits: 1 }
];

/** Turns a picked map feature into localized, human-readable text for the tooltip and the details popup. */
export function describeFeature(pick: PickedFeature, t: Dict, lang: Lang, stats: CityStats | null): FeatureDescription {
  const p = pick.properties;
  const nf = (digits = 0) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits });
  const num = (v: unknown, digits = 0, unit = '') => (typeof v === 'number' ? `${nf(digits).format(v)}${unit ? ` ${unit}` : ''}` : '');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
  const name = str(p['name']);
  const osmUrl = osmLink(str(p['osm']));
  const rows: DetailRow[] = [];
  const id = pick.layerId;

  if (id.startsWith('bld-')) {
    const cls = str(p['class']) || 'other';
    const classLabel = t[BUILDING_CLASS_LABEL[cls] ?? 'classOther'];
    const levels = typeof p['levels'] === 'number' ? p['levels'] : null;
    const hsrc = str(p['hsrc']);
    rows.push({ label: t.propClass, value: classLabel });
    if (str(p['type'])) rows.push({ label: t.propOsmType, value: `building=${str(p['type'])}`, mono: true });
    if (levels !== null) rows.push({ label: t.propLevels, value: nf().format(levels) });
    if (typeof p['height'] === 'number') {
      const note = hsrc === 'height' ? t.heightMeasured : hsrc === 'levels' ? t.heightFromLevels : t.heightEstimated;
      rows.push({ label: t.propHeight, value: num(p['height'], 1, 'm'), note });
    }
    if (typeof p['year'] === 'number') rows.push({ label: t.propYear, value: String(p['year']) });
    const subtitle = levels !== null ? `${classLabel} · ${nf().format(levels)} ${t.unitStoreysShort}` : classLabel;
    return { title: name || t.inspBuilding, subtitle, rows, osmUrl };
  }

  if (id.startsWith('br-')) {
    const kind = str(p['kind']);
    const kindLabel = kind ? t[BRIDGE_KIND_LABEL[kind] ?? 'brOther'] : t.inspBridge;
    if (kind) rows.push({ label: t.propKind, value: kindLabel });
    if (str(p['sub'])) rows.push({ label: t.propOsmType, value: `${kind === 'rail' || kind === 'tram' ? 'railway' : 'highway'}=${str(p['sub'])}`, mono: true });
    if (typeof p['length_m'] === 'number') rows.push({ label: t.propLength, value: num(p['length_m'], 0, 'm') });
    const subtitle = typeof p['length_m'] === 'number' ? `${kindLabel} · ${num(p['length_m'], 0, 'm')}` : kindLabel;
    return { title: name || t.inspBridge, subtitle, rows, osmUrl };
  }

  if (id === 'tr-stops' || id === 'tr-tracks') {
    const routes = str(p['routes']).split(';').filter(Boolean);
    if (routes.length) rows.push({ label: t.propRoutes, value: routes.join(', ') });
    const label = id === 'tr-stops' ? t.inspTramStop : t.inspTramTrack;
    const subtitle = routes.length ? `${label} · ${routes.join(', ')}` : label;
    return { title: name || label, subtitle, rows, osmUrl };
  }

  if (id.startsWith('di-')) {
    for (const row of DISTRICT_ROWS) {
      const v = p[row.key];
      if (typeof v !== 'number') continue;
      const median = stats?.medians[row.key];
      rows.push({
        label: t[row.label],
        value: num(v, row.digits ?? 0, row.unit ?? ''),
        note: typeof median === 'number' ? `${t.cityMedian}: ${num(median, row.digits ?? 0, row.unit ?? '')}` : undefined
      });
    }
    if (typeof p['max_height_m'] === 'number') {
      const tallest = str(p['tallest_name']);
      rows.push({ label: t.propMaxHeight, value: num(p['max_height_m'], 0, 'm'), note: tallest || undefined });
    }
    const perKm2 = typeof p['buildings_per_km2'] === 'number' ? ` · ${num(p['buildings_per_km2'])} ${t.metricBuildingsPerKm2.toLowerCase()}` : '';
    return { title: name || t.inspDistrict, subtitle: `${t.inspDistrict}${perKm2}`, rows, osmUrl };
  }

  return { title: name || t.inspNoName, subtitle: '', rows, osmUrl };
}

/** `w123` / `n123` / `r123` (pipeline `osm` property) → openstreetmap.org object URL. */
export function osmLink(ref: string): string | null {
  const m = /^([nwr])(\d+)$/.exec(ref);
  if (!m) return null;
  const kind = m[1] === 'n' ? 'node' : m[1] === 'w' ? 'way' : 'relation';
  return `https://www.openstreetmap.org/${kind}/${m[2]}`;
}
