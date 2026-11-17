import { Dict } from './i18n.types';

export const EN: Dict = {
  htmlLang: 'en',
  docTitle: 'KMD · wroVIS',
  docDescription:
    'Interactive visualisation of Wrocław built on OpenStreetMap data: 3D buildings, bridges, tram network and districts.',
  langName: 'English',

  // Top HUD & Navigation
  changeLanguage: 'Language',
  chooseView: 'View',
  stageAriaLabel: 'Interactive map of Wrocław',

  // Views
  viewBuildings: '3D buildings',
  viewBridges: 'Bridges & water',
  viewTransit: 'Transport',
  viewDistricts: 'Districts',
  viewBuildingsDesc: 'Building footprints extruded by height and coloured by use',
  viewBridgesDesc: 'The Odra, canals and the bridge network by type',
  viewTransitDesc: 'Tram tracks, stops, cycleways and walking range',
  viewDistrictsDesc: 'The 48 districts compared on one metric',

  // Splash / loading states
  splashLoadingMap: 'Loading map…',
  splashLoadingData: 'Loading data…',
  splashReady: 'Ready',
  splashMapError: 'The map could not be loaded. Check your connection and reload the page.',

  // Bottom Dock
  sliderBuildingsMinLevels: 'Show buildings with at least',
  sliderBridgesMinLength: 'Show bridges longer than',
  sliderTransitRadius: 'Walking range from tram stops',
  sliderDistrictsThreshold: 'Highlight districts from',
  unitLevels: 'storeys',
  unitMeters: 'm',
  presetAll: 'All',
  legend: 'Legend',
  glossary: 'Glossary',
  glossaryDesc:
    'Map data © OpenStreetMap contributors (ODbL). Basemap tiles by OpenFreeMap. Building heights come from the height tag, otherwise from the number of storeys (3 m each) or an estimate by building class.',
  close: 'Close',

  // Legend labels
  bldResidential: 'Residential',
  bldCommercial: 'Commercial & offices',
  bldPublic: 'Public & sacred',
  bldIndustrial: 'Industrial & utilities',
  bldOther: 'Other / unknown',
  brRoad: 'Road bridge',
  brTram: 'Tram bridge',
  brRail: 'Railway bridge',
  brFoot: 'Footbridge & cycle bridge',
  brOther: 'Other',
  brWater: 'Water',
  trTramTrack: 'Tram track',
  trTramStop: 'Tram stop',
  trCycleway: 'Cycleway',
  trWalkRadius: 'Walking range',

  // District metrics
  metricBuildingsPerKm2: 'Buildings per km²',
  metricBuildings: 'Number of buildings',
  metricPoiPerKm2: 'Services per km²',
  metricGreenPct: 'Green space share',
  metricTramStops: 'Tram stops',

  // Inspector
  inspBuilding: 'Building',
  inspBridge: 'Bridge',
  inspTramStop: 'Tram stop',
  inspTramTrack: 'Tram track',
  inspDistrict: 'District',
  inspNoName: 'Unnamed',
  classResidential: 'residential',
  classCommercial: 'commercial',
  classIndustrial: 'industrial',
  classPublic: 'public',
  classReligious: 'sacred',
  classUtility: 'utility',
  classOther: 'other',
  propClass: 'Class',
  propOsmType: 'OSM tag',
  propLevels: 'Storeys',
  propHeight: 'Height',
  propYear: 'Built',
  propKind: 'Type',
  propLength: 'Length',
  propRoutes: 'Lines',
  propArea: 'Area',
  propBuildings: 'Buildings',
  propBuildingsPerKm2: 'Buildings per km²',
  propPoiPerKm2: 'Services per km²',
  propGreenPct: 'Green space',
  propWaterPct: 'Water',
  propTramStops: 'Tram stops',
  propBridges: 'Bridge sections',
  propLevelsMean: 'Average storeys',
  propMaxHeight: 'Tallest building',
  heightMeasured: 'measured',
  heightFromLevels: 'from storeys',
  heightEstimated: 'estimated',
  cityMedian: 'city median',
  openInOsm: 'Open in OpenStreetMap',
  unitStoreysShort: 'fl.',

  // Attribution
  dataAttribution: 'Map data © OpenStreetMap contributors (ODbL) · Basemap: OpenFreeMap',
  dataExtractDate: 'OSM extract'
};
