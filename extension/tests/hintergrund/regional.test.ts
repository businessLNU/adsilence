/**
 * Die regionale Liste zur Browsersprache.
 *
 * Zwei Fragen: Findet die Zuordnung die richtige Liste, und schaltet die
 * Automatik nur beim ERSTEN Mal? Die zweite ist die wichtigere - eine
 * Automatik, die eine Entscheidung des Nutzers beim naechsten Start
 * ueberschreibt, ist ein Fehler, den er nicht abstellen kann.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionalFuerSprache, type ListeInfo } from '../../src/hintergrund/regeln.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const LISTEN: ListeInfo[] = [
  { id: 'basis', name: 'EasyList', premium: false, standard: true, regeln: 1 },
  { id: 'regional-de', name: 'EasyList Germany', premium: false, standard: false, regeln: 1, sprache: 'de' },
  { id: 'regional-fr', name: 'Liste FR', premium: false, standard: false, regeln: 1, sprache: 'fr' },
  { id: 'regional-ja', name: 'ABP Japanese filters', premium: false, standard: false, regeln: 1, sprache: 'ja' },
];

test('die Sprache des Browsers findet ihre Liste', () => {
  assert.equal(regionalFuerSprache('de', LISTEN), 'regional-de');
  assert.equal(regionalFuerSprache('fr', LISTEN), 'regional-fr');
  assert.equal(regionalFuerSprache('ja', LISTEN), 'regional-ja');
});

test('Landesvarianten finden dieselbe Liste', () => {
  // `de-AT`, `de-CH`, `fr-CA`: verglichen wird der Grundcode.
  assert.equal(regionalFuerSprache('de-AT', LISTEN), 'regional-de');
  assert.equal(regionalFuerSprache('de-CH', LISTEN), 'regional-de');
  assert.equal(regionalFuerSprache('fr-CA', LISTEN), 'regional-fr');
  assert.equal(regionalFuerSprache('DE', LISTEN), 'regional-de', 'Grossschreibung egal');
});

test('ohne passende Liste passiert nichts', () => {
  // Lieber keine Liste als eine in einer Sprache, die niemand liest.
  assert.equal(regionalFuerSprache('th', LISTEN), null);
  assert.equal(regionalFuerSprache('', LISTEN), null);
  assert.equal(regionalFuerSprache('xx-YY', LISTEN), null);
});

test('eine allgemeine Liste wird nie als regionale ausgewaehlt', () => {
  // `basis` hat keine `sprache`; kein Sprachcode darf sie treffen.
  for (const code of ['de', 'en', 'fr', 'zh']) {
    assert.notEqual(regionalFuerSprache(code, LISTEN), 'basis');
  }
});

test('jede regionale Quelle nennt eine Sprache, und keine doppelt', () => {
  const quellen: { id: string; sprache?: string; standard?: boolean }[] = JSON.parse(
    readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'),
  );
  const regional = quellen.filter((q) => q.id.startsWith('regional-'));
  assert.ok(regional.length > 10, `nur ${regional.length} regionale Listen`);
  const sprachen = new Set<string>();
  for (const q of regional) {
    assert.ok(q.sprache, `${q.id} hat keine Sprache`);
    assert.equal(sprachen.has(q.sprache!), false, `${q.sprache} steht zweimal`);
    sprachen.add(q.sprache!);
    // Regionale Listen sind NIE Standard: Sie werden über die Browsersprache
    // ausgewählt, sonst trüge jeder alle achtzehn mit.
    assert.equal(Boolean(q.standard), false, `${q.id} darf nicht standard sein`);
  }
});

test('die Sprachcodes der Listen gibt es auch als Oberflaechensprache', async () => {
  // Sonst stünde in der Liste ein Code statt eines Namens.
  const { SPRACHEN } = await import('../../src/oberflaeche/sprachen.ts');
  const bekannt = new Set(SPRACHEN.map((s) => s.code));
  const quellen: { id: string; sprache?: string }[] = JSON.parse(readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'));
  for (const q of quellen.filter((x) => x.sprache)) {
    assert.ok(bekannt.has(q.sprache!), `${q.sprache} steht in keiner Sprachliste`);
  }
});

// ── Wann die Listenpflege nachholt ─────────────────────────────────────────

test('istUeberfaellig: ohne Stand ist immer nachzuholen', async () => {
  const { istUeberfaellig } = await import('../../src/hintergrund/listenpflege.ts');
  const jetzt = Date.parse('2026-09-03T12:00:00.000Z');
  const tag = 24 * 60 * 60 * 1000;
  assert.equal(istUeberfaellig(null, jetzt, tag), true, 'noch nie gelaufen');
  assert.equal(istUeberfaellig(undefined, jetzt, tag), true);
  assert.equal(istUeberfaellig('kein Datum', jetzt, tag), true, 'unlesbar zaehlt als nie');
});

test('istUeberfaellig rechnet an der Grenze richtig', async () => {
  const { istUeberfaellig } = await import('../../src/hintergrund/listenpflege.ts');
  const jetzt = Date.parse('2026-09-03T12:00:00.000Z');
  const tag = 24 * 60 * 60 * 1000;
  assert.equal(istUeberfaellig('2026-09-03T11:00:00.000Z', jetzt, tag), false, 'eine Stunde her');
  assert.equal(istUeberfaellig('2026-09-02T13:00:00.000Z', jetzt, tag), false, 'knapp unter einem Tag');
  assert.equal(istUeberfaellig('2026-09-02T11:00:00.000Z', jetzt, tag), true, 'knapp darueber');
  assert.equal(istUeberfaellig('2026-08-27T12:00:00.000Z', jetzt, tag), true, 'eine Woche');
});

test('die zwei Grenzen stehen in der richtigen Reihenfolge', async () => {
  const { LISTENPFLEGE_UEBERFAELLIG_MS, LISTENPFLEGE_VERALTET_MS, LISTENPFLEGE_TAKT_MIN } = await import(
    '../../src/gemeinsam/konstanten.ts'
  );
  // Erst nachholen, dann warnen: Wer beim Start nachholt, soll nicht zugleich
  // eine Warnung sehen, die der Nachholvorgang gerade beseitigt.
  assert.ok(LISTENPFLEGE_UEBERFAELLIG_MS < LISTENPFLEGE_VERALTET_MS, 'nachholen muss vor warnen kommen');
  // Und der Nachholpunkt liegt hinter dem Takt, sonst holt jeder Start nach.
  assert.ok(LISTENPFLEGE_UEBERFAELLIG_MS > LISTENPFLEGE_TAKT_MIN * 60 * 1000, 'sonst laeuft sie bei jedem Start');
});
