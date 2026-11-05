import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chanKey, clean, detectOffset, groupChannels, mergeChannel } from '../src/merge.mjs';
import { parseXmltv, parseEpisode } from '../src/xmltv.mjs';

const H = 3600_000;
const T = Date.UTC(2026, 10, 5, 0, 0);
const prog = (h, len, t, extra = {}) => ({ s: T + h * H, e: T + (h + len) * H, t, ...extra });

test('clé de chaîne : variantes HD, identifiants XMLTV, « + »', () => {
  assert.equal(chanKey('TF1 HD'), 'tf1');
  assert.equal(chanKey('TF1.fr', true), 'tf1');
  assert.equal(chanKey('Canal+ Sport'), 'canalplussport');
  assert.equal(chanKey('CanalPlusSport.fr', true), 'canalplussport');
  assert.equal(chanKey('France.3.-.Corse.fr', true), 'france3corse');
  assert.equal(chanKey('France 3 Corse'), 'france3corse');
  assert.equal(chanKey('beIN SPORTS 1 FHD'), 'beinsports1');
  assert.notEqual(chanKey('Canal+'), chanKey('Canal+ Sport'));
});

test('clé de chaîne : tous les alphabets, jamais une clé faite seulement de chiffres', () => {
  assert.equal(chanKey('ar: 1 أبوظبي الرياضية'), chanKey('1 أبوظبي الرياضية'));
  assert.notEqual(chanKey('ar: 1 أبوظبي الرياضية'), chanKey('ar: السعودية 1'));
  assert.equal(chanKey('Россия 1'), 'россия1');
  assert.equal(chanKey('CCTV-1 综合'), 'cctv1综合');
  assert.equal(chanKey('1'), '');
  assert.equal(chanKey('ar: 1'), '');
  assert.notEqual(chanKey('One TV'), chanKey('ON E HD'));
});

test('regroupement des chaînes entre sources', () => {
  const a = { code: 'a', channels: new Map([['TF1.fr', { id: 'TF1.fr', names: ['TF1'] }], ['M6.fr', { id: 'M6.fr', names: ['M6'] }]]) };
  const b = { code: 'b', channels: new Map([['x1', { id: 'x1', names: ['TF1 HD'] }], ['x2', { id: 'x2', names: ['Gulli'] }]]) };
  const { groups, bySourceChannel } = groupChannels([a, b]);
  assert.equal(groups.length, 3);
  assert.equal(bySourceChannel.get('b|x1').id, 'TF1.fr');
  assert.equal(bySourceChannel.get('b|x2').id, 'b.x2');
});

test('nettoyage : chevauchements retirés, léger chevauchement recalé', () => {
  const out = clean([prog(0, 1, 'A'), prog(0.95, 1, 'B'), prog(1.2, 0.3, 'inclus'), prog(3, 1, 'C')]);
  assert.deepEqual(out.map((p) => p.t), ['A', 'B', 'C']);
  assert.equal(out[1].s, T + H);
});

test('fusion : la source la plus complète sert de base, les trous sont comblés, les champs complétés', () => {
  const a = [prog(0, 1, 'Journal'), prog(2, 1, 'Film')]; // trou de 1 h à 2 h
  const b = [prog(0, 1, 'Journal', { i: 'img.jpg', d: 'Les titres' }), prog(1, 1, 'Météo'), prog(2, 1, 'Film', { ep: { season: 1, episode: 2 } })];
  const { progs, primary } = mergeChannel([{ src: 'a', progs: a }, { src: 'b', progs: b }], T);
  assert.equal(primary, 'b'); // b couvre mieux les 48 h
  assert.deepEqual(progs.map((p) => p.t), ['Journal', 'Météo', 'Film']);
  assert.equal(progs[0].i, 'img.jpg');
  assert.equal(progs[0].n, 2); // deux sources d'accord
});

test('fusion : une source décalée d’une heure est écartée pour la chaîne', () => {
  const ref = [0, 1, 2, 3, 4, 5].map((h) => prog(h, 1, `Prog ${h}`));
  const shifted = ref.map((p) => ({ ...p, s: p.s + H, e: p.e + H }));
  assert.equal(detectOffset(ref, shifted), 60);
  const { offsets, progs } = mergeChannel([{ src: 'ok', progs: ref }, { src: 'decale', progs: shifted }], T);
  assert.deepEqual(offsets, [{ src: 'decale', minutes: 60 }]);
  assert.equal(progs.length, 6);
  assert.ok(progs.every((p) => p.src === 'ok'));
});

test('lecture XMLTV : heures, image, épisode, rediffusion, entités', () => {
  const x = parseXmltv(`<tv><channel id="TF1.fr"><display-name>TF1</display-name><icon src="logo.png"/></channel>
  <programme start="20261105200000 +0100" stop="20261105211000 +0100" channel="TF1.fr"><title lang="fr">Joséphine &amp; Cie</title>
  <sub-title>L&apos;épisode</sub-title><category>Série</category><icon src="i.jpg"/><episode-num system="xmltv_ns">1.4.</episode-num><previously-shown/></programme></tv>`);
  assert.equal(x.channels.get('TF1.fr').icon, 'logo.png');
  const p = x.programmes[0];
  assert.equal(new Date(p.s).toISOString(), '2026-11-05T19:00:00.000Z');
  assert.equal(p.t, 'Joséphine & Cie');
  assert.equal(p.st, "L'épisode");
  assert.deepEqual(p.ep, { season: 2, episode: 5 });
  assert.equal(p.rerun, 1);
  assert.deepEqual(parseEpisode('<episode-num system="onscreen">S03E07</episode-num>'), { season: 3, episode: 7 });
});
