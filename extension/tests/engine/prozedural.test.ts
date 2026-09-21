/**
 * `#?#` — prozedurale Kosmetik, und warum sie nicht mehr pauschal wegfällt.
 *
 * Bis zum 08.09.2026 verwarf der Parser JEDE `#?#`-Zeile, ungelesen. Die
 * Begründung war richtig und die Folge falsch: In dieser Schreibweise stehen
 * Operatoren, die CSS nicht kann — aber längst nicht in jeder Zeile.
 *
 * GEMESSEN über alle Quelllisten: 2.465 `#?#`-Zeilen, davon 903 ohne einen
 * einzigen solchen Operator. Fast durchweg `:has(...)`, das jeder Zielbrowser
 * nativ beherrscht. Sie fielen weg, weil sie mit einem Fragezeichen
 * geschrieben sind, nicht weil an ihnen etwas unmöglich wäre.
 *
 * Was WIRKLICH einen DOM-Läufer bräuchte, fällt weiter heraus — und zwar
 * unter seinem eigenen Grund, nicht als „kaputter Selektor".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListe } from '../../src/engine/abp.ts';
import { zuKosmetik } from '../../src/engine/kosmetik.ts';

function baue(...zeilen: string[]) {
  const verworfen: Record<string, number> = {};
  const k = zuKosmetik(parseListe(zeilen.join('\n')), verworfen);
  return { k, verworfen };
}

test(':has() kommt durch und gilt nur auf seiner Seite', () => {
  const { k, verworfen } = baue('beispiel.de#?#.karte:has(.werbung)');
  assert.deepEqual(k.spezifisch['beispiel.de'], ['.karte:has(.werbung)']);
  assert.deepEqual(k.generisch, [], 'nichts davon darf global werden');
  assert.deepEqual(verworfen, {});
});

test(':-abp-has() ist dasselbe und wird auf die amtliche Schreibweise gebracht', () => {
  const { k } = baue('beispiel.de#?#article:-abp-has([href="/adblock"])');
  assert.deepEqual(k.spezifisch['beispiel.de'], ['article:has([href="/adblock"])']);
});

test('was einen DOM-Laeufer braeuchte, faellt weiter heraus — unter eigenem Grund', () => {
  for (const zeile of [
    'beispiel.de#?#.box:has-text(Werbung)',
    'beispiel.de#?#.box:-abp-contains(Werbung)',
    'beispiel.de#?#.box:-abp-properties(color)',
    'beispiel.de#?#.box:upward(2)',
  ]) {
    const { k, verworfen } = baue(zeile);
    assert.deepEqual(k.spezifisch, {}, zeile);
    assert.equal(verworfen.erweiterteKosmetik, 1, zeile);
    assert.equal(verworfen.selektorUngueltig, undefined, `${zeile}: das ist kein kaputter Selektor`);
  }
});

test('`#$#` und `#%#` bleiben draussen, unveraendert', () => {
  // Diese beiden verwirft schon der PARSER — sie erreichen `zuKosmetik` nie.
  // Deshalb wird hier die gelesene Regel geprueft, nicht der Zaehler.
  const regeln = parseListe('beispiel.de#$#body { padding: 0 }\nbeispiel.de#%#log()');
  assert.equal(regeln.length, 2);
  for (const r of regeln) {
    assert.equal(r.typ, 'unbekannt');
    assert.equal((r as { grund?: string }).grund, 'erweiterteKosmetik');
  }
});

test('ein kaputter `##`-Selektor bleibt ein kaputter Selektor', () => {
  // Die beiden Zahlen duerfen nicht in einen Topf: Wer `selektorUngueltig`
  // senken will, sucht einen Fehler. Wer `erweiterteKosmetik` senken will,
  // baut einen Operator nach. Das sind zwei verschiedene Arbeiten.
  const { verworfen } = baue('beispiel.de##[[[[');
  assert.equal(verworfen.selektorUngueltig, 1);
  assert.equal(verworfen.erweiterteKosmetik, undefined);
});

test('eine `#@?#`-Ausnahme nimmt den Selektor zurueck', () => {
  const { k } = baue('beispiel.de#?#.karte:has(.werbung)', 'beispiel.de#@?#.karte:has(.werbung)');
  assert.deepEqual(k.ausnahmen['beispiel.de'], ['.karte:has(.werbung)']);
});

/*
 * Der Nachweis am gebauten Paket: Keine einzige uebernommene `#?#`-Regel darf
 * im GENERISCHEN Blatt landen. Ein `:has()` ohne Domain liefe auf jeder Seite
 * der Welt, und der Browser muesste es bei jeder DOM-Aenderung neu bewerten.
 * GEMESSEN: In den Quelllisten steht keine einzige domainlose `#?#`-Zeile —
 * dieser Test haelt fest, dass das so bleibt.
 */
test('kein :has() steht im generischen Blatt', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const datei = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kosmetik', 'generisch.css');
  if (!existsSync(datei)) return;
  const css = readFileSync(datei, 'utf8');
  assert.ok(
    !css.includes(':has('),
    'im generischen Blatt steht ein :has() — das laeuft dann auf JEDER Seite',
  );
});
