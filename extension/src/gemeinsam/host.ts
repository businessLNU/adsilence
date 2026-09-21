/**
 * Aus einer Eingabe einen Host machen.
 *
 * Steht HIER und nicht mehr in `optionen/teile/Ausnahmen.tsx`, weil die
 * Testreihe `.tsx` nicht laden kann (Node streift Typen ab, JSX nicht) - und
 * eine Funktion, an der haengt, WELCHE Eingabe angenommen wird, gehoert
 * geprueft. Das Feld in den Optionen wirbt seit dem 07.09.2026 im Platzhalter
 * ausdruecklich mit `beispiel.de oder https://www.beispiel.de`; ohne Test
 * haelt dieses Versprechen nur zufaellig.
 *
 * Weg: Schema, Pfad, Abfrage, Anker, Port, `www.`, Leerraum, Grossschreibung.
 * Uebrig bleibt der Host - oder `null`, wenn nichts Hostartiges uebrig ist.
 *
 * Die Reihenfolge ist nicht beliebig: Der Pfad muss VOR dem Port weg, sonst
 * bleibt in `beispiel.de:8080/pfad` der Port stehen (`:\d+$` trifft dann
 * nicht das Ende). Und `www.` erst danach, sonst fasst der Griff bei
 * `https://www.…` ins Schema.
 */
export function normalisiereHost(eingabe: string): string | null {
  let h = eingabe.trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  if (h.startsWith('www.')) h = h.slice(4);
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(h) && h !== 'localhost') return null;
  return h;
}
