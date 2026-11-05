// Construit le guide : télécharge toutes les sources, vérifie leur fraîcheur, relie les chaînes, fusionne, ajoute le
// sport, puis écrit les fichiers statiques dans le dossier de sortie (publié tel quel sur GitHub Pages).
//   node src/build.mjs --out dist [--country fr] [--no-sport]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { SOURCES } from './sources.mjs';
import { fetchText, safeId, pool } from './util.mjs';
import { parseXmltv } from './xmltv.mjs';
import { chanKey, groupChannels, mergeChannel } from './merge.mjs';
import { fetchEspn, fetchF1, buildSport, isSportBroadcast } from './sport.mjs';
import { toXmltv } from './export.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = opt('out', 'dist');
const COUNTRIES = (opt('country', Object.keys(SOURCES).join(','))).split(',');
const WITH_SPORT = !args.includes('--no-sport');
const NOW = Date.now();
const H = 3600_000;

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const write = (path, data) => {
  const full = join(OUT, path);
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};

/** version courte d'un programme pour les listes (grille, « en cours ») */
const short = (p) => ({ s: p.s, e: p.e, t: p.t, ...(p.st ? { st: p.st.slice(0, 90) } : {}), ...(p.i ? { i: p.i } : {}), ...(p.c ? { c: p.c[0] } : {}), ...(p.ep ? { ep: p.ep } : {}), ...(p.rerun ? { rerun: 1 } : {}) });
const full = (p) => {
  const { ch: _ch, fill: _fill, ...rest } = p;
  return rest;
};

