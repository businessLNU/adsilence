# AdSilence, die Browser-Erweiterung

Blockt Werbung und Tracker in Chromium, Firefox und Safari. Ein Quelltext,
drei Pakete, ein Bauskript.

Die Erweiterung arbeitet allein. Ein Konto braucht sie nur, wenn jemand
Premium gekauft hat: Dann fragt sie beim Backend nach, was sein Tarif
erlaubt. Ohne Konto verlaesst nichts den Browser.

---

## Bauen

Einmalig:

```bash
cd extension
npm install
cp .env.example .env      # ADSILENCE_API zeigt auf das Backend
```

Dann:

```bash
npm run build             # alle drei Ziele nach dist/
npm run build:chromium    # nur eines
npm run dev               # Chromium mit Auto-Neubau
```

`dist/<ziel>/` ist das fertige, entpackte Paket. `npm run zip` schnuert daraus
`dist/adsilence-<ziel>-<version>.zip` fuer die Stores.

**Fehlende Eingaben brechen den Bau nicht ab.** Wer die Oberflaeche
anschauen will, bevor `npm run listen:holen && npm run listen:bauen` gelaufen
ist, bekommt ein Paket ohne Filterlisten: Es laedt, es laesst sich bedienen,
es blockt nur nichts. Das Bauskript sagt in jeder Warnzeile, was fehlt und
was der Verlust bedeutet. Nur ein echter Fehler im Quelltext beendet den Lauf
mit Status 1.

### Woher die Adresse des Backends kommt

Im Quelltext steht keine. Drei Werte schreibt das Bauskript beim Buendeln
hinein (`src/gemeinsam/umgebung.d.ts`):

| Konstante | Woher | Vorgabe |
|---|---|---|
| `ADSILENCE_API` | `extension/.env`, von der echten Umgebung ueberstimmbar | `http://localhost:3000` |
| `VERSION` | `extension/package.json` | `0.0.0` |
| `BROWSER` | `--ziel=` des Bauaufrufs | `chromium` |

Ein Release baut man also so, ohne eine Datei anzufassen:

```bash
ADSILENCE_API=https://<adresse-des-backends> npm run build
```

`ADSILENCE_MANIFEST_KEY` in der `.env` haelt die Erweiterungs-ID beim lokalen
Laden fest. Leer lassen ist in Ordnung; der Store vergibt beim Hochladen
ohnehin einen eigenen Schluessel.

---

## Laden im Browser

### Chrome, Edge, Brave, Vivaldi

1. `chrome://extensions` oeffnen
2. rechts oben **Entwicklermodus** einschalten
3. **Entpackt laden** und `extension/dist/chromium` waehlen

Nach jedem Neubau in derselben Zeile auf den Neuladen-Pfeil klicken. Fuer den
Hintergrund gibt es dort den Link **Service Worker**, der die Konsole oeffnet.

### Firefox

1. `about:debugging#/runtime/this-firefox` oeffnen
2. **Temporaeres Add-on laden**
3. `extension/dist/firefox/manifest.json` waehlen (die Manifest-Datei, nicht
   den Ordner)

Temporaer heisst: bis zum naechsten Neustart. `npm run lint:firefox` faehrt
`web-ext lint` ueber das Paket, bevor es zu addons.mozilla.org geht.

**Fuenf Warnungen bleiben stehen, und zwar mit Absicht** (gemessen am
03.09.2026 mit `web-ext@10`: 0 Fehler, 5 Warnungen).

Zwei weitere sind an diesem Tag WEGGEFALLEN und stehen hier, damit niemand
sie wieder einbaut: `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`, einmal fuer
Desktop und einmal fuer Android. `data_collection_permissions` kennt Firefox
erst ab 140 und Firefox fuer Android erst ab 142; `strict_min_version` stand
auf 128 und galt fuer beide. Behoben durch 140.0 im `gecko`-Block und einen
eigenen `gecko_android`-Block mit 142.0. Das sperrt niemanden aus, der noch
Sicherheitsupdates bekaeme: ESR 128 wird seit August 2025 nicht mehr
gepflegt (Mozillas Sicherheitshinweise, nachgesehen am 03.09.2026 - gepflegt
sind 115, 140 und 153). Wer die Zahl wieder senkt, holt beide Warnungen
zurueck.

