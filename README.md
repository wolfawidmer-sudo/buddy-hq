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
