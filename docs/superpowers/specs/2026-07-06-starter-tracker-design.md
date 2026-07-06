# Sauerteig-Starter-Tracker — Design

## Kontext & Ziel

Crumb (`crumb.skords.de`) ist ein Rezept-Planer für Sauerteigbrot. Dieses Feature
fügt einen leichtgewichtigen Starter-Tracker hinzu: Fütterungsprotokoll,
berechnete Health-Anzeige, Erinnerungen. Reine CRUD-Logik + eine
Berechnungsformel — kein KI/LLM, keine Foto-Analyse, keine 7-Tage-Ansetz-Anleitung,
keine Zielprofil-Auswahl-UI über ein simples Dropdown hinaus, kein Coach-Chat.

Architekturprinzip: der Starter-Tracker ist ein eigenständiges, paralleles Objekt
neben der `bake_sessions`-State-Machine — kein neuer Phasentyp im Backplan-Flow,
optional per `starter_id`-Spalte mit einer Backsession verknüpfbar.

## Scope v1

✅ 3 neue Tabellen + 1 nullable Spalte auf `bake_sessions`
✅ 8 Backend-Endpunkte unter `/api/starters`
✅ 1 neuer Notification-Trigger-Typ (`starter-feeding-due`), ins bestehende Settings-Modell integriert
✅ 2 neue Frontend-Routen: Liste + Detail (jeweils eigene Route, kein Modal)
✅ Warnbanner in `PlanModal` bei niedriger Starter-Health beim Anlegen einer Backsession

❌ Foto-Analyse, 7-Tage-Anleitung, Zielprofil-Auswahl-Verfeinerung, Coach-Chat

## 1. Datenmodell

