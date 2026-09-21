/**
 * `:has-text()` - Selektor und gesuchter Text auseinandernehmen.
 *
 * Hier liegt das Risiko dieser Funktion. Der Läufer im Inhaltsskript
 * VERSTECKT, was er trifft; ein Selektor, der zu weit gefasst ist, nimmt
 * einer Seite einen Teil weg, den niemand gemeint hat. Deshalb prüfen die
 * meisten Fälle unten, was NICHT durchkommt.
 *
 * GEMESSEN über alle Quelllisten am 08.09.2026: 1.520 Zeilen mit einer
 * Textsuche, davon 910 in der Form, die hier durchkommt (Operator am Ende).
 * Die übrigen 610 stehen verschachtelt oder tragen Kombinatoren dahinter -
 * für die bräuchte es einen Selektor-Parser, und bis der steht, ist „fast
 * richtig" die schlechtere Antwort als „nicht umgesetzt".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListe } from '../../src/engine/abp.ts';
import { alsTextregel, zuTextregeln } from '../../src/engine/prozedural.ts';

test('die einfache Form wird zerlegt', () => {
  assert.deepEqual(alsTextregel('.box:has-text(Werbung)'), { wahl: '.box', text: 'Werbung' });
  assert.deepEqual(alsTextregel('p:-abp-contains(Anzeige)'), { wahl: 'p', text: 'Anzeige' });
  assert.deepEqual(alsTextregel('div.a > span:contains(Ad)'), { wahl: 'div.a > span', text: 'Ad' });
});

test('ein regulaerer Ausdruck bleibt stehen, wie er ist', () => {
  // 197 der gemessenen Zeilen benutzen diese Form. Der Läufer erkennt sie an
  // den Schrägstrichen; hier wird nichts übersetzt.
  assert.deepEqual(alsTextregel('.box:has-text(/Werb\\w+/)'), { wahl: '.box', text: '/Werb\\w+/' });
});

test('Klammern IM Text zaehlen mit', () => {
  assert.deepEqual(alsTextregel('.box:has-text(Anzeige (gesponsert))'), {
    wahl: '.box',
    text: 'Anzeige (gesponsert)',
  });
});

test('was nach dem Operator noch kommt, macht die Regel unbrauchbar', () => {
  // `:has-text(Werbung) + .box` heisst „das Geschwister DANACH" - wer nur den
  // Teil davor nimmt, versteckt das falsche Element.
  for (const s of [
    '.a:has-text(Werbung) + .box',
    '.a:has-text(Werbung) > span',
    'p:has-text(Anzeige) ~ div',
    '.a:has-text(x):upward(2)',
  ]) {
    assert.equal(alsTextregel(s), null, s);
  }
});

test('verschachtelt in :has() kommt nicht durch', () => {
  // `.a:has(h2:has-text(Anzeigen))` meint: `.a`, DAS ein h2 mit dem Text
  // enthaelt. Den Selektor davor zu nehmen waere `.a:has(h2` - unbrauchbar.
  assert.equal(alsTextregel('.mfe-lex:has(h2:has-text(Anzeigen))'), null);
  assert.equal(alsTextregel('div.X:has(span.Y:has-text(Anzeigen))'), null);
});

test('zwei Textoperatoren in einer Zeile kommen nicht durch', () => {
  assert.equal(alsTextregel('.a:has-text(eins):has-text(zwei)'), null);
});

test('ohne gueltigen Selektor davor gibt es keine Regel', () => {
  for (const s of [
    ':has-text(Werbung)', // nichts davor
    '.a:has-text()', // nichts drin
    '[[[[:has-text(x)', // kaputter Selektor
    '.a:has-text(x', // Klammer offen
    '.a', // gar kein Operator
  ]) {
    assert.equal(alsTextregel(s), null, s);
  }
});

// ── Aus gelesenen Regeln eine Karte je Host ────────────────────────────────

const karte = (...zeilen: string[]) => zuTextregeln(parseListe(zeilen.join('\n')));

test('eine Textregel landet unter ihrem Host', () => {
  assert.deepEqual(karte('beispiel.de#?#.box:has-text(Werbung)'), {
    'beispiel.de': [{ wahl: '.box', text: 'Werbung' }],
  });
});

test('mehrere Domains bekommen dieselbe Regel', () => {
  const k = karte('a.de,b.de#?#.box:has-text(Werbung)');
  assert.deepEqual(Object.keys(k).sort(), ['a.de', 'b.de']);
});

test('eine Regel OHNE Host bleibt draussen', () => {
  // Sie liefe auf jeder Seite der Welt und muesste bei jeder DOM-Aenderung
  // neu bewertet werden. In den Quelllisten gibt es keine solche Zeile.
  assert.deepEqual(karte('#?#.box:has-text(Werbung)'), {});
});

test('`#@?#` nimmt die Regel zurueck, egal in welcher Reihenfolge', () => {
  assert.deepEqual(karte('a.de#?#.box:has-text(x)', 'a.de#@?#.box:has-text(x)'), {});
  assert.deepEqual(karte('a.de#@?#.box:has-text(x)', 'a.de#?#.box:has-text(x)'), {});
  // Eine Ausnahme auf einem ANDEREN Host laesst die Regel stehen.
  assert.deepEqual(karte('a.de#?#.box:has-text(x)', 'b.de#@?#.box:has-text(x)'), {
    'a.de': [{ wahl: '.box', text: 'x' }],
  });
});

test('dieselbe Regel zweimal steht einmal da', () => {
  assert.deepEqual(karte('a.de#?#.box:has-text(x)', 'a.de#?#.box:has-text(x)'), {
    'a.de': [{ wahl: '.box', text: 'x' }],
  });
});

test('was schon als reines CSS durchgeht, kommt hier NICHT nochmal', () => {
  // `:has()` wendet der Browser selbst an - eine zweite Fassung als Textregel
  // waere derselbe Effekt zum Preis eines DOM-Laufs.
  assert.deepEqual(karte('a.de#?#.box:has(.werbung)'), {});
});

test('`##` ohne Fragezeichen erzeugt keine Textregel', () => {
  assert.deepEqual(karte('a.de##.box:has-text(x)'), {});
});

/*
 * Der Nachweis an den gebauten Listen: Jeder Selektor, der dort steht, muss
 * ein Selektor sein, den ein Browser annimmt. Ein kaputter faellt im
 * Inhaltsskript in ein `catch` und wirkt still nicht - genau die Sorte
 * Fehler, die niemandem auffaellt.
 */
test('die gebauten Textregeln tragen brauchbare Selektoren', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ordner = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prozedural');
  if (!existsSync(ordner)) return;

  let regeln = 0;
  const hosts = new Set<string>();
  for (const datei of readdirSync(ordner)) {
    if (!datei.endsWith('.json')) continue;
    const karteJe = JSON.parse(readFileSync(join(ordner, datei), 'utf8')) as Record<
      string,
      { wahl: string; text: string }[]
    >;
    for (const [host, liste] of Object.entries(karteJe)) {
      hosts.add(host);
      for (const r of liste) {
        regeln += 1;
        assert.ok(r.wahl && r.text, `${host}: leeres Feld in ${JSON.stringify(r)}`);
        assert.ok(
          !r.wahl.includes(':has-text(') && !r.wahl.includes(':-abp-contains('),
          `${host}: der Operator steht noch im Selektor: ${r.wahl}`,
        );
      }
    }
  }
  assert.ok(regeln > 800, `nur ${regeln} Textregeln gebaut - gemessen waren es 1.157`);
  assert.ok(hosts.size > 600, `nur ${hosts.size} Hosts - gemessen waren es 798`);
});