| Warnung | Warum sie bleibt |
|---|---|
| `COINMINER_USAGE_DETECTED` (3x, in `rules/`) | Ein Fehlalarm mit Ansage: Der Linter findet `coinhive`- und `coinimp`-Zeichenketten in BLOCKREGELN. EasyPrivacy und zwei regionale Listen sperren diese Miner, die Namen stehen deshalb im Paket. Fuer die AMO-Pruefung gehoert dieser Satz in die Notiz an den Reviewer. |
| `UNSAFE_VAR_ASSIGNMENT` (2x, `seiten/*.js`) | Beide Stellen liegen in React DOM (`a.innerHTML = "<script></script>"` in dessen Elementfabrik), nicht in unserem Code. Es gibt keine eigene `innerHTML`-Zuweisung im Paket. Wegzubekommen waere sie nur mit einem anderen Framework - `preact/compat` traegt diese Zeile nicht -, und ein Frameworkwechsel unter einer fertigen Oberflaeche ist teurer als zwei Warnungen, die AMO durchlaesst. |

### Ladeprobe ohne Fenster

`--load-extension` ist in Chrome ab Version 137 abgeschaltet, und der
Notausgang `--disable-features=DisableLoadExtensionCommandLineSwitch` wirkt in
den neueren Fassungen auch nicht mehr. GEMESSEN am 03.09.2026 mit Chrome
152.0.7977.75, zweimal: kein Eintrag im Profil, kein Ziel unter
`/json/list`, keine indizierten Regellisten - die Erweiterung wird schlicht
nicht geladen, ohne eine Zeile im Protokoll.

Mit **Chrome for Testing** geht es weiterhin (dort ist der Schalter nicht
abgeschaltet):

```bash
BIN="$HOME/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$BIN" --headless=new --disable-gpu --no-first-run \
  --user-data-dir=/tmp/adsilence-chrome \
  --load-extension="$PWD/dist/chromium" \
  --remote-debugging-port=9333 about:blank &
curl -s http://127.0.0.1:9333/json/list      # der Service Worker muss darin stehen
```

Der Service Worker schlaeft nach rund 30 Sekunden ein und verschwindet dann
aus `/json/list`; das ist kein Fehler. Wecken laesst er sich, indem man das
Popup als Ziel oeffnet:

```bash
curl -s -X PUT "http://127.0.0.1:9333/json/new?chrome-extension://<id>/popup/index.html"
```

Von HAND ist der Weg unveraendert: `chrome://extensions`, Entwicklermodus,
**Entpackt laden**. Nur der Kommandozeilenschalter ist weg, nicht die
Moeglichkeit.

### Die Koederprobe

Ein Typecheck sagt, dass der Code uebersetzt. Ob die Erweiterung BLOCKT, sagt
er nicht. `npm run probe:koeder` startet einen kleinen Webserver in drei
Rollen (Seite, Werbeserver, Zaehldienst), laedt `dist/chromium` in ein echtes
Chrome und misst an `tests/koeder/index.html`, was ankommt und was
verschwindet - Werbeskript, Zaehlpixel, drei generische Selektoren, offene und
GESCHLOSSENE Shadow Roots, ein Scriptlet, das Popup.

