/**
 * Der Nachweis, dass die gebauten Regeln WIRKEN.
 *
 * Alles andere in `tests/engine/` prueft Form und Grammatik. Eine Liste kann
 * dabei formal tadellos sein und trotzdem keine Werbung blocken: genau das
 * war der Fall, als das Budget nach Listenreihenfolge geschnitten wurde und
 * `||pagead2.googlesyndication.com^` hinter dem Schnitt lag (siehe Kopf von
 * `src/engine/dnr.ts`). Hier wird deshalb an drei benannten Adressen
 * gemessen, was der Browser tun WUERDE.
 *
 * Zuerst wird der kleine Abgleich aus `hilfen.ts` an ausgedachten Regeln
 * geeicht; ein Matcher, der jede URL trifft, wuerde sonst jeden Nachweis
 * bestehen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseListe } from '../../src/engine/abp.ts';
import { zuDnr } from '../../src/engine/dnr.ts';
import type { DnrRegel } from '../../src/engine/dnr-typen.ts';
import { entscheidung, passtRegel, urlFilterZuRegex } from './hilfen.ts';
import type { Anfrage } from './hilfen.ts';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function liesRegeln(id: string): DnrRegel[] {
  return JSON.parse(readFileSync(join(WURZEL, 'rules', `${id}.json`), 'utf8'));
}

function ausZeilen(...zeilen: string[]): DnrRegel[] {
  return zuDnr(parseListe(zeilen.join('\n')), { startId: 1, budget: 100 }).rules;
}

// ── Eichung: die Grammatik des urlFilter ───────────────────────────────────

test('`||host^` haengt am Hostnamen, nicht irgendwo in der URL', () => {
  const regex = urlFilterZuRegex('||werbung.example^');
  assert.ok(regex.test('https://werbung.example/x.js'));
  assert.ok(regex.test('https://cdn.werbung.example/x.js'), 'Subdomains gehoeren dazu');
  assert.ok(!regex.test('https://gutewerbung.example/x.js'), 'kein Treffer mitten im Namen');
  assert.ok(!regex.test('https://echt.example/?u=werbung.example'), 'kein Treffer im Query');
});

test('`|` verankert am Anfang, `|` am Ende', () => {
  assert.ok(urlFilterZuRegex('|https://a.example/x').test('https://a.example/x'));
  assert.ok(!urlFilterZuRegex('|https://a.example/x').test('https://b.example/https://a.example/x'));
  assert.ok(urlFilterZuRegex('/ad.gif|').test('https://a.example/ad.gif'));
  assert.ok(!urlFilterZuRegex('/ad.gif|').test('https://a.example/ad.gif?x=1'));
});

test('`*` steht fuer beliebigen Text, `^` fuer ein Trennzeichen oder das Ende', () => {
  assert.ok(urlFilterZuRegex('/banner*.gif').test('https://a.example/banner_gross.gif'));
  assert.ok(urlFilterZuRegex('/anzeige^').test('https://a.example/anzeige?x=1'));
  assert.ok(urlFilterZuRegex('/anzeige^').test('https://a.example/anzeige'));
  assert.ok(!urlFilterZuRegex('/anzeige^').test('https://a.example/anzeigen.html'));
});

test('der Abgleich achtet auf Ressourcentyp, Herkunft und Partei', () => {
  const [regel] = ausZeilen('||a.example^$script,third-party,domain=news.example');
  const grund: Anfrage = { url: 'https://a.example/x.js', initiator: 'https://news.example/', typ: 'script' };
  assert.ok(passtRegel(regel, grund));
  assert.ok(!passtRegel(regel, { ...grund, typ: 'image' }), 'falscher Typ');
  assert.ok(!passtRegel(regel, { ...grund, initiator: 'https://andere.example/' }), 'falsche Herkunft');
  assert.ok(!passtRegel(regel, { url: 'https://a.example/x.js', initiator: 'https://a.example/', typ: 'script' }), 'erste Partei');
});

test('bei gleicher Prioritaet schlaegt eine Ausnahme die Blockregel', () => {
  const regeln = ausZeilen('||a.example^', '@@||a.example/ok.js');
  const treffer = entscheidung(regeln, { url: 'https://a.example/ok.js', initiator: 'https://b.example/', typ: 'script' });
  assert.equal(treffer?.aktion, 'allow');
  const blockiert = entscheidung(regeln, { url: 'https://a.example/ad.js', initiator: 'https://b.example/', typ: 'script' });
  assert.equal(blockiert?.aktion, 'block');
});

test('eine Blockregel ohne Typ laesst die Navigation zur Seite durch', () => {
  const regeln = ausZeilen('||a.example^');
  assert.equal(entscheidung(regeln, { url: 'https://a.example/', typ: 'main_frame' }), null);
  assert.equal(
    entscheidung(regeln, { url: 'https://a.example/x.js', initiator: 'https://b.example/', typ: 'script' })?.aktion,
    'block',
  );
});

// ── Nachweise an den gebauten Listen ───────────────────────────────────────

test('rules/basis.json blockt das Werbeskript von Google', () => {
  const treffer = entscheidung(liesRegeln('basis'), {
    url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    initiator: 'https://zeitung.example/artikel',
    typ: 'script',
  });
  assert.ok(treffer, 'keine Regel in basis.json trifft adsbygoogle.js');
  assert.equal(treffer.aktion, 'block');
});

test('rules/privatsphaere.json blockt Google Analytics', () => {
  const treffer = entscheidung(liesRegeln('privatsphaere'), {
    url: 'https://www.google-analytics.com/analytics.js',
    initiator: 'https://zeitung.example/artikel',
    typ: 'script',
  });
  assert.ok(treffer, 'keine Regel in privatsphaere.json trifft analytics.js');
  assert.equal(treffer.aktion, 'block');
});

test('eine harmlose Seite trifft KEINE Regel in rules/basis.json', () => {
  const regeln = liesRegeln('basis');
  const seite: Anfrage = { url: 'https://de.wikipedia.org/wiki/Test', typ: 'main_frame' };
  const treffer = regeln.filter((r) => passtRegel(r, seite));
  assert.deepEqual(
    treffer.map((r) => r.id),
    [],
    'die Wikipedia-Seite selbst waere blockiert',
  );

  const unterrahmen: Anfrage = {
    url: 'https://de.wikipedia.org/wiki/Test',
    initiator: 'https://de.wikipedia.org/',
    typ: 'sub_frame',
  };
  assert.equal(entscheidung(regeln, unterrahmen), null, 'auch als Unterrahmen darf nichts greifen');
});

test('keine Liste blockt die Navigation zu einer beliebigen Seite', () => {
  // Eine einzige Regel mit main_frame und ohne Muster machte das halbe Web
  // unerreichbar. Der Fall ist billig zu pruefen und teuer zu uebersehen.
  // Alle Listen aus `listen/quellen.json`, nicht fuenf von Hand: Eine Liste,
  // die hier fehlt, koennte das halbe Web sperren, ohne dass ein Test es sieht.
  const quellen: { id: string }[] = JSON.parse(readFileSync(join(WURZEL, 'listen', 'quellen.json'), 'utf8'));
  for (const { id } of quellen) {
    const treffer = entscheidung(liesRegeln(id), { url: 'https://de.wikipedia.org/wiki/Test', typ: 'main_frame' });
    // Nur BLOCK zaehlt. Eine `allow`-Regel auf einer Navigation ist eine
    // Ausnahme und richtet keinen Schaden an; die japanische Liste hat eine
    // solche, und sie deshalb zu verwerfen hiesse, eine Freistellung fuer
    // einen Angriff zu halten.
    assert.notEqual(
      treffer?.aktion,
      'block',
      `${id}.json BLOCKT die Navigation zu de.wikipedia.org (Regel ${treffer?.regel.id})`,
    );
  }
});
