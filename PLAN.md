# wroVIS — plan interaktywnej wizualizacji Wrocławia na danych OSM

Stan na 2026-11-16. Repo zawiera tylko `README.md`; plan opisuje drogę od pustego repo do wdrożonej aplikacji.

---

## 1. Decyzje architektoniczne

| Obszar | Decyzja | Uzasadnienie |
| :--- | :--- | :--- |
| Szkielet aplikacji | `npx github:kmd-labs/design-system` → Angular 21 standalone + submoduł `src/design-system` | Wymóg zadania. Daje gotowy HUD (brand + język, przełącznik widoków, dolny dok z suwakiem), i18n, splash, popupy, tokeny SCSS. |
| Silnik mapy | **MapLibre GL JS 5** + protokół **PMTiles** | WebGL, wektorowe kafle, wytłaczanie budynków 3D (`fill-extrusion`), `feature-state` do hover. Brak serwera kafli: PMTiles to jeden plik serwowany statycznie (GitHub Pages obsługuje HTTP Range). |
| Mapa bazowa | Kafle wektorowe **OpenFreeMap** (schemat OpenMapTiles, bez klucza API) + własny styl JSON generowany z tokenów KMD | Zero infrastruktury na start. Opcja B (jeśli zależność zewnętrzna przeszkadza): własny `wroclaw-basemap.pmtiles` z Planetiler (Java 21). |
| Warstwy tematyczne | Własne pliki z OSM: duże warstwy → PMTiles, małe → zminimalizowany GeoJSON w `src/assets/data/` | Pełna kontrola atrybutów (kondygnacje, typ mostu, linia tramwajowa, osiedle). |
| Pipeline danych | Python 3.12 (`uv`), **QuackOSM** (DuckDB) + GeoPandas → GeoParquet → tippecanoe / GDAL PMTiles | Działa na Windows bez osmium/Dockera (QuackOSM czyta PBF bezpośrednio). Powtarzalne skrypty w `tools/pipeline/`. |
| Styl i motyw | Kolory mapy wyłącznie z `ThemeService.getTokenColor()` w `effect()` na `ThemeService.mode()` | Wymóg `AGENTS.md` (brak hex w rendererze, Light domyślnie, Midnight opt-in). |
| Teksty | Każdy string przez `I18nService` (`en.ts` + `pl.ts`) | Wymóg `AGENTS.md`. |
| Wdrożenie | GitHub Pages przez wygenerowany `deploy.yml` | Szkielet już to konfiguruje. |

Poza zakresem MVP: deck.gl, three.js, backend, routing, dane spoza OSM.

---

## 2. Audyt danych OSM dla Wrocławia (Overpass, 2026-11-16)

Obszar: relacja OSM **451516** (granica miasta; area id `3600451516`). Przybliżony bbox: 16,81–17,18 E, 51,04–51,21 N.

| Cecha | Liczba | Wniosek |
| :--- | ---: | :--- |
| Budynki (`building=*`) | 145 983 | Warstwa główna; wymaga kafli (PMTiles), nie GeoJSON. |
| Budynki z `height` | 4 407 (3 %) | Wysokość liczyć z `building:levels` × 3 m, `height` tylko nadpisuje. |
| Budynki z `building:levels` | nie zmierzono (serwer Overpass przeciążony) | **Zmierzyć w Etapie 1**; od tego zależy jakość widoku 3D. Fallback: heurystyka wg typu budynku. |
| Budynki z `start_date` | 692 (0,5 %) | **Widok „wiek zabudowy” jako oś czasu nie ma sensu.** Suwak w doku pełni rolę suwaka parametru, nie osi czasu. |
| Osiedla (`admin_level=9`) | 48 | Komplet 48 osiedli → kartogramy i statystyki per osiedle. |
| Trasy tramwajowe (`route=tram`) | 49 | Warianty i kierunki; po złączeniu po `ref` ok. 23 linie. |
| Trasy autobusowe (`route=bus`) | 332 | Zbyt gęste na mapę główną; jako opcjonalna warstwa. |
| Przystanki tramwajowe (`railway=tram_stop`) | 465 | Do bufora „zasięg dojścia”. |
| Drogi na mostach (`highway` + `bridge`) | 994 | Wrocław = „miasto mostów”; mocny motyw widoku. |
| Obrysy mostów (`man_made=bridge`) | 394 | Poligony do podświetlenia. |
| Ścieżki rowerowe (`highway=cycleway`) | 3 441 | Warstwa w widoku Transport. |
| Wody (`natural=water`) | 809 | Odra, kanały, wyspy. |
| Zieleń (`landuse` grass/forest/meadow/allotments/cemetery/recreation_ground) | 18 649 | Udział zieleni per osiedle. |
| POI `amenity` (węzły) | 24 146 | Gęstość usług per osiedle, heatmapa. |
| POI `shop` (węzły) | 5 358 | j.w. |

