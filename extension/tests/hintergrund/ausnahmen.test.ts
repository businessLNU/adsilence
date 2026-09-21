/**
 * `src/hintergrund/ausnahmen.ts`: „Auf dieser Seite nicht blocken."
 *
 * Zwei Dinge muessen stimmen, sonst ist die Ausnahme keine:
 *
 *   1. Die Regel muss JEDE Blockregel schlagen. Statische Regeln liegen bei
 *      Prioritaet 1 bis 4; die Ausnahme liegt bei 100.
 *   2. Der Host muss so geschrieben sein, wie der Browser ihn liefert:
 *      klein, ohne Port, Punycode statt Umlaut. Ein `WWW.Beispiel.DE` im
 *      Speicher findet `location.hostname` nie wieder, und der Nutzer sieht
 *      einen Schalter, der auf „erlaubt" steht, waehrend weiter geblockt
 *      wird.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ausnahmeRegel, ausschlussMuster, baueAusnahmen, hostAus, hostKette, siteErlaubt } from '../../src/hintergrund/ausnahmen.ts';
import {
  BUDGET_EIGENE,
  ID_AUSNAHME_BIS,
  ID_AUSNAHME_VON,
  ID_EIGENE_VON,
  PRIORITAET_AUSNAHME,
} from '../../src/gemeinsam/konstanten.ts';
import type { Sites } from '../../src/gemeinsam/typen.ts';

function sites(...hosts: string[]): Sites {
  const s: Sites = {};
  for (const host of hosts) s[host] = { erlaubt: true, seit: 1_700_000_000_000 };
  return s;
}

// ── Regel-Erzeugung ────────────────────────────────────────────────────────

test('eine Ausnahme ist allowAllRequests auf Haupt- und Unterrahmen', () => {
  const regel = ausnahmeRegel('beispiel.de', 1);
  assert.equal(regel.id, 1);
  assert.equal(regel.priority, PRIORITAET_AUSNAHME);
  assert.equal(regel.action.type, 'allowAllRequests');
  assert.deepEqual(regel.condition.requestDomains, ['beispiel.de']);
  assert.deepEqual(regel.condition.resourceTypes, ['main_frame', 'sub_frame']);
});

test('die Prioritaet schlaegt jede statische Regel', () => {
  // block 1, $important 2, @@ allow 3, @@$document allowAllRequests 4.
  assert.equal(PRIORITAET_AUSNAHME, 100);
  assert.ok(PRIORITAET_AUSNAHME > 4);
});

test('nur erlaubte Hosts bekommen eine Regel, in fester Reihenfolge', () => {
  const s: Sites = {
    ...sites('zeta.example', 'alpha.example'),
    'aus.example': { erlaubt: false, seit: 1 },
  };
  const regeln = baueAusnahmen(s);
  assert.equal(regeln.length, 2);
  assert.deepEqual(
    regeln.map((r) => r.condition.requestDomains?.[0]),
    ['alpha.example', 'zeta.example'],
    'sortiert, damit zwei Laeufe dieselben Regeln ergeben',
  );
});

test('die IDs liegen im Bereich der Ausnahmen und sind eindeutig', () => {
  const regeln = baueAusnahmen(sites('a.example', 'b.example', 'c.example'));
  const ids = regeln.map((r) => r.id);
  assert.deepEqual(ids, [ID_AUSNAHME_VON, ID_AUSNAHME_VON + 1, ID_AUSNAHME_VON + 2]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(id >= ID_AUSNAHME_VON && id <= ID_AUSNAHME_BIS, `id ${id} ausserhalb 1..${ID_AUSNAHME_BIS}`);
  }
});

test('der Bereich beginnt bei 1 und laesst Platz fuer die eigenen Regeln', () => {
  assert.equal(ID_AUSNAHME_VON, 1);
  assert.ok(ID_AUSNAHME_BIS >= 1000, 'erweiterung.md N7 verlangt mindestens 1..1000');
});

/**
 * Die beiden Bereiche zusammen muessen unter der KLEINSTEN Deckelung bleiben,
 * die einer der drei Browser setzt. Firefox erlaubt 5000 dynamische plus
 * Sitzungsregeln, Chrome seit 121 dreissigtausend. Reisst der Aufruf die
 * Grenze, faellt `updateDynamicRules()` als GANZES um: nicht die eine Regel zu
 * viel, sondern alle - Ausnahmen und eigene Regeln zusammen waeren weg.
 *
 * Vorher standen hier 9999 Ausnahmen und ein Budget von 4000; das konnte die
 * Grenze reissen, sobald jemand ueber tausend Seiten freistellte.
 */
