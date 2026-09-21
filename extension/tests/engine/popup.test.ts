/**
 * `$popup` → Hosts, deren Tab wieder zugeht.
 *
 * Der Kern dieser Datei ist die STRENGE: Ein Host, der „ungefaehr passt",
 * schliesst irgendwann einen Tab, den jemand wollte — und das ist schlimmer
 * als ein Popunder. Deshalb kommt nur durch, was ein reiner Host-Anker ist,
 * und alles mit einer Bedingung, die ein Tab nicht kennt, bleibt draussen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListe } from '../../src/engine/abp.ts';
import { popupHostVon, zuPopupHosts } from '../../src/engine/popup.ts';

const hosts = (...zeilen: string[]) => zuPopupHosts(parseListe(zeilen.join('\n'))).hosts;

test('ein reiner Host-Anker wird uebernommen, mit und ohne third-party', () => {
  assert.deepEqual(hosts('||adfoc.us^$popup'), ['adfoc.us']);
  assert.deepEqual(hosts('||adintop.com^$popup,third-party'), ['adintop.com']);
  assert.deepEqual(hosts('||aflam.io^$popup'), ['aflam.io']);
});

test('Pfadmuster bleiben draussen — dafuer braeuchte es einen URL-Vergleicher', () => {
  // Diese Formen stehen wirklich in den Listen. Sie als Host zu lesen hiesse,
  // aus `/cpm/ad.$popup` irgendeinen Host zu raten.
  for (const zeile of ['/adsph2/*$popup', '.cash/?clickid=$popup', '/cpm/ad.$popup', '||a.de/werbung$popup']) {
    assert.deepEqual(hosts(zeile), [], zeile);
  }
});

test('ein Platzhalter im Host ist kein Host', () => {
  assert.deepEqual(hosts('||ad*.com^$popup'), []);
});

test('Bedingungen, die der Tab nicht kennt, fallen weg', () => {
  // `domain=` gilt der oeffnenden Seite, `~third-party` dem Verhaeltnis der
  // beiden — beides weiss der neue Tab nicht sicher.
  assert.deepEqual(hosts('||werbung.de^$popup,domain=hltv.org'), []);
  assert.deepEqual(hosts('||werbung.de^$popup,~third-party'), []);
});

test('eine Ausnahme nimmt den Host zurueck, egal in welcher Reihenfolge', () => {
  assert.deepEqual(hosts('||gut.de^$popup', '@@||gut.de^$popup'), []);
  assert.deepEqual(hosts('@@||gut.de^$popup', '||gut.de^$popup'), []);
  const e = zuPopupHosts(parseListe('@@||gut.de^$popup'));
  assert.deepEqual(e.ausnahmen, ['gut.de'], 'die Ausnahme muss auch benannt sein');
});

test('Regeln ohne $popup gehen den Popup-Weg gar nicht erst', () => {
  assert.deepEqual(hosts('||werbung.de^', '||werbung.de^$script', 'beispiel.de##.werbung'), []);
});

test('doppelte Hosts stehen einmal da, sortiert', () => {
  assert.deepEqual(hosts('||b.de^$popup', '||a.de^$popup', '||b.de^$popup'), ['a.de', 'b.de']);
});

test('popupHostVon ist streng und macht klein', () => {
  assert.equal(popupHostVon('||Beispiel.DE^'), 'beispiel.de');
  assert.equal(popupHostVon('||beispiel.de'), 'beispiel.de', 'das ^ darf fehlen');
  for (const muster of ['|http://a.de', '||a.de/pfad', '||a.de^$', 'a.de', '', '||*^']) {
    assert.equal(popupHostVon(muster), null, muster);
  }
});

/*
 * Der Nachweis, dass es nicht nur an erfundenen Zeilen haengt: Die gebauten
 * Listen muessen wirklich Hosts enthalten, und zwar in der Groessenordnung,
 * die gemessen wurde. Eine Aenderung, die den Ertrag halbiert, faellt hier
 * auf und nicht erst beim Nutzer.
 */
test('die gebauten Listen tragen die gemessene Menge an Popup-Hosts', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ordner = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'popup');
  if (!existsSync(ordner)) return; // ohne `listen:bauen` gibt es nichts zu pruefen

  const alle = new Set<string>();
  for (const datei of readdirSync(ordner)) {
    if (!datei.endsWith('.json')) continue;
    const liste = JSON.parse(readFileSync(join(ordner, datei), 'utf8')) as { hosts: string[] };
    for (const h of liste.hosts) alle.add(h);
  }
  assert.ok(
    alle.size > 3000,
    `nur ${alle.size} Popup-Hosts in den gebauten Listen — gemessen waren es 4.380. ` +
      `Wurde die Erkennung strenger, oder fehlt ein \`npm run listen:bauen\`?`,
  );
  for (const h of alle) {
    assert.ok(!h.includes('*') && !h.includes('/'), `"${h}" ist kein Host`);
  }
});