Nie zmierzono (timeouty): `leisure=park/garden`, budynki z `building:levels`. Oba wchodzą do audytu w Etapie 1.

---

## 3. Widoki aplikacji (przełącznik top-right) i rola doku

Każdy widok to pionowy wycinek: warstwy mapy + panel doku + legenda + klucze i18n + hasła w słowniczku.

### MVP (4 widoki)

1. **Zabudowa 3D** (`view: buildings`)
   - Wytłaczanie budynków (`fill-extrusion`), wysokość = `height` lub `levels × 3`.
   - Kolor wg klasy budynku (mieszkalny / usługowy / przemysłowy / sakralny / publiczny / inny) lub wg liczby kondygnacji (przełącznik `app-switcher` w doku).
   - Suwak: **min. liczba kondygnacji** (0–30) z markerami presetów (3, 5, 11, 20). Play: automatyczny przelot po progach.
   - Hover: nazwa, kondygnacje, typ. Klik: popup ze szczegółami + link do obiektu na osm.org.

2. **Mosty i woda** (`view: bridges`)
   - Odra, kanały i wyspy jako wyróżniona warstwa wody; mosty (`man_made=bridge` + drogi z `bridge=*`) kolorowane wg typu: drogowy / tramwajowy / kolejowy / kładka piesza i rowerowa.
   - Suwak: **min. długość mostu (m)**. Toggle per typ mostu. Licznik mostów w doku.
   - Popup: nazwa, typ, długość (policzona w pipeline w EPSG:2180).

3. **Transport** (`view: transit`)
   - Linie tramwajowe (po `ref`, kolor z tagu `colour` lub palety kategorialnej), przystanki, ścieżki rowerowe (toggle), autobusy (toggle, domyślnie off).
   - Suwak: **zasięg dojścia do przystanku tramwajowego** (100–1000 m) → bufory liczone w przeglądarce (`@turf/buffer`) lub prekomputowane dla kroków 100 m.
   - Statystyka w doku: % powierzchni osiedli w zasięgu.

4. **Osiedla** (`view: districts`)
   - Kartogram 48 osiedli; metryka z `app-switcher`: liczba budynków, gęstość POI, udział zieleni, liczba przystanków tramwajowych.
   - Suwak: **próg metryki** (podświetla osiedla powyżej progu).
   - Klik: popup z kartą osiedla i mini-wykresem (porównanie do mediany miasta).

### Rozszerzenia (po MVP, w kolejności)

5. **Zieleń** — parki, lasy, ogródki działkowe, cmentarze; udział zieleni per osiedle.
6. **Usługi (POI)** — heatmapa wg kategorii (gastronomia, edukacja, zdrowie, kultura, handel).
7. **„Co jest otwarte o godzinie X”** — parser `opening_hours` (biblioteka `opening_hours`), suwak jako oś doby z Play. Jedyny widok z prawdziwą osią czasu.
8. **Wiek zabudowy** — tylko jeśli pokrycie `start_date` zostanie uzupełnione; dziś 0,5 %.
9. **Motyw Midnight** — wyłącznie w popupie ustawień (reguła `AGENTS.md`), zapis `wrovis.theme` w `localStorage`.

