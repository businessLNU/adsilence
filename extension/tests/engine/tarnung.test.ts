/**
 * `listen/tarnung.txt`: unsere eigene, von Hand gepflegte Liste.
 *
 * Sie ist die einzige der 29 Quellen, die NICHT aus dem Netz kommt. Damit ist
 * sie auch die einzige, die still verschwinden kann: Ein `listen:holen` ohne
 * den `eigen`-Zweig liefe fuer sie gegen `undefined`, ein vergessener Eintrag
 * im Manifest laesst die Datei im Paket liegen, ohne dass sie je geladen
 * wird. Beides faellt niemandem auf - geblockt wird ja weiterhin, nur eben
 * dieses eine nicht mehr.
 *
 * Deshalb prueft dieser Test die ganze Kette: Quelle, Bau, Manifest, Vorgabe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LISTEN_VORGABE } from '../../src/gemeinsam/konstanten.ts';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lies = (...p: string[]) => readFileSync(join(wurzel, ...p), 'utf8');
const liesJson = (...p: string[]) => JSON.parse(lies(...p));

test('die Quelle steht im Projekt und hat keine URL', () => {
  const quellen: { id: string; url?: string; datei?: string; eigen?: boolean }[] = liesJson('listen', 'quellen.json');
  const q = quellen.find((x) => x.id === 'tarnung');
  assert.ok(q, 'tarnung fehlt in listen/quellen.json');
  assert.equal(q!.eigen, true, 'ohne eigen:true holt listen:holen sie aus dem Netz - das gibt es hier nicht');
  assert.equal(q!.url, undefined, 'eine eigene Liste hat keine URL');
  assert.equal(q!.datei, 'tarnung.txt');
});

test('jede Regel darin nennt Datum, Seite und Grund', () => {
  const text = lies('listen', 'tarnung.txt');
  assert.match(text, /^\[Adblock/, 'ohne Adblock-Kopf weist listen:holen die Datei ab');
  // Eine Regel ohne Begruendung wird nie wieder entfernt, auch wenn sie
  // laengst schadet. Das ist der ganze Zweck der Kommentare in der Datei.
  assert.match(text, /Gemessen am \d\d\.\d\d\.\d{4}/, 'kein Messdatum in der Datei');
  assert.match(text, /NICHT kaputt/, 'kein Absatz dazu, was die Regel nicht bricht');
  const regeln = text.split('\n').filter((z) => z.trim() && !z.startsWith('!') && !z.startsWith('['));
  assert.ok(regeln.length > 0, 'die Liste ist leer');
});

test('Googles First-Party-Service-Worker ist geblockt', () => {
  const regeln: { action: { type: string }; condition: { urlFilter?: string } }[] = liesJson('rules', 'tarnung.json');
  // Gemessen am 04.09.2026: Ohne diese beiden Regeln laedt der Rahmen durch,
  // meldet einen Service Worker auf der Seiten-Domain an und stellt die
  // Zaehlanfragen aus dessen Kontext. Der Pfad kommt aus Googles eigenem
  // Abbild und ist deshalb ueberall gleich - auch dann, wenn der Betreiber
  // seine uebrigen Pfade wuerfeln laesst.
  for (const muster of ['/_/service_worker/*/sw_iframe.html', '/_/service_worker/*/sw.js']) {
    const treffer = regeln.find((r) => r.condition.urlFilter === muster);
    assert.ok(treffer, `keine Regel fuer ${muster}`);
    assert.equal(treffer!.action.type, 'block');
  }
});

test('die getarnten Zaehl-Buckets sind geblockt', () => {
  type Regel = { action: { type: string }; condition: { urlFilter?: string; requestDomains?: string[] } };
  const regeln: Regel[] = liesJson('rules', 'tarnung.json');
  // Gemessen am 04.09.2026 an adblock.turtlecute.org: liefen durch, waehrend
  // die uebrigen Werbe-Buckets derselben Seite laengst in EasyList stehen.
  // Geblockt wird der einzelne Bucket, nicht s3.amazonaws.com - eine Regel
  // auf den Anbieter naehme halbe Websites mit.
  //
  // Geprueft wird die WIRKUNG, nicht die Form: Die Engine buendelt mehrere
  // Hostregeln zu einer `requestDomains`-Regel, sobald es sich lohnt. Ein
  // Test, der nur `urlFilter` liest, faellt beim naechsten Buendeln um, ohne
  // dass sich am Schutz etwas geaendert haette.
  const gedeckt = (host: string) =>
    regeln.some(
      (r) =>
        r.action.type === 'block' &&
        ((r.condition.urlFilter ?? '').includes(host) || (r.condition.requestDomains ?? []).includes(host)),
    );
  for (const host of ['analytics.s3.amazonaws.com', 'analyticsengine.s3.amazonaws.com']) {
    assert.ok(gedeckt(host), `keine Regel fuer ${host}`);
  }
  assert.ok(!gedeckt('s3.amazonaws.com'), 'eine Regel auf den ganzen Anbieter waere zu breit');
});

test('die Reparatur-Ausnahmen schlagen die Sammelregeln', () => {
  // Peter Lowe\'s Liste blockt ganze Domains (`||doubleclick.net^`). Die
  // `allow`-Regeln, die Seiten vor ihrer eigenen Anti-Adblock-Erkennung
  // bewahren, duerfen davon nicht ueberfahren werden. In DNR entscheidet die
  // Prioritaet: Erst bei GLEICHER Prioritaet gewinnt `allow` ueber `block`,
  // und die Sammelregeln kommen aus einer anderen Liste. Gemessen am
  // 04.09.2026 an accuweather.com: gpt.js kommt weiterhin durch.
  const hosts: { priority: number; action: { type: string } }[] = liesJson('rules', 'hosts.json');
  const hoechsteSperre = Math.max(...hosts.filter((r) => r.action.type === 'block').map((r) => r.priority));
  const reparatur: { priority: number; action: { type: string } }[] = liesJson('rules', 'ublock-reparatur.json');
  const ausnahmen = reparatur.filter((r) => r.action.type === 'allow' || r.action.type === 'allowAllRequests');
  assert.ok(ausnahmen.length > 0, 'keine Ausnahmen in der Reparaturliste gefunden');
  const zuSchwach = ausnahmen.filter((r) => r.priority <= hoechsteSperre);
  assert.equal(
    zuSchwach.length,
    0,
    `${zuSchwach.length} Ausnahmen haben keine hoehere Prioritaet als die Sammelregeln (${hoechsteSperre})`,
  );
});

test('die Liste ist in allen drei Paketen an', () => {
  for (const ziel of ['chromium', 'firefox', 'safari']) {
    const m = liesJson('manifest', `${ziel === 'chromium' ? 'base' : ziel}.json`);
    const rr = m.declarative_net_request?.rule_resources;
    if (!rr) continue; // die Zielmanifeste erben von base.json
    const e = rr.find((r: { id: string }) => r.id === 'tarnung');
    assert.ok(e, `${ziel}: tarnung fehlt in rule_resources`);
    assert.equal(e.enabled, true, `${ziel}: tarnung ist ausgeschaltet`);
    assert.equal(e.path, 'rules/tarnung.json');
  }
});

test('sie ist voreingestellt an und kostet nichts', () => {
  const v = LISTEN_VORGABE.find((l) => l.id === 'tarnung');
  assert.ok(v, 'tarnung fehlt in LISTEN_VORGABE');
  // Gegen Tarnung hilft nichts, was der Nutzer erst kaufen muss: Wer die
  // Erweiterung installiert, erwartet, dass sie Zaehler aufhaelt - auch die,
  // die sich als eigene Adresse der Seite ausgeben.
  assert.equal(v!.standard, true);
  assert.equal(v!.premium, false);
});

/*
 * Hier stand bis zum 08.09.2026 eine ZWEITE Budgetpruefung mit eigenen Zahlen
 * (Deckel 30000, Puffer 2000) und eigenem Weg an die Daten (ein regulaerer
 * Ausdruck ueber `konstanten.ts`). Sie ist nach
 * `tests/hintergrund/regelbudget.test.ts` gewandert, das dieselbe Sache prueft
 * und die Konstanten IMPORTIERT statt sie abzulesen.
 *
 * Der Grund ist der, der in regelbudget.test.ts schon aufgeschrieben stand:
 * Zwei Stellen mit derselben Zahl werden irgendwann zwei verschiedene
 * Wahrheiten. Es waren drei — 30.000 hart, 10 % Reserve, 28.000 mit Puffer —
 * und sie sagten am selben Tag Verschiedenes ueber denselben Zustand.
 */

