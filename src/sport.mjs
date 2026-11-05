// Sport : matchs (ESPN, Jolpica pour la F1) croisés avec le guide TV réel.
//
// Pourquoi croiser : ESPN annonce les diffuseurs de SON marché (« Paramount+ » pour la Ligue Europa aux États-Unis),
// ce qui n'a aucun sens pour un téléspectateur français. Ici, une chaîne n'est « confirmée » que si elle a vraiment
// le match au programme à cette heure-là. Les diffuseurs annoncés restent visibles à part, marqués non vérifiés.
import { ESPN_LEAGUES } from './sources.mjs';
import { fetchJson, fold, words, lev, pool } from './util.mjs';

/** préfixes de titres de retransmissions (« Football : … », « Rugby : … ») */
const SPORT_PREFIX =
  /^(football americain|football|rugby a xiii|rugby a 7|rugby|basket ?ball|basket|tennis de table|tennis|handball|volley ?ball|volley|beach volley|hockey sur glace|hockey|formule 1|formule e|f1|moto ?gp|moto|superbike|rallye|wrc|nascar|indycar|cyclisme|vtt|golf|boxe|mma|ufc|judo|athletisme|natation|ski alpin|ski de fond|ski|biathlon|saut a ski|patinage|snooker|flechettes|nba|nfl|nhl|mlb|ncaa|catch|equitation|voile|esport|e sport|padel|petanque|baseball|cricket|escrime|lutte|halterophilie|badminton|squash|triathlon|aviron|canoe|surf|skateboard|escalade)\b\s*:/;
const NOT_LIVE = /\b(magazine|mag|documentaire|doc|emission|journal|conference de presse|resume|resumes|le meilleur|best of|avant match|apres match|debrief|plateau|talk|actualite|actu|la quotidienne|replay)\b/;

const SPORT_CAT = /\b(sport|sports|football|rugby|basket|tennis|handball|volley|hockey|cyclisme|golf|boxe|mma|athletisme|natation|ski|biathlon|snooker|formule|moto|automobile|sports mecaniques|equitation|voile|padel|baseball|cricket|judo|escrime|catch|combat)\b/;
/** « Bayer Leverkusen / Marseille » : deux noms séparés par une barre (format des chaînes Canal+, beIN…) */
const VERSUS = /^[^:|]{2,40}\s\/\s[^:|]{2,40}$/;

/** le programme ressemble-t-il à une retransmission sportive ? (pas un magazine ni un documentaire) */
export function isSportBroadcast(p) {
  const t = fold(p.t).replace(/\s+/g, ' ').trim();
  const cats = fold((p.c || []).join(' | '));
  if (NOT_LIVE.test(t) || /magazine|documentaire|doc sport|mag sport|emission/.test(cats)) return false;
  return SPORT_PREFIX.test(t) || /\bmultiplex\b/.test(t) || (VERSUS.test(p.t.trim()) && (SPORT_CAT.test(cats) || SPORT_CAT.test(fold(p.st || ''))));
}

const GENERIC = new Set([
  'fc', 'cf', 'ac', 'as', 'sc', 'ss', 'sv', 'vfb', 'vfl', 'tsg', 'rc', 'rb', 'cd', 'ud', 'sd', 'afc', 'ssc', 'us', 'og', 'ogc', 'losc', 'club', 'de', 'la', 'le', 'les', 'du', 'des', 'of', 'the',
  'real', 'united', 'city', 'sporting', 'athletic', 'atletico', 'olympique', 'olympic', 'stade', 'racing', 'deportivo', 'calcio', 'football', 'futbol',
  'saint', 'st', 'san', 'fk', 'sk', 'bk', 'if', 'ik', 'cfc', '1', '04', '05', '1899', '1909', '1846', 'hotspur', 'wanderers', 'rovers', 'town', 'county', 'albion',
]);
/** surnoms français courants absents d'ESPN */
const NICK = { 'paris saint germain': ['psg', 'paris sg', 'paris'], marseille: ['om'], lyon: ['ol', 'lyonnais'], lille: ['losc'], 'bayern munich': ['bayern'], 'inter milan': ['inter'], 'ac milan': ['milan'], internazionale: ['inter'] };

const variantCache = new WeakMap();
/** variantes d'un nom d'équipe, en mots significatifs (calculées une fois par équipe) */
export function teamVariants(team) {
  if (variantCache.has(team)) return variantCache.get(team);
  const out = computeVariants(team);
  variantCache.set(team, out);
  return out;
}
function computeVariants(team) {
  const out = [];
  const names = [team.name, team.short, team.abbr, team.location].filter(Boolean);
  for (const n of names) {
    const f = fold(n).replace(/[^a-z0-9 ]+/g, ' ').trim();
    for (const extra of NICK[f] || []) out.push(words(extra));
  }
  for (const n of names) {
    const sig = words(n).filter((w) => !GENERIC.has(w) && w.length >= 3);
    if (sig.length) out.push(sig);
  }
  if (team.abbr && team.abbr.length >= 3) out.push([fold(team.abbr)]);
  return out;
}

