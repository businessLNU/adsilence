/**
 * `src/gemeinsam/fingerabdruck-kanal.ts`: die Form des `detail`-Strings
 * zwischen isoliertem Skript und Hauptwelt.
 *
 * Was hier haengt: Ein `detail` ohne das Geheimnis darf die Hauptwelt NIE
 * als „aus" lesen - sonst schaltet jede Seite den Schutz mit einer Zeile
 * ab. Und der Kodierer und der Dekodierer muessen dieselbe Sprache
 * sprechen; bis zum 05.09.2026 standen beide Haelften in zwei Dateien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EREIGNIS_FINGERABDRUCK,
  EREIGNIS_KOSMETIK,
  HANDSCHLAG_ANTWORT,
  HANDSCHLAG_FERTIG,
  HANDSCHLAG_FRAGE,
  dekodiere,
  kodiere,
} from '../../src/gemeinsam/fingerabdruck-kanal.ts';

const G = 'a1b2c3d4-geheim';

test('kodiere und dekodiere sind Umkehrungen voneinander', () => {
  for (const f of [
    { an: false, token: null },
    { an: true, token: null },
    { an: true, token: 'f'.repeat(64) },
    { an: false, token: 'wird-bei-aus-nicht-mitgeschickt' },
  ]) {
    const zurueck = dekodiere(G, kodiere(G, f));
    assert.deepEqual(zurueck, { an: f.an, token: f.an ? f.token : null });
  }
});

test('ein leeres Token wird zu "1" ohne Doppelpunkt, nicht zu "1:"', () => {
  // Aus einem leeren Token rechnete die Hauptwelt sonst einen Seed, der fuer
  // den Host in jeder Sitzung derselbe waere.
  assert.equal(kodiere(G, { an: true, token: '' }), `${G}:1`);
  assert.deepEqual(dekodiere(G, `${G}:1:`), null);
});

test('ohne das Geheimnis wird nichts angenommen - vor allem kein "aus"', () => {
  for (const detail of ['0', '1', '1:token', ':0', 'x:0', `${G}0`, `${G}:`, `${G}:2`, `${G}:00`, `${G.slice(1)}:0`, '', 42, null, undefined, {}, { detail: `${G}:0` }]) {
    assert.equal(dekodiere(G, detail), null, `detail ${String(detail)}`);
  }
  // Ein leeres Geheimnis darf nichts freischalten: Sonst waere ":0" ein Schluessel.
  assert.equal(dekodiere('', ':0'), null);
});

test('die Namen sind je genau einer und unterscheiden sich', () => {
  const namen = [EREIGNIS_FINGERABDRUCK, EREIGNIS_KOSMETIK, HANDSCHLAG_FRAGE, HANDSCHLAG_ANTWORT, HANDSCHLAG_FERTIG];
  assert.equal(new Set(namen).size, namen.length);
  for (const n of namen) assert.match(n, /^adsilence:[a-z-]+$/);
});
