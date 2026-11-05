import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSport, findBroadcasts, isSportBroadcast, parseGuideTitle, teamIn } from '../src/sport.mjs';
import { chanKey } from '../src/merge.mjs';
import { words } from '../src/util.mjs';

const H = 3600_000;
const KO = Date.UTC(2026, 10, 5, 20, 0); // coup d'envoi, 21 h à Paris
const tok = (s) => new Set(words(s));
const leverkusen = { name: 'Bayer Leverkusen', short: 'Leverkusen', abbr: 'LEV', location: 'Leverkusen' };
const om = { name: 'Marseille', short: 'Marseille', abbr: 'MAR', location: 'Marseille' };
const psg = { name: 'Paris Saint-Germain', short: 'PSG', abbr: 'PSG', location: 'Paris' };

test('équipes reconnues dans les titres du guide (surnoms, fautes d’une lettre)', () => {
  assert.ok(teamIn(leverkusen, tok('Bayer Leverkusen / Marseille')));
  assert.ok(teamIn(om, tok('Football : Ligue Europa | Bayer Leverkusen / Marseille')));
  assert.ok(teamIn(psg, tok('PSG / OM')));
  assert.ok(teamIn({ name: 'Olympiacos' }, tok('Rennes / Olympiakos')));
  assert.ok(!teamIn(om, tok('Lyon / Lens')));
});

test('retransmission ou magazine ?', () => {
  assert.ok(isSportBroadcast({ t: 'Football : Ligue Europa | Bayer Leverkusen / Marseille' }));
  assert.ok(isSportBroadcast({ t: 'Bayer Leverkusen / Marseille', c: ['Football'] }));
  assert.ok(!isSportBroadcast({ t: 'Football : conférence de presse' }));
  assert.ok(!isSportBroadcast({ t: 'Golf+, le mag', c: ['Sport', 'Mag Golf'] }));
  assert.ok(!isSportBroadcast({ t: 'Plateau avant-match UEFA Europa League' }));
});

test('le diffuseur vient du guide, pas de l’annonce ESPN (« Paramount+ »)', () => {
  const index = [
    { ch: { id: 'CanalPlus.fr', name: 'Canal+' }, p: { s: KO - 6 * 60_000, e: KO, t: 'Plateau avant-match UEFA Europa League', st: '4e journée : Bayer Leverkusen - Marseille' } },
    { ch: { id: 'CanalPlus.fr', name: 'Canal+' }, p: { s: KO, e: KO + 116 * 60_000, t: 'Bayer Leverkusen / Marseille', st: 'Ligue Europa - 4e journée', c: ['Football'] } },
    { ch: { id: 'TF1.fr', name: 'TF1' }, p: { s: KO - 10 * 60_000, e: KO + 2 * H, t: 'Koh-Lanta' } },
  ];
  const ev = { id: 'espn:1', sport: 'football', start: KO, home: leverkusen, away: om, announced: ['Paramount+'] };
  const tv = findBroadcasts(ev, index);
  assert.deepEqual(tv.map((b) => [b.name, b.niveau]), [['Canal+', 'confirmé']]); // pas le plateau, pas TF1
  const keyToGroup = new Map([['canalplus', { id: 'CanalPlus.fr' }]]);
  const [out] = buildSport([ev], index, keyToGroup, chanKey, KO);
  assert.equal(out.verifie, true);
  assert.deepEqual(out.announced, [{ name: 'Paramount+', type: 'streaming', dansLeGuide: false }]);
});

test('rediffusion rattachée au match d’origine', () => {
  const ev = { id: 'espn:1', sport: 'football', start: KO, home: leverkusen, away: om, announced: [] };
  const index = [
    { ch: { id: 'CanalPlus.fr', name: 'Canal+' }, p: { s: KO, e: KO + 2 * H, t: 'Bayer Leverkusen / Marseille', c: ['Football'] } },
    { ch: { id: 'CanalPlusFoot.fr', name: 'Canal+ Foot' }, p: { s: KO + 10 * H, e: KO + 12 * H, t: 'Football : Ligue Europa | Bayer Leverkusen / Marseille' } },
  ];
  const out = buildSport([ev], index, new Map(), chanKey, KO);
  assert.equal(out.length, 1);
  assert.equal(out[0].rediffusions.length, 1);
  assert.equal(out[0].rediffusions[0].name, 'Canal+ Foot');
});

test('matchs que seul le guide connaît : regroupés entre chaînes', () => {
  const p = (ch, name) => ({ ch: { id: ch, name }, p: { s: KO, e: KO + 2 * H, t: 'Rugby : Top 14 | Toulouse / Toulon' } });
  const out = buildSport([], [p('CanalPlus.fr', 'Canal+'), p('CanalPlusSport.fr', 'Canal+ Sport')], new Map(), chanKey, KO);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Toulouse · Toulon');
  assert.equal(out[0].competition, 'Top 14');
  assert.equal(out[0].tv.length, 2);
});

test('titres du guide découpés', () => {
  assert.deepEqual(parseGuideTitle({ t: 'Football : Ligue Europa | Rennes / Olympiakos' }), { sport: 'Football', competition: 'Ligue Europa', home: 'Rennes', away: 'Olympiakos' });
  assert.deepEqual(parseGuideTitle({ t: 'Bayer Leverkusen / Marseille', st: 'Ligue Europa - 4e journée', c: ['Football'] }), { sport: 'Football', competition: 'Ligue Europa', home: 'Bayer Leverkusen', away: 'Marseille' });
  assert.equal(parseGuideTitle({ t: 'Koh-Lanta' }), null);
});
