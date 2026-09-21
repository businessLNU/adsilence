/**
 * Die Engine von AdSilence: Filterlisten lesen und in das übersetzen, was ein
 * MV3-Browser ausführen kann. Reines TypeScript ohne Node- oder DOM-Import;
 * läuft im Build (`scripts/listen-bauen.mjs`), im Service Worker (eigene
 * Regeln) und in den Tests.
 *
 *   abp.ts        Zeile → Regel (netz, kosmetik, scriptlet, unbekannt)
 *   dnr.ts        Netzregeln → declarativeNetRequest, mit Budget und Schemaprüfung
 *   kosmetik.ts   Kosmetikregeln → Selektoren (generisch, je Host, Ausnahmen)
 *   scriptlets.ts Scriptlet-Regeln → Einträge je Host
 *   prozedural.ts `#?#`-Textregeln → Selektor + gesuchter Text je Host
 *   popup.ts      $popup-Regeln → Hosts, deren Tab wieder zugeht
 *   eigene.ts     Textfeld der Optionsseite → Regeln + Fehler je Zeile
 *   gruende.ts    die Codes, warum etwas nicht umgesetzt wurde
 *   dnr-typen.ts  DNR-Regel als eigener Typ, unabhängig von @types/chrome
 */
export { nackteHostzeilen, parseListe, parseZeile } from './abp.ts';
export { anteileAusQuellen, imRahmenDesAnteils } from './nachschub.ts';
export type { Anteile, NachschubRegel } from './nachschub.ts';
export type { Kosmetikregel, Netzregel, Regel, Ressource, Scriptletregel, Unbekannt } from './abp.ts';
export {
  HOSTS_JE_REGEL,
  MUSTER_MAX_LAENGE,
  REGEX_BUDGET_STANDARD,
  REGEX_KOSTEN_MAX,
  REGEX_MAX_LAENGE,
  bedingungGrenztEin,
  domainGueltig,
  pruefeNetzregel,
  pruefeRegelsatz,
  regexKosten,
  regexTauglich,
  uebersetzeNetzregel,
  zuDnr,
} from './dnr.ts';
export { ATTRAPPEN } from './dnr.ts';
export type { DnrErgebnis, DnrOptionen, Klasse, Uebersetzung } from './dnr.ts';
export { DNR_RESSOURCEN } from './dnr-typen.ts';
export type { DnrAktion, DnrAktionTyp, DnrBedingung, DnrRegel, DnrRessource } from './dnr-typen.ts';
export { alsStylesheet, grundFuerSelektor, hostGueltig, selektorGueltig, zuKosmetik } from './kosmetik.ts';
export type { Kosmetik } from './kosmetik.ts';
export { BEKANNT, scriptletName, zuScriptlets } from './scriptlets.ts';
export type { Scriptlet, ScriptletName } from './scriptlets.ts';
export { alsTabSchliesser, popupHostVon, zuPopupHosts } from './popup.ts';
export { alsTextregel, zuTextregeln } from './prozedural.ts';
export type { ProzeduralKarte, Textregel } from './prozedural.ts';
export type { PopupListe } from './popup.ts';
export { eigeneRegeln } from './eigene.ts';
export type { EigeneRegeln, Regelfehler } from './eigene.ts';
export { GRUENDE, berichtsSchluessel, zaehle } from './gruende.ts';
export type { Grund, Verwerfung } from './gruende.ts';
