/**
 * Eine Attrappe der Erweiterungs-API fuer die Tests des Hintergrunds.
 *
 * `src/gemeinsam/browser.ts` liest `globalThis.browser ?? globalThis.chrome`
 * EINMAL beim Laden des Moduls. Ein Test, der die Attrappe erst nach dem
 * `import` setzt, kaeme zu spaet; deshalb wird sie hier gesetzt und das zu
 * pruefende Modul danach mit `await import(...)` geholt. `node --test` faehrt
 * jede Testdatei in einem eigenen Prozess, die Attrappen der Dateien stoeren
 * sich also nicht.
 *
 * Bewusst nur `storage`, `i18n` und `runtime`. Alles Weitere fehlt absichtlich:
 * Die Module des Hintergrunds pruefen jede Browser-Funktion vor dem Aufruf
 * (`if (!dnr) return`), und ein Test, der ohne `declarativeNetRequest`
 * durchlaeuft, weist genau diese Pruefung mit nach. Wer eine Funktion
 * braucht, reicht sie in `zusatz` nach.
 */

/** Ein Speicherbereich wie `storage.local`: die Form, die der Code benutzt. */
export type SpeicherAttrappe = {
  daten: Map<string, unknown>;
  get(schluessel: string[] | string | null): Promise<Record<string, unknown>>;
  set(teil: Record<string, unknown>): Promise<void>;
  remove(schluessel: string[] | string): Promise<void>;
  clear(): Promise<void>;
};

export function baueSpeicher(anfang: Record<string, unknown> = {}): SpeicherAttrappe {
  const daten = new Map<string, unknown>(Object.entries(structuredClone(anfang)));
  return {
    daten,
    async get(schluessel) {
      const ergebnis: Record<string, unknown> = {};
      // `get(null)` heisst „alles"; so liest `migriereSpeicher()`.
      const namen = schluessel === null ? [...daten.keys()] : Array.isArray(schluessel) ? schluessel : [schluessel];
      for (const name of namen) {
        if (daten.has(name)) ergebnis[name] = structuredClone(daten.get(name));
      }
      return ergebnis;
    },
    async set(teil) {
      for (const [name, wert] of Object.entries(teil)) daten.set(name, structuredClone(wert));
    },
    async remove(schluessel) {
      for (const name of Array.isArray(schluessel) ? schluessel : [schluessel]) daten.delete(name);
    },
    async clear() {
      daten.clear();
    },
  };
}

export type Antwortgeber = (url: string, init?: { method?: string; body?: string }) => {
  status: number;
  koerper: unknown;
};

export type Netzattrappe = {
  /** Jede Anfrage in der Reihenfolge, in der sie gestellt wurde. */
  aufrufe: { url: string; method: string; kopf: Record<string, string>; koerper: unknown }[];
  /** Was auf welche Adresse geantwortet wird; spaeter gesetzte gewinnen. */
  antworte(pfadEnde: string, status: number, koerper: unknown): void;
};

export type Umgebung = {
  lokal: SpeicherAttrappe;
  sitzung: SpeicherAttrappe;
  netz: Netzattrappe;
};

type Zusatz = {
  lokal?: Record<string, unknown>;
  sitzung?: Record<string, unknown>;
  /** Weitere API-Zweige, z. B. `{ alarms: … }`. */
  api?: Record<string, unknown>;
  /** `storage.session` weglassen (Safari vor 16.4). */
  ohneSitzungsspeicher?: boolean;
};

/**
 * DAS API-Objekt. Es bleibt fuer die ganze Testdatei dasselbe, weil
 * `browser.ts` es genau einmal liest und in einer Konstanten haelt. Ein
 * zweiter Aufruf von `installiereApi()` taeuscht deshalb keinen zweiten
 * Browser vor, sondern raeumt DIESEN aus und richtet ihn neu ein; sonst
 * schriebe der Test in eine Attrappe, die der Code gar nicht mehr sieht.
 */
const apiObjekt: Record<string, unknown> = {};

/**
 * Setzt `globalThis.chrome` und `globalThis.fetch` und gibt die Griffe
 * zurueck, mit denen ein Test hineinschauen kann.
 */
export function installiereApi(zusatz: Zusatz = {}): Umgebung {
  const lokal = baueSpeicher(zusatz.lokal ?? {});
  const sitzung = baueSpeicher(zusatz.sitzung ?? {});

  const antworten = new Map<string, { status: number; koerper: unknown }>();
  const aufrufe: Netzattrappe['aufrufe'] = [];

  for (const schluessel of Object.keys(apiObjekt)) delete apiObjekt[schluessel];
  Object.assign(apiObjekt, {
    storage: {
      local: lokal,
      ...(zusatz.ohneSitzungsspeicher ? {} : { session: sitzung }),
    },
    i18n: { getUILanguage: () => 'de' },
    runtime: {
      getURL: (pfad: string) => `chrome-extension://attrappe/${pfad}`,
      getManifest: () => ({ declarative_net_request: { rule_resources: [] } }),
    },
    ...(zusatz.api ?? {}),
  });

  (globalThis as unknown as { chrome?: unknown }).chrome = apiObjekt;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;

  (globalThis as unknown as { fetch: unknown }).fetch = async (
    eingabe: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    const url = String(eingabe);
    let treffer: { status: number; koerper: unknown } | undefined;
    for (const [ende, antwort] of antworten) if (url.endsWith(ende)) treffer = antwort;
    aufrufe.push({
      url,
      method: init?.method ?? 'GET',
      kopf: init?.headers ?? {},
      koerper: init?.body === undefined ? null : JSON.parse(init.body),
    });
    if (!treffer) throw new TypeError(`Attrappe kennt ${url} nicht`);
    const text = treffer.koerper === undefined ? '' : JSON.stringify(treffer.koerper);
    return {
      ok: treffer.status >= 200 && treffer.status < 300,
      status: treffer.status,
      text: async () => text,
    };
  };

  return {
    lokal,
    sitzung,
    netz: {
      aufrufe,
      antworte(pfadEnde, status, koerper) {
        antworten.set(pfadEnde, { status, koerper });
      },
    },
  };
}

/** Ein Zugangstoken, das noch lange gilt: dann erneuert `konto.ts` nicht. */
export function gueltigeSitzung(): Record<string, unknown> {
  return { sitzung: { accessToken: 'zugang-attrappe', laeuftAb: Date.now() + 60 * 60 * 1000 } };
}

/** Ein verbundenes Konto ohne echte Werte (Regel 1: nichts Echtes im Code). */
export function verbundenesKonto(): Record<string, unknown> {
  return {
    konto: {
      refreshToken: 'auffrischen-attrappe',
      refreshLaeuftAb: Date.now() + 30 * 24 * 60 * 60 * 1000,
      email: 'max.mustermann@beispiel.de',
      name: 'Max Mustermann',
      seit: Date.now(),
    },
  };
}
