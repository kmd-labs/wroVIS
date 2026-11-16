# wroVIS data pipeline

Turns the Geofabrik Lower Silesia OpenStreetMap extract into the thematic data served by the app
(`src/assets/data/`). Pure JavaScript (Node ≥ 20), no native binaries, so it runs the same on a
developer machine and in CI.

```bash
npm install
npm run all          # fetch → extract → stats → tiles (≈ 1.5 min after the first download)
```

Or from the repository root: `npm run data`.

| Step | Script | What it does |
| :--- | :--- | :--- |
| fetch | `src/00-fetch.mjs` | Downloads `dolnoslaskie-latest.osm.pbf` (MD5-verified, reused when unchanged) and the Wrocław boundary (OSM relation 451516 via Nominatim). |
| extract | `src/10-extract.mjs` | Streams the PBF once, keeps nodes inside the city bbox, assembles ways and multipolygon/boundary relations, writes thematic GeoJSON layers to `data/work/` plus `extract-summary.json` with tag coverage. |
| stats | `src/30-stats.mjs` | Per-district (osiedle) metrics: buildings, levels, POI by category, green and water share, tram stops, bridges. Writes `stats.json`, `districts.geojson` and the light GeoJSON layers. |
| tiles | `src/40-tiles.mjs` | Slices the heavy layers with geojson-vt, encodes MVT with vt-pbf, packs one `wroclaw.pmtiles` (own PMTiles v3 writer), verifies it with the `pmtiles` reader and writes `manifest.json`. |

## Outputs (`src/assets/data/`)

| File | Content |
| :--- | :--- |
| `wroclaw.pmtiles` | Vector tiles z10–z14 (overzoomed by MapLibre above 14). Layers: `buildings` (z13+), `bridge_areas`, `water`, `waterways`, `green`, `tram_tracks`, `cycleways`, `bridges`, `poi`. |
| `districts.geojson` | 48 districts with metrics baked into properties. |
| `tram_routes.geojson`, `tram_stops.geojson` | Tram route relations (ref, colour, from/to) and stops. |
| `bridges.geojson` | Bridge segments (kind: road / tram / rail / foot / other, length). |
| `city.geojson` | City outline. |
| `stats.json` | City totals, per-district rows, medians and ranges. |
| `manifest.json` | Extract date and checksum, layer counts, tag-coverage audit, file sizes. |

## Feature ids and properties

Feature `id` is `osmId * 2` for ways and `osmId * 2 + 1` for relations (unsigned, unique, usable with
MapLibre `feature-state`). The `osm` property keeps the original reference (`w…`, `r…`, `n…`).

Building height: `height` tag when present (`hsrc = height`), else `building:levels × 3 m`
(`hsrc = levels`), else a per-class estimate (`hsrc = estimated`) — show it as such in legends.

## Data licence

© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright.
Extract by Geofabrik (https://download.geofabrik.de/).