---

## 4. Pipeline danych (`tools/pipeline/`)

```
tools/pipeline/
  pyproject.toml            # uv, Python 3.12: quackosm, geopandas, pyarrow, shapely, pyproj
  00_fetch.py               # Geofabrik dolnoslaskie-latest.osm.pbf (~150 MB) + granica (relacja 451516)
  10_extract.py             # QuackOSM: filtr geometrii = granica, filtry tagów per temat → GeoParquet
  20_transform.py           # GeoPandas: normalizacja atrybutów, klasy budynków, długości (EPSG:2180), join do osiedli
  30_stats.py               # agregaty per osiedle + globalne → stats.json
  40_tiles.ps1 / .sh        # tippecanoe (Docker/WSL) lub `ogr2ogr -f PMTiles` (GDAL ≥ 3.8, pip install gdal)
  manifest.json             # data migawki OSM, liczności, atrybucja ODbL
```

Wyjścia do `src/assets/data/`:

| Plik | Format | Zawartość |
| :--- | :--- | :--- |
| `buildings.pmtiles` | PMTiles, z12–z16 | 146 k budynków: `class`, `levels`, `height_m`, `name`, `osm_id` |
| `water.pmtiles` | PMTiles | wody + nazwy |
| `bridges.geojson` | GeoJSON (uproszczony) | ~1,4 k obiektów: `kind`, `name`, `length_m` |
| `tram_lines.geojson`, `tram_stops.geojson` | GeoJSON | linie po `ref`, kolor, przystanki |
| `cycleways.pmtiles` | PMTiles | 3,4 k dróg |
| `districts.geojson` | GeoJSON (uproszczony ~5 m) | 48 osiedli + metryki |
| `stats.json` | JSON | agregaty do doku i popupów |

Budżet rozmiaru: łącznie ≤ 50 MB w repo (limit GitHub 100 MB/plik). Jeśli przekroczone: kafle budowane w CI w `deploy.yml` (workflow pobiera Geofabrik i uruchamia pipeline, wynik trafia tylko do artefaktu Pages) albo hosting PMTiles na Cloudflare R2 z CORS.

Narzędzia lokalne (stan na dziś): Node 24.14, Python 3.14 (pipeline pinuje 3.12 przez `uv` ze względu na koła geopandas/duckdb), brak Javy, Dockera, GDAL, osmium, WSL. Do tippecanoe potrzebny Docker Desktop lub WSL2; alternatywa bez nich: `pip install gdal` i `ogr2ogr -f PMTiles`.

---

## 5. Architektura aplikacji (`src/app/`)

```
src/app/
  app.component.*            # HUD ze szkieletu: brand, język, przełącznik widoków, dok, popup, tooltip
  core/i18n/                 # ze szkieletu; klucze per widok, słowniczek
  core/map/
    map.service.ts           # instancja MapLibre (poza NgZone), rejestracja protokołu pmtiles, padding pod HUD
    style.builder.ts         # styl JSON z tokenów ThemeService (bg-deep, map-bg, line, accent…) + warstwy bazowe
    layers.registry.ts       # deklaratywne definicje warstw per widok (source, layer, legenda, interakcje)
  core/data/
    data.service.ts          # ładowanie GeoJSON/stats.json, progres do SplashService
    stats.model.ts
  core/state/
    app.state.ts             # sygnały: currentView, sliderValue, hoveredFeature, selectedDistrict, toggles
  features/
    buildings/  bridges/  transit/  districts/     # po jednym: *.view.ts (warstwy) + *.dock.ts (panel doku)
    inspector/               # hover tooltip (canvas pill wg reguł design.md) + popup szczegółów (PopupService)
  shared/
    legend/                  # legenda kategorialna / sekwencyjna z tokenów (skill dataviz)
    scales.ts                # skale kolorów budowane z tokenów palety KMD
```

