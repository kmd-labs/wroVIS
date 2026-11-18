# wroVIS — plan interaktywnej wizualizacji Wrocławia na danych OSM

**Stan na 2026-11-18:** Etapy 0–3 i 5 zrobione, Etap 4 (wykończenie) w części. Na gałęzi `feat/jedna-mapa-lewy-dok`: przebudowa z pięciu widoków na **jedną mapę 3D z warstwami**, dok po lewej, pastylka palety Normalna / Neon, wyszukiwarka adresów, trasy piesze i rowerowe (przez ulice / bez ulic), lista lokali w karcie budynku (§10, 2026-11-18). Wdrożona wersja na GitHub Pages: <https://kmd-labs.github.io/wroVIS/> (`main` = `e584f58`).

---

## 1. Decyzje architektoniczne

| Obszar | Decyzja | Uzasadnienie |
| :--- | :--- | :--- |
| Szkielet aplikacji | `npx github:kmd-labs/design-system` → Angular 21 standalone + submoduł `src/design-system` | Wymóg zadania. Daje gotowy HUD (brand + język, przełącznik widoków, dolny dok z suwakiem), i18n, splash, popupy, tokeny SCSS. |
| Silnik mapy | **MapLibre GL JS 6** + protokół **PMTiles** | WebGL, wektorowe kafle, wytłaczanie budynków 3D (`fill-extrusion`), `feature-state` do hover i zaznaczeń. Brak serwera kafli: PMTiles to jeden plik serwowany statycznie (GitHub Pages obsługuje HTTP Range). |
| Mapa bazowa | Kafle wektorowe **OpenFreeMap** (schemat OpenMapTiles, bez klucza API) + własny styl JSON generowany z tokenów KMD | Zero infrastruktury. Opcja B (jeśli zależność zewnętrzna przeszkadza): własny `wroclaw-basemap.pmtiles` z Planetiler (Java 21). |
| Warstwy tematyczne | Własne pliki z OSM: duże warstwy → PMTiles, małe → zminimalizowany GeoJSON, grafy sieci → binaria gzip w `src/assets/data/` | Pełna kontrola atrybutów (kondygnacje, typ i długość mostu, adres, linia tramwajowa, osiedle). |
| Pipeline danych | **Node.js, czysty JS** (`osm-pbf-parser`, `geojson-vt`, `vt-pbf`, turf, własny writer PMTiles v3) w `tools/pipeline/` | Windows Smart App Control na tej maszynie blokuje niepodpisane binaria natywne (numpy, CPython z uv), więc Python/GDAL/tippecanoe odpadają. Jeden toolchain z aplikacją. |
| Analizy sieciowe | Grafy pieszy i rowerowy budowane w pipeline, **Dijkstra w przeglądarce** (`core/walk/walk-graph.ts`) | Bez backendu: zasięg pieszy liczy się w 1–7 ms, odcinek trasy rowerowej w 1–3 ms. Liczone tylko na klik / zmianę suwaka, nic nie działa w tle. |
| Styl i motyw | Kolory mapy wyłącznie z tokenów (`ThemeService.getTokenColor()`), styl przebudowywany w `effect()` i nakładany przez `setStyle(…, { diff: true })` | Wymóg `AGENTS.md` (brak hex w rendererze, Light domyślnie, Midnight opt-in). Palety Neon View jako tokeny `--color-cy-*` w `styles.scss`. |
| Teksty | Każdy string przez `I18nService` (`en.ts` + `pl.ts`) | Wymóg `AGENTS.md`; typ `Dict` wymusza parytet języków. |
| Wdrożenie | GitHub Pages przez `deploy.yml` ze szkieletu (push do `main` + co 6 h) | Repo **publiczne** (prywatne repo organizacji na darmowym planie nie ma Pages), źródło Pages: GitHub Actions. |

Poza zakresem: deck.gl, three.js, backend, dane na żywo (MPK), dane spoza OSM. Routing jest w zakresie tylko jako analiza w przeglądarce (zasięg pieszy, trasa rowerowa).

---

## 2. Audyt danych OSM dla Wrocławia (Overpass, 2026-11-16)

Obszar: relacja OSM **451516** (granica miasta; area id `3600451516`). Przybliżony bbox: 16,81–17,18 E, 51,04–51,21 N.