const hasWord = (tokens, w) => tokens.has(w) || (w.length >= 6 && [...tokens].some((t) => t.length >= 5 && Math.abs(t.length - w.length) <= 1 && lev(t, w) <= 1));

/** l'équipe est-elle citée dans ce texte ? (tous les mots d'une de ses variantes) */
export function teamIn(team, tokens) {
  return teamVariants(team).some((v) => v.length && v.every((w) => hasWord(tokens, w)));
}

/** mots du titre, du sous-titre et du début de la description */
const progTokens = (p) => new Set(words(`${p.t} ${p.st || ''} ${(p.d || '').slice(0, 400)}`));
const headTokens = (p) => new Set(words(`${p.t} ${p.st || ''}`));

/**
 * Programmes d'un match : sur une chaîne, à l'heure du match, qui citent les deux équipes (dans le titre ou le
 * sous-titre : confirmé ; seulement dans la description : probable). F1 : « Formule 1 » + le nom du Grand Prix.
 */
export function findBroadcasts(event, index) {
  const out = [];
  const t0 = event.start;
  // index trié par début : programmes qui commencent entre 4 h avant et 30 min après le coup d'envoi
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].p.s < t0 - 4 * 3600_000) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < index.length && index[i].p.s <= t0 + 30 * 60_000; i++) {
    const { ch, p } = index[i];
    if (p.e < t0 + 15 * 60_000) continue;
    // ni plateau d'avant-match, ni résumé, ni programme trop court pour être le match
    if (p.e - p.s < 40 * 60_000 || NOT_LIVE.test(fold(p.t))) continue;
    let level = null;
    if (event.sport === 'f1') {
      const head = fold(`${p.t} ${p.st || ''}`);
      if (/formule 1|\bf1\b/.test(head) && event.keywords.some((k) => head.includes(k))) level = 'confirmé';
    } else if (event.home && event.away) {
      const h = headTokens(p);
      if (teamIn(event.home, h) && teamIn(event.away, h)) level = 'confirmé';
      else if (isSportBroadcast(p)) {
        const all = progTokens(p);
        if (teamIn(event.home, all) && teamIn(event.away, all)) level = 'probable';
      }
    }
    if (level) out.push({ ch: ch.id, name: ch.name, s: p.s, e: p.e, t: p.t, st: p.st, live: !p.rerun, niveau: level, multiplex: /multiplex/i.test(p.t) || undefined });
  }
  const rank = (x) => (x.niveau === 'confirmé' ? 0 : 1) + (x.multiplex ? 0.5 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.s - b.s);
}

const STREAMING = /paramount|peacock|prime video|amazon|apple tv|dazn|espn\+|max\b|hulu|fubo|netflix|youtube|tubi|pluto|fox one|nbc sports app|stan\b|kayo|optus|now\b/i;

const day = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

function espnTeam(c) {
  const t = c.team || {};
  return { name: t.displayName, short: t.shortDisplayName, abbr: t.abbreviation, location: t.location, logo: t.logo, score: c.score };
}

