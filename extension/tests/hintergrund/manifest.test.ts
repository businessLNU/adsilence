/**
 * Das Manifest ist die einzige Datei, die der Browser LIEST, BEVOR er
 * irgendetwas ausfuehrt. Steht darin ein Pfad, den es nicht gibt, oder fehlt
 * eine Freigabe, laeuft die Erweiterung nicht oder - schlimmer - sie laeuft
 * und eine Haelfte wirkt still nicht.
 *
 * Geprueft wird das GEMISCHTE Manifest je Ziel (`scripts/manifest.mjs`), nicht
 * `manifest/base.json`: Was ein Overlay ersetzt, faellt sonst durch. Die
 * Funktionen dort sind rein; dieser Test braucht keinen Bau und keinen
 * Browser.
 *
 * Der Kern ist die vierte Pruefung: `web_accessible_resources`. Ein
 * INHALTSSKRIPT darf eine Datei aus dem eigenen Paket nur dann lesen, wenn sie
 * dort aufgefuehrt ist. Chrome lehnt den Zugriff sonst ab, und weil um jeden
 * dieser Aufrufe ein `catch` liegt (er soll die Seite nicht brechen), merkt es
 * niemand: Die Kosmetik in Shadow Roots bliebe einfach aus.
 *
 * GEMESSEN am 03.09.2026: Genau das ist passiert. `src/inhalt/kosmetik.ts` hat
 * die generischen Stylesheets eine Zeit lang selbst geholt; der `fetch` kam nie
 * zurueck. Die Loesung war NICHT, die Dateien freizugeben - dann koennte jede
 * Seite die Erweiterung an ihnen erkennen -, sondern den Hintergrund zu
 * fragen, der ohne Freigabe liest. Dieser Test haelt beide Wege auseinander:
 * Was ein Inhaltsskript liest, MUSS freigegeben sein; freigegeben sein darf
 * nur, was auch jemand liest. Heute liest niemand, also steht dort nichts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error - Bauskript ohne Typen; die Funktionen sind rein und exportiert.
import { ZIELE, ladeManifest } from '../../scripts/manifest.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Manifest = {
  manifest_version: number;
  name: string;
  version: string;
  default_locale?: string;
  icons?: Record<string, string>;
  action?: { default_popup?: string; default_icon?: Record<string, string> };
  options_ui?: { page?: string };
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: { js?: string[]; css?: string[]; world?: string; matches?: string[] }[];
  background?: { service_worker?: string; scripts?: string[] };
  declarative_net_request?: { rule_resources?: { id: string; enabled: boolean; path: string }[] };
  web_accessible_resources?: { resources?: string[]; matches?: string[] }[];
};

function manifestFuer(ziel: string): Manifest {
  const { manifest } = ladeManifest(ziel) as { manifest: Manifest };
  return manifest;
}

const ziele: string[] = ZIELE;

test('jedes Ziel ergibt ein Manifest der Version 3 mit Name und Version', () => {
  for (const ziel of ziele) {
    const m = manifestFuer(ziel);
    assert.equal(m.manifest_version, 3, ziel);
    assert.ok(m.name, `${ziel}: name fehlt`);
    assert.match(m.version, /^\d+\.\d+(\.\d+)?$/, `${ziel}: version "${m.version}"`);
    assert.ok(m.default_locale, `${ziel}: default_locale fehlt, __MSG_-Platzhalter blieben stehen`);
  }
});

test('jedes Ziel hat genau eine Form von Hintergrund', () => {
  for (const ziel of ziele) {
    const b = manifestFuer(ziel).background ?? {};
    const wege = [b.service_worker, b.scripts].filter(Boolean).length;
    assert.equal(wege, 1, `${ziel}: ${wege} Hintergrundformen im Manifest`);
  }
});

/**
 * Jeder Pfad, den das Manifest nennt, muss im REPO eine Quelle haben. Die
 * gebauten `.js`-Dateien entstehen erst beim Bau; fuer sie wird die
 * TypeScript-Quelle geprueft. `scripts/pruefe-paket.mjs` macht dieselbe
 * Pruefung danach am fertigen `dist/<ziel>`, dort dann an den echten Dateien.
 */
