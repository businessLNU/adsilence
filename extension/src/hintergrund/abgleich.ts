/**
 * Abgleich ueber Geraete (Premium): Listenwahl, Ausnahmen und eigene Regeln
 * liegen als ein JSON-Stand beim Konto. Ausgeloest nur von Hand
 * (`abgleich.jetzt`); nichts laeuft im Hintergrund.
 *
 * Reihenfolge: erst laden, ist der Serverstand neuer, uebernehmen; dann den
 * eigenen Stand mit `version + 1` hochladen. Antwortet der Server mit
 * ABGLEICH_VERALTET, hat inzwischen ein anderes Geraet geschrieben; dann
 * noch einmal laden und uebernehmen, ohne zu ueberschreiben.
 *
 * IM Stand sind genau drei Dinge: `einstellungen.listen`, `sites` und
 * `eigeneRegeln` (Typ `Stand` unten). Alles andere in `Einstellungen` ist
 * Sache des Geraets und wandert bewusst nicht mit - `aktiv`, `sprache`,
 * `thema`, `zaehlerBadge`, `warnung`, `cookieAntwort`, `listenPflege`,
 * `fingerabdruck`. Aufgezaehlt wird hier, was DRIN ist, nicht, was fehlt:
 * Eine Liste des Fehlenden war bis zum 05.09.2026 bei fuenf Feldern stumm,
 * weil sie niemand nachzog, wenn ein Feld dazukam.
 */

import { liesLokal, schreibeLokal } from '../gemeinsam/speicher.ts';
import type { Sites } from '../gemeinsam/typen.ts';
import { allesAnwenden } from './anwenden.ts';
import { ApiFehler, anfrageMitKonto } from './konto.ts';
import { aktuelleLizenz } from './lizenz.ts';
import { istObjekt, istHost, istString } from './pruefung.ts';
import { aktualisiereDynamischeRegeln } from './regeln.ts';

type Stand = { listen: Record<string, boolean>; sites: Sites; eigeneRegeln: string };
type ServerStand = { stand: unknown; version: number; aktualisiertAm: string | null };

const MAX_BYTES = 64 * 1024;

async function eigenerStand(): Promise<Stand> {
  const { einstellungen, sites, eigeneRegeln } = await liesLokal('einstellungen', 'sites', 'eigeneRegeln');
  return { listen: einstellungen.listen, sites, eigeneRegeln };
}

/** Nur Felder mit der erwarteten Form; alles andere bleibt, wie es ist. */
async function uebernehme(roh: unknown): Promise<void> {
  if (!istObjekt(roh)) return;
  const { einstellungen } = await liesLokal('einstellungen');
  const neu: Parameters<typeof schreibeLokal>[0] = {};

  if (istObjekt(roh.listen)) {
    const listen: Record<string, boolean> = {};
    for (const [id, wert] of Object.entries(roh.listen)) if (typeof wert === 'boolean') listen[id] = wert;
    neu.einstellungen = { ...einstellungen, listen };
  }
  if (istObjekt(roh.sites)) {
    const sites: Sites = {};
    for (const [host, wert] of Object.entries(roh.sites)) {
      if (istHost(host) && istObjekt(wert) && typeof wert.erlaubt === 'boolean') {
        sites[host] = { erlaubt: wert.erlaubt, seit: typeof wert.seit === 'number' ? wert.seit : Date.now() };
      }
    }
    neu.sites = sites;
  }
  if (istString(roh.eigeneRegeln)) neu.eigeneRegeln = roh.eigeneRegeln;

  await schreibeLokal(neu);
}

export async function abgleichJetzt(): Promise<{ aktualisiertAm: string | null }> {
  const lizenz = await aktuelleLizenz();
  if (!lizenz.premium) throw new ApiFehler('LIZENZ_ERFORDERLICH', '', 403);

  const { abgleich } = await liesLokal('abgleich');
  const server = await anfrageMitKonto<ServerStand>('/api/adsilence/abgleich');
  let version = typeof server.version === 'number' ? server.version : 0;
  if (server.stand && version > abgleich.version) await uebernehme(server.stand);

  const stand = await eigenerStand();
  if (JSON.stringify(stand).length > MAX_BYTES) throw new ApiFehler('ABGLEICH_ZU_GROSS', '', 0);

  let antwort: { version: number; aktualisiertAm: string | null };
  try {
    antwort = await anfrageMitKonto('/api/adsilence/abgleich', { method: 'PUT', body: { stand, version: version + 1 } });
  } catch (f) {
    if (!(f instanceof ApiFehler) || f.code !== 'ABGLEICH_VERALTET') throw f;
    const erneut = await anfrageMitKonto<ServerStand>('/api/adsilence/abgleich');
    version = typeof erneut.version === 'number' ? erneut.version : version;
    if (erneut.stand) await uebernehme(erneut.stand);
    antwort = { version, aktualisiertAm: erneut.aktualisiertAm };
  }

  await schreibeLokal({ abgleich: { version: antwort.version, aktualisiertAm: antwort.aktualisiertAm } });
  await aktualisiereDynamischeRegeln();
  await allesAnwenden();
  return { aktualisiertAm: antwort.aktualisiertAm };
}
