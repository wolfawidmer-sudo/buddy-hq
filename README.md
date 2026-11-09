# Buddy HQ

Privates Betriebs-Dashboard für Buddy Island (Windows, Electron). Zeigt den Reingewinn
(Stripe-Netto minus Kosten aller Dienste) und den Zustand aller Dienste.

**Keine Keys im Repo.** Keys werden nur in der App eingegeben und lokal verschlüsselt gespeichert.

## Entwickeln

```sh
npm install
npm test           # Tests ohne Fremdpakete
npm run secret-scan
npm start          # App starten (braucht Electron)
```

Einmalig nach dem Klonen, damit der Secret-Scan vor jedem Commit und Push läuft:

```sh
git config core.hooksPath .githooks
```

## Aufbau

- `src/core/` – Rechnen ohne Electron: exakte Beträge (BigInt), EZB-Kurse, Zeiträume (Europe/Zurich), Gewinnrechnung.
- `src/main/` – Hauptprozess: Fenster, Sicherheit, später alle API-Aufrufe.
- `src/renderer/` – Oberfläche (ohne Netzzugriff, strenge CSP).
- `scripts/secret-scan.js` – Secret-Scan vor Commit/Push und im CI.

## Tests

- `npm test` – Rechnung, Kurse, Zeiträume, Login, Tresor, alle Dienste mit Attrappen (keine echten Anfragen).
- CI startet zusätzlich die echte App unsichtbar (`BUDDY_HQ_SMOKE=1`), richtet einen Test-Zugang ein und öffnet jede Seite.
- `node test/ui/harness.js <playwright> <chrome> <ordner>` – Screenshots aller Seiten mit Attrappen (nur Entwicklung).

## Release (nur von Hand)

1. Version in `package.json` erhöhen.
2. GitHub → Actions → «Release» → «Run workflow».
3. Der Lauf testet, baut `Buddy-HQ-Setup.exe` auf Windows und legt ein privates Release an.