test('jeder Pfad im Manifest hat eine Quelle im Repo', () => {
  const quelleFuer = (pfad: string): string[] => {
    if (pfad.endsWith('.js')) return [join(WURZEL, 'src', pfad.replace(/\.js$/, '.ts'))];
    if (pfad.endsWith('.html')) return [join(WURZEL, 'src', pfad)];
    return [join(WURZEL, pfad)];
  };

  const fehlend: string[] = [];
  for (const ziel of ziele) {
    const m = manifestFuer(ziel);
    const pfade = [
      ...Object.values(m.icons ?? {}),
      ...Object.values(m.action?.default_icon ?? {}),
      m.action?.default_popup,
      m.options_ui?.page,
      m.background?.service_worker,
      ...(m.background?.scripts ?? []),
      ...(m.content_scripts ?? []).flatMap((s) => [...(s.js ?? []), ...(s.css ?? [])]),
      ...(m.declarative_net_request?.rule_resources ?? []).map((r) => r.path),
    ].filter((p): p is string => typeof p === 'string');

    for (const pfad of pfade) {
      if (!quelleFuer(pfad).some((p) => existsSync(p))) fehlend.push(`${ziel}: ${pfad}`);
    }
  }
  assert.deepEqual(fehlend, [], `Pfade ohne Quelle:\n  ${fehlend.join('\n  ')}`);
});

/**
 * Paketdateien, die ein INHALTSSKRIPT selbst liest. Gesucht wird nur in
 * `src/inhalt/`: Der Service Worker liest seine eigenen Dateien ohne Freigabe,
 * ein Inhaltsskript nicht. `${id}` in einem Vorlagentext wird zu `*`, damit
 * sich der Pfad mit dem Muster im Manifest vergleichen laesst.
 */
/**
 * Der ZWEITE Leser einer freigegebenen Datei: eine Umleitungsregel.
 *
 * `$redirect` beantwortet eine geblockte Anfrage aus dem Paket. Chrome laedt
 * die Datei dabei fuer die fremde Seite, sie muss also freigegeben sein -
 * gelesen wird sie aber von keinem Inhaltsskript, sondern von einer Regel in
 * `rules/*.json`. Ohne diesen zweiten Weg meldete der Waechter unten jede
 * Attrappe als „freigegeben, aber niemand liest sie".
 */