/** matchs ESPN de toutes les ligues suivies, de la veille à J+7 */
export async function fetchEspn(now = Date.now(), log = () => {}) {
  // de J-3 (pour reconnaître les rediffusions des matchs récents) à J+7
  const days = Array.from({ length: 11 }, (_, i) => day(now + (i - 3) * 86_400_000));
  const jobs = ESPN_LEAGUES.flatMap(([path, label, sport]) => days.map((d) => ({ path, label, sport, d })));
  const seen = new Map();
  let fails = 0;
  await pool(jobs, 6, async (j) => {
    try {
      const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${j.path}/scoreboard?dates=${j.d}`, { tries: 2, timeoutMs: 20_000 });
      for (const e of data.events || []) {
        const c = e.competitions?.[0];
        if (!c || seen.has(e.id)) continue;
        const home = c.competitors?.find((x) => x.homeAway === 'home') || c.competitors?.[0];
        const away = c.competitors?.find((x) => x.homeAway === 'away') || c.competitors?.[1];
        const announced = new Set();
        for (const b of c.broadcasts || []) for (const n of b.names || []) announced.add(n);
        for (const g of c.geoBroadcasts || []) if (g.media?.shortName && !/^[A-Z]{4,}$/.test(g.media.shortName)) announced.add(g.media.shortName);
        seen.set(e.id, {
          id: `espn:${e.id}`,
          sport: j.sport,
          competition: j.label,
          name: e.name,
          start: Date.parse(e.date),
          status: c.status?.type?.state || e.status?.type?.state,
          statusText: c.status?.type?.shortDetail,
          venue: c.venue?.fullName,
          home: home && espnTeam(home),
          away: away && espnTeam(away),
          announced: [...announced],
        });
      }
    } catch {
      fails++;
    }
  });
  log(`ESPN : ${seen.size} matchs, ${fails} requêtes en échec sur ${jobs.length}`);
  return [...seen.values()];
}

/** séances de F1 (course, qualifications, sprint) de la saison en cours, via Jolpica (sans clé) */
export async function fetchF1(now = Date.now(), log = () => {}) {
  try {
    const data = await fetchJson('https://api.jolpi.ca/ergast/f1/current.json?limit=40', { tries: 2, timeoutMs: 20_000 });
    const out = [];
    for (const r of data.MRData?.RaceTable?.Races || []) {
      const keywords = [...new Set([r.raceName, r.Circuit?.Location?.country, r.Circuit?.Location?.locality].filter(Boolean).flatMap((x) => words(x)).filter((w) => w.length >= 4 && !['grand', 'prix', 'formula'].includes(w)))];
      // noms français des Grands Prix les plus courants
      const fr = { brazil: ['bresil', 'sao', 'paulo'], 'united states': ['etats', 'unis', 'austin'], mexico: ['mexique'], 'abu dhabi': ['abou', 'dhabi'], qatar: ['qatar'], 'las vegas': ['vegas'], spain: ['espagne'], italy: ['italie'], netherlands: ['pays', 'bas'], belgium: ['belgique'], hungary: ['hongrie'], austria: ['autriche'], 'great britain': ['grande', 'bretagne'], japan: ['japon'], china: ['chine'], australia: ['australie'], 'saudi arabia': ['arabie', 'saoudite'], bahrain: ['bahrein'], azerbaijan: ['azerbaidjan'], singapore: ['singapour'], canada: ['canada'], monaco: ['monaco'] };
      const country = fold(r.Circuit?.Location?.country || '');
      keywords.push(...(fr[country] || []));
      const sessions = [['Course', r.date, r.time], ['Qualifications', r.Qualifying?.date, r.Qualifying?.time], ['Sprint', r.Sprint?.date, r.Sprint?.time], ['Qualifications sprint', r.SprintQualifying?.date, r.SprintQualifying?.time]];
      for (const [label, d, t] of sessions) {
        if (!d || !t) continue;
        const start = Date.parse(`${d}T${t}`);
        if (start < now - 86_400_000 || start > now + 8 * 86_400_000) continue;
        out.push({ id: `f1:${r.season}-${r.round}-${fold(label).replace(/\s+/g, '-')}`, sport: 'f1', competition: 'Formule 1', name: `${r.raceName} · ${label}`, start, keywords, announced: [] });
      }
    }
    log(`F1 : ${out.length} séances`);
    return out;
  } catch (e) {
    log(`F1 : échec (${e.message})`);
    return [];
  }
}

/** « Football : Ligue Europa | Bayer Leverkusen / Marseille » → { sport, competition, home, away } */
export function parseGuideTitle(p) {
  const t = p.t.replace(/\s+/g, ' ').trim();
  const split = (x) => {
    const parts = x.split(/\s+(?:\/|-|vs\.?|contre)\s+/i);
    return parts.length === 2 ? parts.map((y) => y.trim()) : [];
  };
  const cleanComp = (x) => (x || '').replace(/\s*[-.,]?\s*\d+(e|ère|er)\s+(journ[ée]e|tour|manche).*$/i, '').replace(/\.$/, '').trim();
  if (VERSUS.test(t)) {
    const [home, away] = split(t);
    const sport = (p.c || []).find((c) => SPORT_CAT.test(fold(c)) && !/^sports?$/i.test(c)) || (p.c || [])[0] || 'Sport';
    return { sport, competition: cleanComp(p.st) || sport, home, away };
  }
  const m = /^([^:]+?)\s*:\s*(.+)$/.exec(t);
  if (!m) return null;
  const [, sport, rest] = m;
  let competition = rest;
  let teams = null;
  const bar = rest.split(/\s+\|\s+/);
  if (bar.length > 1) {
    competition = bar[0];
    teams = bar.slice(1).join(' ');
  } else if (p.st) {
    const sub = p.st.replace(/^[^:]*journ[ée]e\s*:\s*/i, '').replace(/^[^:]{0,40}:\s*/, '');
    if (/\s(\/|-|vs\.?|contre)\s/i.test(sub)) teams = sub;
  }
  const [home, away] = teams ? split(teams) : [];
  return { sport: sport.trim(), competition: competition.trim(), home, away };
}

/**
 * Programme sportif complet : matchs ESPN et F1 avec les chaînes qui les diffusent vraiment, plus les retransmissions
 * du guide qu'ESPN ne connaît pas (rugby, handball, cyclisme…), regroupées quand plusieurs chaînes ont le même match.
 * @param {{ ch: object, p: object }[]} allIndex programmes du guide autour de la période, triés par début
 * @param {Map<string, object>} keyToGroup alias de chaînes (pour reconnaître un diffuseur annoncé)
 */
export function buildSport(events, allIndex, keyToGroup, chanKey, now = Date.now()) {
  const index = allIndex.filter(({ p }) => isSportBroadcast(p));
  const used = new Set();
  const out = [];
  for (const ev of events) {
    const tv = findBroadcasts(ev, allIndex);
    for (const b of tv) used.add(`${b.ch}|${b.s}`);
    const tvIds = new Set(tv.map((b) => b.ch));
    const announced = (ev.announced || []).map((name) => {
      const g = keyToGroup.get(chanKey(name));
      return { name, type: STREAMING.test(name) ? 'streaming' : 'tv', dansLeGuide: !!(g && tvIds.has(g.id)), ...(g ? { ch: g.id } : {}) };
    });
    out.push({ ...ev, keywords: undefined, tv, announced, verifie: tv.some((b) => b.niveau === 'confirmé'), direct: true });
  }
  // retransmissions du guide sans match ESPN : regroupées par (titre, heure)
  const groups = new Map();
  for (const { ch, p } of index) {
    if (used.has(`${ch.id}|${p.s}`) || p.rerun) continue;
    const g = parseGuideTitle(p);
    if (!g) continue;
    const key = `${fold(p.t)}|${fold(p.st || '')}|${Math.round(p.s / (15 * 60_000))}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `guide:${Buffer.from(key).toString('base64url').slice(0, 24)}`,
        sport: g.sport,
        competition: g.competition,
        name: g.home && g.away ? `${g.home} · ${g.away}` : p.st && fold(p.st) !== fold(g.sport) && fold(p.st) !== fold(g.competition) ? p.st.replace(/\.$/, '') : g.competition,
        start: p.s,
        end: p.e,
        home: g.home ? { name: g.home } : undefined,
        away: g.away ? { name: g.away } : undefined,
        source: 'guide',
        tv: [],
        announced: [],
        verifie: true,
      });
    }
    groups.get(key).tv.push({ ch: ch.id, name: ch.name, s: p.s, e: p.e, t: p.t, st: p.st, live: true, niveau: 'confirmé' });
  }
  // Rediffusions : beaucoup de chaînes repassent un match le lendemain sans le signaler. Un même match vu plus tard
  // (mêmes équipes) devient une rediffusion de la première diffusion, ou du match ESPN s'il est connu.
  const espnEvents = out.filter((e) => e.home && e.away);
  const firstByPair = new Map();
  const kept = [];
  for (const g of [...groups.values()].sort((a, b) => a.start - b.start)) {
    const toks = new Set(words(`${g.tv[0].t} ${g.tv[0].st || ''}`));
    const orig = g.home && g.away ? espnEvents.find((e) => g.start - e.start >= 100 * 60_000 && g.start - e.start < 10 * 86_400_000 && teamIn(e.home, toks) && teamIn(e.away, toks)) : null;
    if (orig) {
      (orig.rediffusions ||= []).push(...g.tv.map((b) => ({ ...b, live: false })));
      continue;
    }
    const pair = g.home && g.away ? [g.home.name, g.away.name].map((n) => words(n).join('')).sort().join('|') : null;
    if (pair && firstByPair.has(pair)) {
      const first = firstByPair.get(pair);
      if (g.start - first.start >= 100 * 60_000) {
        (first.rediffusions ||= []).push(...g.tv.map((b) => ({ ...b, live: false })));
        continue;
      }
    }
    if (pair && !firstByPair.has(pair)) firstByPair.set(pair, g);
    kept.push(g);
  }
  out.push(...kept);
  // on publie ce qui est en cours ou à venir ; le passé n'a servi qu'à reconnaître les rediffusions
  const since = now - 3 * 3600_000;
  return out.filter((e) => (e.end || e.start + 3 * 3600_000) > since).sort((a, b) => a.start - b.start);
}