async function buildCountry(cc) {
  const report = { country: cc, sources: [], offsets: [] };
  const parsed = [];
  await pool(SOURCES[cc], 4, async (src) => {
    const t0 = Date.now();
    const entry = { code: src.code, name: src.name, note: src.note };
    try {
      const { text, url } = await fetchText(src.urls);
      const x = parseXmltv(text);
      const last = x.programmes.reduce((m, p) => Math.max(m, p.e), 0);
      const first = x.programmes.reduce((m, p) => Math.min(m, p.s), Infinity);
      Object.assign(entry, {
        url,
        channels: x.channels.size,
        programmes: x.programmes.length,
        withImage: x.programmes.filter((p) => p.i).length,
        from: Number.isFinite(first) ? new Date(first).toISOString() : null,
        to: last ? new Date(last).toISOString() : null,
        noOffset: x.noOffset,
        ms: Date.now() - t0,
      });
      // fraîcheur : une source qui ne va pas au-delà de demain soir est périmée (cas d'EPG.lat France)
      if (last < NOW + (src.minHorizonH ?? 20) * H) entry.status = 'écartée : périmée';
      else if (!x.programmes.length) entry.status = 'écartée : vide';
      else {
        entry.status = 'ok';
        // chaînes écartées à la main (contenu sans rapport avec la chaîne chez cette source)
        const ex = new Set(src.exclude || []);
        for (const id of ex) x.channels.delete(id);
        parsed.push({ ...src, channels: x.channels, programmes: x.programmes.filter((p) => p.e > NOW - 8 * 24 * H && !ex.has(p.ch)) });
      }
    } catch (e) {
      Object.assign(entry, { status: 'écartée : erreur', error: e.message, ms: Date.now() - t0 });
    }
    report.sources.push(entry);
    log(`[${cc}] ${src.code} : ${entry.status}${entry.programmes ? ` (${entry.channels} chaînes, ${entry.programmes} programmes)` : ''}${entry.error ? ` ${entry.error}` : ''}`);
  });
  // ordre de priorité de sources.mjs, quel que soit l'ordre d'arrivée
  const order = SOURCES[cc].map((s) => s.code);
  parsed.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  report.sources.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));

  const { groups, bySourceChannel, keyToGroup } = groupChannels(parsed, cc);
  // programmes rangés par chaîne et par source
  const lists = new Map();
  for (const src of parsed) {
    for (const p of src.programmes) {
      const g = bySourceChannel.get(`${src.code}|${p.ch}`);
      if (!g || g.members[0] === undefined) continue;
      const mine = g.members.find((m) => m.src === src.code);
      if (!mine || mine.id !== p.ch) continue; // variante en double d'une même source
      if (!lists.has(g)) lists.set(g, new Map());
      const bySrc = lists.get(g);
      if (!bySrc.has(src.code)) bySrc.set(src.code, []);
      bySrc.get(src.code).push(p);
    }
  }

  const channels = [];
  const nowFile = {};
  const sportIndex = [];
  let progCount = 0;
  let imgCount = 0;
  const xmltvChannels = [];
  for (const g of groups) {
    const bySrc = lists.get(g);
    if (!bySrc) continue;
    const ordered = order.filter((c) => bySrc.has(c)).map((c) => ({ src: c, progs: bySrc.get(c) }));
    const { progs, primary, offsets } = mergeChannel(ordered, NOW);
    if (!progs.length) continue;
    for (const o of offsets) report.offsets.push({ ch: g.id, ...o });
    const file = `${cc}/ch/${safeId(g.id)}.json`;
    const isSport = progs.filter(isSportBroadcast).length >= 2 || /sport|bein|eurosport|equipe|rmc sport|dazn|golf|infosport|automoto/i.test(g.name);
    channels.push({
      id: g.id,
      name: g.name,
      names: [...g.names],
      logo: g.logo,
      file,
      sources: g.members.map((m) => m.src),
      primary,
      sport: isSport || undefined,
      programmes: progs.length,
      to: progs[progs.length - 1].e,
    });
    write(file, { id: g.id, name: g.name, logo: g.logo, generatedAt: NOW, programmes: progs.map(full) });
    // fenêtre courte : en cours et suivants jusqu'à la génération d'après (toutes les 3 h) avec de la marge
    nowFile[g.id] = progs.filter((p) => p.e > NOW - H && p.s < NOW + 9 * H).map(short);
    progCount += progs.length;
    imgCount += progs.filter((p) => p.i).length;
    const ref = { id: g.id, name: g.name };
    for (const p of progs) if (p.e > NOW - 30 * H && p.s < NOW + 8 * 24 * H) sportIndex.push({ ch: ref, p });
    xmltvChannels.push({ id: g.id, name: g.name, logo: g.logo, progs });
  }
  channels.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const aliases = {};
  for (const [k, g] of keyToGroup) if (channels.some((c) => c.id === g.id)) aliases[k] = g.id;

  write(`${cc}/channels.json`, { generatedAt: NOW, country: cc, channels });
  write(`${cc}/aliases.json`, { generatedAt: NOW, note: 'clé = nom de chaîne normalisé (voir chanKey dans src/merge.mjs)', aliases });
  write(`${cc}/now.json`, { generatedAt: NOW, from: NOW - H, to: NOW + 9 * H, channels: nowFile });
  write(`${cc}/xmltv.xml.gz`, gzipSync(toXmltv(xmltvChannels)));

  Object.assign(report, { channels: channels.length, programmes: progCount, withImage: imgCount, imagePct: progCount ? Math.round((imgCount / progCount) * 1000) / 10 : 0 });
  log(`[${cc}] ${channels.length} chaînes, ${progCount} programmes, ${report.imagePct} % avec image, ${report.offsets.length} décalages écartés`);
  return { report, sportIndex, keyToGroup };
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const reports = [];
  const sportIndex = [];
  const keyMaps = [];
  for (const cc of COUNTRIES) {
    if (!SOURCES[cc]) continue;
    const r = await buildCountry(cc);
    // garde-fou : un guide anormalement petit (sources en panne) n'est pas publié, l'ancien reste en ligne
    const MIN = { fr: 300 }[cc] ?? 20;
    if (r.report.channels < MIN) throw new Error(`[${cc}] seulement ${r.report.channels} chaînes (minimum ${MIN}) : publication annulée`);
    reports.push(r.report);
    for (const x of r.sportIndex) sportIndex.push(x);
    keyMaps.push(r.keyToGroup);
  }
  let sport = null;
  if (WITH_SPORT) {
    const [espn, f1] = await Promise.all([fetchEspn(NOW, log), fetchF1(NOW, log)]);
    const keyToGroup = new Map(keyMaps.flatMap((m) => [...m]));
    sportIndex.sort((a, b) => a.p.s - b.p.s);
    const events = buildSport([...espn, ...f1], sportIndex, keyToGroup, chanKey, NOW);
    const withTv = events.filter((e) => e.tv.length).length;
    const espnTotal = espn.length + f1.length;
    const espnVerified = events.filter((e) => e.source !== 'guide' && e.verifie).length;
    sport = { events: events.length, avecChaine: withTv, espnEtF1: espnTotal, espnEtF1Verifies: espnVerified, guideSeul: events.filter((e) => e.source === 'guide').length };
    write('sport/events.json', { generatedAt: NOW, note: 'tv = chaînes qui ont vraiment le match au guide ; announced = diffuseurs annoncés par ESPN (marché américain), non vérifiés sauf dansLeGuide', events });
    log(`Sport : ${events.length} événements, ${withTv} avec une chaîne trouvée dans le guide (${espnVerified}/${espnTotal} matchs ESPN/F1 vérifiés)`);
  }
  const index = { generatedAt: NOW, generatedAtIso: new Date(NOW).toISOString(), countries: reports.map((r) => ({ country: r.country, channels: r.channels, programmes: r.programmes, imagePct: r.imagePct })), sport, files: { channels: '<pays>/channels.json', now: '<pays>/now.json', channel: '<pays>/ch/<id>.json', aliases: '<pays>/aliases.json', xmltv: '<pays>/xmltv.xml.gz', sport: 'sport/events.json', report: 'report.json' } };
  write('index.json', index);
  write('report.json', { generatedAt: NOW, countries: reports, sport });
  write('index.html', dashboard(index, reports));
  write('.nojekyll', '');
}

function dashboard(index, reports) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = reports
    .flatMap((r) => r.sources.map((s) => `<tr><td>${esc(r.country)}</td><td>${esc(s.name)}</td><td>${esc(s.status)}</td><td>${s.channels ?? ''}</td><td>${s.programmes ?? ''}</td><td>${s.programmes ? Math.round((s.withImage / s.programmes) * 100) + ' %' : ''}</td><td>${esc((s.to || '').slice(0, 16))}</td></tr>`))
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide TV ouvert</title>
<style>body{font:15px system-ui,sans-serif;margin:24px;color:#111;background:#fff}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}}</style>
<h1>Guide TV ouvert</h1><p>Généré le ${esc(index.generatedAtIso)} (UTC). ${index.countries.map((c) => `${esc(c.country)} : ${c.channels} chaînes, ${c.programmes} programmes, ${c.imagePct} % avec image`).join(' · ')}${index.sport ? ` · Sport : ${index.sport.events} événements, ${index.sport.avecChaine} avec une chaîne trouvée` : ''}</p>
<table><tr><th>Pays</th><th>Source</th><th>État</th><th>Chaînes</th><th>Programmes</th><th>Images</th><th>Jusqu'au</th></tr>${rows}</table>
<p>Fichiers : <a href="index.json">index.json</a> · <a href="fr/channels.json">fr/channels.json</a> · <a href="fr/now.json">fr/now.json</a> · <a href="sport/events.json">sport/events.json</a> · <a href="report.json">report.json</a></p>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
