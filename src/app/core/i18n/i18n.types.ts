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
  chooseView: string;
  stageAriaLabel: string;

  // Views (top-right switcher) and their dock subtitles
  viewBuildings: string;
  viewBridges: string;
  viewTransit: string;
  viewDistricts: string;
  viewCyberpunk: string;
  viewBuildingsDesc: string;
  viewBridgesDesc: string;
  viewTransitDesc: string;
  viewDistrictsDesc: string;
  viewCyberpunkDesc: string;

  // Splash / loading states
  splashLoadingMap: string;
  splashLoadingData: string;
  splashReady: string;
  splashMapError: string;

  // Bottom Dock
  sliderBuildingsMinLevels: string;
  sliderBridgesMaxLength: string;
  upTo: string;
  sliderTransitRadius: string;
  sliderDistrictsThreshold: string;
  unitLevels: string;
  unitMeters: string;
  presetAll: string;
  palette: string;
  paletteNeon: string;
  paletteKmd: string;
  paletteNeonHint: string;
  paletteKmdHint: string;
  legend: string;
  glossary: string;
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
  transitModeLabel: string;
  transitModeRadius: string;
  transitModeBike: string;
  bkRoute: string;
  bkPoint: string;
  bikeHint: string;
  bikeAddMore: string;
  bikeLoading: string;
  bikeError: string;
  bikeTotal: string;
  bikeNoLink: string;
  bikeUndo: string;
  bikeClear: string;
  unitKm: string;
  bridgeOne: string;
  bridgeFew: string;
  bridgeMany: string;
  segmentOne: string;
  segmentFew: string;
  segmentMany: string;
  walkToggle: string;
  walkToggleHint: string;
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
  propInside: string;
  unitPlaces: string;
  propArchitect: string;
  propStyle: string;
  propHeritage: string;
  heritageListed: string;
  heritageRef: string;

  // Attribution
  dataAttribution: string;
  dataExtractDate: string;
}
