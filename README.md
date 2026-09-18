# Crumb - Deine Brot Bibliothek

Brotbacken mit System. Eine Web-App zum Verwalten, Planen und Importieren von Brotrezepten.

## Features

- 📚 Rezept-Bibliothek mit Favoriten
- 🔍 Suche und Filter (Sauerteig, Hefe, Vollkorn, "Heute fertig")
- 📥 Import von Rezepten via URL (Plötzblog, Homebaking.at, Brotdoc)
- ⏰ Backplan mit Timeline-Berechnung und Benachrichtigungen
- 📱 Responsive UI (Mobile + Desktop)

## Tech Stack

- **Frontend**: Next.js 16, React 19, TailwindCSS, TypeScript
- **Backend**: Express, PostgreSQL, Node.js
- **Notifications**: ntfy

## Quick Start (Docker)

```bash
# Environment konfigurieren
cp .env.example .env
# .env anpassen (Datenbank-Passwort, Domain, ntfy Token)

# Container starten
docker-compose up --build
```

Öffne http://localhost:3000

## Environment Variablen

### .env (Root)

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=dein_sicheres_passwort
POSTGRES_DB=crumb_db
DATABASE_URL=postgres://postgres:dein_sicheres_passwort@db:5432/crumb_db

# NTFY Notifications
NTFY_URL=https://ntfy.skords.de
NTFY_TOPIC=Crumb
NTFY_TOKEN=dein_token
NTFY_VORLAUF=5

# CORS
ALLOWED_ORIGIN=http://localhost:3000

# UI API URL
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## Entwicklung

### Lokal ohne Docker

**Backend:**
```bash
cd api
npm install
# .env mit DATABASE_URL erstellen
node index.js
```

**Frontend:**
```bash
cd ui
npm install
npm run dev
```

## Projektstruktur

```
crumb/
├── api/              # Express Backend
│   ├── scrapers/     # Rezept-Importer
│   ├── uploads/     # Hochgeladene Bilder
│   └── index.js     # API Server
├── ui/              # Next.js Frontend
│   ├── src/
│   │   ├── app/    # Pages
│   │   ├── components/
│   │   └── lib/    # Utilities
│   └── public/      # Statische Assets
├── docker-compose.yml
└── .env             # Environment (nicht in Repo!)
```

## Deployment

1. `.env` mit Production-Werten konfigurieren
2. `ALLOWED_ORIGIN` auf deine Domain setzen
3. `NEXT_PUBLIC_API_URL` auf API-Domain setzen
4. Docker Container starten:
   ```bash
   docker-compose up -d
   ```

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
