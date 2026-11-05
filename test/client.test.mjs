// Client de l'app (client/ctvEpg.ts) : noms de fournisseurs, même clé que le serveur, horloge corrigée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CtvEpg, channelKey, cleanProviderName } from '../client/ctvEpg.ts';
import { chanKey } from '../src/merge.mjs';

test('noms de chaînes des fournisseurs IPTV nettoyés', () => {
  assert.equal(cleanProviderName('FR| TF1 FHD ᴿᴬᵂ'), 'TF1');
  assert.equal(cleanProviderName('|FR| CANAL+ SPORT 360 HD'), 'CANAL+ SPORT 360');
  assert.equal(cleanProviderName('FR: M6 (backup)'), 'M6');
  assert.equal(cleanProviderName('[FR] France 2 1080p'), 'France 2');
  assert.equal(cleanProviderName('UK| BBC ONE HD'), 'BBC ONE');
  assert.equal(cleanProviderName('beIN SPORTS 1 FHD'), 'beIN SPORTS 1');
  assert.equal(cleanProviderName('AR| MBC 1 HD'), 'MBC 1');
});

test('le client et le serveur calculent la même clé', () => {
  const names = ['TF1 HD', 'Canal+ Sport 360', 'France 3 Corse', 'beIN SPORTS 1', 'One TV', 'ON E HD', 'ar: 1 أبوظبي الرياضية', 'Россия 1', 'CCTV-1 综合', '1', 'L’Équipe', 'RMC Découverte'];
  for (const n of names) assert.equal(channelKey(n), chanKey(n), n);
  for (const id of ['TF1.fr', 'CanalPlusSport.fr', 'France.3.-.Corse.fr']) assert.equal(channelKey(id, true), chanKey(id, true), id);
});

/** faux serveur : sert les fichiers donnés, avec un en-tête Date réglable */
function fakeFetch(files, serverNow) {
  return async (url) => {
    const path = url.replace(/^https:\/\/[^/]+\/(epg\/|AGENCE-BUZZLE\/epg\/data\/)/, '');
    if (!(path in files)) return new Response('', { status: 404, headers: { date: new Date(serverNow()).toUTCString() } });
    return new Response(JSON.stringify(files[path]), { headers: { 'content-type': 'application/json', date: new Date(serverNow()).toUTCString() } });
  };
}

test('correspondance, programme en cours et horloge de la box corrigée', async () => {
  const T = Date.UTC(2026, 10, 5, 20, 30);
  const files = {
    'fr/aliases.json': { aliases: { tf1: 'TF1.fr', canalplussport360: 'CanalPlusSport360.fr' } },
    'fr/now.json': {
      generatedAt: T,
      channels: {
        'TF1.fr': [
          { s: T - 30 * 60_000, e: T + 30 * 60_000, t: 'Koh-Lanta' },
          { s: T + 30 * 60_000, e: T + 90 * 60_000, t: 'Journal' },
        ],
      },
    },
  };
  // la box retarde de 2 heures (cas fréquent sur les box Android sans réseau à l'allumage)
  const epg = new CtvEpg({ fetchImpl: fakeFetch(files, () => T), now: () => T - 2 * 3600_000 });
  await epg.load();
  assert.equal(epg.match({ name: 'FR| TF1 FHD ᴿᴬᵂ' }), 'TF1.fr');
  assert.equal(epg.match({ name: 'nimporte quoi', epgId: 'TF1.fr' }), 'TF1.fr');
  assert.equal(epg.match({ name: '|FR| CANAL+ SPORT 360 HD' }), 'CanalPlusSport360.fr');
  assert.equal(epg.match({ name: 'Chaîne inconnue' }), undefined);
  const { cur, next } = epg.nowNext('TF1.fr');
  assert.equal(cur?.t, 'Koh-Lanta'); // sans correction, la box afficherait le programme d'il y a 2 h
  assert.equal(next?.t, 'Journal');
});