test('Ausnahmen und eigene Regeln passen zusammen unter die Firefox-Deckelung', () => {
  const FIREFOX_MAX = 5000;
  const hoechsteId = ID_EIGENE_VON + BUDGET_EIGENE - 1;
  assert.ok(ID_EIGENE_VON > ID_AUSNAHME_BIS, `die Bereiche ueberlappen: ${ID_AUSNAHME_BIS} / ${ID_EIGENE_VON}`);
  assert.ok(
    ID_AUSNAHME_BIS + BUDGET_EIGENE <= FIREFOX_MAX,
    `${ID_AUSNAHME_BIS} Ausnahmen + ${BUDGET_EIGENE} eigene > ${FIREFOX_MAX}`,
  );
  assert.ok(hoechsteId <= FIREFOX_MAX, `hoechste dynamische ID ${hoechsteId} ueber ${FIREFOX_MAX}`);
});

test('mehr Hosts als IDs sprengen die Erweiterung nicht', () => {
  const viele: Sites = {};
  for (let i = 0; i < ID_AUSNAHME_BIS + 50; i += 1) viele[`h${i}.example`] = { erlaubt: true, seit: 1 };
  const regeln = baueAusnahmen(viele);
  assert.equal(regeln.length, ID_AUSNAHME_BIS);
  assert.ok(regeln.every((r) => r.id <= ID_AUSNAHME_BIS));
});

test('ohne erlaubte Hosts gibt es keine Regeln', () => {
  assert.deepEqual(baueAusnahmen({}), []);
  assert.deepEqual(baueAusnahmen({ 'a.example': { erlaubt: false, seit: 1 } }), []);
});

test('ausschlussMuster deckt Host und Unterdomains ab', () => {
  const muster = ausschlussMuster(sites('beispiel.de'));
  assert.deepEqual(muster, ['*://beispiel.de/*', '*://*.beispiel.de/*']);
  assert.deepEqual(ausschlussMuster({ 'a.example': { erlaubt: false, seit: 1 } }), []);
});

// ── Host-Normalisierung ────────────────────────────────────────────────────

test('hostAus liefert den Hostnamen klein und ohne Port', () => {
  assert.equal(hostAus('https://WWW.Beispiel.DE/pfad?x=1#y'), 'www.beispiel.de');
  assert.equal(hostAus('http://beispiel.de:8080/'), 'beispiel.de');
  assert.equal(hostAus('https://beispiel.de'), 'beispiel.de');
});

test('`www.` bleibt stehen: es ist ein eigener Host', () => {
  // Wer `www.beispiel.de` erlaubt, hat genau diese Seite gemeint. Ein
  // stilles Abschneiden erlaubte auch `intern.beispiel.de`.
  assert.equal(hostAus('https://www.beispiel.de/'), 'www.beispiel.de');
  assert.notEqual(hostAus('https://www.beispiel.de/'), 'beispiel.de');
});

test('ein Umlautname kommt als Punycode, so wie der Browser ihn liefert', () => {
  assert.equal(hostAus('https://müller.example/'), 'xn--mller-kva.example');
  assert.equal(hostAus('https://MÜLLER.example/'), 'xn--mller-kva.example');
});

test('was keine http(s)-Adresse ist, hat keinen Host fuer uns', () => {
  assert.equal(hostAus(undefined), null);
  assert.equal(hostAus(''), null);
  assert.equal(hostAus('chrome://extensions'), null);
  assert.equal(hostAus('about:blank'), null);
  assert.equal(hostAus('file:///tmp/a.html'), null);
  assert.equal(hostAus('kein URL'), null);
});

test('hostKette nennt den Host und alle Domains darueber, TLD ausgenommen', () => {
  assert.deepEqual(hostKette('a.b.beispiel.de'), ['a.b.beispiel.de', 'b.beispiel.de', 'beispiel.de']);
  assert.deepEqual(hostKette('beispiel.de'), ['beispiel.de']);
  assert.deepEqual(hostKette('localhost'), ['localhost']);
});

test('eine Ausnahme auf der Domain gilt auch fuer ihre Unterdomains', () => {
  const s = sites('beispiel.de');
  assert.equal(siteErlaubt(s, 'beispiel.de'), true);
  assert.equal(siteErlaubt(s, 'shop.beispiel.de'), true);
  assert.equal(siteErlaubt(s, 'a.b.beispiel.de'), true);
  assert.equal(siteErlaubt(s, 'beispiel.de.boese.example'), false, 'kein Treffer als Praefix eines fremden Namens');
  assert.equal(siteErlaubt(s, 'anderes.example'), false);
});

test('ein auf false gesetzter Eintrag erlaubt nichts', () => {
  assert.equal(siteErlaubt({ 'beispiel.de': { erlaubt: false, seit: 1 } }, 'shop.beispiel.de'), false);
});
