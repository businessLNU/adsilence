#!/usr/bin/env node
/**
 * Ein Manifest je Browser aus `manifest/base.json` + Overlay.
 *
 *   node scripts/manifest.mjs --ziel=chromium|firefox|safari|alle [--aus=dist]
 *
 * Mischen: Objekte tief, Arrays ERSETZEN (ein Overlay, das `permissions`
 * nennt, meint die ganze Liste). `version` kommt aus `extension/package.json`,
 * der Chromium-`key` aus `extension/.env` (`ADSILENCE_MANIFEST_KEY`).
 *
 * `rule_resources` wird auf Dateien gefiltert, die es wirklich gibt: Ein
 * Manifest, das auf `rules/cookies.json` zeigt, waehrend die Datei fehlt,
 * laedt der Browser gar nicht erst. Der Build ohne Listen soll trotzdem ein
 * ladbares Paket ergeben, mit Warnung.
 *
 * Die Funktionen sind rein und exportiert; `tests/hintergrund/manifest.test.ts`
 * faehrt sie ohne Dateisystem.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZIELE = ['chromium', 'firefox', 'safari'];
export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');

function istObjekt(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Objekte tief mischen, Arrays und Skalare aus dem Overlay ersetzen. */
export function mische(basis, overlay) {
  if (!istObjekt(basis) || !istObjekt(overlay)) return overlay === undefined ? basis : overlay;
  const ergebnis = { ...basis };
  for (const [k, v] of Object.entries(overlay)) {
    ergebnis[k] = istObjekt(v) && istObjekt(basis[k]) ? mische(basis[k], v) : v;
  }
  return ergebnis;
}

/**
 * Fertiges Manifest fuer ein Ziel.
 * `vorhandeneRegeln`: Liste der Ruleset-IDs, deren Datei existiert; `null`
 * heisst „nicht pruefen".
 */
export function baueManifest({ basis, overlay, version, key, vorhandeneRegeln }) {
  const warnungen = [];
  const m = mische(basis, overlay ?? {});
  m.version = version;

  if (key && m.background && m.background.service_worker) m.key = key;

  if (m.declarative_net_request && Array.isArray(m.declarative_net_request.rule_resources) && vorhandeneRegeln) {
    const da = new Set(vorhandeneRegeln);
    const behalten = [];
    for (const r of m.declarative_net_request.rule_resources) {
      if (da.has(r.id)) behalten.push(r);
      else warnungen.push(`Ruleset "${r.id}" hat keine Datei (${r.path}) und faellt aus dem Manifest.`);
    }
    m.declarative_net_request.rule_resources = behalten;
    if (behalten.length === 0) {
      delete m.declarative_net_request;
      warnungen.push('Kein einziges Ruleset vorhanden: declarative_net_request entfaellt ganz. `npm run listen:bauen` fahren.');
    }
  }

  /*
   * WARUM HIER KEINE SCRIPTLETS STEHEN. Vom 08.09.2026 bis zum selben Abend
   * standen die ab Werk aktiven Listen als statische `content_scripts` im
   * Manifest -- fuer den Zeitpunkt war das richtig, ein statischer Eintrag ist
   * ab dem ersten Moment da, ohne Worker. Es war trotzdem falsch, und zwar aus
   * einem Grund, der sich nicht wegbauen laesst:
   *
   * Ein Manifesteintrag kennt keine Ausnahmen. `exclude_matches` steht beim
   * Bauen fest, die Ausnahmeliste des Nutzers entsteht erst danach. Damit
   * wirkten fuer diese Listen WEDER „AdSilence auf dieser Seite aus" NOCH der
   * Hauptschalter NOCH das Abschalten einer einzelnen Liste. Ein MAIN-World-
   * Skript hat zum `document_start` keinen synchronen Weg an den Zustand der
   * Erweiterung -- `chrome.storage` ist asynchron, und im MAIN-World gibt es
   * `chrome.*` gar nicht. Das ist keine Luecke im Entwurf, sondern die
   * Eigenschaft eines statischen Eintrags.
   *
   * Derselbe Grund steht seit jeher am generischen Stylesheet
   * (`katalog/32-browser-erweiterung.md`): Es steht ausdruecklich NICHT im
   * Manifest, weil es sich dann „weder je Host noch global abschalten" liesse.
   *
   * Die Ausnahme ist die Zusage, der Zeitpunkt die Qualitaet. Ein Blocker, den
   * man auf einer kaputten Seite nicht abschalten kann, wird deinstalliert.
   * Registriert wird deshalb aus dem Hintergrund, mit `excludeMatches`
   * (`src/hintergrund/scriptlets.ts`), und `tests/hintergrund/manifest.test.ts`
   * haelt fest, dass hier nichts wieder hineinwandert.
   */

  return { manifest: m, warnungen };
}