| Cecha | Liczba | Wniosek |
| :--- | ---: | :--- |
| Budynki (`building=*`) | 145 983 | Warstwa główna; wymaga kafli (PMTiles), nie GeoJSON. |
| Budynki z `height` | 4 407 (3 %) | Wysokość liczyć z `building:levels` × 3 m, `height` tylko nadpisuje. |
| Budynki z `building:levels` | 49 874 (34,4 %, pomiar z ekstraktu) | Wystarczy do widoku 3D; reszta ma wysokość szacowaną wg klasy i jest tak oznaczona (`hsrc=estimated`). |
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

Uzupełnienie z ekstraktu (Etap 1): zieleń łącznie (leisure/landuse/natural) 32 456 poligonów, budynki z `building:levels` 34,4 %. Pełny audyt w `src/assets/data/manifest.json`.

---

## 3. Widoki aplikacji (przełącznik top-right) i rola doku

Każdy widok to pionowy wycinek: warstwy mapy + panel doku + legenda + klucze i18n + hasła w słowniczku. We wszystkich widokach z legendą kategorii **pozycje legendy są pastylkami**, które wyłączają swoją kategorię (filtr) albo warstwę (`legendLayers`); stan trwa do przeładowania strony. Suwak doku jest przypięty do dołu doku.

### Zrobione (wdrożone 2026-11-17)

1. **Zabudowa 3D** (`view: buildings`) — widok startowy
   - Wytłaczanie budynków (`fill-extrusion`), wysokość `height` → `levels × 3 m` → szacunek wg klasy; kolor wg 5 grup funkcji.
   - Klik w budynek: **karta przypięta obok budynku** (styl KMD, bez modalnego popupu): adres (tagi `addr:*` albo punkt adresowy w obrysie), co jest w środku (POI w obrysie), kondygnacje, wysokość ze źródłem, architekt, styl, zabytek, Wikipedia, link do OSM.
   - Przełącznik **„Zasięg pieszy”** w doku (domyślnie wyłączony, pamiętany w `wrovis.walk`). Włączony: suwak **czasu dojścia 5–20 min**, klik uruchamia „falę” zasięgu (5 km/h) po grafie pieszym, ulice w fioletowych pasmach 5/10/15/20 min, liczniki 8 kategorii miejsc w zasięgu z czasem do najbliższego, **budynki poza zasięgiem szare** (`feature-state.wt`). Wyłączony: tylko karta budynku, bez suwaka.

2. **Mosty i woda** (`view: bridges`)
   - Odra, kanały, obrysy mostów; odcinki na mostach kolorowane wg typu (drogowy / tramwajowy / kładka / kolejowy / inny).
   - Suwak **„mosty o długości do X m”** (w prawo przybywa dłuższych, na końcu skali wszystkie) z **licznikiem mostów i odcinków** przy suwaku, zgodnym z mapą i pastylkami (637 mostów; do 50 m 481, do 100 m 566, do 200 m 608, do 300 m 622). Most = odcinki pogrupowane w pipeline (`bid`, `blen`).

3. **Transport** (`view: transit`) — przełącznik trybu w doku:
   - **Zasięg przystanków:** tory i przystanki tramwajowe, drogi rowerowe, suwak promienia dojścia 100–1000 m wokół przystanków.
   - **Trasa rowerowa:** suwak zastępuje planer — klik dodaje punkty A, B, C…, punkty można przeciągać (trasa przelicza się na żywo), Cofnij / Wyczyść, km łącznie i per odcinek. Trasa **wyłącznie po drogach rowerowych połączonych w OSM** (tryb ścisły, bez łączenia przerw); punkt przyciągany do fragmentu sieci wspólnego dla obu końców odcinka; brak połączenia = czerwona przerywana linia i komunikat.

4. **Osiedla** (`view: districts`)
   - Kartogram 48 osiedli, **16 miar** do wyboru (lista w doku, otwiera się do góry), w tym statystyki ulic: gęstość km/km², udział ulic z tramwajem, strefy piesze, udział ulic ≤ 30 km/h (z pokryciem tagu `maxspeed`).
   - Suwak progu miary; karta osiedla z medianą miasta przy każdej wartości.
   - **Panel „Ranking osiedli”** po lewej (świadome odstępstwo od HUD, §5): akordeon 16 atrybutów zsynchronizowany z kartogramem, ranking 48 osiedli, najechanie obrysowuje osiedle, klik przybliża i otwiera kartę; na telefonie arkusz z przycisku w doku.

