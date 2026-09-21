#!/usr/bin/env node
/**
 * Packt `dist/<ziel>/` zu `dist/adsilence-<ziel>-<version>.zip`, so wie es
 * die Stores nehmen (Manifest auf oberster Ebene, keine Ordnerhuelle).
 *
 *   node scripts/zip.mjs --ziel=chromium|firefox|safari|alle
 *
 * Benutzt das `zip` des Systems (macOS und jedes Linux haben es). Node bringt
 * keinen Archivschreiber mit, und eine eigene Implementierung waere mehr Code
 * als der Rest dieses Skripts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WURZEL, ZIELE } from './manifest.mjs';

/**
 * Was nicht ins Archiv gehoert.
 *
 * `_metadata/` legt CHROME selbst an, sobald das Paket einmal entpackt geladen
 * wurde (`generated_indexed_rulesets` - die vorkompilierten Regellisten).
 * GEMESSEN am 03.09.2026: nach einer Ladeprobe lagen zehn solche Dateien und
 * 5,5 MB in `dist/chromium`, die vorher nicht da waren. Sie sind
 * maschinenspezifisch, gehoeren dem Browser und nicht uns, und `_metadata` ist
 * im Web Store ein reservierter Name. Ein Archiv, das je nachdem, ob vorher
 * jemand die Erweiterung geladen hat, anders aussieht, ist keins.
 */
const AUSSCHLUSS = ['*.DS_Store', '_metadata/*', '*.zip', '*.map'];

function argument(name, vorgabe) {
  const treffer = process.argv.find((a) => a.startsWith(`--${name}=`));
  return treffer ? treffer.slice(name.length + 3) : vorgabe;
}

const pkg = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8'));
const ziel = argument('ziel', 'alle');
const ziele = ziel === 'alle' ? ZIELE : [ziel];

/**
 * Zeigt der Eigenschutz auf einen Rechner statt auf die echte API?
 *
 * `rules/eigenschutz.json` entsteht beim Bau aus `ADSILENCE_API` und laesst
 * die Verbindung zur eigenen API durch — auch dann, wenn eine Filterliste
 * deren Domain fuehrt. Wer das Paket ohne `ADSILENCE_API` baut, bekommt
 * `||localhost^` hineingeschrieben. Das ist beim Entwickeln richtig und im
 * Store wertlos: Der Schutz zeigt dann auf einen Rechner, den es beim Kunden
 * nicht gibt, und faellt genau in dem Fall aus, fuer den es ihn gibt.
 *
 * Deshalb ein ABBRUCH und keine Warnung (Regel 6.6): Die schlimmste Folge ist
 * ein Zip, das nicht entsteht, und das merkt man sofort. Die Alternative waere
 * eine Erweiterung im Store, deren taegliche Listenpflege eines Tages
 * schweigend aufhoert.
 */
function eigenschutzTaugt(quelle) {
  const pfad = join(quelle, 'rules', 'eigenschutz.json');
  if (!existsSync(pfad)) return 'rules/eigenschutz.json fehlt im Paket';
  let regeln;
  try {
    regeln = JSON.parse(readFileSync(pfad, 'utf8'));
  } catch {
    return 'rules/eigenschutz.json ist kein gueltiges JSON';
  }
  const muster = regeln?.[0]?.condition?.urlFilter ?? '';
  if (/localhost|127\.0\.0\.1|\[::1\]|^\|\|\^?$/.test(muster)) {
    return `Eigenschutz zeigt auf \`${muster}\`. Mit \`ADSILENCE_API=https://…  npm run build\` neu bauen.`;
  }
  return null;
}

let fehler = 0;
for (const z of ziele) {
  const quelle = join(WURZEL, 'dist', z);
  if (!existsSync(join(quelle, 'manifest.json'))) {
    console.warn(`[zip ${z}] ${quelle} hat kein manifest.json; erst \`npm run build\`.`);
    fehler++;
    continue;
  }
  const untauglich = eigenschutzTaugt(quelle);
  if (untauglich) {
    console.error(`[zip ${z}] ${untauglich}`);
    fehler++;
    continue;
  }
  const datei = join(WURZEL, 'dist', `adsilence-${z}-${pkg.version}.zip`);
  rmSync(datei, { force: true });
  // -X: keine macOS-Attribute, -r: rekursiv, -q: leise.
  const ergebnis = spawnSync('zip', ['-r', '-X', '-q', datei, '.', '-x', ...AUSSCHLUSS], { cwd: quelle, stdio: 'inherit' });
  if (ergebnis.error || ergebnis.status !== 0) {
    console.error(`[zip ${z}] zip fehlgeschlagen: ${ergebnis.error?.message ?? `Status ${ergebnis.status}`}`);
    fehler++;
    continue;
  }
  const bytes = statSync(datei).size;
  console.log(`[zip ${z}] ${datei} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}
process.exit(fehler ? 1 : 0);