Zasady:
- Mapa żyje w `.stage` (100vw × 100vh); HUD nad nią; `map.setPadding` uwzględnia `--dock-clearance` i wysokość nagłówka.
- Zmiana widoku = przełączenie zestawu warstw w `layers.registry` (bez niszczenia mapy) + wymiana panelu doku.
- `app-timeline-slider` ze szkieletu służy jako suwak parametru; `min/max/step/markers` konfigurowane per widok.
- Hover przez `feature-state`, nie przez przebudowę warstw; filtrowanie suwakiem przez `setFilter` / wyrażenia.
- Atrybucja `© OpenStreetMap contributors` (ODbL) zawsze widoczna: kompaktowa kontrolka MapLibre + wpis w słowniczku.
- SEO/OG przez `SeoService`, własny `og-image` przez `scripts/generate-og.mjs`.

---

## 6. Etapy i kryteria ukończenia

| Etap | Zakres | Gotowe, gdy | Szacunek |
| :--- | :--- | :--- | ---: |
| **0. Szkielet** | scaffold CLI, scalenie do tego repo, submoduł, `npm start`, `maplibre-gl` + `pmtiles`, pusta mapa Wrocławia na OpenFreeMap | aplikacja działa lokalnie z HUD i mapą; commit | 0,5 dnia |
| **1. Dane** | pipeline `00–40`, audyt `building:levels` i parków, pierwsze PMTiles/GeoJSON, `manifest.json` | pliki w `src/assets/data/` w budżecie; raport pokrycia tagów | 2–3 dni |
| **2. Rdzeń mapy** | `MapService`, `style.builder` z tokenów, rejestr warstw, przełącznik widoków, splash z progresem, inspektor hover/klik | styl reaguje na `ThemeService.mode()`; przełączanie widoków bez migotania | 1–2 dni |
| **3. Widoki MVP** | Zabudowa 3D → Mosty i woda → Transport → Osiedla (każdy: warstwy, dok, legenda, i18n PL/EN, słowniczek) | każdy widok ma suwak, legendę, popup, oba języki | 4–6 dni |
| **4. Wykończenie** | mobile (`respond-to`, dok ikonowy), a11y (ARIA, klawiatura), wydajność (z-levels, simplify, Lighthouse), checklista `design.md` §8 | Lighthouse ≥ 90 perf/a11y na desktopie; checklista odhaczona | 1–2 dni |
| **5. Wdrożenie** | `deploy.yml`, README z atrybucją ODbL/Geofabrik/OpenFreeMap, OG image, tag `v1.0.0` | strona na GitHub Pages działa z czystej przeglądarki | 0,5 dnia |
| Rozszerzenia | widoki 5–9 z §3 | każdy jako osobny PR | wg potrzeb |

---

## 7. Ryzyka i sposoby obejścia