/** KEY=WERT-Zeilen aus einer .env, ohne Abhaengigkeit. */
export function liesEnv(pfad) {
  const werte = {};
  if (!existsSync(pfad)) return werte;
  for (const zeile of readFileSync(pfad, 'utf8').split('\n')) {
    const t = zeile.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    let wert = t.slice(i + 1).trim();
    if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) wert = wert.slice(1, -1);
    werte[t.slice(0, i).trim()] = wert;
  }
  return werte;
}

function liesJson(pfad) {
  return JSON.parse(readFileSync(pfad, 'utf8'));
}

/** Manifest fuer ein Ziel aus den Dateien des Repos. */
export function ladeManifest(ziel, { wurzel = WURZEL, regelnPruefen = true, ausOrdner = null } = {}) {
  if (!ZIELE.includes(ziel)) throw new Error(`Unbekanntes Ziel: ${ziel} (erlaubt: ${ZIELE.join(', ')})`);
  const basis = liesJson(join(wurzel, 'manifest', 'base.json'));
  const overlay = liesJson(join(wurzel, 'manifest', `${ziel}.json`));
  const pkg = liesJson(join(wurzel, 'package.json'));
  const env = { ...liesEnv(join(wurzel, '.env')), ...process.env };

  let vorhandeneRegeln = null;
  if (regelnPruefen) {
    // Zwei Orte, und der zweite ist noetig: Die meisten Regelsaetze liegen im
    // Projekt und werden kopiert, `eigenschutz.json` dagegen entsteht ERST
    // beim Bau, weil es die eigene API-Adresse traegt. Ein Filter, der nur ins
    // Projekt sieht, wirft es wieder aus dem Manifest - die Datei liegt dann
    // im Paket und wird nie geladen.
    vorhandeneRegeln = (basis.declarative_net_request?.rule_resources ?? [])
      .filter((r) => existsSync(join(wurzel, r.path)) || (ausOrdner && existsSync(join(ausOrdner, r.path))))
      .map((r) => r.id);
  }

  return baueManifest({
    basis,
    overlay,
    version: pkg.version,
    key: env.ADSILENCE_MANIFEST_KEY || undefined,
    vorhandeneRegeln,
  });
}

export function schreibeManifest(ziel, ausOrdner) {
  const { manifest, warnungen } = ladeManifest(ziel, { ausOrdner });
  mkdirSync(ausOrdner, { recursive: true });
  writeFileSync(join(ausOrdner, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return warnungen;
}

function argument(name, vorgabe) {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ziel = argument('ziel', 'chromium');
  const aus = argument('aus', join(WURZEL, 'dist'));
  const ziele = ziel === 'alle' ? ZIELE : [ziel];
  for (const z of ziele) {
    const warnungen = schreibeManifest(z, join(aus, z));
    for (const w of warnungen) console.warn(`[manifest ${z}] ${w}`);
    console.log(`[manifest ${z}] ${join(aus, z, 'manifest.json')}`);
  }
}