Playwright ist dafuer absichtlich keine Abhaengigkeit dieses Pakets: Es bringt
einen ganzen Browser mit, und diese eine Probe ist der einzige Ort, der ihn
braucht. Einmalig:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run probe:koeder
```

Stand 03.09.2026: 10 von 10 Proben bestanden.

### Safari (nur macOS, Xcode noetig)

```bash
npm run build:safari
npm run safari              # ruft scripts/safari.sh
```

Das erzeugt unter `dist/safari-xcode/AdSilence/AdSilence.xcodeproj` ein
Xcode-Projekt, das FERTIG EINGESTELLT ist: Version aus `package.json`,
Baunummer bei jedem Lauf um eins hoeher, und das Team eingetragen, sofern
`ADSILENCE_TEAM_ID` in `extension/.env` steht. Oeffnen, **Product > Archive**,
**Distribute App** - mehr ist es nicht.

**Der Ordner `dist/safari-xcode` wird bei jedem Lauf geloescht und neu
gebaut.** Was dort von Hand eingestellt wird, ist beim naechsten Mal weg;
deshalb setzt das Skript Version, Baunummer und Team selbst. Wer dauerhaft
mehr braucht (eigene Symbole, Berechtigungen, mehrere Ziele), kopiert das
Projekt einmal an einen festen Ort und pflegt es dort.

**Die Baunummer steht in `safari-buildnummer.txt` und gehoert ins Git.** App
Store Connect nimmt keine Baunummer zweimal an; zwei Rechner mit derselben
Zahl bekommen eine Absage.

**Die Bundle-Kennung muss auf den App-Namen enden.** Der Wandler behandelt
`--bundle-identifier` als die der ERWEITERUNG und leitet die der App ab, indem
er das letzte Segment durch den App-Namen ersetzt. GEMESSEN am 03.09.2026,
drei Anlaeufe: `io.adsilence.safari` und `io.adsilence` fuehrten beide zu
einem Abbruch, weil die Kennung der App nicht mehr Praefix der Erweiterung
war; `io.adsilence.AdSilence` baut. Der Wert steht samt Messung in
`scripts/safari.sh`.

Der Wandler meldet dabei zwei Manifest-Schluessel als „nicht unterstuetzt", und
beide bleiben stehen: `options_ui.open_in_tab` (Safari oeffnet die
Optionsseite ohnehin in einem Fenster, der Schluessel schadet den anderen
Zielen nicht) und `match_about_blank` (Safari matcht `about:blank`-Rahmen
nicht; Chromium und Firefox tun es, und dort ist es die Stelle, an der ein
Werbe-Iframe sitzt). GEMESSEN am 03.09.2026: Ein dritter Schluessel,
`background.persistent`, stand ebenfalls in der Liste - der ist ein Ueberbleibsel
aus Manifest V2 und inzwischen entfernt. Danach in Safari: Einstellungen, Entwickler,
**Unsignierte Erweiterungen erlauben**, dann Einstellungen, Erweiterungen,
AdSilence einschalten. Fuer den App Store wird dieses Projekt archiviert und
hochgeladen; eine Safari-Erweiterung kommt nie als ZIP in einen Store.

---

## Alle Skripte

| Befehl | Was er tut |
|---|---|
| `npm run dev` | Chromium bauen und beobachten (esbuild und Vite bauen bei jeder Aenderung neu) |
| `npm run build` | alle drei Ziele nach `dist/` |
| `npm run build:chromium` \| `:firefox` \| `:safari` | ein einzelnes Ziel |
| `npm run manifest` | nur die `manifest.json` je Ziel neu mischen |
| `npm run zip` | `dist/<ziel>/` zu `dist/adsilence-<ziel>-<version>.zip` packen |
| `npm run safari` | Xcode-Projekt aus `dist/safari` erzeugen |
| `npm run typecheck` | `tsc` ueber beide Konfigurationen, muss vor jedem Abschluss gruen sein |
| `npm test` | alle Tests (`node --test`) |
| `npm run test:hintergrund` \| `test:engine` \| `test:oberflaeche` | eine Reihe davon |
| `npm run listen:holen` | Filterlisten herunterladen nach `listen/quellen/`; mit `-- --aus=<ordner>` stattdessen aus Dateien auf der Platte (je Quelle das Feld `datei` in `listen/quellen.json`). Im Wurzelverzeichnis buendelt `npm run listen:einlesen` das fuer den Eingang `listen/` samt Bauen |
| `npm run listen:bauen` | daraus `rules/`, `kosmetik/`, `scriptlets/` und `listen/bericht.json` erzeugen |
| `npm run locales` | `_locales/<code>/messages.json` aus `i18n/*.json` (das Bauskript ruft es bei Bedarf selbst) |
| `npm run pruefe:texte` | jede Sprache hat dieselben Schluessel, kein fester Text in einer Komponente |
| `npm run pruefe:sprachen` | dasselbe aus der anderen Richtung: kein Schluessel ohne Uebersetzung |
| `npm run pruefe:paket` | das GEBAUTE `dist/<ziel>` gegen sein eigenes Manifest halten (jeder genannte Pfad muss da sein) |
| `npm run probe:koeder` | die gebaute Erweiterung in einem echten Chrome an der Koederseite messen (braucht Playwright, siehe unten) |
| `npm run lint:firefox` | `web-ext lint` ueber `dist/firefox` |

`npm run typecheck` faehrt zwei Konfigurationen: `tsconfig.json` fuer alles mit
DOM, `tsconfig.worker.json` fuer `src/hintergrund/**` mit `WebWorker` statt
`DOM`. Zweiteres ist kein Selbstzweck. Im Service Worker gibt es kein
`document`; ohne die zweite Pruefung faellt ein Zugriff darauf erst zur
Laufzeit auf, und zwar bei Nutzern.

---

## Was im Paket liegt

```
dist/chromium/
  manifest.json
  hintergrund/index.js        Service Worker, ein Buendel
  inhalt/kosmetik.js          Inhaltsskript, isolierte Welt
  inhalt/schatten.js          Inhaltsskript, Hauptwelt (Shadow DOM)
  popup/index.html            Popup, dazu seiten/popup.js und .css
  optionen/index.html         Optionsseite, dazu seiten/optionen.js und .css
  rules/<liste>.json          Blockregeln fuer declarativeNetRequest
  kosmetik/<liste>.json       seitenspezifische Selektoren
  kosmetik/<liste>.generisch.css  generische Selektoren, je Liste einzeln
  scriptlets/<liste>.json     Gegenmittel je Host
  listen/quellen.json         welche Listen es gibt (Name, frei/premium)
  listen/bericht.json         wie viele Regeln je Liste, fuer die Optionsseite
  icons/, _locales/
```

Was NICHT ins Paket geht: `listen/quellen/` mit den rohen Filterlisten (ueber
20 MB, zur Laufzeit liest sie niemand) und `kosmetik/generisch.css`, die
Vereinigung aller generischen Selektoren. Letztere ist eine Momentaufnahme zum
Nachsehen; geladen werden die Dateien je Liste.

Keine Hashes in Dateinamen, kein Code-Splitting im Hintergrund, keine
Verschleierung. Ein Paket wird als Ganzes ausgeliefert; es gibt keinen Cache,
den ein Hash umgehen muesste, und ein Store-Review liest den Quelltext.

`kosmetik/<liste>.generisch.css` entsteht beim Bauen aus dem `generisch`-Feld
der jeweiligen JSON-Datei. Der Hintergrund meldet diese Dateien je AKTIVER
Liste als Inhaltsskript an. Warum nicht einfach `content_scripts.css` im
Manifest: Das liesse sich weder abschalten noch je Seite ausnehmen. Eine
Ausnahme fuer eine Seite waere dann nur eine halbe, und "AdSilence aus" hiesse
weiterhin versteckte Elemente.

---

## Manifest und Overlays

Eine Quelle, drei Ergebnisse: `manifest/base.json` plus
`manifest/<ziel>.json`. `scripts/manifest.mjs` mischt Objekte tief, **Arrays
ersetzen**. Ein Overlay, das `content_scripts` nennt, meint also die ganze
Liste.

Zwei Dinge, die dabei absichtlich so sind:

- **Safari bekommt das Inhaltsskript der Hauptwelt nicht.** `base.json`
  registriert `inhalt/schatten.js` mit `"world": "MAIN"`. Safari kennt diesen
  Schluessel in `content_scripts` nicht durchgaengig und lehnt das Manifest im
  Zweifel ganz ab. Deshalb zaehlt `manifest/safari.json` die
  `content_scripts` noch einmal vollstaendig auf, ohne diesen Eintrag. JSON
  kennt keine Kommentare, darum steht die Begruendung hier und nicht dort.
  Wer den Eintrag in `base.json` anfasst, muss `safari.json` mit anfassen.
- **`rule_resources` wird gefiltert.** Nur Listen, deren Datei wirklich
  existiert, stehen im fertigen Manifest. Ein Manifest, das auf eine fehlende
  `rules/cookies.json` zeigt, laedt der Browser gar nicht erst, und die
  Fehlermeldung nennt den Grund nicht.

---

## Berechtigungen, einzeln

Jede Berechtigung kostet Vertrauen und einen Satz im Store-Dialog. Deshalb
steht hier zu jeder, wofuer genau sie da ist.

| Berechtigung | Wofuer | Was ohne sie ausfaellt |
|---|---|---|
| `declarativeNetRequest` | Blocken. Der Browser gleicht die Regeln aus `rules/` selbst ab. | alles. Das ist der Kern. |
| `storage` | Einstellungen, Ausnahmeliste, eigene Regeln, Lizenzstand, Konto-Token | nichts wuerde einen Neustart ueberleben |
| `alarms` | Lizenzpruefung alle 6 Stunden, Nachfassen bei einem offenen Verbindungscode | ein schlafender Service Worker prueft nie wieder nach |
| `scripting` | meldet die generische Kosmetik je aktiver Liste an und schiebt Scriptlets in die Seite | leere Werbeflaechen bleiben stehen, Adblock-Erkennung greift |
| `webNavigation` | liefert mit `onCommitted` den Moment, in dem ein Scriptlet noch vor dem ersten Seitenskript laufen kann | Scriptlets kaemen zu spaet und waeren wirkungslos |
| `host_permissions: <all_urls>` | Kosmetik und Scriptlets betreffen jede Seite; ausserdem liest `tabs.query` damit die Adresse des aktiven Tabs | die Erweiterung koennte nicht sagen, auf welcher Seite man gerade ist |

**Nicht angefordert**, obwohl es naheliegend waere:

- `tabs`. Die Host-Berechtigung reicht, damit `tabs.query` die URL mitliefert.
  Eine zweite Berechtigung fuer dasselbe waere nur ein weiterer Satz im
  Dialog.
- `declarativeNetRequestFeedback`. Damit liesse sich mitschreiben, welche
  Anfrage auf welcher Seite geblockt wurde. Genau diese Liste wollen wir
  nicht haben.
- `<all_urls>` als optionale Berechtigung. Ohne sie waere die Erweiterung auf
  jeder neuen Seite erst einmal aus, und niemand merkt, dass er sie
  freischalten muesste.

`host_permissions` ist die einzige Berechtigung, die der Nutzer im Dialog
wirklich abwaegen muss. Sie ist bei einem Werbeblocker unvermeidbar: Er muss
auf jeder Seite arbeiten koennen, sonst arbeitet er nicht.

---

## Datenschutz

### Was den Browser verlaesst, und wann

Alles in dieser Tabelle geht ausschliesslich an die Adresse in
`ADSILENCE_API`, also an das eigene Backend. Es gibt keinen Dritten, keine
Analyse, keine Absturzberichte, kein Werbenetz.

| Was | Wann | Endpunkt | Inhalt |
|---|---|---|---|
| Anmeldung | nur wenn jemand in der Erweiterung E-Mail und Passwort eingibt | `POST /api/adsilence/geraete/anmelden` | E-Mail, Passwort |
| Verbindungscode anfordern | Klick auf "Mit Konto verbinden" | `POST /api/adsilence/verbindung` | Browserkennung (`chromium`, `firefox`, `safari`), Geraetebezeichnung wie "Chrome auf macOS" |
| Code abholen | alle 3 Sekunden, hoechstens 10 Minuten, solange ein Code offen ist | `POST /api/adsilence/verbindung/abholen` | Code und Abholgeheimnis, sonst nichts |
| Sitzung erneuern | wenn das Zugangstoken ablaeuft | `POST /api/adsilence/geraete/auffrischen` | Refresh-Token |
| Konto trennen | Klick auf "Trennen" | `POST /api/adsilence/geraete/abmelden` | Refresh-Token |
| Tarif pruefen | beim Start des Hintergrunds, alle 6 Stunden, nach dem Verbinden, nach der Rueckkehr vom Kauf (3 Sekunden Takt, hoechstens 60 Sekunden), beim Oeffnen des Popups falls der Stand aelter als eine Stunde ist | `GET /api/adsilence/lizenz` | nur das Zugangstoken |
| Abgleich zwischen Geraeten (nur Premium) | Klick auf "Jetzt abgleichen" | `GET`/`PUT /api/adsilence/abgleich` | Einstellungen und die Liste der erlaubten Hosts |
| Meldung "Seite kaputt" | erst nach dem zweiten Klick, nachdem die Vorschau gezeigt hat, was gesendet wird | `POST /api/adsilence/meldung` | Adresse **ohne** Query und Fragment, Browser, Version, aktive Listen, bis zu 50 beteiligte Regeln, freier Kommentar |

Zu jeder dieser Anfragen:

- `credentials: 'omit'`. Kein Cookie geht mit, auch nicht, wenn im selben
  Browser eine Sitzung auf der Website offen ist.
- `Accept-Language` traegt die Oberflaechensprache des Browsers, damit
  Fehlermeldungen in der richtigen Sprache zurueckkommen.
- Die Meldung "Seite kaputt" geht **ohne** `Authorization`-Kopfzeile, auch
  wenn ein Konto verbunden ist. Eine Fehlermeldung ueber eine Seite soll sich
  nicht einer Person zuordnen lassen.

### Was den Browser nie verlaesst

- besuchte Adressen, Verlauf, Suchbegriffe
- welche Anfrage auf welcher Seite geblockt wurde
- der Zaehler im Symbol (er kommt vom Browser selbst und bleibt dort)
- die Ausnahmeliste, solange niemand den Abgleich einschaltet
- eigene Regeln

Die Filterlisten liegen fertig im Paket. Es gibt **kein** Nachladen von
Listen zur Laufzeit, also auch keine Verbindung zu easylist.to oder einem
anderen Listenanbieter waehrend des Surfens. Neue Listen kommen mit dem
naechsten Update der Erweiterung.

### Was gespeichert wird, und wo

`chrome.storage.local`, nie `sync`: Einstellungen, Ausnahmeliste je Host,
eigene Regeln, Lizenzstand, Refresh-Token des verbundenen Kontos.
`chrome.storage.session` haelt das kurzlebige Zugangstoken, damit es einen
Neustart des Rechners nicht ueberlebt. Kein Feld traegt eine besuchte
Adresse, ausser der Nutzer hat eine Seite selbst auf die Ausnahmeliste
gesetzt oder eine Meldung geschrieben.

---

## Store-Beschreibung

**Einzweck (Single Purpose), ein Satz:** AdSilence blockiert Werbung und
Tracker auf Webseiten. Jede Berechtigung und jeder Programmteil dient diesem
einen Zweck.

Langtext fuer den Store:

> AdSilence blockiert Werbung, Trackingskripte und Cookie-Hinweise, bevor sie
> geladen werden. Seiten werden schneller fertig, und niemand schaut dabei zu.
>
> Die Filterregeln liegen in der Erweiterung. AdSilence laedt beim Surfen
> keine Listen nach, fuehrt kein Protokoll ueber besuchte Seiten und schickt
> keine Nutzungsdaten an irgendwen.
>
> - Ein Schalter je Seite, wenn eine Seite ohne Werbeblocker besser laeuft
> - Eigene Regeln in gewohnter Filterlisten-Schreibweise
> - Zwanzig Sprachen, hell und dunkel, folgt dem System
> - Optional Premium: Cookie-Fenster automatisch beantworten, Warnung vor
>   gefaelschten Adressen, taegliche Listenpflege, Abgleich der Einstellungen
>   zwischen Geraeten. Blocken selbst ist vollstaendig kostenlos.

Fuer den Datenschutzabschnitt des Store-Eintrags gilt die Tabelle oben
woertlich. Beim Firefox-Eintrag steht die Angabe zusaetzlich im Manifest:
`browser_specific_settings.gecko.data_collection_permissions.required` ist
`["none"]`.

---

## Filterlisten und ihre Lizenz

Die Regeln in `rules/`, `kosmetik/` und `scriptlets/` sind aus fremden
Filterlisten erzeugt. Sie sind abgeleitete Werke; die Lizenz der Quelle gilt
weiter.

| Liste im Paket | Quelle | Lizenz |
|---|---|---|
| `basis` | EasyList | GPLv3 und CC BY-SA 3.0, siehe https://easylist.to/pages/licence.html |
| `privatsphaere` | EasyPrivacy | dieselbe |
| `laestig` | Fanboy's Annoyance List | dieselbe |
| `regional-de` | EasyList Germany | dieselbe |
| `cookies` | EasyList Cookie List | CC BY 3.0, http://creativecommons.org/licenses/by/3.0/ |

Wann welche Momentaufnahme gezogen wurde, mit Pruefsumme und Zeilenzahl,
steht in `listen/quellen/<id>.meta.json`. Was der Konverter daraus gemacht
hat und was er verworfen hat, in `listen/bericht.json`.

Der Quelltext von AdSilence selbst gehoert zum umgebenden Projekt und steht
unter dessen Lizenz.