5. **Neon View** (`view: cyberpunk` w kodzie)
   - Nocna mapa: przyciemniona baza bez etykiet, budynki w 6 neonowych kategoriach z jasnością rosnącą z wysokością, świecące tory tramwajowe i drogi rowerowe, przystanki ze statycznym halo i nazwami od z15.
   - Dwie palety (Neon / KMD), przełącznik w doku, pamiętane w `wrovis.cyberPalette`; suwak min. kondygnacji.
   - Karta obiektu i dok w stylu **„neonowe szkło”**: zaokrąglone rogi KMD, gradientowa obwódka (kolor kategorii → wyróżnienie palety), miękki kolorowy cień, pastylka kategorii, Inter zwykłą wielkością liter. Celowo bez ścinanych rogów, linii skanu, monospace wersalikami i pulsowania — za bardzo kojarzyły się z UI znanej gry. Nazwa widoku neutralna (zamiast „CyberPunk”, „Night City View”).

### Z pierwotnego planu, jeszcze niezrobione

- Zabudowa 3D: przełącznik koloru wg liczby kondygnacji.
- Transport: autobusy (warstwa opcjonalna), statystyka „% powierzchni osiedli w zasięgu przystanków”.
- Osiedla: mini-wykres porównania z medianą w karcie osiedla.
- Popup mostu z długością całego mostu (dziś karta pokazuje długość odcinka).

### Rozszerzenia (kolejność propozycji)

1. **Linki do udostępniania** — stan w URL (widok, kamera, zaznaczenie, paleta), przycisk „Udostępnij”. ~0,5 dnia.
2. **Kinowe wejście i „Wycieczka po Wrocławiu”** — przelot kamery po splashu, Play w doku przelatuje po 8–10 ikonach miasta z podpisami; poprawione wysokości landmarków. 1–2 dni.
3. **Wyszukiwarka adresów** — 55 tys. adresów i 12 tys. ulic, indeks ładowany przy pierwszym użyciu. 1–2 dni.
4. **Szlif** — nachodzące etykiety presetów suwaka (3 / 5 kondygnacji), animowane liczby w doku, płynne przenikanie widoków, lazy-load MapLibre (bundle 1,4 MB).
5. **Zieleń** — parki, lasy, ogródki działkowe, cmentarze; udział zieleni per osiedle.
6. **Usługi (POI)** — heatmapa wg kategorii.
7. **„Co jest otwarte o godzinie X”** — parser `opening_hours`, suwak jako oś doby.
8. **Wiek zabudowy** — tylko jeśli pokrycie `start_date` wzrośnie (dziś 0,4 %).
9. **Motyw Midnight** — wyłącznie w popupie ustawień (reguła `AGENTS.md`), zapis `wrovis.theme`.

---

## 4. Pipeline danych (`tools/pipeline/`, Node.js)

Pierwotnie planowany pipeline w Pythonie (QuackOSM/GeoPandas, GDAL) nie uruchamia się na tej maszynie: Windows Smart App Control blokuje niepodpisane biblioteki natywne. Pipeline jest w Node.js bez binariów natywnych.

```
tools/pipeline/
  package.json             # npm run all = fetch → extract → stats → tiles (≈ 1,5 min po pierwszym pobraniu)
  src/00-fetch.mjs         # Geofabrik dolnoslaskie-latest.osm.pbf (MD5) + granica miasta (relacja 451516, Nominatim)
  src/10-extract.mjs       # jeden przebieg strumieniowy PBF → warstwy tematyczne data/work/*.geojson + audyt (≈ 27 s):
                           #   budynki (+ adres z punktów adresowych w obrysie, POI w środku, architekt, zabytek, Wikipedia),
                           #   ulice (klasa, nazwa, flaga `tram` liczona geometrycznie), mosty pogrupowane (`bid`, `blen`),
                           #   graf pieszy walk.bin.gz i rowerowy cycle.bin.gz
  src/30-stats.mjs         # statystyki 48 osiedli (16 miar, w tym ulice) → stats.json, districts.geojson (≈ 50 s)
  src/40-tiles.mjs         # geojson-vt + vt-pbf → wroclaw.pmtiles (własny writer PMTiles v3), weryfikacja, manifest.json (≈ 7 s)
  src/lib/                 # config, osm-geometry, pmtiles-writer, walk-graph (format binarny grafów), bridge-groups
  data/                    # raw/ i work/ — ignorowane w git
```

