import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite baut ausschliesslich die zwei React-Seiten der Erweiterung: das Popup
 * und die Optionsseite. Hintergrund und Inhaltsskripte baut esbuild in
 * `scripts/build.mjs`; sie sind keine HTML-Einstiege, brauchen kein React
 * und muessen je Ziel ein anderes Modulformat haben.
 *
 * Gefahren, die diese Datei abraeumt, jede schon einmal aufgetreten:
 *
 * 1. `root: src`, sonst landen die Seiten unter `dist/<ziel>/src/popup/…`,
 *    und das Manifest zeigt auf `popup/index.html`. Der Pfad im Manifest ist
 *    die Vorgabe; der Ausgabepfad richtet sich danach, nicht umgekehrt.
 * 2. `base: './'`, denn eine Erweiterungsseite wird als `chrome-extension://<id>/
 *    popup/index.html` geladen. Absolute Pfade („/seiten/popup.js") zeigen
 *    dann auf die Wurzel der Erweiterung und nicht neben die HTML-Datei.
 * 3. Keine Hashes in Dateinamen. Ein Paket wird als Ganzes ausgeliefert; es
 *    gibt keinen Cache, den ein Hash umgehen muesste. Dafuer bleiben die
 *    Namen zwischen zwei Builds gleich, was Diffs und Store-Reviews lesbar
 *    haelt.
 * 4. `modulePreload.polyfill: false`, denn der Polyfill kommt als INLINE-Skript
 *    in die HTML-Datei. Die Content Security Policy von MV3 verbietet
 *    genau das; die Seite bliebe weiss.
 * 5. `emptyOutDir: false`, denn esbuild hat vorher in denselben Ordner
 *    geschrieben. Ein Leeren an dieser Stelle wuerfe den Hintergrund weg.
 *
 * Ziel, Backend-Adresse und Version kommen aus Umgebungsvariablen, die
 * `scripts/build.mjs` setzt (`ADSILENCE_ZIEL`, `ADSILENCE_API`,
 * `ADSILENCE_VERSION`). Damit laesst sich diese Datei auch von Hand fahren
 * (`ADSILENCE_ZIEL=firefox npx vite build`), ohne dass eine Adresse im
 * Quelltext steht.
 */

const HIER = new URL('.', import.meta.url);

function pfad(relativ: string): string {
  return fileURLToPath(new URL(relativ, HIER));
}

function paketVersion(): string {
  try {
    return JSON.parse(readFileSync(pfad('package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default defineConfig(() => {
  const ziel = process.env.ADSILENCE_ZIEL ?? 'chromium';
  // Ohne Schraegstrich am Ende: `src/gemeinsam/konstanten.ts` haengt die
  // Pfade selbst an, und `…//api` faellt bei manchen Servern durch.
  const api = (process.env.ADSILENCE_API ?? 'http://localhost:3000').replace(/\/+$/, '');
  const version = process.env.ADSILENCE_VERSION ?? paketVersion();

  return {
    root: pfad('src'),
    base: './',
    // Es gibt kein `src/public`; ohne diese Zeile sucht Vite bei jedem Lauf danach.
    publicDir: false,
    // Die `.env` liegt neben package.json, nicht in `src/`.
    envDir: pfad('.'),
    plugins: [react()],
    resolve: {
      alias: {
        // Dieselben Bausteine, die auch die Website benutzt (Login-Karte,
        // Sprachwahl). Benutzt, nicht kopiert: eine Kopie liefe beim
        // naechsten Update des Backends auseinander.
        bausteine: pfad('../frontend'),
      },
    },
    define: {
      // Die drei Bauzeit-Konstanten aus `src/gemeinsam/umgebung.d.ts`.
      // Vite traegt Schluessel dieser Form auch in die Ersetzung des ganzen
      // `import.meta.env`-Objekts ein, und `konstanten.ts` liest es als Objekt.
      'import.meta.env.ADSILENCE_API': JSON.stringify(api),
      'import.meta.env.VERSION': JSON.stringify(version),
      'import.meta.env.BROWSER': JSON.stringify(ziel),
    },
    build: {
      outDir: pfad(`dist/${ziel}`),
      emptyOutDir: false,
      // Dieselben Untergrenzen wie im esbuild-Teil des Bauskripts.
      target: ['chrome121', 'firefox128', 'safari17'],
      sourcemap: false,
      modulePreload: { polyfill: false },
      // Ein Store-Review liest den Quelltext; unlesbarer Code kostet Zeit,
      // und die paar Kilobyte spielen bei einem lokal geladenen Paket keine
      // Rolle. Deshalb wird nur zusammengefasst, nicht verschleiert.
      minify: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          popup: pfad('src/popup/index.html'),
          optionen: pfad('src/optionen/index.html'),
        },
        output: {
          entryFileNames: 'seiten/[name].js',
          chunkFileNames: 'seiten/[name].js',
          assetFileNames: 'seiten/[name].[ext]',
        },
      },
    },
  };
});
