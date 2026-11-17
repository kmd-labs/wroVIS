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
  viewBuildingsDesc: string;
  viewBridgesDesc: string;
  viewTransitDesc: string;
  viewDistrictsDesc: string;

  // Splash / loading states
  splashLoadingMap: string;
  splashLoadingData: string;
  splashReady: string;
  splashMapError: string;

  // Bottom Dock
  sliderBuildingsMinLevels: string;
  sliderBridgesMinLength: string;
  sliderTransitRadius: string;
  sliderDistrictsThreshold: string;
  unitLevels: string;
  unitMeters: string;
  presetAll: string;
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

  // Inspector (hover tooltip & details popup)
  inspBuilding: string;
  inspBridge: string;
  inspTramStop: string;
  inspTramTrack: string;
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
  unitStoreysShort: string;

  // Attribution
  dataAttribution: string;
  dataExtractDate: string;
}