Wyjścia w `src/assets/data/` (commitowane, łącznie 21 MB):

| Plik | Rozmiar | Zawartość |
| :--- | ---: | :--- |
| `wroclaw.pmtiles` | 19,2 MB | z10–z14 (overzoom powyżej 14), 248 kafli; warstwy: `buildings` (z13+, z adresem i POI), `bridge_areas`, `water`, `waterways`, `green`, `tram_tracks`, `cycleways`, `bridges`, `streets` (z12+), `poi` |
| `walk.bin.gz` | 1,5 MB | graf pieszy: 202 tys. węzłów, 263 tys. krawędzi, 7 754 km, 13 tys. miejsc w 8 kategoriach; ładowany przy pierwszym kliknięciu w Zabudowie 3D |
| `cycle.bin.gz` | 70 kB | graf dróg rowerowych: 494 km, 265 składowych (74 % w jednej sieci); ładowany przy włączeniu planera |
| `districts.geojson` | 173 kB | 48 osiedli z wpisanymi metrykami |
| `bridges.geojson` | 375 kB | 1 332 odcinki na mostach (`kind`, `length_m`, `bid`, `blen`) |
| `tram_routes.geojson`, `tram_stops.geojson` | 398 / 86 kB | 49 wariantów tras (25 linii), 465 przystanków |
| `city.geojson`, `stats.json`, `manifest.json` | < 70 kB | granica, statystyki miasta i osiedli, metadane i audyt |

Format grafów (`lib/walk-graph.mjs` ↔ `core/walk/walk-graph.ts`): węzły w kolejności Mortona, współrzędne `Uint16` w pudełku kwantyzacji równym faktycznemu zasięgowi danych, krawędzie i geometria kodowane różnicowo, całość gzip (rozpakowanie w przeglądarce przez `DecompressionStream`).

Identyfikatory cech: `id = osmId×2` (way) lub `osmId×2+1` (relation), więc działają z `feature-state`; właściwość `osm` trzyma oryginalny odnośnik.

Narzędzia lokalne: Node 24.14; brak Javy, Dockera, GDAL, osmium, WSL, `gh`; Python 3.14 jest, ale Smart App Control blokuje natywne koła z PyPI.

---

## 5. Architektura aplikacji (`src/app/`)

```
src/app/
  app.component.*            # HUD: brand, język, przełącznik widoków, dok (suwak / liczniki / planer / przełączniki), legenda
  core/i18n/                 # Dict + en.ts / pl.ts
  core/map/
    map.service.ts           # MapLibre poza NgZone, protokół pmtiles, padding pod HUD i panel rankingu, hover/klik
    style.builder.ts         # pełny styl z tokenów; źródła runtime z live-sources.ts
    layers.registry.ts       # deklaratywne widoki: warstwy, legenda, suwak, interakcje, legendLayers, modeHidden
    live-sources.ts          # ostatnie dane źródeł zapisywanych w runtime (zasięg, trasa), żeby przebudowa stylu ich nie kasowała
    map.types.ts, map.config.ts, style.expr.ts
  core/data/                 # data.service (GeoJSON/stats), bridge-count.service, stats.model
  core/state/app.state.ts    # sygnały: widok, parametry, zaznaczenie, zasięg pieszy, tryb Transportu, punkty trasy, ukryte pozycje legendy
  core/walk/                 # walk-graph.ts (dekodowanie grafu, Dijkstra, zasięg, trasa), walk.service.ts (zasięg pieszy)
  core/bike/                 # bike-route.service.ts (planer trasy rowerowej, przeciąganie punktów)
  features/inspector/        # tooltip, popup szczegółów, karta obiektu przypięta do punktu (KMD / neonowe szkło), formatowanie
  features/districts/        # panel „Ranking osiedli”
  shared/                    # legenda (pastylki), skale kolorów, palety Neon View
```

