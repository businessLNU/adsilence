/**
 * Die Meldung „Ich sehe hier Werbung" darf keine fremden Projektnamen tragen.
 *
 * ── Der Fall, gegen den diese Datei steht ─────────────────────────────────
 * Unter „Aktive Listen" stand die rohe Kennung jeder aktiven Liste. Bei einem
 * Kunden mit den Standardeinstellungen las sich das so:
 *
 *   basis, privatsphaere, hosts, tarnung, ublock, ublock-privatsphaere,
 *   ublock-schadsoftware, urlhaus, heimnetz, ublock-eilig, ublock-reparatur,
 *   antiadblock, cookies, laestig, regional-de
 *
 * Zwei Dinge stimmen daran nicht. Erstens stehen dort die Namen fremder
 * Projekte, in einem Fenster, das unser Produkt zeigt — und der Kunde SIEHT
 * diese Zeile, sie ist die Vorschau dessen, was er absendet. Zweitens sagt
 * ihm kein einziges der Woerter etwas.
 *
 * Gesendet wird deshalb der Bereich. `bereicheVon()` ist die Stelle, die das
 * uebersetzt, und dieser Test haelt fest, dass keine Kennung durchkommt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LISTEN_VORGABE, bereicheVon } from '../../src/gemeinsam/konstanten.ts';

/** Die sieben Bereiche — mehr darf `bereicheVon` nie zurueckgeben. */
const ERLAUBT = new Set(['werbung', 'privatsphaere', 'schadsoftware', 'cookies', 'laestiges', 'reparatur', 'regional']);

/**
 * Kennungen, die es HEUTE nicht gibt — genau der Fall, der die Sperre
 * braucht.
 *
 * Die erste Fassung dieses Tests fuetterte nur `LISTEN_VORGABE`. Damit war er
 * wirkungslos: Jede Kennung dort steht in der Zuordnungstabelle, also kam
 * ohnehin nur ein Bereich heraus — auch nachdem der schuetzende Filter am
 * Ende von `bereicheVon()` versuchsweise entfernt worden war. Gefaehrlich ist
 * aber gerade die Liste, die jemand MORGEN eintraegt und in der Tabelle
 * vergisst.
 */
const KUENFTIGE = ['ublock-neu', 'adguard-basis', 'easylist-extra', 'urlhaus-zwei'];

test('keine Listenkennung kommt durch — auch keine unbekannte', () => {
  const alle = [...LISTEN_VORGABE.map((l) => l.id), ...KUENFTIGE];
  for (const bereich of bereicheVon(alle)) {
    assert.ok(
      ERLAUBT.has(bereich),
      `„${bereich}" ist kein Bereich, sondern eine durchgereichte Kennung. ` +
        'Genau die stand vorher in der Meldung, die der Kunde absendet.',
    );
  }
});

/**
 * Der eigentliche Punkt, direkt geprueft: Kein Name eines fremden Projekts
 * darf in der Ausgabe vorkommen — auch nicht als Teil eines Wortes.
 */
test('kein fremder Projektname in der Ausgabe', () => {
  const ausgabe = bereicheVon([...LISTEN_VORGABE.map((l) => l.id), ...KUENFTIGE])
    .join(' ')
    .toLowerCase();
  for (const name of ['ublock', 'urlhaus', 'easylist', 'fanboy', 'adguard', 'adblock', 'abp']) {
    assert.ok(!ausgabe.includes(name), `„${name}" steht in der Meldung: ${ausgabe}`);
  }
});

/**
 * Jede Liste muss einem Bereich zugeordnet sein. Eine, die fehlt, faellt
 * still weg — das ist der sichere Ausgang, aber es heisst auch, dass eine
 * neue Liste in der Meldung unsichtbar bleibt, bis es jemand merkt.
 */
test('jede Liste hat einen Bereich', () => {
  for (const l of LISTEN_VORGABE) {
    assert.equal(
      bereicheVon([l.id]).length,
      1,
      `„${l.id}" ist keinem Bereich zugeordnet (BEREICH_JE_LISTE in gemeinsam/konstanten.ts).`,
    );
  }
});

/** Zwoelf Regionallisten ergeben EINEN Eintrag, nicht zwoelf. */
test('die Regionallisten fallen zu einem Eintrag zusammen', () => {
  const regional = LISTEN_VORGABE.filter((l) => l.id.startsWith('regional-')).map((l) => l.id);
  assert.ok(regional.length > 5, 'die Probe braucht mehrere Regionallisten');
  assert.deepEqual(bereicheVon(regional), ['regional']);
});

/** Die Reihenfolge ist fest, damit zwei Meldungen vergleichbar bleiben. */
test('die Reihenfolge haengt nicht an der Eingabe', () => {
  const a = bereicheVon(['cookies', 'basis', 'urlhaus']);
  const b = bereicheVon(['urlhaus', 'cookies', 'basis']);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['werbung', 'schadsoftware', 'cookies']);
});

/** Ein Wert, den es nicht gibt, wird weggelassen und nicht durchgereicht. */
test('eine unbekannte Kennung faellt weg', () => {
  assert.deepEqual(bereicheVon(['gibt-es-nicht', 'basis']), ['werbung']);
});
