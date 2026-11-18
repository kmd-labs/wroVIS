export type Lang = 'en' | 'pl';

/**
 * Every user-facing text of the application in one language.
 * Add new translation keys here first so TypeScript enforces parity across en.ts and pl.ts.
 */
export interface Dict {
  htmlLang: string;
  docTitle: string;
  docDescription: string;
  langName: string;

  // Top HUD & Navigation
  changeLanguage: string;
  stageAriaLabel: string;

  // Views (top-right switcher) and their dock subtitles

  // Splash / loading states
  splashLoadingMap: string;
  splashLoadingData: string;
  splashReady: string;
  splashMapError: string;

  // Bottom Dock
  sliderTransitRadius: string;
  sliderDistrictsThreshold: string;
  unitMeters: string;
  presetAll: string;
  palette: string;
  paletteNeon: string;
  paletteNeonHint: string;
  glossary: string;
  legend: string;
  glossaryDesc: string;
  close: string;

  // Legend labels
  bldResidential: string;
  bldCommercial: string;
  bldPublic: string;
  bldIndustrial: string;
  bldOther: string;
  bldPublicOnly: string;
  bldReligious: string;
  brRoad: string;
  brTram: string;
  brRail: string;
  brFoot: string;
  brOther: string;
  brWater: string;
  trTramTrack: string;
  trTramStop: string;
  trCycleway: string;
  trWalkRadius: string;

  // District metrics
  metricBuildingsPerKm2: string;
  metricBuildings: string;
  metricPoiPerKm2: string;
  metricGreenPct: string;
  metricTramStops: string;
  metricStreetsPerKm2: string;
  metricTramStreetPct: string;
  metricPedestrianKm: string;
  metricSlowStreetPct: string;
  metricStreetsKm: string;
  metricArea: string;
  metricPoi: string;
  metricWaterPct: string;
  metricBridges: string;
  metricLevelsMean: string;
  metricMaxHeight: string;
  rankingTitle: string;
  rankingButton: string;
  rankingHint: string;
  chooseMetric: string;

  // Inspector (hover tooltip & details popup)
  inspBuilding: string;
  inspBridge: string;
  inspTramStop: string;
  inspTramTrack: string;
  sliderWalkMinutes: string;
  unitMinutes: string;
  minutesOnFoot: string;
  wk5: string;
  wk10: string;
  wk15: string;
  wk20: string;
  wkPlace: string;
  wkOrigin: string;
  walkHint: string;
  bkRoute: string;
  bkPoint: string;
  bikeAddMore: string;
  bikeLoading: string;
  bikeError: string;
  bikeTotal: string;
  bikeNoLink: string;
  unitKm: string;
  wkOutside: string;
  legendHide: string;
  legendShow: string;
  walkLoading: string;
  walkError: string;
  walkOutside: string;
  walkNearest: string;
  walkNone: string;
  placeShop: string;
  placeFood: string;
  placeEducation: string;
  placeHealth: string;
  placeCulture: string;
  placeServices: string;
  placeTram: string;
  placePark: string;
  inspDistrict: string;
  inspNoName: string;
  classResidential: string;
  classCommercial: string;
  classIndustrial: string;
  classPublic: string;
  classReligious: string;
  classUtility: string;
  classOther: string;
  propClass: string;
  propOsmType: string;
  propLevels: string;
  propHeight: string;
  propYear: string;
  propKind: string;
  propLength: string;
  propRoutes: string;
  propArea: string;
  propBuildings: string;
  propBuildingsPerKm2: string;
  propPoiPerKm2: string;
  propGreenPct: string;
  propWaterPct: string;
  propTramStops: string;
  propBridges: string;
  propLevelsMean: string;
  propMaxHeight: string;
  heightMeasured: string;
  heightFromLevels: string;
  heightEstimated: string;
  cityMedian: string;
  openInOsm: string;
  openInWikipedia: string;
  unitStoreysShort: string;
  propStreetsKm: string;
  propStreetsPerKm2: string;
  propTramStreetPct: string;
  propPedestrianKm: string;
  propSlowStreetPct: string;
  maxspeedCoverage: string;
  propAddress: string;
  andMore: string;
  propArchitect: string;
  propStyle: string;
  propHeritage: string;
  heritageListed: string;
  heritageRef: string;

  // Dock, tools, layers and search
  paletteNormal: string;
  paletteNormalHint: string;
  paletteSunset: string;
  paletteSunsetHint: string;
  dockLabel: string;
  dockCollapse: string;
  dockExpand: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchLoading: string;
  searchError: string;
  searchNoResults: string;
  searchClear: string;
  searchStreetHint: string;
  addressOne: string;
  addressFew: string;
  addressMany: string;
  toolLabel: string;
  toolExplore: string;
  toolWalk: string;
  toolBike: string;
  toolExploreHint: string;
  toolWalkHint: string;
  toolBikeHint: string;
  exploreHint: string;
  walkModeLabel: string;
  walkModeReach: string;
  walkModeRoute: string;
  bikeModeLabel: string;
  bikeModeStreets: string;
  bikeModeCycleways: string;
  bikeModeStreetsHint: string;
  bikeModeCyclewaysHint: string;
  routeHintWalk: string;
  routeHintBikeStreets: string;
  routeHintBikeCycleways: string;
  routeWalkTotal: string;
  routeBikeTotal: string;
  routeTimeWalk: string;
  routeTimeBike: string;
  bikeOnCycleways: string;
  bikeOnStreets: string;
  routeNoLink: string;
  routeLoadingWalk: string;
  routeLoadingBike: string;
  routeError: string;
  routeUndo: string;
  routeClear: string;
  bkStreet: string;
  wrRoute: string;
  layersTitle: string;
  layerExpand: string;
  layerCollapse: string;
  layerBuildings: string;
  layerTrams: string;
  layerStopRadius: string;
  layerCycleways: string;
  layerBridges: string;
  layerDistricts: string;
  layerBuildingsHint: string;
  layerTramsHint: string;
  layerStopRadiusHint: string;
  layerCyclewaysHint: string;
  layerBridgesHint: string;
  layerDistrictsHint: string;
  inspPlacesTitle: string;
  poiFinance: string;
  poiPublic: string;
  poiCulture: string;
  poiSport: string;
  poiWorship: string;
  poiTransport: string;

  // Attribution
  dataAttribution: string;
  dataExtractDate: string;
}
