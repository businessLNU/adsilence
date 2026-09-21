/**
 * Cookie-Fenster automatisch beantworten.
 *
 * Die wichtigste Frage ist nicht „findet es den Knopf", sondern „klickt es
 * NUR dann, wenn es ein Einwilligungsfenster ist". Ein Klick auf den falschen
 * Knopf - Kauf bestaetigen, AGB annehmen, Ueberweisung ausloesen - ist
 * schlimmer als ein stehengebliebenes Fenster.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findeKnopf, WERKZEUGE } from '../../src/gemeinsam/cookies.ts';

/** Eine Seite nachstellen: welche Selektoren gibt es, welche sind sichtbar? */
function seite(vorhanden: string[]) {
  const hat = (selektor: string) => selektor.split(',').some((s) => vorhanden.includes(s.trim()));
  return { gibtEs: hat, sichtbar: hat };
}

test('auf einer Seite OHNE Einwilligungswerkzeug wird nichts geklickt', () => {
  // Auch dann nicht, wenn zufaellig ein Knopf mit passendem Selektor da ist:
  // Ohne die Kennung des Werkzeugs gibt es keinen Grund anzunehmen, dass es
  // um Cookies geht.
  const s = seite(['#onetrust-accept-btn-handler', '.cky-btn-accept']);
  assert.equal(findeKnopf('annehmen', s.gibtEs, s.sichtbar), null);
  assert.equal(findeKnopf('ablehnen', s.gibtEs, s.sichtbar), null);
});

test('mit Kennung UND Knopf wird der richtige gefunden', () => {
  const s = seite(['#onetrust-banner-sdk', '#onetrust-accept-btn-handler', '#onetrust-reject-all-handler']);
  assert.equal(findeKnopf('annehmen', s.gibtEs, s.sichtbar)?.selektor, '#onetrust-accept-btn-handler');
  assert.equal(findeKnopf('ablehnen', s.gibtEs, s.sichtbar)?.selektor, '#onetrust-reject-all-handler');
});

test('ohne sichtbaren Knopf wird nicht geklickt, auch wenn die Kennung da ist', () => {
  // Das Fenster laedt noch: Kennung im DOM, Knopf noch nicht sichtbar.
  const s = seite(['#onetrust-banner-sdk']);
  assert.equal(findeKnopf('annehmen', s.gibtEs, s.sichtbar), null);
});

test('gibt es zur gewaehlten Antwort keinen Knopf, wird NICHT der andere geklickt', () => {
  // Manche Werkzeuge kennen kein „alles ablehnen". Dann bleibt das Fenster
  // stehen - ein Ausweichen auf „annehmen" waere das Gegenteil dessen, was
  // der Nutzer gewaehlt hat.
  const s = seite(['#truste-consent-track', '#truste-consent-button']);
  assert.equal(findeKnopf('annehmen', s.gibtEs, s.sichtbar)?.selektor, '#truste-consent-button');
  assert.equal(findeKnopf('ablehnen', s.gibtEs, s.sichtbar), null);
});

test('jedes Werkzeug hat Kennung und mindestens einen Annehmen-Knopf', () => {
  for (const w of WERKZEUGE) {
    assert.ok(w.erkennung.trim(), `${w.name}: keine Erkennung`);
    assert.ok(w.annehmen.length > 0, `${w.name}: kein Annehmen-Knopf`);
    // `ablehnen` darf leer sein - nicht jedes Werkzeug bietet es an.
    for (const s of [...w.annehmen, ...w.ablehnen, w.erkennung]) {
      assert.doesNotThrow(() => new RegExp(''), `${w.name}: ${s}`);
      assert.ok(s.length < 200, `${w.name}: Selektor zu lang`);
    }
  }
});

test('kein Werkzeug klickt denselben Selektor fuer beide Antworten', () => {
  // Sonst hiesse „ablehnen" in Wahrheit „annehmen".
  for (const w of WERKZEUGE) {
    for (const a of w.annehmen) {
      assert.equal(w.ablehnen.includes(a), false, `${w.name}: ${a} steht auf beiden Seiten`);
    }
  }
});

test('die Werkzeuge sind eindeutig benannt', () => {
  const namen = WERKZEUGE.map((w) => w.name);
  assert.equal(new Set(namen).size, namen.length, 'ein Name kommt doppelt vor');
});
