/**
 * Prueft den Uebersetzungskern gegen die echten Kataloge `i18n/de.json` und
 * `i18n/en.json`. Laeuft mit `node --test` ohne Bundler: Der Kern importiert
 * nichts aus Vite oder React, die Kataloge kommen ueber `fs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fuellePlatzhalter,
  richtung,
  schluesselAusId,
  uebersetze,
  waehleSprache,
  zerlegePlatzhalter,
  type Katalog,
} from '../../src/oberflaeche/i18n-kern.ts';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ordner = join(wurzel, 'i18n');

const kataloge: Record<string, Katalog> = {};
for (const datei of readdirSync(ordner).filter((d) => d.endsWith('.json'))) {
  kataloge[datei.slice(0, -5)] = JSON.parse(readFileSync(join(ordner, datei), 'utf8'));
}

test('de und en sind da und decken dieselben Schluessel ab', () => {
  assert.ok(kataloge.de, 'de.json fehlt');
  assert.ok(kataloge.en, 'en.json fehlt');
  assert.deepEqual(Object.keys(kataloge.en!).sort(), Object.keys(kataloge.de!).sort());
});

test('extDescription ist der Single-Purpose-Satz', () => {
  assert.equal(kataloge.en!.extDescription, 'Blocks ads and trackers, keeps pages quiet. Nothing else.');
  assert.equal(kataloge.de!.extName, 'AdSilence');
});

test('kein Wert ist leer, keiner traegt Gedankenstrich oder Emoji', () => {
  for (const [code, katalog] of Object.entries(kataloge)) {
    for (const [k, v] of Object.entries(katalog)) {
      assert.ok(v.trim().length > 0, `${code}: ${k} leer`);
      assert.doesNotMatch(v, /[–—]/, `${code}: ${k} hat Gedankenstrich`);
      assert.doesNotMatch(v, /\p{Extended_Pictographic}/u, `${code}: ${k} hat Emoji`);
    }
  }
});

test('t() liefert de, faellt auf en zurueck und zuletzt auf den Schluessel', () => {
  assert.equal(uebersetze(kataloge, 'de', 'en', 'popup.aktiv'), 'AdSilence aktiv');
  assert.equal(uebersetze(kataloge, 'en', 'en', 'popup.aktiv'), 'AdSilence active');
  // Eine Sprache ohne Katalog faellt auf Englisch zurueck, nicht auf Deutsch.
  // `he` steht bewusst hier: Hier stand einmal `th`, und als der thailaendische
  // Katalog dazukam, pruefte die Zeile nichts mehr - sie bekam Thai und meldete
  // einen Fehler, obwohl der Rueckfall in Ordnung war. Der Platzhalter fuer
  // "gibt es nicht" darf keine Sprache sein, die es geben koennte.
  assert.ok(!kataloge.he, 'he.json gibt es doch: bitte einen anderen Platzhalter waehlen');
  assert.equal(uebersetze(kataloge, 'he', 'en', 'popup.aktiv'), 'AdSilence active');
  assert.equal(uebersetze(kataloge, 'de', 'en', 'gibt.es.nicht'), 'gibt.es.nicht');
});

test('jede Sprache im Ordner ist geladen und antwortet aus dem eigenen Katalog', () => {
  /*
   * Die Liste kommt aus dem ORDNER, nicht aus einer Aufzaehlung.
   *
   * Hier stand `['de','en','zh',…]` mit zwanzig Codes und „die 20 Sprachen"
   * im Namen. Beim Angleichen an die Website am 07.09.2026 fielen zehn
   * Kataloge weg — und diese Zeile war die einzige Stelle, die deshalb umfiel,
   * obwohl nichts kaputt war. Eine abgeschriebene Liste stimmt bis zur
   * naechsten Aenderung und ist danach Arbeit, die nichts prueft.
   */
  const erwartet = readdirSync(new URL('../../i18n/', import.meta.url))
    .filter((d) => d.endsWith('.json'))
    .map((d) => d.replace(/\.json$/, ''))
    .sort();
  assert.ok(erwartet.length > 0, 'i18n/ ist leer');
  assert.deepEqual(Object.keys(kataloge).sort(), erwartet);
  // Nicht nur "geladen": Der Wert muss aus dem eigenen Katalog kommen und nicht
  // ueber den Rueckfall aus `en`.
  for (const code of erwartet) {
    assert.equal(uebersetze(kataloge, code, 'en', 'popup.aktiv'), kataloge[code]!['popup.aktiv']);
  }
});

test('Platzhalter werden gefuellt, fehlende bleiben sichtbar stehen', () => {
  assert.equal(uebersetze(kataloge, 'de', 'en', 'popup.site.blockiert', { anzahl: 37 }), '37 Anfragen blockiert');
  assert.equal(uebersetze(kataloge, 'en', 'en', 'popup.premium.bis', { datum: '01.01.2027' }), 'Premium until 01.01.2027');
  assert.equal(fuellePlatzhalter('Hallo {name}, {rest}', { name: 'Welt' }), 'Hallo Welt, {rest}');
});

test('jeder Platzhalter in de hat denselben Platzhalter in en', () => {
  const namen = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
  for (const [k, v] of Object.entries(kataloge.de!)) {
    assert.deepEqual(namen(kataloge.en![k]!), namen(v), `Platzhalter weichen ab: ${k}`);
  }
});

