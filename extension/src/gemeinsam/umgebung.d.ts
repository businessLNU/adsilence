/**
 * Die drei Bauzeit-Konstanten, die `scripts/build.mjs` per `define` in den
 * Code schreibt (esbuild wie Vite). Nichts davon steht im Quelltext: die
 * Adresse kommt aus `extension/.env`, Version und Browser aus dem Bauaufruf.
 *
 * Das Interface heisst wie das von `vite/client`, damit beide Deklarationen
 * zusammenfliessen, falls die Oberflaeche jene Typen zusaetzlich einbindet.
 */
interface ImportMetaEnv {
  /** Basisadresse des Backends ohne Schraegstrich am Ende. */
  readonly ADSILENCE_API: string;
  /** Version aus `extension/package.json`. */
  readonly VERSION: string;
  /** Zielbrowser dieses Bauvorgangs. */
  readonly BROWSER: 'chromium' | 'firefox' | 'safari';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
