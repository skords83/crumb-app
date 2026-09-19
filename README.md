# Crumb – Deine Brot-Bibliothek

Rezepte verwalten und importieren, Backvorgänge planen und Sauerteig pflegen.

## Funktionen

- Rezeptbibliothek mit Suche, Kategorien und Favoriten
- Rezeptimport per URL oder Datei
- Backplan mit Timern, Fortschritt und Web-Push-Benachrichtigungen
- Backhistorie mit unveränderlichem Rezeptstand pro Backvorgang
- Starter-Verwaltung und Passwortreset per E-Mail

Frontend: Next.js 16 / React 19. Backend: Express / PostgreSQL.
Benachrichtigungen verwenden Web Push; ntfy wird nicht mehr verwendet.

## Docker / Deployment

Die mitgelieferte `docker-compose.yaml` verwendet veröffentlichte Images und
Traefik über das externe Netzwerk `proxy`. Sie veröffentlicht keine lokalen
Ports. Die Router sind auf `crumb.skords.de` eingestellt; bei einer anderen Domain
auch die Traefik-Labels anpassen.

1. `.env.example` nach `.env` kopieren und Datenbank, JWT-Secret sowie URLs setzen.
2. `NEXT_PUBLIC_API_URL` muss den API-Pfad enthalten, beispielsweise
   `https://crumb.skords.de/api`. Dieser Wert wird beim **UI-Image-Build** gesetzt;
   eine reine Laufzeitvariable ändert bereits gebauten Browsercode nicht.
3. Web Push und SMTP wie unten beschrieben konfigurieren.
4. Images aktualisieren und Container neu erstellen:
   ```bash
   docker compose pull
   docker compose up -d
   ```

Datenbank und Bilder liegen in Docker-Volumes. Schema-Erweiterungen erfolgen beim
API-Start, bevor Anfragen angenommen werden.

## Web Push und Passwortreset

Einmalig ein VAPID-Schlüsselpaar erzeugen:

```bash
cd api
npm ci
npx web-push generate-vapid-keys
```

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und `VAPID_SUBJECT` (z. B.
`mailto:admin@example.com`) in `.env` eintragen. Das Schlüsselpaar dauerhaft
beibehalten, damit bestehende Browser-Abonnements gültig bleiben. Danach in der
App Push aktivieren und testen. Ein erfolgreicher Test bestätigt die Annahme durch
den Push-Dienst; die tatsächliche Anzeige hängt auch von Browser und Betriebssystem ab.
Ohne gültige VAPID-Konfiguration zeigt der Test einen Fehler. Fehlgeschlagene
Benachrichtigungen ohne erfolgreiche Annahme werden beim nächsten Durchlauf erneut versucht.

Für E-Mails `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` und
`SMTP_FROM` setzen. Typisch: Port 587 mit `SMTP_SECURE=false` (STARTTLS) oder
Port 465 mit `SMTP_SECURE=true`. SMTP-Authentifizierung wird nur bei gesetztem
`SMTP_USER` verwendet. `FRONTEND_URL` muss die Browser-URL ohne `/api` sein,
damit Reset-Links korrekt sind. Ohne Host oder Absender meldet der Passwortreset,
dass der Betreiber ihn noch einrichten muss.

Alle diese Variablen werden vom Compose-Service an die API weitergereicht.
Es werden keine Zugangsdaten automatisch erzeugt oder versendet.

## Lokale Entwicklung

PostgreSQL separat bereitstellen. In `api/.env` mindestens `DATABASE_URL`, ein
zufälliges `JWT_SECRET` mit mindestens 32 Zeichen, `ALLOWED_ORIGIN=http://localhost:3000`,
`BASE_URL=http://localhost:5000` und `FRONTEND_URL=http://localhost:3000` setzen.
In `ui/.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:5000/api`.

```bash
cd api
npm ci
node index.js
```

In einem zweiten Terminal:

```bash
cd ui
npm ci
npm run dev
```

## Backhistorie und Datenmigration

Beim Start eines Backvorgangs werden Titel, Zutaten und Phasen als eigener
Rezeptstand gespeichert. Änderungen am Bibliotheksrezept verändern diesen Stand
nicht. Beim Entfernen eines Rezepts bleibt es intern archiviert; laufende
Backvorgänge und Historie bleiben erhalten. Unter **Backplan → Backhistorie** sind
die letzten 50 abgeschlossenen Vorgänge einschließlich ihrer Rezeptstände verfügbar.

Für bestehende Backvorgänge übernimmt die Migration den aktuell gespeicherten
Rezeptstand. Bereits früher überschriebene oder gelöschte Daten lassen sich damit
nicht rekonstruieren. Gleichzeitige Änderungen am Fortschritt werden über eine
Versionsprüfung erkannt und mit einem Hinweis zum Neuladen beantwortet.

Hydration berücksichtigt g/kg, Wasser in ml/l/cl/dl, Mehl- und Wasseranteile
separater Starter sowie Verweise auf andere Teigphasen. Fehlende Starter-Hydration
wird mit 100 % angenommen, Milch näherungsweise mit 87 % Wasseranteil.
Schätzungen und Annahmen werden sichtbar gekennzeichnet; unbekannte Einheiten
führen zu „Nicht berechenbar“. Einheit und Starter-Hydration sind im Rezepteditor
anpassbar.

## Tests

`npm test` in `api` prüft Berechnungen, Sicherheitsregressionen, Push-Fehlerfälle
und Datenbankmigration/Backfortschritt. Die Datenbanktests nutzen PostgreSQL via
PGlite im Speicher und benötigen keine laufende Produktionsdatenbank.
`npm test` in `ui` prüft Hydration und API-Fehlerbehandlung; `npm run build` prüft
den Produktionsbuild einschließlich TypeScript. `npm audit` prüft Abhängigkeiten.

## Lizenz

MIT

## Sicherheitskonfiguration

Neue Konten benötigen einen Einladungscode. Setze `REGISTRATION_INVITE_CODE` in
`.env` auf einen zufälligen Wert mit mindestens 32 Zeichen, beispielsweise erzeugt
mit `openssl rand -hex 32`. Teile ihn nur mit eingeladenen Personen. Ohne Code
bleibt die Registrierung gesperrt; bestehende Konten können sich weiter anmelden.
Zum Sperren weiterer Registrierungen den Wert entfernen und den API-Container
neu erstellen. Ein geänderter Code beeinflusst bestehende Konten nicht.

Beim ersten Start dieser Sicherheitsversion wird `users.token_version` automatisch
angelegt. Bestehende Anmeldungen werden einmalig ungültig. Passwortwechsel und
Passwortreset widerrufen danach sämtliche bisherigen Anmeldungen des Kontos
und offene Reset-Links; anschließend ist eine erneute Anmeldung erforderlich.

Push unterstützt HTTPS-Endpunkte von Google FCM, Mozilla und Apple. Ziele werden
auch beim Versand geprüft, DNS-Adressen beim Verbindungsaufbau auf öffentliche
Adressen begrenzt. Andere Anbieter werden abgelehnt. Pro Benutzer sind bis zu
20 Geräte vorgesehen, Versandverbindungen haben ein Zeitlimit von 10 Sekunden.
Eine Subscription kann nicht durch ein anderes Konto übernommen werden; beim
Kontowechsel gegebenenfalls Push zunächst im bisherigen Konto deaktivieren.

Prüfungen: `cd api && npm test`, `cd ui && npm run build`, sowie `npm audit`
in beiden Verzeichnissen. Sicherheitsupdates werden erst nach Neubau und
Deployment der Container in der laufenden Anwendung wirksam.