Zasady:
- Mapa żyje w `.stage` (100vw × 100vh); HUD nad nią; padding kamery uwzględnia nagłówek, dok i panel rankingu.
- Zmiana widoku = przełączenie widoczności warstw z `layers.registry` (bez niszczenia mapy) + wymiana zawartości doku.
- Hover i zaznaczenia przez `feature-state`; filtry przez wyrażenia w stylu.
- Źródła GeoJSON wypełniane w runtime (`setData`) muszą trafiać też do `live-sources.ts`, inaczej `setStyle(diff)` po zmianie języka, motywu czy legendy je wyczyści.
- Nic nie animuje mapy w tle: obliczenia na klik / zmianę suwaka, krótkie animacje (fala zasięgu ≈ 1 s) same się kończą.
- Atrybucja `© OpenStreetMap contributors` (ODbL) zawsze widoczna: kompaktowa kontrolka MapLibre + wpis w słowniczku.
- **Odstępstwo od trzystrefowego HUD (`AGENTS.md` §2), świadome, na życzenie właściciela (2026-11-18):** dok jest kolumną **po lewej** (na telefonie arkusz od dołu, zwinięty do wyszukiwarki); prawy górny przełącznik widoków zniknął, bo widoki stały się warstwami; obok pastylki języka jest osobna pastylka palety Normalna / Neon (pastylka języka nadal zawiera tylko język). Panel „Ranking osiedli” stoi po prawej, gdy warstwa Osiedla jest włączona.

---

## 6. Etapy i kryteria ukończenia

