# wroVIS

Interactive Visualisation of Wrocław City — interaktywna wizualizacja Wrocławia zbudowana na danych OpenStreetMap.

Aplikacja KMD Labs: Angular 21 + [`@kmd/design-system`](https://github.com/kmd-labs/design-system) (submoduł `src/design-system`) + MapLibre GL JS + PMTiles.

Plan prac i decyzje architektoniczne: [`PLAN.md`](PLAN.md).

## Uruchomienie

```bash
git clone --recurse-submodules https://github.com/kmd-labs/wroVIS.git
cd wroVIS
npm install --legacy-peer-deps
npm start            # http://localhost:4200
```

Jeśli repo zostało sklonowane bez submodułów: `git submodule update --init`.

## Skrypty

| Polecenie | Działanie |
| :--- | :--- |
| `npm start` | serwer deweloperski |
| `npm run build` | build produkcyjny do `dist/wrovis/browser` |
| `npm run build:gh-pages` | build z `base-href /wroVIS/` dla GitHub Pages |
| `npm run build:og` | regeneracja obrazka OpenGraph |

## Dane i licencje

- Dane mapy: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licencja ODbL 1.0.
- Mapa bazowa: [OpenFreeMap](https://openfreemap.org/) (dane OSM, schemat OpenMapTiles).
- Szkielet i design system: [kmd-labs/design-system](https://github.com/kmd-labs/design-system), Apache 2.0.