function gelesenAusRegeln(): string[] {
  const gelesen: string[] = [];
  const ordner = join(WURZEL, 'rules');
  if (!existsSync(ordner)) return gelesen;
  for (const name of readdirSync(ordner)) {
    if (!name.endsWith('.json')) continue;
    let regeln: { action?: { type?: string; redirect?: { extensionPath?: string } } }[];
    try {
      regeln = JSON.parse(readFileSync(join(ordner, name), 'utf8'));
    } catch {
      continue;
    }
    for (const r of regeln) {
      const pfad = r.action?.type === 'redirect' ? r.action.redirect?.extensionPath : undefined;
      if (typeof pfad === 'string') gelesen.push(pfad.replace(/^\//, ''));
    }
  }
  return gelesen;
}

function gelesenAusInhalt(): string[] {
  const muster = /fetch\(\s*api\.runtime\.getURL\(\s*[`'"]([^`'"]*)[`'"]/g;
  const gelesen: string[] = [];
  const ordner = join(WURZEL, 'src', 'inhalt');
  for (const name of readdirSync(ordner)) {
    if (!name.endsWith('.ts')) continue;
    for (const treffer of readFileSync(join(ordner, name), 'utf8').matchAll(muster)) {
      gelesen.push(treffer[1]!.replace(/\$\{[^}]*\}/g, '*'));
    }
  }
  return gelesen;
}

/** Ein `resources`-Muster des Manifests gegen einen Pfad; `*` bleibt in einem Segment. */
function passtAufMuster(pfad: string, muster: string): boolean {
  const teile = muster.split('*').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${teile.join('[^/]*')}$`).test(pfad);
}

test('jede Paketdatei, die ein Inhaltsskript liest, ist freigegeben', () => {
  const gelesen = gelesenAusInhalt();
  const fehlend: string[] = [];
  for (const ziel of ziele) {
    const freigaben = (manifestFuer(ziel).web_accessible_resources ?? []).flatMap((w) => w.resources ?? []);
    for (const pfad of gelesen) {
      if (!freigaben.some((f) => passtAufMuster(pfad, f))) fehlend.push(`${ziel}: ${pfad}`);
    }
  }
  assert.deepEqual(fehlend, [], `von einem Inhaltsskript gelesen, aber nicht freigegeben:\n  ${fehlend.join('\n  ')}`);
});

/**
 * Und die Gegenrichtung: keine Freigabe ohne Leser. Eine Freigabe macht die
 * Datei fuer JEDE Seite lesbar und damit die Erweiterung erkennbar; eine, die
 * niemand mehr braucht, faellt sonst nie auf. Ein Sternchen ueber dem ganzen
 * Paket ist ohnehin verboten.
 */
test('keine Freigabe ohne Leser', () => {
  for (const ziel of ziele) {
    for (const w of manifestFuer(ziel).web_accessible_resources ?? []) {
      for (const r of w.resources ?? []) {
        assert.notEqual(r, '*', `${ziel}: das ganze Paket ist freigegeben`);
        assert.ok(r.includes('/'), `${ziel}: "${r}" gibt einen ganzen Ordner frei`);
        assert.ok(
          [...gelesenAusInhalt(), ...gelesenAusRegeln()].some((pfad) => passtAufMuster(pfad, r)),
          `${ziel}: "${r}" ist freigegeben, aber weder ein Inhaltsskript noch eine Umleitungsregel liest es`,
        );
      }
    }
  }
});

/**
 * Der Anfangszustand im Manifest muss zur Tabelle in `konstanten.ts` passen.
 *
 * Sonst zeigt der Schalter in den Optionen etwas anderes als der Browser tut:
 * `allesAnwenden()` bringt die Rulesets beim ersten Einrichten auf
 * `LISTEN_VORGABE.standard`, und ein davon abweichendes `enabled` im Manifest
 * wird dabei wieder umgelegt. Genau das war der Fall, als `cookies` nach N9
 * frei und an sein sollte, im Manifest aber auf `false` stand.
 */
/*
 * Am 08.09.2026 standen die ab Werk aktiven Scriptlet-Listen einen Nachmittag
 * lang als statische `content_scripts` im Manifest. Fuer den Zeitpunkt war das
 * richtig; abschaltbar waren sie damit nicht mehr.
 *
 * Ein Manifesteintrag kennt keine Ausnahmen: `exclude_matches` steht beim
 * Bauen fest, die Ausnahmeliste des Nutzers entsteht danach. Fuer diese Listen
 * wirkten deshalb WEDER die Seitenausnahme NOCH der Hauptschalter NOCH das
 * Abschalten einer einzelnen Liste. Nachzuruesten ist das nicht: Ein
 * MAIN-World-Skript hat zum `document_start` keinen synchronen Weg an den
 * Zustand der Erweiterung.
 *
 * Derselbe Satz steht seit jeher am generischen Stylesheet
 * (katalog/32-browser-erweiterung.md): nicht ins Manifest, weil es sich sonst
 * „weder je Host noch global abschalten" liesse.
 */
test('kein Scriptlet steht als statisches Inhaltsskript im Manifest', () => {
  for (const ziel of ziele) {
    for (const cs of manifestFuer(ziel).content_scripts ?? []) {
      for (const datei of cs.js ?? []) {
        assert.ok(
          !datei.startsWith('scriptlets/'),
          `${ziel}: "${datei}" steht statisch im Manifest und laesst sich damit ` +
            `weder je Seite noch global abschalten. Scriptlets werden aus dem ` +
            `Hintergrund registriert (src/hintergrund/scriptlets.ts), mit ` +
            `excludeMatches.`,
        );
      }
    }
  }
});

test('enabled im Manifest entspricht LISTEN_VORGABE.standard', async () => {
  const { LISTEN_VORGABE } = await import('../../src/gemeinsam/konstanten.ts');
  const vorgabe = new Map(LISTEN_VORGABE.map((l) => [l.id, l.standard]));
  const abweichungen: string[] = [];
  for (const ziel of ziele) {
    for (const r of manifestFuer(ziel).declarative_net_request?.rule_resources ?? []) {
      const soll = vorgabe.get(r.id);
      if (soll === undefined) {
        abweichungen.push(`${ziel}: Ruleset "${r.id}" steht in keinem LISTEN_VORGABE-Eintrag`);
      } else if (soll !== r.enabled) {
        abweichungen.push(`${ziel}: ${r.id} enabled=${r.enabled}, standard=${soll}`);
      }
    }
  }
  assert.deepEqual(abweichungen, [], abweichungen.join('\n  '));
});