| Etap | Zakres | Stan |
| :--- | :--- | :--- |
| **0. Szkielet** ✅ | scaffold CLI, submoduł, MapLibre + PMTiles, mapa Wrocławia na OpenFreeMap | 2026-11-16 |
| **1. Dane** ✅ | pipeline Node `00–40`, audyt tagów, PMTiles + GeoJSON + statystyki | 2026-11-16 |
| **2. Rdzeń mapy** ✅ | `MapService`, styl z tokenów, rejestr warstw, przełącznik widoków, splash, inspektor | 2026-11-17 (PR #1) |
| **3. Widoki MVP** ✅ | 4 widoki + Neon View, legendy, karty, i18n PL/EN | 2026-11-17 (PR #2); luki w §3 |
| **4. Wykończenie** ◐ | mobile: dok, karty i ranking sprawdzone na 400×800; a11y: ARIA w legendzie, rankingu, kartach, Esc; **brak**: audyt Lighthouse, checklista `design.md` §8, lazy-load MapLibre | w toku |
| **5. Wdrożenie** ✅ | GitHub Pages działa (<https://kmd-labs.github.io/wroVIS/>); **brak**: README z pełną atrybucją, własny OG image, tag `v1.0.0` | 2026-11-17 |
| Rozszerzenia | §3 „Rozszerzenia” | wg potrzeb, każde jako osobny PR |

---

## 7. Ryzyka i sposoby obejścia

| Ryzyko | Skutek | Obejście |
| :--- | :--- | :--- |
| Brak `building:levels` w ⅔ budynków | płaski widok 3D | wysokość szacowana wg klasy, źródło wysokości pokazywane w karcie budynku |
| `start_date` w 0,4 % budynków | brak osi czasu zabudowy | suwaki parametrów zamiast osi czasu |
| Smart App Control blokuje natywne narzędzia GIS | brak standardowego toolchainu | pipeline w czystym JS — zrealizowane |
| Rozmiar danych (21 MB, PMTiles 19 MB) | dłuższe pierwsze ładowanie, granica wygody dla repo | grafy ładowane leniwie; przy dalszym wzroście PMTiles budować w CI lub trzymać w R2 |
| OpenFreeMap to zewnętrzna usługa | ryzyko dostępności | źródło w jednym miejscu stylu; plan B = Planetiler PMTiles |
| **Pages w prywatnym repo organizacji** | `Create Pages site failed … Resource not accessible by integration` | repo publiczne + Settings → Pages → Source: GitHub Actions — zrealizowane 2026-11-17 |
| Sekrety `KMD_BOT_*` niedostępne dla repo | synchronizacja design systemu i auto-włączanie Pages zawodzą | po upublicznieniu działa; w razie regresji zainstalować aplikację KMD Bot w repo |
| Sieć dróg rowerowych w OSM jest poszatkowana (265 składowych) | tryb ścisły nadkłada drogi lub nie znajduje trasy | komunikat o braku połączenia; opcjonalnie łączenie przerw ≤ 25 m |
| Skojarzenia z marką gry (nazwa, UI ramek) | ryzyko prawne/wizerunkowe | nazwa „Neon View”, styl „neonowe szkło”; w komunikacji „w stylu cyberpunka” małą literą, bez nazw i grafik gry |
| Checkout na Windows zamienia końce linii na CRLF | wieloliniowe podmiany w skryptach zawodzą | skrypty normalizują `\r\n` → `\n`; rozważyć `.gitattributes` (`* text=auto eol=lf`) |
| Reguły `AGENTS.md` (hex w rendererze, stringi) | odrzucenie w review | styl tylko z tokenów; typ `Dict` wymusza parytet `en.ts`/`pl.ts` |

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

---

## 10. Dziennik postępu

### 2026-11-16
- Etap 0: szkielet KMD, MapLibre 6 + PMTiles, mapa Wrocławia (§8).
- Etap 1: pipeline Node `00–40`, warstwy tematyczne i statystyki osiedli.

### 2026-11-17
- Etap 2 (PR #1): rdzeń mapy, rejestr warstw, inspektor, legenda.
- Widok neonowy (najpierw „CyberPunk”): budynki w 6 kategoriach z jasnością wg wysokości, świecące tory i drogi rowerowe, 2 palety; dok i karta w stylu neonowym.
- Dane budynków w karcie: adresy (38 % budynków, w tym z punktów adresowych w obrysie), POI w środku, zabytek, architekt, Wikipedia. Warstwa `streets` z flagą tramwaju.
- Osiedla: statystyki ulic, 16 miar, panel rankingu z podświetleniem na mapie.
- Zasięg pieszy („miasto 15 minut”): graf pieszy w pipeline, Dijkstra w przeglądarce, fala, liczniki miejsc; potem przeniesiony do Zabudowy 3D (osobny widok usunięty), z przełącznikiem i wyszarzaniem budynków poza zasięgiem; suwak kondygnacji w Zabudowie 3D usunięty.
- Legenda jako pastylki we wszystkich widokach z kategoriami.
- Mosty: licznik mostów i odcinków, suwak „do X m”, grupowanie mostów w pipeline.
- Transport: planer trasy rowerowej po połączonych drogach rowerowych.
- Wdrożenie (PR #2 + merge do `main`): przyczyną nieudanych buildów było prywatne repo bez Pages; po upublicznieniu i ustawieniu źródła Pages na GitHub Actions wdrożenia przechodzą.
- Widok neonowy przemianowany na „Neon View”; ramki zmienione na „neonowe szkło”, pulsowanie przystanków zastąpione statycznym halo (mniej skojarzeń z grą, brak animacji w tle).

### 2026-11-18 — jedna mapa 3D, dok po lewej
- **Widoki → warstwy:** Zabudowa 3D, Mosty i woda, Transport, Osiedla i Neon View połączone w jedną mapę 3D. W doku przełączniki warstw (Budynki 3D, Tramwaje, Zasięg przystanków, Drogi rowerowe, Mosty i woda, Osiedla), pamiętane w `wrovis.layers`; włączona warstwa rozwija swój suwak i legendę. Wszystkie warstwy zostają w stylu, przełączanie zmienia tylko widoczność.
- **Paleta Normalna / Neon** (pastylka w lewym górnym rogu, `wrovis.palette`): neon zmienia bazę, budynki, tramwaje i drogi rowerowe; pozostałe warstwy dostają neonowe odpowiedniki tokenów (`NEON_TOKEN_ROLE`). Druga paleta neonowa (KMD) usunięta.
- **Narzędzia w doku** (`wrovis.tool`): Odkrywaj (klik = karta obiektu), 15 minut (Zasięg | Trasa piesza), Rower (Przez ulice | Bez ulic, `wrovis.bikeMode`). Punkty trasy są wspólne dla profili, więc tę samą trasę A→B można porównać pieszo i rowerem.
- **Trasy:** A* zamiast Dijkstry; nowy graf `bike.bin.gz` (6 657 km: drogi rowerowe + ulice dozwolone dla rowerów) z rodzajem krawędzi w pliku (flaga w nagłówku formatu grafu). „Przez ulice” liczy metr ulicy jako 1,25 m drogi rowerowej, a metr ulicy głównej jako 1,7 m; odcinki ulicami rysowane przerywaną linią, w doku podział km. „Bez ulic” = dotychczasowy tryb ścisły (`cycle.bin.gz`). Kierunek jazdy (jednokierunkowe) nie jest uwzględniany.
- **Wyszukiwarka adresów** na górze doku: `addresses.json.gz` (75 816 adresów na 2 206 ulicach, 0,4 MB), ładowana przy pierwszym fokusie; lista zawęża się z każdą literą, bez polskich znaków; wybór ulicy pokazuje jej numery. Wybrany adres działa w aktywnym narzędziu: karta budynku, start zasięgu albo kolejny punkt trasy.
- **Karta budynku** wymienia lokale w środku pogrupowane wg kategorii (właściwość `pois` w kaflach, do 40 pozycji); karta jest teraz jedna dla wszystkich obiektów (modalny popup szczegółów usunięty).
- **Subtelniejsze piny:** miejsca w zasięgu jako małe półprzezroczyste kropki od z14,5; mniejszy pin karty.
- **Suwaki:** pastylki presetów leżą dokładnie nad znacznikami i kciukiem (±1 px); szkielet rezerwował 42 px na przycisk akcji, którego dok nie ma, i liczył znaczniki na 0–100 % zamiast na zakresie ruchu kciuka; obejście w `app.component.scss` (do przeniesienia do design-systemu). Presety rozłożone równo: zasięg przystanków 200–1000 m (400 / 600 / 800), kondygnacje 5–25 co 5.
- **Trzecia paleta „Zachód” (Sunset):** jasna złota godzina nad wybrzeżem: brzoskwiniowa baza, turkusowa woda, pastelowe fasady w 6 kategoriach (róż, fiolet, koral, turkus, złoto, wrzos), ciepło-biały key light (kolorowe światło brudziło pastele). Dok i karta w szkle w barwach palety, obwódka róż → turkus. Paleta oryginalna: na prośbę o „styl GTA 6 / Vice City” zrobiono estetykę gatunku (Miami lat 80, zachód słońca) bez nazwy, logo, liternictwa i wyglądu gry (zob. §7, ryzyko skojarzeń z marką gry). Kod palet uogólniony: role `cy-<paleta>-<rola>` (`neon`, `sunset`), `PALETTE_LOOK` (ciemna/jasna baza, siła poświaty), `PALETTE_TOKEN_ROLE`.
- **Napisy miejsc w stylu palety** (`core/map/label-style.ts`): bez nowych czcionek (OpenFreeMap ma tylko Noto Sans Regular/Bold/Italic); charakter dają wielkość liter, rozstrzelenie, krój i poświata. Neon: wersaliki z szerokim rozstrzeleniem, biały rdzeń i rozmyta neonowa obwódka (Wrocław cyjan, osiedla czerwień); nazwy miejsc wracają na mapę neonową, ulice i wody dalej ukryte. Zachód: „WROCŁAW” różowymi rozstrzelonymi wersalikami na kremowej obwódce, osiedla i dzielnice śliwkową kursywą. Normalna bez zmian. Rozważone i odłożone: własne pliki glifów (np. Inter, czcionki palet) albo napisy jako elementy HTML.
- **Ranking osiedli w stylu palety:** wygląd „szkła palety” (Neon, Zachód) przeniesiony z doku do wspólnej klasy `.glass-panel.palette-glass` w `styles.scss`; zmienne `--neon-*` ustawia `AppComponent` na `:root`. Używają jej dok i panel rankingu.
- **Wyszukiwarka: sama ulica.** Wybór ulicy kadruje ją (zasięg jej adresów) i podświetla jej przebieg z warstwy `streets` (dopasowanie po nazwie: 2 179 z 2 206 ulic indeksu; pozostałe tylko kadrowanie). Poświata pulsuje 5 razy (~4 s) i zostaje jako stałe podświetlenie: animacja kończy się sama, zgodnie z zasadą „nic nie animuje mapy w tle”. Nazwa ulicy zostaje w polu, więc można dopisać numer.
- **Przelot na starcie:** po zniknięciu splasha kamera leci z widoku całego miasta nad Odrę i Ostrów Tumski, wzdłuż rzeki, i siada nad Rynkiem (~8 s, `INTRO_STOPS`). Przerywa go przeciągnięcie, kółko, dotyk lub klawisz; przy `prefers-reduced-motion` mapa od razu otwiera się nad Rynkiem.
- **Wydajność zasięgu i tras (pomiar profilerem):** sam Dijkstra/A* był szybki (zasięg 15 min ≈ 2 ms, trasa 12 km ≈ 20 ms); lag dawało oznaczanie budynków w zasięgu (≈ 170 ms przy każdym kliknięciu i po każdym przesunięciu mapy). Siatka węzłów jest teraz płaska i drobna (0,0005°, CSR) z wyszukiwaniem pierścieniowym: najbliższy węzeł 5× szybciej i zawsze poprawnie (stara siatka 5×5 komórek w 130 na 20 tys. punktów pomijała bliższy węzeł). Werdykty budynków są pamiętane dla bieżącego zasięgu, a `feature-state` zapisywany tylko przy zmianie; A* używa wielokrotnie tych samych buforów (bez ~4 MB alokacji na każdy ruch myszy przy przeciąganiu). Graf pieszy ładuje się po otwarciu „15 minut”, nie przy pierwszym kliknięciu.
- **Usunięte suwaki:** „Pokaż budynki o co najmniej X kondygnacji” (palety Neon/Zachód) i „Pokaż mosty o długości do X m” wraz z licznikiem mostów (`BridgeCountService`), parametrami `neonMinLevels` / `bridgesMaxLength` i ich tekstami. Mosty filtrują już tylko pastylki legendy (rodzaje mostów, woda).
- **Narzędzia a osiedla:** przejście na „15 minut” albo „Rower” wyłącza warstwę Osiedla (kartogram zasłaniał zasięg i trasy); to samo przy wczytaniu strony z zapamiętanym narzędziem. W „Odkrywaj” można ją włączyć z powrotem.
- **Kolory tras i osiedli wg palety:** trasy (piesze i rowerowe) w barwie, której nie używa żadna inna warstwa palety: Normalna fiolet, Neon gorąca magenta (kontrast z tłem 6,9:1, ciemna obwódka), Zachód elektryczny indygo (6,2:1, kremowa obwódka). Kartogram osiedli ma własną skalę 4 stopni w każdej palecie: Normalna niebieska (KMD), Neon od przygaszonego indygo do elektrycznego fioletu, Zachód brzoskwinia → koral → róż → śliwka; kolejne stopnie różnią się o 1,3–1,9:1. Role `route` i `ramp-1…4` w `cy-<paleta>-*`.
- **Warstwy jak akordeon:** włączona warstwa rozwija swoje ustawienia, pozostałe się zwijają (zostają włączone); strzałka przy włączonej warstwie rozwija ją z powrotem. Miary osiedli to przewijana lista w doku (16 pozycji, ok. 7 widocznych) zamiast listy rozwijanej, którą dok przycinał.
- **Trasy na fioletowo** (nie pomarańczowo jak budynki mieszkalne i tramwaje) z szeroką jasną obwódką; adres dodany z wyszukiwarki kadruje całą trasę.
- **Poprawka:** klik w miejsce przy odciętym fragmencie sieci (np. dziedziniec Ratusza) zamykał zasięg w kilku metrach; zasięg i trasy łapią się teraz sieci właściwej (składowe ≥ 200 węzłów).

### Odrzucone (z powodem)
- **Pozycje tramwajów i autobusów na żywo (MPK):** endpoint MPK działa, ale jest nieoficjalny i bez CORS (wymagałby proxy, np. Cloudflare Worker); oficjalne otwarte dane CUI (CC0) też bez CORS i z wątpliwą aktualnością. Odłożone.
- **„Doba tramwajów” (odtwarzanie rozkładu GTFS):** zbudowane i wycofane — ciągła animacja ~4 tys. kursów wyraźnie spowalniała aplikację, a dane nie są na żywo.
- **Przyciski obrotu/nachylenia kamery:** zbędne, gesty MapLibre wystarczają (prawy przycisk / Ctrl + przeciąganie, dwa palce).
- **Nazwy etykiet ulic unoszących się nad ulicą:** do ponownego rozważenia na bazie warstwy `streets`.

### Następne kroki
1. Linki do udostępniania (stan w URL).
2. Kinowe wejście i wycieczka po ikonach miasta.
3. Etap 4: audyt Lighthouse, poprawki a11y, nachodzące etykiety presetów suwaka, lazy-load MapLibre.
4. Etap 5: README z atrybucją (ODbL, Geofabrik, OpenFreeMap), własny OG image, tag `v1.0.0`.
5. Wyszukiwarka adresów.
