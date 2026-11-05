// Heures : conversion XMLTV → UTC, et affichage à l'heure locale autour des changements d'heure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime } from '../src/xmltv.mjs';

const iso = (v) => new Date(parseTime(v).ms).toISOString();
const local = (ms, tz) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23' }).format(ms);

test('décalage écrit : Paris en hiver (+0100) et en été (+0200)', () => {
  assert.equal(iso('20261104002500 +0100'), '2026-11-03T23:25:00.000Z');
  assert.equal(iso('20260715210000 +0200'), '2026-07-15T19:00:00.000Z');
  assert.equal(iso('20261104000000 +0000'), '2026-11-04T00:00:00.000Z');
  assert.equal(iso('20261104000000 -0500'), '2026-11-04T05:00:00.000Z');
});

test('décalages non entiers et extrêmes', () => {
  assert.equal(iso('20261105120000 +0530'), '2026-11-05T06:30:00.000Z'); // Inde
  assert.equal(iso('20261105120000 +0545'), '2026-11-05T06:15:00.000Z'); // Népal
  assert.equal(iso('20261105120000 +1400'), '2026-11-04T22:00:00.000Z'); // Kiritimati
  assert.equal(iso('20261105120000 -1100'), '2026-11-05T23:00:00.000Z'); // Pago Pago
  assert.equal(iso('20261105120000 +05:30'), '2026-11-05T06:30:00.000Z'); // variante avec deux-points
});

test('sans décalage : UTC, et signalé', () => {
  const r = parseTime('20261105120000');
  assert.equal(new Date(r.ms).toISOString(), '2026-11-05T12:00:00.000Z');
  assert.equal(r.noOffset, true);
});

test('Paris, passage à l’heure d’été (28/03/2027) : 2 h → 3 h, aucun créneau perdu', () => {
  // 01:30 heure d'hiver puis 03:30 heure d'été : une heure réelle d'écart
  const a = parseTime('20270328013000 +0100').ms;
  const b = parseTime('20270328033000 +0200').ms;
  assert.equal(b - a, 3600_000);
  assert.equal(local(a, 'Europe/Paris'), '28/03 01:30');
  assert.equal(local(b, 'Europe/Paris'), '28/03 03:30');
});

test('Paris, passage à l’heure d’hiver (31/10/2027) : l’heure de 2 h à 3 h existe deux fois', () => {
  const first = parseTime('20271031023000 +0200').ms;
  const second = parseTime('20271031023000 +0100').ms;
  assert.equal(second - first, 3600_000);
  assert.equal(local(first, 'Europe/Paris'), '31/10 02:30');
  assert.equal(local(second, 'Europe/Paris'), '31/10 02:30');
  // la grille garde les deux programmes, dans l'ordre réel
  assert.ok(second > first);
});

test('le même instant affiché dans plusieurs fuseaux (le guide suit l’appareil)', () => {
  const ms = parseTime('20261105210000 +0100').ms; // 21 h à Paris
  assert.equal(local(ms, 'Europe/Paris'), '05/11 21:00');
  assert.equal(local(ms, 'America/Montreal'), '05/11 15:00');
  assert.equal(local(ms, 'Asia/Kolkata'), '06/11 01:30');
  assert.equal(local(ms, 'Asia/Kathmandu'), '06/11 01:45');
  assert.equal(local(ms, 'Australia/Sydney'), '06/11 07:00');
  assert.equal(local(ms, 'Pacific/Kiritimati'), '06/11 10:00');
  assert.equal(local(ms, 'UTC'), '05/11 20:00');
});

test('États-Unis : 14/03/2027 et 07/11/2027', () => {
  const spring = parseTime('20270314030000 -0400').ms; // 3 h EDT = juste après le saut
  assert.equal(local(spring, 'America/New_York'), '14/03 03:00');
  const fallA = parseTime('20271107013000 -0400').ms;
  const fallB = parseTime('20271107013000 -0500').ms;
  assert.equal(fallB - fallA, 3600_000);
  assert.equal(local(fallA, 'America/New_York'), local(fallB, 'America/New_York'));
});

test('Sydney : hémisphère sud (heure d’été en octobre)', () => {
  const ms = parseTime('20271003030000 +1100').ms;
  assert.equal(local(ms, 'Australia/Sydney'), '03/10 03:00');
});
