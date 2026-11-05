// Sources gratuites, par pays. Ordre = priorité par défaut quand deux sources se valent sur une chaîne.
// Ajouter une source : une ligne ici. Plusieurs adresses = miroirs essayés dans l'ordre.

const MJH = (path) => [`https://i.mjh.nz/${path}`, `https://cdn.jsdelivr.net/gh/matthuisman/i.mjh.nz@master/${path}`];

export const SOURCES = {
  fr: [
    {
      code: 'xmltvfr',
      name: 'XML TV Fr (xmltvfr.fr)',
      urls: ['https://xmltvfr.fr/xmltv/xmltv_fr.xml.gz'],
      note: 'Projet open source racacax/XML-TV-Fr : TNT, câble, satellite, Belgique, DOM',
      // « La chaîne du Père Noël » y reçoit des matchs de foot (vu le 05/11/2026) : écartée
      exclude: ['PereNoel.fr'],
    },
    {
      code: 'epgshare01',
      name: 'EPGSHARE01 France',
      urls: ['https://epgshare01.online/epgshare01/epg_ripper_FR1.xml.gz'],
      note: 'WebGrab+Plus, chaînes SFR/Orange, beaucoup de sport',
    },
    {
      code: 'epgshare01-bein',
      name: 'EPGSHARE01 beIN',
      urls: ['https://epgshare01.online/epgshare01/epg_ripper_BEIN1.xml.gz'],
      note: 'Chaînes beIN SPORTS (plusieurs pays, on ne garde que ce qui se relie à une chaîne française)',
      onlyKnown: true,
    },
    { code: 'samsung', name: 'Samsung TV Plus France (i.mjh.nz)', urls: MJH('SamsungTVPlus/fr.xml.gz'), note: 'Chaînes gratuites FAST, quelques heures à l’avance seulement', minHorizonH: 2 },
    { code: 'pluto', name: 'Pluto TV France (i.mjh.nz)', urls: MJH('PlutoTV/fr.xml.gz'), note: 'Chaînes gratuites FAST, quelques heures à l’avance seulement', minHorizonH: 2 },
    { code: 'plex', name: 'Plex France (i.mjh.nz)', urls: MJH('Plex/fr.xml.gz'), note: 'Chaînes gratuites FAST, quelques heures à l’avance seulement', minHorizonH: 2 },
    {
      code: 'epglat',
      name: 'EPG.lat France',
      urls: ['https://epg.lat/files/fr.xml.gz'],
      note: 'Souvent une copie ancienne d’epgshare01 : écartée automatiquement si périmée',
    },
  ],
};

/** Ligues suivies pour le sport (API publique ESPN, sans clé) : [ligue ESPN, nom affiché, sport] */
export const ESPN_LEAGUES = [
  ['soccer/fra.1', 'Ligue 1', 'football'],
  ['soccer/fra.2', 'Ligue 2', 'football'],
  ['soccer/fra.coupe_de_france', 'Coupe de France', 'football'],
  ['soccer/uefa.champions', 'Ligue des champions', 'football'],
  ['soccer/uefa.europa', 'Ligue Europa', 'football'],
  ['soccer/uefa.europa.conf', 'Ligue Conférence', 'football'],
  ['soccer/eng.1', 'Premier League', 'football'],
  ['soccer/esp.1', 'Liga', 'football'],
  ['soccer/ita.1', 'Serie A', 'football'],
  ['soccer/ger.1', 'Bundesliga', 'football'],
  ['soccer/por.1', 'Liga Portugal', 'football'],
  ['soccer/ned.1', 'Eredivisie', 'football'],
  ['soccer/uefa.nations', 'Ligue des nations', 'football'],
  ['soccer/fifa.worldq.uefa', 'Qualifications Coupe du monde', 'football'],
  ['basketball/nba', 'NBA', 'basket'],
  ['football/nfl', 'NFL', 'football américain'],
  ['hockey/nhl', 'NHL', 'hockey'],
  ['baseball/mlb', 'MLB', 'baseball'],
];