test('der Eigenschutz haengt an der API-Adresse, nicht an localhost', () => {
  // `rules/eigenschutz.json` steht NICHT im Projekt - es entsteht beim Bau aus
  // `ADSILENCE_API`. Geprueft wird deshalb der Erzeuger, nicht das Ergebnis:
  // dass der Bau den Host aus der Konfiguration nimmt und nicht eine feste
  // Adresse einsetzt.
  const bau = readFileSync(join(wurzel, 'scripts', 'build.mjs'), 'utf8');
  assert.match(bau, /function schreibeEigenschutz/, 'build.mjs erzeugt keinen Eigenschutz mehr');
  assert.match(
    bau,
    /new URL\(api\)\.hostname/,
    'der Eigenschutz nimmt den Host nicht mehr aus der uebergebenen API-Adresse',
  );

  // Und der Riegel davor: Ein Paket mit `localhost` im Eigenschutz darf nicht
  // in den Store. GEMESSEN am 04.09.2026: Ohne `ADSILENCE_API` schreibt der
  // Bau `||localhost^` hinein - beim Entwickeln richtig, im Store wertlos, und
  // an der Datei sieht man den Unterschied nicht an.
  const zip = readFileSync(join(wurzel, 'scripts', 'zip.mjs'), 'utf8');
  assert.match(zip, /function eigenschutzTaugt/, 'zip.mjs prueft den Eigenschutz nicht mehr');
  assert.match(zip, /localhost/, 'zip.mjs erkennt einen Eigenschutz auf localhost nicht mehr');
});