test('zerlegePlatzhalter trennt Text und Platzhalter in Reihenfolge', () => {
  assert.deepEqual(zerlegePlatzhalter('Ich akzeptiere die {agb} und die {widerruf}.'), [
    'Ich akzeptiere die ',
    { platzhalter: 'agb' },
    ' und die ',
    { platzhalter: 'widerruf' },
    '.',
  ]);
  assert.deepEqual(zerlegePlatzhalter('{a}'), [{ platzhalter: 'a' }]);
  assert.deepEqual(zerlegePlatzhalter('nur Text'), ['nur Text']);
});

test('waehleSprache: Einstellung gewinnt, de-AT findet de, sonst Browser', () => {
  const verfuegbar = ['de', 'en'];
  assert.equal(waehleSprache('de', verfuegbar, () => 'en'), 'de');
  assert.equal(waehleSprache('de-AT', verfuegbar, () => 'en'), 'de');
  assert.equal(waehleSprache('th', verfuegbar, () => 'en'), 'en');
  assert.equal(waehleSprache(null, verfuegbar, () => 'de'), 'de');
  assert.equal(waehleSprache(undefined, verfuegbar, () => 'en'), 'en');
});

test('richtung: ar und fa laufen rechts nach links, alles andere nicht', () => {
  assert.equal(richtung('ar'), 'rtl');
  assert.equal(richtung('fa-IR'), 'rtl');
  assert.equal(richtung('de'), 'ltr');
  assert.equal(richtung('he'), 'ltr');
});

test('schluesselAusId macht aus regional-de regionalDe', () => {
  assert.equal(schluesselAusId('regional-de'), 'regionalDe');
  assert.equal(schluesselAusId('basis'), 'basis');
  // JEDE Liste aus `listen/quellen.json`, nicht eine Auswahl von Hand: Eine
  // neue Liste ohne eigene Texte zeigt im Reiter Filterlisten ihren englischen
  // Namen zweimal - einmal als Name, einmal als Beschreibung. Genau so standen
  // die fuenf uBlock-Listen da, bis es jemand bemerkte.
  // Die REGIONALEN Listen sind ausgenommen: Ihr Name ist der Name ihrer
  // Sprache aus `sprachen.ts` (siehe `nameVon()` in Filterlisten.tsx), und
  // achtzehn Listen mal zwanzig Sprachen waeren 360 Uebersetzungen fuer
  // Namen, die dort laengst stehen.
  //
  // Erklaert wird mit einem Satz (`.text`). Er muss da sein; ohne ihn steht
  // wieder zweimal derselbe englische Name.
  const quellen: { id: string; sprache?: string }[] = JSON.parse(readFileSync(join(wurzel, 'listen', 'quellen.json'), 'utf8'));
  for (const { id } of quellen.filter((q) => !q.sprache)) {
    const k = schluesselAusId(id);
    assert.ok(kataloge.de![`optionen.listen.${k}.name`], `de: optionen.listen.${k}.name fehlt`);
    assert.ok(kataloge.de![`optionen.listen.${k}.text`], `de: optionen.listen.${k}.text fehlt`);
  }
});

/**
 * Die Knopfschluessel kommen AUS DEM QUELLTEXT, nicht aus einer Liste hier.
 *
 * Hier stand eine Aufzaehlung von dreizehn Schluesseln. Sie war am 08.09.2026
 * falsch: `optionen.konto.pruefen` war entfernt worden, und der Test fiel mit
 * `Cannot read properties of undefined` um -- nicht weil ein Knopf zu lang
 * war, sondern weil die Abschrift veraltet war. Umgekehrt haette ein NEUER
 * Knopf nie jemandem gefehlt: Was nicht in der Liste steht, wird nicht
 * geprueft, und niemand merkt es.
 *
 * Gesucht wird das Muster `<Knopf …>{t('schluessel')}</Knopf>` in allen
 * Bauteilen. Ein Knopf ist damit genau das, was im Code einer ist.
 */
function knopfschluessel(): string[] {
  const gefunden = new Set<string>();
  const lauf = (ordner: string) => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const voll = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) lauf(voll);
      else if (eintrag.name.endsWith('.tsx')) {
        const text = readFileSync(voll, 'utf8');
        /*
         * Nicht `<Knopf[^>]*>`: Ein `onClick={() => …}` enthaelt selbst ein
         * `>`, und der Ausdruck brach dort ab -- gefunden wurden dann fuenf
         * von dreizehn Knoepfen. Stattdessen ein Fenster bis zum ersten
         * `t('…')` nach dem Knopfanfang.
         */
        for (const t of text.matchAll(/<Knopf\b[\s\S]{0,400}?\{t\('([^']+)'/g)) gefunden.add(t[1]!);
      }
    }
  };
  lauf(join(wurzel, 'src'));
  return [...gefunden].sort();
}

test('Knopftexte haben hoechstens drei Woerter', () => {
  const knoepfe = knopfschluessel();
  assert.ok(
    knoepfe.length >= 8,
    `Nur ${knoepfe.length} Knopftexte gefunden. Entweder hat sich das Muster ` +
      'geaendert, oder dieser Test prueft nichts mehr.',
  );
  for (const [code, katalog] of Object.entries(kataloge)) {
    for (const k of knoepfe) {
      const wert = katalog[k];
      assert.ok(wert, `${code}: ${k} steht auf einem Knopf, fehlt aber im Katalog.`);
      const woerter = wert!.trim().split(/\s+/).length;
      assert.ok(woerter <= 3, `${code}: ${k} hat ${woerter} Woerter`);
    }
  }
});
