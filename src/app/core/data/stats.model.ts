/** Shape of `assets/data/stats.json` produced by `tools/pipeline/src/30-stats.mjs`. */

export interface DistrictStats {
  id: number;
  name: string;
  area_km2: number;
  buildings: number;
  buildings_per_km2: number;
  levels_mean: number;
  levels_known_pct: number;
  max_height_m: number;
  tallest_name: string | null;
  poi: number;
  poi_per_km2: number;
  poi_food: number;
  poi_shop: number;
  poi_education: number;
  poi_health: number;
  poi_culture: number;
  poi_worship: number;
  poi_finance: number;
  poi_public: number;
  poi_transport: number;
  poi_sport: number;
  green_pct: number;
  water_pct: number;
  tram_stops: number;
  bridges: number;
  /** Street length inside the district (segments assigned by midpoint), km. */
  streets_km: number;
  streets_km_per_km2: number;
  /** Share of street length carrying tram tracks, %. */
  tram_street_pct: number;
  /** Pedestrian zones and living streets, km. */
  pedestrian_km: number;
  /** Share of ≤ 30 km/h streets among streets with a tagged speed limit, % (null in JSON without any tagged limit). */
  slow_street_pct: number;
  /** Share of street length with a tagged speed limit, %. */
  maxspeed_known_pct: number;
}

export type DistrictNumericKey = {
  [K in keyof DistrictStats]: DistrictStats[K] extends number ? K : never;
}[keyof DistrictStats];

export interface MetricRange {
  min: number;
  max: number;
}

export interface CityStats {
  generatedAt: string;
  city: {
    name: string;
    area_km2: number;
    districts: number;
    buildings: number;
    poi: number;
    tram_routes: number;
    tram_lines: number;
    tram_stops: number;
    bridges: number;
    bridges_by_kind: Record<string, number>;
    green_pct: number;
    water_pct: number;
    streets_km: number;
    tram_street_pct: number;
    pedestrian_km: number;
  };
  medians: Partial<Record<DistrictNumericKey, number>>;
  ranges: Partial<Record<DistrictNumericKey, MetricRange>>;
  districts: DistrictStats[];
}

/** Subset of `assets/data/manifest.json` used by the UI (attribution and data freshness). */
export interface DataManifest {
  generatedAt: string;
  attribution: string;
  source: {
    extract: string | null;
    extractLastModified: string | null;
    extractMd5: string | null;
    boundary: string;
  };
  bbox: [number, number, number, number];
}