Migrationen folgen der bestehenden Projekt-Konvention: **kein separates
`init.sql`/Migrationsscript**, sondern idempotente `CREATE TABLE IF NOT EXISTS`
/ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` Blöcke innerhalb von `initDB()` in
`api/index.js`, wie es dort bereits für `bake_sessions`, `sent_notifications`,
`push_subscriptions` und `user_notification_settings` gemacht wird.

```sql
CREATE TABLE IF NOT EXISTS starters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  flour_type VARCHAR(50) NOT NULL, -- 'weizen' | 'roggen' | 'dinkel' | 'vollkorn'
  hydration_percent INTEGER NOT NULL DEFAULT 100,
  target_profile VARCHAR(50) NOT NULL DEFAULT 'ausgeglichen',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_starters_user ON starters(user_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS starter_feedings (
  id SERIAL PRIMARY KEY,
  starter_id INTEGER NOT NULL REFERENCES starters(id) ON DELETE CASCADE,
  flour_grams INTEGER NOT NULL,
  water_grams INTEGER NOT NULL,
  discard_grams INTEGER,
  temperature_celsius NUMERIC(4,1),
  activity_rating INTEGER CHECK (activity_rating BETWEEN 1 AND 10),
  notes TEXT,
  fed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_starter_feedings_starter ON starter_feedings(starter_id, fed_at DESC);

CREATE TABLE IF NOT EXISTS starter_target_profiles (
  profile_key VARCHAR(50) PRIMARY KEY,
  label_de VARCHAR(100) NOT NULL,
  feeding_interval_hours_min INTEGER NOT NULL,
  feeding_interval_hours_max INTEGER NOT NULL,
  ratio_starter_flour_water VARCHAR(20) NOT NULL,
  target_temp_min NUMERIC(4,1),
  target_temp_max NUMERIC(4,1)
);

-- bake_sessions: optionale Verknüpfung, MUSS nullable bleiben
-- (bestehende Zeilen haben keinen Wert und dürfen nicht brechen)
ALTER TABLE bake_sessions ADD COLUMN IF NOT EXISTS starter_id INTEGER REFERENCES starters(id);
```

`target_profile` ist bewusst ein plain `VARCHAR(50)` ohne DB-FK auf
`starter_target_profiles` — analog zu `recipes.category`, das ebenfalls ein
freies `VARCHAR` ohne FK ist. Validierung passiert auf API-Ebene.

**Single Source of Truth für Zielprofile:** Ein neues Modul `api/starter-profiles.js`
exportiert das komplette `TARGET_PROFILES`-Array (inkl. Intervalle, Ratio,
Temperaturen) sowie `TARGET_PROFILE_KEYS`. `initDB()` seeded
`starter_target_profiles` per parametrisiertem `INSERT ... ON CONFLICT
(profile_key) DO NOTHING` aus diesem Array (Loop, nicht hartkodiertes SQL).
`api/starters.js` validiert `target_profile` bei POST/PATCH gegen dieselben
`TARGET_PROFILE_KEYS`. Damit können API-Validierung und geseedete Profile nicht
auseinanderlaufen.

```js
// api/starter-profiles.js
const TARGET_PROFILES = [
  { profile_key: 'powerkur', label_de: 'Powerkur', feeding_interval_hours_min: 8, feeding_interval_hours_max: 12, ratio_starter_flour_water: '1:5:5', target_temp_min: 24, target_temp_max: 26 },
  { profile_key: 'max_aktivitaet', label_de: 'Maximale Aktivität', feeding_interval_hours_min: 8, feeding_interval_hours_max: 10, ratio_starter_flour_water: '1:3:3', target_temp_min: 26, target_temp_max: 28 },
  { profile_key: 'ausgeglichen', label_de: 'Ausgeglichen', feeding_interval_hours_min: 12, feeding_interval_hours_max: 24, ratio_starter_flour_water: '1:5:5', target_temp_min: 22, target_temp_max: 24 },
  { profile_key: 'minimal', label_de: 'Minimaler Aufwand', feeding_interval_hours_min: 24, feeding_interval_hours_max: 48, ratio_starter_flour_water: '1:1:1', target_temp_min: 18, target_temp_max: 20 },
  { profile_key: 'urlaub', label_de: 'Urlaubsmodus', feeding_interval_hours_min: 120, feeding_interval_hours_max: 168, ratio_starter_flour_water: '1:1:1 (Kühlschrank)', target_temp_min: 4, target_temp_max: 6 },
];
const TARGET_PROFILE_KEYS = TARGET_PROFILES.map(p => p.profile_key);
module.exports = { TARGET_PROFILES, TARGET_PROFILE_KEYS };
```

## 2. Backend-Endpunkte

Neues Modul `api/starters.js`, Aufbau analog zu `api/push.js` /
`api/bake-sessions.js` (Express-Router, `setPool(p)`-Injection, in `index.js`
unter `/api/starters` gemountet, `authenticateToken`-Middleware wie alle
anderen Routen).

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/starters` | Liste aller Starter des Users (ohne archivierte), **Health inline pro Starter** |
| `POST` | `/api/starters` | Neuen Starter anlegen (`name`, `flour_type`, `hydration_percent`, `target_profile`) |
| `GET` | `/api/starters/:id` | Einzelner Starter inkl. letzter Fütterungen, **Health inline** |
| `PATCH` | `/api/starters/:id` | Starter bearbeiten (z. B. Zielprofil ändern) |
| `DELETE` | `/api/starters/:id` | Soft-Delete via `archived_at` |
| `GET` | `/api/starters/:id/health` | Health/Status separat (Parität/Zukunft; Liste/Detail brauchen ihn nicht mehr separat) |
| `POST` | `/api/starters/:id/feedings` | Neue Fütterung protokollieren; Response enthält aktualisierte Health |
| `GET` | `/api/starters/:id/feedings` | Fütterungshistorie (neueste zuerst, gecappt auf z. B. 100) |

**Auth-Scoping (wichtig):** Jede `:id`-Route filtert explizit über
`starters.user_id = req.user.userId` — nie nur über die `starter_id` aus dem
Pfad oder über `starter_feedings.starter_id` allein. Konkret:

```sql
-- Beispiel: Feedings einer Starter-ID abrufen
SELECT sf.* FROM starter_feedings sf
JOIN starters s ON s.id = sf.starter_id
WHERE sf.starter_id = $1 AND s.user_id = $2
ORDER BY sf.fed_at DESC LIMIT 100;
```

Ohne den `s.user_id = $2`-Filter könnte ein User durch Erraten/Durchprobieren
fremder Starter-IDs deren Fütterungen sehen — dieser Join-Filter ist Pflicht
auf jeder Route, die eine `:id` entgegennimmt.

**Batching für die Liste (kein N+1):** `GET /api/starters` holt zuerst alle
Starter des Users (bereits user-scoped), dann in einer zweiten Query die
letzten 20 Fütterungen je Starter für genau diese ID-Menge (z. B. via
`ROW_NUMBER() OVER (PARTITION BY starter_id ORDER BY fed_at DESC)` oder
`LATERAL JOIN`) — dieselbe Fenstergröße wie in Abschnitt 5 für die
PlanModal-Kopplung, damit `calculateHealth`/`calculateFeedingStreak` überall
mit derselben Datenbasis rechnen. Da die ID-Menge bereits aus der
user-gescopten Query stammt, ist kein zusätzlicher Owner-Check auf der
Batch-Query nötig.

## 3. Health-Berechnung

Neue Datei `api/starter-health.js` — reine Funktion, keine DB-Zugriffe,
unabhängig testbar (analog zum Trennungsprinzip von `bake-engine.js`).

```js
function calculateHealth(feedings, targetProfile) {
  const lastFeeding = feedings[0]; // sortiert nach fed_at DESC
  if (!lastFeeding) return { health: 0, status: 'Unbekannt' };

  const hoursSinceLastFeeding = (Date.now() - new Date(lastFeeding.fed_at)) / 3600000;
  const { feeding_interval_hours_max } = targetProfile;

  let health;
  if (hoursSinceLastFeeding <= feeding_interval_hours_max) {
    health = 100;
  } else {
    const overdueHours = hoursSinceLastFeeding - feeding_interval_hours_max;
    health = Math.max(0, 100 - (overdueHours / feeding_interval_hours_max) * 100);
  }

  const streak = calculateFeedingStreak(feedings, targetProfile);
  health = Math.min(100, health + Math.min(streak * 2, 10));

  if (lastFeeding.activity_rating && lastFeeding.activity_rating <= 3) {
    health -= 15;
  }

  health = Math.max(0, Math.round(health));
  return { health, status: statusLabel(health) };
}

function statusLabel(health) {
  if (health >= 90) return 'Topfit 🌟';
  if (health >= 60) return 'Gut';
  if (health >= 30) return 'Schwächelt';
  return 'Kritisch';
}

function calculateFeedingStreak(feedings, targetProfile) {
  let streak = 0;
  for (let i = 0; i < feedings.length - 1; i++) {
    const gapHours = (new Date(feedings[i].fed_at) - new Date(feedings[i + 1].fed_at)) / 3600000;
    if (gapHours <= targetProfile.feeding_interval_hours_max) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

module.exports = { calculateHealth };
```

## 4. Notification-Integration

Erweiterung von `api/notification-engine.js` um Trigger-Typ
**`starter-feeding-due`**. Läuft — anders als im ursprünglichen Entwurf mit
eigenem Sende-Pfad — **innerhalb des bestehenden `notificationSweep()`** in
`api/index.js` (gleicher 60s-Tick wie die Bake-Session-Auswertung), und nutzt
die bestehende `dispatch()`-Funktion aus `notification-engine.js` für den
atomaren Dedup-Insert + Versand, statt einen eigenen Sende-Pfad zu bauen.

**Settings-Verhalten:** respektiert `master_enabled` und Quiet Hours wie jeder
andere Trigger — aber ohne eigenen Feature-Toggle, analog zu `overdue`. Kein
Ping um 3 Uhr nachts, kein Versand wenn Notifications global deaktiviert sind.

```js
// Settings sind pro User unterschiedlich (Quiet Hours etc.) — der Check muss
// also pro Starter (bzw. dessen user_id) laufen, nicht einmal global vorab.
async function checkStarterFeedingDue(pool) {
  const { rows: starters } = await pool.query(`
    SELECT s.id, s.user_id, s.name, tp.feeding_interval_hours_max
    FROM starters s
    JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
    WHERE s.archived_at IS NULL
  `);

  for (const starter of starters) {
    const settings = await getSettings(pool, starter.user_id);
    if (!settings.master_enabled || isInQuietHours(settings)) continue;

    const { rows: feedings } = await pool.query(
      `SELECT fed_at FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 1`,
      [starter.id]
    );
    const lastFeeding = feedings[0];
    const hoursSince = lastFeeding
      ? (Date.now() - new Date(lastFeeding.fed_at)) / 3600000
      : Infinity;

    if (hoursSince <= starter.feeding_interval_hours_max) continue;

    const dedupKey = `st-${starter.id}-feedingdue-${new Date().toISOString().slice(0, 10)}`;
    await dispatch(pool, starter.user_id, null, {
      notificationId: dedupKey,
      type: 'starter-feeding-due',
      title: '🫙 Sauerteig füttern',
      message: `${starter.name} wartet auf Fütterung (${Math.round(hoursSince)}h seit letzter Fütterung).`,
      priority: 4,
      tags: 'sourdough',
    });
  }
}
```

**Warum das dedup-Muster ausreicht:** Die Fälligkeits-Bedingung
(`hoursSince > feeding_interval_hours_max`) ist monoton — einmal wahr, bleibt
sie wahr bis zur nächsten Fütterung. Der auf das Kalenderdatum
tagesgenaue Dedup-Key (`st-{id}-feedingdue-{datum}`) kombiniert mit dem
bestehenden `UNIQUE (user_id, notification_id)`-Constraint auf
`sent_notifications` garantiert dadurch automatisch genau eine Benachrichtigung
pro Starter und Tag, unabhängig davon wie oft der 60s-Sweep in diesem Zeitraum
läuft — ohne zusätzlichen State. Ein Datumswechsel während andauernder
Überfälligkeit erzeugt bewusst einen neuen Key (= neue Erinnerung für den
neuen Tag), was der dokumentierten Absicht "max. eine Erinnerung pro Starter
und Tag" entspricht.

`session_id` bei `dispatch()` ist hier `null`, da Starter nicht an eine
`bake_sessions`-Zeile gebunden sind — das ist zulässig, `sent_notifications.session_id`
ist bereits nullable.

## 5. Kopplung an Backplan (Teil des MVP)

`POST /api/bake-sessions` akzeptiert optional `starter_id` im Body. Falls
gesetzt:

```js
try {
  const starterRes = await pool.query(
    `SELECT s.*, tp.* FROM starters s
     JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
     WHERE s.id = $1 AND s.user_id = $2`,
    [starter_id, req.user.userId]
  );
  if (starterRes.rows.length > 0) {
    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [starter_id]
    );
    const { health, status } = calculateHealth(feedingsRes.rows, starterRes.rows[0]);
    if (health < 60) {
      response.starterWarning = {
        starterId: starter_id,
        message: `Dein Starter "${starterRes.rows[0].name}" ist aktuell "${status}". Eventuell vorher füttern.`,
      };
    }
  }
} catch (err) {
  console.error('⚠️ Starter-Health-Check Fehler (nicht kritisch):', err.message);
  // starterWarning bleibt einfach weg — Bake-Session-Erstellung wird NICHT blockiert
}
```

Fehlschläge hier (Starter nicht gefunden, gehört anderem User, Query-Fehler)
dürfen die Bake-Session-Erstellung nie blockieren oder zu einem 500 führen —
best-effort Zusatzinfo, kein kritischer Pfad.

Frontend zeigt `starterWarning` als nicht-blockierenden Hinweis-Banner in
`PlanModal` an — kein neuer Gate-Typ, keine Änderung an der State-Machine.

## 6. Frontend

Zwei neue Routen (keine Modals — dedizierte Routen für Deep-Links/Bookmarks
und mehr Platz für die Fütterungshistorie):

- **`ui/src/app/starters/page.tsx`** — Liste aller Starter als Cards: Name,
  Mehlsorte-Badge, Health-Fortschrittsbalken (farblich gestuft
  grün/gelb/orange/rot analog zu den vier Status-Stufen) + Status-Label, Zeit
  seit letzter Fütterung. "Neuer Starter"-FAB analog zum bestehenden
  Speichern-FAB. Mockup approved (siehe unten).
- **`ui/src/app/starters/[id]/page.tsx`** — Detailseite analog zu
  `recipes/[id]/page.tsx`: Fütterungsformular (Mehl/Wasser/Discard in Gramm,
  Temperatur, Aktivität 1–10 Slider, Notizen), Health-Anzeige, chronologische
  Fütterungshistorie.

Beide neuen Interaktionen (Neuer-Starter-Formular, Fütterung protokollieren)
implementieren **genau einen Flow**: direkter API-Call (`POST /api/starters`
bzw. `POST /api/starters/:id/feedings`), danach lokalen State aktualisieren.
Kein `onConfirm`-Passthrough-Prop nach dem Vorbild von `PlanModal`s
`handleConfirm` — jener Zweig (Parent übernimmt Submit vs. Modal submitted
selbst) ist in `PlanModal` mittlerweile toter Code, den kein aktueller Call-Site
mehr nutzt, weil das Mischen beider Flows früher zu einem Bug geführt hat, der
in `recipes/[id]/page.tsx` explizit gefixt wurde ("Kein onConfirm-Prop:
PlanModal übernimmt den Submit selbst"). Die neuen Starter-Komponenten
wiederholen dieses Muster nicht.

Verwendet die bestehende Cremeton-Palette (`#F5F0E8`/`#EDE5D6`/`#8B7355`/
`#2C1A0E`/`#C4A484`) und Dark-Mode-Konventionen aus `DESIGN.md` — kein neues
Design-System. Alle UI-Texte auf Deutsch.

**Mockup:** Interaktives Listen-Mockup wurde vor der Implementierung erstellt
und abgenommen (Cards mit Health-Balken, Badge, FAB — s.
`.superpowers/brainstorm/` Session vom 2026-07-06).

## Offene Nicht-Themen (bewusst außerhalb Scope)

- Foto-Analyse/Bilderkennung des Starters
- 7-Tage-Ansetz-Anleitung
- Auswahl-UI für Zielprofile über ein simples Dropdown hinaus
- Chat/Coach-Feature
