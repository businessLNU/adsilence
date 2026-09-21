#!/usr/bin/env bash
# Safari-Huelle aus dist/safari bauen (Xcode-Projekt), macOS only.
#
#   bash scripts/safari.sh            # nach `npm run build:safari`
#
# Ergebnis: dist/safari-xcode/AdSilence/ mit einem Xcode-Projekt. Oeffnen,
# Team eintragen, bauen; Safari > Einstellungen > Erweiterungen einschalten.
# Fuer den App Store wird dieses Projekt archiviert und hochgeladen; die
# Erweiterung selbst kommt nie als .zip in einen Safari-Store.
set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUELLE="$HIER/dist/safari"
ZIEL="$HIER/dist/safari-xcode"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun fehlt. Xcode installieren (App Store) und einmal oeffnen." >&2
  exit 1
fi
if [ ! -f "$QUELLE/manifest.json" ]; then
  echo "$QUELLE hat kein manifest.json. Erst: npm run build:safari" >&2
  exit 1
fi

# Das letzte Segment der Kennung MUSS der App-Name sein.
#
# Der Konverter behandelt `--bundle-identifier` als Kennung der ERWEITERUNG
# und leitet die der APP daraus ab: Er schneidet das letzte Segment ab und
# haengt den App-Namen an. Aus `io.adsilence.safari` wurde deshalb
# `io.adsilence.AdSilence` fuer die App und `io.adsilence.safari.Extension`
# fuer die Erweiterung — und Xcode brach ab mit „Embedded binary's bundle
# identifier is not prefixed with the parent app's bundle identifier".
#
# GEMESSEN am 03.09.2026 mit Xcode 26.6, drei Anlaeufe:
#   io.adsilence.safari    -> App io.adsilence.AdSilence  | Ext io.adsilence.safari.Extension    (bricht ab)
#   io.adsilence           -> App io.AdSilence            | Ext io.adsilence.Extension           (bricht ab)
#   io.adsilence.AdSilence -> App io.adsilence.AdSilence  | Ext io.adsilence.AdSilence.Extension (baut)
xcrun safari-web-extension-converter "$QUELLE" \
  --project-location "$ZIEL" \
  --app-name AdSilence \
  --bundle-identifier io.adsilence.AdSilence \
  --macos-only \
  --no-open \
  --force

# ── Das Projekt fertig einstellen ──────────────────────────────────────────
#
# Der Konverter setzt Version 1.0 und Baunummer 1, ganz gleich, was in
# `package.json` steht, und traegt kein Team ein. Wer das Projekt nur zum
# Hochladen erzeugt, muesste beides jedes Mal von Hand in Xcode nachtragen -
# und die Baunummer darf App Store Connect NIE zweimal sehen.
PBX="$ZIEL/AdSilence/AdSilence.xcodeproj/project.pbxproj"
VERSION="$(node -p "require('$HIER/package.json').version")"

# Die Baunummer steigt bei JEDEM Lauf. Sie liegt im Projekt (nicht in `dist`,
# das geloescht wird) und wird mitcommittet: Zwei Rechner, die dieselbe Nummer
# hochladen, bekommen von Apple eine Absage.
ZAEHLER="$HIER/safari-buildnummer.txt"
[ -f "$ZAEHLER" ] || echo 0 > "$ZAEHLER"
BAUNUMMER=$(( $(cat "$ZAEHLER") + 1 ))
echo "$BAUNUMMER" > "$ZAEHLER"

sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" "$PBX"
sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BAUNUMMER;/g" "$PBX"

# Das Team nur, wenn es in `extension/.env` steht (`ADSILENCE_TEAM_ID`). Ohne
# Eintrag bleibt das Feld leer, und Xcode fragt beim ersten Bauen danach - das
# ist kein Fehler, nur ein Handgriff mehr.
TEAM="$(grep -m1 '^ADSILENCE_TEAM_ID=' "$HIER/.env" 2>/dev/null | cut -d= -f2- | tr -d '\"' | tr -d ' ')"
if [ -n "${TEAM:-}" ]; then
  # Hinter jede Produktkennung dieselbe Teamzeile setzen.
  sed -i '' "s/\(PRODUCT_BUNDLE_IDENTIFIER = io\.adsilence[^;]*;\)/\1 DEVELOPMENT_TEAM = $TEAM;/g" "$PBX"
  echo "Team eingetragen: $TEAM"
else
  echo "Kein ADSILENCE_TEAM_ID in extension/.env - Team in Xcode waehlen."
fi

echo "Xcode-Projekt: $ZIEL"
echo "  Version $VERSION, Baunummer $BAUNUMMER"
