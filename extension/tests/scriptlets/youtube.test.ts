/**
 * YouTubes Werbesperre — die Scriptlets, die sie aushebeln.
 *
 * GEMESSEN am 26.09.2026: Ein Nutzer sah mit AdSilence „Werbeblocker sind auf
 * YouTube nicht erlaubt". Ursache: uBlocks YouTube-Regeln brauchten sieben
 * Scriptlets, die es hier nicht gab — die Werbeanfragen wurden geblockt, die
 * Werbeplaetze in der Player-Antwort blieben stehen, und genau daran erkennt
 * YouTube einen Blocker. Dazu las der Parser `'"adPlacements"'` mitsamt den
 * aeusseren Hochkommas, und `[-]` in einem Pfad lief ins Leere.
 *
 * Der Browser-Nachweis (nachgebaute Seite unter www.youtube.com, gebautes
 * Paket): fetch- und XHR-Antwort des Players ohne Werbeplaetze, der leere
 * Rahmen bekommt unser fetch, `rmnt` entfernt, `rpnt` schiebt ein. Diese
 * Datei haelt die Teile fest, die ohne Browser pruefbar sind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import { parseZeile } from '../../src/engine/abp.ts';
import { zuScriptlets } from '../../src/engine/scriptlets.ts';
import { scriptletLoader, BEKANNTE_SCRIPTLETS, type ScriptletEintrag } from '../../src/scriptlets/bibliothek.ts';

const REGEL = `www.youtube.com##+js(trusted-replace-fetch-response, '"adPlacements"', '"no_ads"', player?)`;

test('Argumente in Anfuehrungszeichen verlieren die aeusseren Hochkommas', () => {
  const regel = parseZeile(REGEL);
  assert.ok(regel && regel.typ === 'scriptlet');
  assert.deepEqual(regel.args, ['"adPlacements"', '"no_ads"', 'player?']);
});

test('ein Komma in Anfuehrungszeichen trennt nicht', () => {
  const regel = parseZeile(`beispiel.de##+js(trusted-replace-fetch-response, 'a,b', "c, d", x)`);
  assert.ok(regel && regel.typ === 'scriptlet');
  assert.deepEqual(regel.args, ['a,b', 'c, d', 'x']);
});

test('Antworten umschreiben nur aus vertrauenswuerdigen Listen', () => {
  const regel = parseZeile(REGEL)!;
  const fremd: Record<string, number> = {};
  assert.deepEqual(zuScriptlets([regel], fremd), {}, 'eine fremde Liste darf fetch-Antworten nicht umschreiben');
  assert.equal(fremd['scriptletOhneVertrauen'], 1);
  const eigen = zuScriptlets([regel], {}, { vertrauenswuerdig: true });
  assert.equal(eigen['www.youtube.com']?.[0]?.name, 'trusted-replace-fetch-response');
});

test('die YouTube-Kuerzel kommen an: rmnt, rpnt, nano-stb', () => {
  for (const [zeile, name] of [
    ['www.youtube.com##+js(rmnt, script, window\\,"fetch")', 'remove-node-text'],
    ['www.youtube.com##+js(rpnt, script, a, b)', 'trusted-replace-node-text'],
    ['www.youtube.com##+js(nano-stb, [native code], 17000, 0.001)', 'nano-setTimeout-booster'],
  ] as const) {
    const s = zuScriptlets([parseZeile(zeile)!], {}, { vertrauenswuerdig: true });
    assert.equal(s['www.youtube.com']?.[0]?.name, name, zeile);
  }
});

function welt(zusatz: Record<string, unknown> = {}): Record<string, unknown> {
  const w: Record<string, unknown> = {
    addEventListener(): void {},
    setTimeout(): number { return 0; },
    JSON, Promise, Proxy, Reflect, Response, ...zusatz,
  };
  createContext(w);
  return w;
}

function laufe(w: Record<string, unknown>, eintraege: ScriptletEintrag[]): void {
  (new Script(`(${scriptletLoader.toString()})`).runInContext(w as object) as (e: ScriptletEintrag[]) => void)(eintraege);
}

test('trusted-replace-fetch-response nimmt die Werbeplaetze aus der Player-Antwort', async () => {
  const roh = '{"adPlacements":[{"x":1}],"videoDetails":{"videoId":"a"}}';
  const w = welt({ fetch: async () => new Response(roh, { status: 200 }) });
  laufe(w, [{ name: 'trusted-replace-fetch-response', args: ['"adPlacements"', '"no_ads"', 'player?'] }]);
  const passend = await (await (w.fetch as (u: string) => Promise<Response>)('https://www.youtube.com/youtubei/v1/player?key=1')).text();
  assert.ok(!passend.includes('"adPlacements"'), passend);
  assert.ok(passend.includes('"no_ads"'));
  const fremd = await (await (w.fetch as (u: string) => Promise<Response>)('https://www.youtube.com/next')).text();
  assert.equal(fremd, roh, 'eine Anfrage, die nicht passt, bleibt unberuehrt');
});

test('json-prune-fetch-response und [-]: Werbeeintraege fallen als Ganzes', async () => {
  const roh = JSON.stringify({ entries: [{ id: 1 }, { id: 2, command: { ad: { isAd: true } } }], adSlots: [1] });
  const w = welt({ fetch: async () => new Response(roh) });
  laufe(w, [{ name: 'json-prune-fetch-response', args: ['adSlots entries.[-].command.ad.isAd', '', 'propsToMatch', '/player'] }]);
  const daten = JSON.parse(await (await (w.fetch as (u: string) => Promise<Response>)('https://x/player')).text());
  assert.deepEqual(daten, { entries: [{ id: 1 }] });
});

test('jedes neue YouTube-Scriptlet ist bekannt', () => {
  for (const name of [
    'trusted-replace-fetch-response', 'trusted-replace-xhr-response', 'json-prune-fetch-response',
    'json-prune-xhr-response', 'trusted-prevent-dom-bypass', 'nano-setTimeout-booster',
    'remove-node-text', 'trusted-replace-node-text',
  ]) assert.ok((BEKANNTE_SCRIPTLETS as readonly string[]).includes(name), name);
});
