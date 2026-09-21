/**
 * Der eine Zugriff auf die Erweiterungs-API.
 *
 * Firefox und Safari stellen `browser` bereit (mit Promises), Chromium nur
 * `chrome` (in MV3 ebenfalls mit Promises, sobald kein Callback uebergeben
 * wird). Beide haben dieselbe Form; ein Polyfill braeuchte es nur fuer
 * Callback-Zeiten, die vorbei sind. Deshalb kein `webextension-polyfill`.
 *
 * Typisiert als `typeof chrome`, weil `@types/chrome` die vollstaendigste
 * Beschreibung ist. Wo Firefox oder Safari eine Funktion nicht kennen, prueft
 * der Aufrufer mit `typeof … === 'function'` und faellt sauber zurueck.
 */
type ErweiterungsApi = typeof chrome;

const global = globalThis as unknown as { browser?: ErweiterungsApi; chrome?: ErweiterungsApi };

export const api: ErweiterungsApi = (global.browser ?? global.chrome) as ErweiterungsApi;

/** In Tests (Node) gibt es keine API; wer das weiss, kann frueh aussteigen. */
export const apiVorhanden = api !== undefined;