| Ryzyko | Skutek | Obejście |
| :--- | :--- | :--- |
| CLI szkieletu tworzy **nowy katalog** i robi `git init`; odmawia pracy w niepustym katalogu | nie da się scaffoldować bezpośrednio w `wroVIS` | scaffold do katalogu tymczasowego, skopiowanie plików (bez `.git`) do repo, ponowne `git submodule add` (§8) |
| `scripts/setup-github.mjs` i `sync-design-system.yml` zakładają organizację `kmd-labs` i sekrety `KMD_BOT_*` | błędy workflow, próba utworzenia repo w cudzej organizacji | uruchomić CLI z `--no-github`; usunąć `sync-design-system.yml` lub podmienić repo na `marcinwood/wroVIS`; `deploy.yml` działa na `github.token` |
| Brak `building:levels` w dużej części budynków | płaski lub losowy widok 3D | audyt w Etapie 1; heurystyka wysokości wg klasy; uczciwe oznaczenie „wysokość szacowana” w legendzie |
| `start_date` w 0,5 % budynków | brak osi czasu zabudowy | suwaki parametrów zamiast osi czasu; oś doby dopiero w widoku `opening_hours` |
| tippecanoe nie działa natywnie na Windows | blokada generowania PMTiles | Docker Desktop / WSL2 albo GDAL `ogr2ogr -f PMTiles` |
| Rozmiar PMTiles > limit repo | brak możliwości commitu | budowanie w CI lub R2 (§4) |
| Overpass ma limity i timeouty | audyt niepowtarzalny | pipeline opiera się na ekstrakcie Geofabrik, Overpass tylko do szybkich sprawdzeń |
| OpenFreeMap to zewnętrzna usługa | ryzyko dostępności | styl trzyma źródło w jednym miejscu; plan B = Planetiler PMTiles |
| Reguły `AGENTS.md` (hex w rendererze, hardcoded stringi) | odrzucenie w review | `style.builder` tylko z tokenów; typ `Dict` wymusza parytet `en.ts`/`pl.ts` |

---

## 8. Etap 0 — wykonane 2026-11-16 (gałąź `feat/etap-0-szkielet`)

Repo ma remote `https://github.com/kmd-labs/wroVIS`, więc skrypt `setup-github.mjs` i workflow `sync-design-system.yml` ze szkieletu zostają (zakładają organizację `kmd-labs`). Poprawiono tylko slug w adresach: base-href `/wroVIS/`, OG `kmd-labs.github.io/wroVIS/`.

```powershell
# 1. Scaffold w katalogu tymczasowym. Uwaga: na Windows `wrovis` i `wroVIS` to ten sam katalog,
#    więc nie można scaffoldować obok repo. Bez TTY CLI nie pyta o tytuł (daje "Wrovis") — poprawiono sed-em.
cd $env:TEMP
npx github:kmd-labs/design-system wrovis --no-github

# 2. Skopiować wygenerowane pliki do repo (bez .git, .gitmodules i src/design-system)
# 3. W repo: git submodule add -b main https://github.com/kmd-labs/design-system.git src/design-system
# 4. npm install --legacy-peer-deps; npm install maplibre-gl pmtiles @turf/buffer
# 5. npm start
```

Dodane pliki: `src/app/core/map/{map.config,map.service,map-stage.component}.ts`, CSS MapLibre w `angular.json`, kontrolka atrybucji ostylowana tokenami w `styles.scss`, klucze i18n dla splasha i SEO. Mapa: OpenFreeMap `positron`, centrum Rynek, zoom 12, `maxBounds` wokół miasta, protokół `pmtiles` zarejestrowany.

**Pułapka MapLibre 6 (rozwiązana):** biblioteka jest ESM-only i szuka workera `maplibre-gl-worker.mjs` obok `import.meta.url`, czyli obok `main.js` Angulara, gdzie go nie ma („Worker failed to load”, w dev i prod). Rozwiązanie: wpis `assets` w `angular.json` kopiuje plik do `assets/maplibre/`, a `MapService` woła `setWorkerUrl()` przed utworzeniem mapy.

Weryfikacja: build dev i prod bez ostrzeżeń; headless Edge (puppeteer-core) na 1440×900 i 400×800 pokazuje mapę z HUD, splash znika po załadowaniu stylu, 0 błędów w konsoli, brak przewijania poziomego na mobile.

---

## 9. Atrybucja i licencje

- Dane: © OpenStreetMap contributors, ODbL 1.0. Atrybucja widoczna na mapie i w README.
- Ekstrakt: Geofabrik (`download.geofabrik.de/europe/poland/dolnoslaskie.html`).
- Mapa bazowa: OpenFreeMap (dane OSM, styl własny).
- Szkielet: `kmd-labs/design-system`, Apache 2.0.
