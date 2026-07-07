# Sauerteig-Starter-Tracker — Implementierungsplan

Spec: `docs/superpowers/specs/2026-07-06-starter-tracker-design.md`

## Goal

CRUD-Fütterungsprotokoll für Sauerteig-Starter mit berechneter Health-Anzeige,
täglichen Fütterungs-Erinnerungen (bestehender Notification-Sweep) und
optionaler, nicht-blockierender Kopplung an neu erstellte Bake-Sessions.

## Architecture

- **Backend**: neues, eigenständiges Modul `api/starters.js` (Express-Router,
  `setPool(p)`-Injection wie `push.js`/`bake-sessions.js`), gemountet unter
  `/api/starters`. Health-Berechnung liegt als reine, DB-freie Funktion in
  `api/starter-health.js` (analog zum Trennungsprinzip von `bake-engine.js`).
  Zielprofile sind eine Single-Source-of-Truth in `api/starter-profiles.js`,
  aus der sowohl die DB-Seed-Zeilen als auch die API-Validierung schöpfen.
  Migrationen sind idempotente Blöcke in `initDB()` (`api/index.js`), wie im
  gesamten Projekt üblich — kein separates Migrationsscript.
- **Notifications**: neuer Trigger-Typ `starter-feeding-due` als Funktion
  `checkStarterFeedingDue(pool)` in `api/notification-engine.js`, aufgerufen
  aus dem bestehenden `notificationSweep()` in `api/index.js` (gleicher
  60s-Tick), nutzt die bestehende `dispatch()`-Funktion für Dedup + Versand.
  Kein neuer Sende-Pfad.
- **Backplan-Kopplung**: `POST /api/bake-sessions` akzeptiert optional
  `starter_id`; bei niedriger Health wird `starterWarning` best-effort in die
  Response gehängt (Fehler hier dürfen die Session-Erstellung nie blockieren).
- **Frontend**: zwei neue Routen (`/starters`, `/starters/[id]`), Kitchen-Notebook-
  Cremeton-Palette aus `DESIGN.md` (`#F5F0E8`/`#EDE5D6`/`#8B7355`/`#2C1A0E`/
  `#C4A484`), kein neues Design-System. `apiFetch` (`ui/src/lib/api.ts`) für
  alle neuen Starter-Tracker-Komponenten. `PlanModal.tsx` bekommt einen
  optionalen Starter-Dropdown + nicht-blockierenden Warnbanner, behält aber
  seinen bestehenden Raw-`fetch`-Stil bei (Konsistenz innerhalb der Datei statt
  Mischen von Fetch-Patterns).

**Bewusste Abweichungen/Ergänzungen gegenüber der Spec (kurz begründet):**

1. **Zusätzlicher Endpunkt `GET /api/starters/profiles`** (nicht in der
   Spec-Tabelle mit 8 Endpunkten gezählt): liefert die `TARGET_PROFILES`-Metadaten
   (Label, Ratio, Temperatur) aus `api/starter-profiles.js` ohne DB-Query. Ohne
   ihn hätte das Frontend keine Quelle für die Zielprofil-Labels im Dropdown,
   ohne sie im Frontend zu duplizieren (Single-Source-of-Truth-Prinzip der Spec
   würde sonst verletzt). Muss in `starters.js` **vor** `GET /:id` registriert
   werden, sonst matcht Express `profiles` als `:id`.
2. **„Neuer Starter"-Formular als Modal**, nicht als dritte Route: Die Spec
   schreibt „2 neue Frontend-Routen (keine Modals)" explizit für Liste/Detail
   vor — die Begründung dort ist Deep-Link-Fähigkeit und Platz für die
   Fütterungshistorie, was auf ein simples 4-Felder-Anlage-Formular nicht
   zutrifft. Modal ist hier die schlankere, im Scope befindliche Lösung. Genau
   ein Flow (direkter POST, kein `onConfirm`-Passthrough) — siehe
   [[feedback_no-dual-flow-modals]].
3. **Nav-Eintrag in `Navigation.tsx`**: Spec erwähnt keine Navigation, aber die
   2 neuen Routen brauchen einen Einstiegspunkt. Neuer Eintrag „Starter" mit
   `Sprout`-Icon (lucide-react) in `navItems`.

## Tech Stack

- Backend: Node.js (v26 lokal), Express, `pg`. Keine Test-Bibliothek bisher
  installiert (`api/package.json` hat nur einen Platzhalter-Test-Script,
  keine `devDependencies`). Für die neue reine Funktion `starter-health.js`
  wird Node's eingebauter Test-Runner (`node:test` + `node:assert/strict`)
  verwendet — keine neue Dependency nötig, per `node --test`. Für Routen/DB-Code
  gibt es im gesamten Projekt keine automatisierten Tests (Konvention:
  manuelle Verifikation per curl/Dev-Server) — dieser Plan folgt dieser
  bestehenden Konvention statt Test-Infrastruktur nur für dieses Feature neu
  zu erfinden.
- Frontend: Next.js (App Router), React, TypeScript, Tailwind, lucide-react.
  Kein Test-Runner im `ui/`-Package vorhanden — Verifikation manuell im
  Dev-Server (`npm run dev`).

## Global Constraints

- Jede `:id`-Route in `starters.js` MUSS über `starters.user_id = req.user.userId`
  scopen (Join oder WHERE), nie nur über die Pfad-ID.
- `target_profile` wird bei POST/PATCH gegen `TARGET_PROFILE_KEYS` aus
  `api/starter-profiles.js` validiert (400 bei ungültigem Wert).
- `starterWarning`-Berechnung in `bake-sessions.js` läuft in einem eigenen
  try/catch; Fehler dort loggen nur und blockieren nie die Session-Erstellung.
- Alle neuen UI-Texte auf Deutsch.
- Alle Migrationen sind `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
  — idempotent, mehrfach ausführbar.

---

## Task 1: `api/starter-profiles.js` — Zielprofile Single Source of Truth

**Files:** `api/starter-profiles.js` (neu)

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

**Steps:**
1. Create the file with the exact content above.
2. Verify: `node -e "console.log(require('./api/starter-profiles.js').TARGET_PROFILE_KEYS)"` from repo root prints the 5 keys.
3. Commit: `feat(starters): add target profile definitions`

---

## Task 2: `api/starter-health.js` — Health-Berechnung (TDD)

**Files:** `api/starter-health.js` (neu), `api/starter-health.test.js` (neu),
`api/package.json` (modify: test script)

### Step 2.1 — Failing test first

Write `api/starter-health.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateHealth } = require('./starter-health');

const PROFILE = { feeding_interval_hours_max: 24 };

test('no feedings -> health 0, status Unbekannt', () => {
  const result = calculateHealth([], PROFILE);
  assert.equal(result.health, 0);
  assert.equal(result.status, 'Unbekannt');
});

test('fed just now -> health 100, status Topfit', () => {
  const feedings = [{ fed_at: new Date().toISOString() }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 100);
  assert.equal(result.status, 'Topfit 🌟');
});

test('overdue by more than the interval -> health decays below 60', () => {
  const overdue = new Date(Date.now() - 48 * 3600000).toISOString(); // 24h over on a 24h-max profile
  const feedings = [{ fed_at: overdue }];
  const result = calculateHealth(feedings, PROFILE);
  assert.ok(result.health < 60, `expected < 60, got ${result.health}`);
});

test('very overdue -> health floors at 0, status Kritisch', () => {
  const veryOverdue = new Date(Date.now() - 24 * 30 * 3600000).toISOString();
  const feedings = [{ fed_at: veryOverdue }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 0);
  assert.equal(result.status, 'Kritisch');
});

test('consecutive on-time feedings build a streak bonus (capped at +10)', () => {
  const now = Date.now();
  // 5 feedings each 12h apart, well within the 24h-max profile -> streak bonus should apply
  const feedings = [0, 1, 2, 3, 4].map(i => ({ fed_at: new Date(now - i * 12 * 3600000).toISOString() }));
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 100); // already capped at 100 (base 100 + bonus, clamped)
});

test('low activity_rating on last feeding penalizes health by 15', () => {
  const feedings = [{ fed_at: new Date().toISOString(), activity_rating: 2 }];
  const result = calculateHealth(feedings, PROFILE);
  assert.equal(result.health, 85); // 100 - 15
});
```

2. Update `api/package.json` `scripts.test` from the placeholder to:
   ```json
   "test": "node --test"
   ```
3. Run test to verify it fails (module doesn't exist yet):
   `cd api && npm test` → expect a `MODULE_NOT_FOUND` error for `./starter-health`.

### Step 2.2 — Implement to pass

Create `api/starter-health.js`:

```js
// api/starter-health.js
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

module.exports = { calculateHealth, statusLabel, calculateFeedingStreak };
```

**Steps:**
1. Create the file with the exact content above.
2. Run test to verify it passes: `cd api && npm test` → all 6 tests green.
3. Commit: `feat(starters): add pure health calculation with tests`

---

## Task 3: DB-Migrationen in `api/index.js`

**Files:** `api/index.js` (modify `initDB()`)

Insert the following block into `initDB()`, right after the existing
`user_notification_settings` `CREATE TABLE` query and its closing `);`);`,
and before `console.log('✅ Datenbank bereit');` (this is inside the same
`try` block as all other migrations, so it shares the existing retry loop):

```js
      // ── Starter Tracker: starters, Fütterungen, Zielprofile ─────
      await pool.query(`CREATE TABLE IF NOT EXISTS starters (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        flour_type VARCHAR(50) NOT NULL,
        hydration_percent INTEGER NOT NULL DEFAULT 100,
        target_profile VARCHAR(50) NOT NULL DEFAULT 'ausgeglichen',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        archived_at TIMESTAMP
      );`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_starters_user ON starters(user_id) WHERE archived_at IS NULL;`);

      await pool.query(`CREATE TABLE IF NOT EXISTS starter_feedings (
        id SERIAL PRIMARY KEY,
        starter_id INTEGER NOT NULL REFERENCES starters(id) ON DELETE CASCADE,
        flour_grams INTEGER NOT NULL,
        water_grams INTEGER NOT NULL,
        discard_grams INTEGER,
        temperature_celsius NUMERIC(4,1),
        activity_rating INTEGER CHECK (activity_rating BETWEEN 1 AND 10),
        notes TEXT,
        fed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_starter_feedings_starter ON starter_feedings(starter_id, fed_at DESC);`);

      await pool.query(`CREATE TABLE IF NOT EXISTS starter_target_profiles (
        profile_key VARCHAR(50) PRIMARY KEY,
        label_de VARCHAR(100) NOT NULL,
        feeding_interval_hours_min INTEGER NOT NULL,
        feeding_interval_hours_max INTEGER NOT NULL,
        ratio_starter_flour_water VARCHAR(20) NOT NULL,
        target_temp_min NUMERIC(4,1),
        target_temp_max NUMERIC(4,1)
      );`);
      for (const p of TARGET_PROFILES) {
        await pool.query(
          `INSERT INTO starter_target_profiles
             (profile_key, label_de, feeding_interval_hours_min, feeding_interval_hours_max, ratio_starter_flour_water, target_temp_min, target_temp_max)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (profile_key) DO NOTHING`,
          [p.profile_key, p.label_de, p.feeding_interval_hours_min, p.feeding_interval_hours_max, p.ratio_starter_flour_water, p.target_temp_min, p.target_temp_max]
        );
      }

      await pool.query(`ALTER TABLE bake_sessions ADD COLUMN IF NOT EXISTS starter_id INTEGER REFERENCES starters(id);`);
```

Also add the import at the top of `api/index.js`, alongside the other
`require`s (after line 19, `const { evaluateAndDispatch, ... } = require('./notification-engine');`):

```js
const { TARGET_PROFILES } = require('./starter-profiles');
```

**Steps:**
1. Add the `require('./starter-profiles')` import.
2. Add the migration block inside `initDB()` at the location described above.
3. Verify: restart the API (`cd api && npm start` or however it's normally run
   locally), confirm the log line `✅ Datenbank bereit` appears with no errors,
   then check the tables exist: `psql $DATABASE_URL -c "\d starters"`,
   `\d starter_feedings`, `\d starter_target_profiles`, and
   `psql $DATABASE_URL -c "SELECT profile_key FROM starter_target_profiles;"`
   should list all 5 keys. Also confirm `\d bake_sessions` now shows a
   `starter_id` column.
4. Restart the API a second time and confirm no errors (idempotency check).
5. Commit: `feat(starters): add DB schema for starters, feedings, target profiles`

---

## Task 4: `api/starters.js` — Router-Skeleton + Liste + Anlegen

**Files:** `api/starters.js` (neu), `api/index.js` (modify: require + setPool + mount)

Create `api/starters.js`:

```js
// api/starters.js
// ============================================================
// STARTERS API — Sauerteig-Starter-Tracker
// ============================================================
const express = require('express');
const router = express.Router();

const { calculateHealth } = require('./starter-health');
const { TARGET_PROFILES, TARGET_PROFILE_KEYS } = require('./starter-profiles');

let pool;
function setPool(p) { pool = p; }

const FLOUR_TYPES = ['weizen', 'roggen', 'dinkel', 'vollkorn'];

// ── GET /api/starters/profiles — Zielprofil-Metadaten (statisch) ──
// Muss VOR /:id registriert werden, sonst matcht Express "profiles" als :id.
router.get('/profiles', (req, res) => {
  res.json(TARGET_PROFILES);
});

// ── GET /api/starters — Liste (ohne archivierte), Health inline ───
router.get('/', async (req, res) => {
  try {
    const startersRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max, tp.label_de AS target_profile_label
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.user_id = $1 AND s.archived_at IS NULL
       ORDER BY s.created_at DESC`,
      [req.user.userId]
    );
    const starters = startersRes.rows;
    if (starters.length === 0) return res.json([]);

    const ids = starters.map(s => s.id);
    const feedingsRes = await pool.query(
      `SELECT * FROM (
         SELECT sf.*, ROW_NUMBER() OVER (PARTITION BY sf.starter_id ORDER BY sf.fed_at DESC) AS rn
         FROM starter_feedings sf
         WHERE sf.starter_id = ANY($1::int[])
       ) ranked WHERE rn <= 20`,
      [ids]
    );
    const feedingsByStarterId = new Map();
    for (const f of feedingsRes.rows) {
      if (!feedingsByStarterId.has(f.starter_id)) feedingsByStarterId.set(f.starter_id, []);
      feedingsByStarterId.get(f.starter_id).push(f);
    }

    const result = starters.map(s => {
      const feedings = feedingsByStarterId.get(s.id) || [];
      const { health, status } = calculateHealth(feedings, s);
      return {
        id: s.id,
        name: s.name,
        flour_type: s.flour_type,
        hydration_percent: s.hydration_percent,
        target_profile: s.target_profile,
        target_profile_label: s.target_profile_label,
        created_at: s.created_at,
        last_fed_at: feedings[0]?.fed_at || null,
        health,
        status,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('❌ starters list Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/starters — Neuen Starter anlegen ────────────────────
router.post('/', async (req, res) => {
  const { name, flour_type, hydration_percent, target_profile } = req.body;
  if (!name || !flour_type) {
    return res.status(400).json({ error: 'name und flour_type erforderlich' });
  }
  if (!FLOUR_TYPES.includes(flour_type)) {
    return res.status(400).json({ error: `flour_type muss einer von ${FLOUR_TYPES.join(', ')} sein` });
  }
  const profile = target_profile || 'ausgeglichen';
  if (!TARGET_PROFILE_KEYS.includes(profile)) {
    return res.status(400).json({ error: `target_profile muss einer von ${TARGET_PROFILE_KEYS.join(', ')} sein` });
  }
  const hydration = Number.isFinite(parseInt(hydration_percent, 10)) ? parseInt(hydration_percent, 10) : 100;

  try {
    const result = await pool.query(
      `INSERT INTO starters (user_id, name, flour_type, hydration_percent, target_profile)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.userId, name, flour_type, hydration, profile]
    );
    res.status(201).json({ ...result.rows[0], health: 0, status: 'Unbekannt' });
  } catch (err) {
    console.error('❌ starter create Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
```

Wire it into `api/index.js`:

1. Add to the requires block (after the `notification-engine` require, before
   the `TARGET_PROFILES` import added in Task 3):
   ```js
   const { router: startersRouter, setPool: setStartersPool } = require('./starters');
   ```
2. Add next to the other `setXPool(pool)` calls (after `setNotificationSettingsPool(pool);`):
   ```js
   setStartersPool(pool);
   ```
3. Add next to the other router mounts (after `app.use('/api/notification-settings', notificationSettingsRouter);`):
   ```js
   // ── Starters Router ──
   app.use('/api/starters', startersRouter);
   ```

**Steps:**
1. Create `api/starters.js` with the content above.
2. Wire requires/setPool/mount into `api/index.js` as described.
3. Restart the API. Verify manually:
   - `curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/starters/profiles` → 5 profile objects.
   - `curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/starters` → `[]` for a fresh user.
   - `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Anton","flour_type":"roggen"}' localhost:5000/api/starters` → 201 with the new starter, `health: 0`, `status: "Unbekannt"`.
   - `curl -H "Authorization: Bearer $TOKEN" localhost:5000/api/starters` → now lists "Anton" with `health: 0`.
4. Commit: `feat(starters): add list and create endpoints`

---

## Task 5: `api/starters.js` — Detail, Bearbeiten, Löschen, Health

**Files:** `api/starters.js` (modify: add routes)

Insert these routes after the `POST /` handler and before `module.exports`:

```js
// ── GET /api/starters/:id — Einzelner Starter inkl. letzter Fütterungen ──
router.get('/:id', async (req, res) => {
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max, tp.label_de AS target_profile_label
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const starter = starterRes.rows[0];
    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [starter.id]
    );
    const { health, status } = calculateHealth(feedingsRes.rows, starter);
    res.json({ ...starter, health, status, feedings: feedingsRes.rows });
  } catch (err) {
    console.error('❌ starter detail Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/starters/:id — Bearbeiten ──────────────────────────
router.patch('/:id', async (req, res) => {
  const { name, flour_type, hydration_percent, target_profile } = req.body;
  if (flour_type !== undefined && !FLOUR_TYPES.includes(flour_type)) {
    return res.status(400).json({ error: `flour_type muss einer von ${FLOUR_TYPES.join(', ')} sein` });
  }
  if (target_profile !== undefined && !TARGET_PROFILE_KEYS.includes(target_profile)) {
    return res.status(400).json({ error: `target_profile muss einer von ${TARGET_PROFILE_KEYS.join(', ')} sein` });
  }
  try {
    const result = await pool.query(
      `UPDATE starters SET
         name = COALESCE($1, name),
         flour_type = COALESCE($2, flour_type),
         hydration_percent = COALESCE($3, hydration_percent),
         target_profile = COALESCE($4, target_profile)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [name ?? null, flour_type ?? null, hydration_percent ?? null, target_profile ?? null, req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ starter update Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/starters/:id — Soft-Delete ────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE starters SET archived_at = NOW() WHERE id = $1 AND user_id = $2 AND archived_at IS NULL RETURNING id`,
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ starter delete Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/starters/:id/health — Health separat ─────────────────
router.get('/:id/health', async (req, res) => {
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(calculateHealth(feedingsRes.rows, starterRes.rows[0]));
  } catch (err) {
    console.error('❌ starter health Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Steps:**
1. Insert the four route handlers above into `api/starters.js`.
2. Verify manually (using the `id` returned from Task 4's create call):
   - `GET /api/starters/:id` → starter with `feedings: []`, `health: 0`.
   - `PATCH /api/starters/:id` with `{"target_profile":"powerkur"}` → updated row.
   - `GET /api/starters/:id/health` → `{ health: 0, status: 'Unbekannt' }`.
   - `DELETE /api/starters/:id` → `{ ok: true }`, then `GET /api/starters` no longer lists it, but `GET /api/starters/:id` still 404s (soft-deleted, not owner-visible in list).
   - `curl` the same `:id` routes with a **different user's token** → all must 404, confirming the `user_id` join-filter works (IDOR check).
3. Commit: `feat(starters): add detail, update, delete, and health endpoints`

---

## Task 6: `api/starters.js` — Fütterungen protokollieren + Historie

**Files:** `api/starters.js` (modify: add routes)

Insert before `module.exports`:

```js
// ── POST /api/starters/:id/feedings — Fütterung protokollieren ───
router.post('/:id/feedings', async (req, res) => {
  const { flour_grams, water_grams, discard_grams, temperature_celsius, activity_rating, notes, fed_at } = req.body;
  if (!Number.isFinite(Number(flour_grams)) || !Number.isFinite(Number(water_grams))) {
    return res.status(400).json({ error: 'flour_grams und water_grams erforderlich' });
  }
  try {
    const starterRes = await pool.query(
      `SELECT s.*, tp.feeding_interval_hours_max
       FROM starters s
       JOIN starter_target_profiles tp ON tp.profile_key = s.target_profile
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (starterRes.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const starter = starterRes.rows[0];

    const insertRes = await pool.query(
      `INSERT INTO starter_feedings
         (starter_id, flour_grams, water_grams, discard_grams, temperature_celsius, activity_rating, notes, fed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
       RETURNING *`,
      [
        starter.id,
        Number(flour_grams),
        Number(water_grams),
        discard_grams != null ? Number(discard_grams) : null,
        temperature_celsius != null ? Number(temperature_celsius) : null,
        activity_rating != null ? Number(activity_rating) : null,
        notes || null,
        fed_at || null,
      ]
    );

    const feedingsRes = await pool.query(
      `SELECT * FROM starter_feedings WHERE starter_id = $1 ORDER BY fed_at DESC LIMIT 20`,
      [starter.id]
    );
    const { health, status } = calculateHealth(feedingsRes.rows, starter);
    res.status(201).json({ feeding: insertRes.rows[0], health, status });
  } catch (err) {
    console.error('❌ feeding create Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/starters/:id/feedings — Historie (neueste zuerst) ───
router.get('/:id/feedings', async (req, res) => {
  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM starters WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Starter nicht gefunden' });
    }
    const result = await pool.query(
      `SELECT sf.* FROM starter_feedings sf
       JOIN starters s ON s.id = sf.starter_id
       WHERE sf.starter_id = $1 AND s.user_id = $2
       ORDER BY sf.fed_at DESC LIMIT 100`,
      [req.params.id, req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ feedings history Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Steps:**
1. Insert both route handlers above into `api/starters.js`.
2. Verify manually:
   - `POST /api/starters/:id/feedings` with `{"flour_grams":50,"water_grams":50,"activity_rating":8}` → 201 with `feeding` + `health: 100` + `status: "Topfit 🌟"`.
   - `GET /api/starters/:id/feedings` → array containing that feeding.
   - `GET /api/starters` → the starter's `health`/`last_fed_at` now reflect the new feeding.
   - Repeat the owner-mismatch check from Task 5 for both new routes (different user's token → 404).
3. Commit: `feat(starters): add feeding log and history endpoints`

---

## Task 7: Notification-Trigger `starter-feeding-due`

**Files:** `api/notification-engine.js` (modify: add + export function),
`api/index.js` (modify: import + call inside `notificationSweep`)

Add to `api/notification-engine.js` (near the other trigger-check functions,
before the final `module.exports`):

```js
// ── checkStarterFeedingDue ────────────────────────────────────────
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

Add `checkStarterFeedingDue` to the module's `module.exports` object, and add
`const { getSettings, isInQuietHours } = require('./notification-settings');`
to `notification-engine.js`'s requires (confirm no circular-require issue:
`notification-settings.js` does not require `notification-engine.js`, so this
is safe).

Wire into `api/index.js`:
1. Update the existing require line (line 19) to also import
   `checkStarterFeedingDue`:
   ```js
   const { evaluateAndDispatch, cleanupOldNotifications, initWebPush, checkStarterFeedingDue } = require('./notification-engine');
   ```
2. Inside `notificationSweep()`, add the call right after the `for (const session of result.rows) { ... }` loop closes and before the function's own `catch`:
   ```js
        // Notifications auswerten und versenden (idempotent, DB-Dedup)
        await evaluateAndDispatch(pool, { ...session, step_states: updatedStates }, sections);
      }

      // Sauerteig-Fütterungs-Check (unabhängig von Bake-Sessions)
      await checkStarterFeedingDue(pool);
    } catch (err) {
      console.error('❌ Notification-Sweep Fehler:', err.message);
    }
   ```

**Steps:**
1. Add `checkStarterFeedingDue` to `api/notification-engine.js` and export it.
2. Add the `getSettings`/`isInQuietHours` require to `notification-engine.js`.
3. Update the import and insert the call in `notificationSweep()` in `api/index.js`.
4. Verify manually: create a starter, manually backdate its only feeding via
   `psql`: `UPDATE starter_feedings SET fed_at = NOW() - INTERVAL '30 hours' WHERE starter_id = <id>;`
   (assuming an `ausgeglichen` profile with a 24h max). Restart the API (sweep
   runs once at boot) and confirm in the server log / `sent_notifications`
   table (`SELECT * FROM sent_notifications WHERE notification_id LIKE 'st-%';`)
   that exactly one row was inserted. Run the sweep again (wait 60s or restart)
   and confirm no duplicate row appears for the same day.
5. Commit: `feat(starters): add feeding-due notification trigger`

---

## Task 8: `bake-sessions.js` — Starter-Kopplung

**Files:** `api/bake-sessions.js` (modify: `POST /` handler)

1. Add the import at the top of the file:
   ```js
   const { calculateHealth } = require('./starter-health');
   ```
2. Destructure `starter_id` from the body:
   ```js
   const { recipe_id, planned_at, multiplier, starter_id } = req.body;
   ```
3. Add `starter_id` to the INSERT (nullable column, so passing `starter_id || null` is safe even when absent):
   ```js
     const result = await pool.query(
       `INSERT INTO bake_sessions 
        (recipe_id, user_id, planned_at, started_at, multiplier, step_states, step_timestamps, projected_end, starter_id)
        VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8) RETURNING *`,
       [
         recipe_id,
         req.user.userId,
         planned_at,
         multiplier || 1,
         JSON.stringify(states),
         JSON.stringify(timestamps),
         projectedEnd,
         starter_id || null,
       ]
     );
   ```
4. Right after the `session`, `gates`, `timeline` variables are computed (i.e.
   right before `res.status(201).json({...})`), add the best-effort warning
   block:
   ```js
     const session = result.rows[0];
     const gates = getPendingGates(sections, states);
     const timeline = buildUITimeline(sections, states, timestamps, planned_at);

     const response = {
       session,
       timeline,
       gates,
       recipe: { id: recipe.id, title: recipe.title, image_url: recipe.image_url, dough_sections: sections },
     };

     if (starter_id) {
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
       }
     }

     res.status(201).json(response);
   ```
   (This replaces the existing `res.status(201).json({ session, timeline, gates, recipe: {...} });` line.)

**Steps:**
1. Apply the four changes above to `api/bake-sessions.js`.
2. Verify manually:
   - Create a bake session **without** `starter_id` → response unchanged, no `starterWarning` key, `bake_sessions.starter_id` is `NULL` in the DB.
   - Create a starter with health below 60 (e.g. backdate its feeding as in
     Task 7's verification), then `POST /api/bake-sessions` with that
     `starter_id` → response includes `starterWarning.message` mentioning the
     starter's name and status; `bake_sessions.starter_id` is set correctly.
   - Create a bake session with a `starter_id` belonging to **another user**
     → session is created successfully (not blocked), no `starterWarning` in
     the response (best-effort lookup finds nothing owned by this user).
3. Commit: `feat(bake-sessions): couple optional starter with health warning`

---

## Task 9: `ui/src/lib/starter-health.ts` — Frontend Health-Helper

**Files:** `ui/src/lib/starter-health.ts` (neu)

```ts
// ui/src/lib/starter-health.ts
export function healthColor(health: number): string {
  if (health >= 90) return '#4ADE80';
  if (health >= 60) return '#F2C94C';
  if (health >= 30) return '#F5A360';
  return '#F85149';
}

export function healthStatusFromScore(health: number): string {
  if (health >= 90) return 'Topfit 🌟';
  if (health >= 60) return 'Gut';
  if (health >= 30) return 'Schwächelt';
  return 'Kritisch';
}

export function timeSinceFeeding(lastFedAt: string | null): string {
  if (!lastFedAt) return 'Noch nie gefüttert';
  const hours = (Date.now() - new Date(lastFedAt).getTime()) / 3600000;
  if (hours < 1) return 'Gerade eben gefüttert';
  if (hours < 24) return `Vor ${Math.round(hours)}h gefüttert`;
  return `Vor ${Math.round(hours / 24)} Tagen gefüttert`;
}
```

**Steps:**
1. Create the file with the exact content above.
2. Verify: run `npx tsc --noEmit` inside `ui/` (or `npm run lint`) and confirm
   no new type errors are introduced by this file.
3. Commit: `feat(starters): add frontend health formatting helpers`

---

## Task 10: `ui/src/components/StarterCard.tsx`

**Files:** `ui/src/components/StarterCard.tsx` (neu)

Modeled on `RecipeCard.tsx`'s shell/stats-bar/button-footer pattern, using the
health bar in place of the third stat slot.

```tsx
"use client";

import Link from 'next/link';
import { Wheat, Clock } from 'lucide-react';
import { healthColor, timeSinceFeeding } from '@/lib/starter-health';

interface Starter {
  id: number;
  name: string;
  flour_type: string;
  target_profile_label: string;
  health: number;
  status: string;
  last_fed_at: string | null;
}

const FLOUR_LABELS: Record<string, string> = {
  weizen: 'Weizen',
  roggen: 'Roggen',
  dinkel: 'Dinkel',
  vollkorn: 'Vollkorn',
};

export default function StarterCard({ starter }: { starter: Starter }) {
  const color = healthColor(starter.health);
  return (
    <Link
      href={`/starters/${starter.id}`}
      className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col relative border border-[#D6C9B4] dark:border-gray-700 p-5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_rgba(92,61,30,0.2)] dark:hover:shadow-[0_10px_30px_-6px_rgba(0,0,0,0.5)] hover:border-[#8B7355]/40 dark:hover:border-gray-600 active:scale-[0.98]"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-black text-[#2C1A0E] dark:text-gray-100 truncate">{starter.name}</h3>
        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border bg-[#EDE5D6] dark:bg-gray-700 text-[#8B7355] dark:text-[#C4A484] border-[#D6C9B4] dark:border-gray-600 whitespace-nowrap flex-shrink-0">
          {FLOUR_LABELS[starter.flour_type] || starter.flour_type}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[#A68B6A] dark:text-gray-500 mb-3">
        <Wheat size={12} />
        <span>{starter.target_profile_label}</span>
      </div>

      <div className="mb-2">
        <div className="h-2 rounded-full bg-[#EDE5D6] dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(4, starter.health)}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[12px] font-bold mb-3">
        <span className="text-[#5C3D1E] dark:text-gray-300">{starter.status}</span>
        <span className="text-[#A68B6A] dark:text-gray-500">{starter.health}%</span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[#A68B6A] dark:text-gray-500 mt-auto pt-2 border-t border-[#EDE5D6] dark:border-gray-700">
        <Clock size={12} />
        <span>{timeSinceFeeding(starter.last_fed_at)}</span>
      </div>
    </Link>
  );
}
```

**Steps:**
1. Create the file with the content above.
2. Verify: `npx tsc --noEmit` in `ui/` shows no new errors.
3. Commit: `feat(starters): add StarterCard component`

---

## Task 11: `ui/src/components/NewStarterModal.tsx`

**Files:** `ui/src/components/NewStarterModal.tsx` (neu)

Single-flow (direct `apiFetch` POST, no `onConfirm` passthrough — see
[[feedback_no-dual-flow-modals]]):

```tsx
"use client";

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Profile {
  profile_key: string;
  label_de: string;
}

interface NewStarterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (starter: any) => void;
}

const FLOUR_OPTIONS = [
  { value: 'weizen', label: 'Weizen' },
  { value: 'roggen', label: 'Roggen' },
  { value: 'dinkel', label: 'Dinkel' },
  { value: 'vollkorn', label: 'Vollkorn' },
];

export default function NewStarterModal({ isOpen, onClose, onCreated }: NewStarterModalProps) {
  const [name, setName] = useState('');
  const [flourType, setFlourType] = useState('weizen');
  const [hydration, setHydration] = useState(100);
  const [targetProfile, setTargetProfile] = useState('ausgeglichen');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setFlourType('weizen'); setHydration(100); setTargetProfile('ausgeglichen'); setError('');
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/profiles`)
      .then(res => res.json())
      .then(data => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters`, {
        method: 'POST',
        body: JSON.stringify({ name, flour_type: flourType, hydration_percent: hydration, target_profile: targetProfile }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Fehler beim Anlegen');
        setIsSubmitting(false);
        return;
      }
      const created = await res.json();
      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-[#2C1A0E] dark:text-gray-100">Neuer Starter</h2>
          <button onClick={onClose} className="text-[#A68B6A] dark:text-gray-500 hover:text-[#5C3D1E] dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z.B. Anton"
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100 outline-none focus:border-[#8B7355]/50"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Mehlsorte</label>
            <select
              value={flourType}
              onChange={e => setFlourType(e.target.value)}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            >
              {FLOUR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Hydration (%)</label>
            <input
              type="number"
              value={hydration}
              onChange={e => setHydration(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Zielprofil</label>
            <select
              value={targetProfile}
              onChange={e => setTargetProfile(e.target.value)}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-[#2C1A0E] dark:text-gray-100"
            >
              {profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.label_de}</option>)}
            </select>
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#8B7355] dark:text-gray-400 border-2 border-[#D6C9B4] dark:border-gray-700">
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#8B7355] text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Wird angelegt…' : 'Anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Steps:**
1. Create the file with the content above.
2. Verify: `npx tsc --noEmit` in `ui/` shows no new errors.
3. Commit: `feat(starters): add new-starter creation modal`

---

## Task 12: `ui/src/app/starters/page.tsx` — Liste

**Files:** `ui/src/app/starters/page.tsx` (neu)

Modeled on `ui/src/app/page.tsx`'s page shell, loading/error/empty states, and
FAB pattern.

```tsx
"use client";

import { useEffect, useState } from 'react';
import { Plus, Sprout, RefreshCw } from 'lucide-react';
import StarterCard from '@/components/StarterCard';
import NewStarterModal from '@/components/NewStarterModal';
import { apiFetch } from '@/lib/api';

export default function StartersPage() {
  const [starters, setStarters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const load = () => {
    setIsLoading(true);
    setLoadError(false);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters`)
      .then(res => res.json())
      .then(data => { setStarters(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => { setLoadError(true); setIsLoading(false); });
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-white transition-colors duration-200">
      <div className="max-w-6xl mx-auto pt-8 pb-20">
        <h1 className="text-2xl font-black mb-6">Meine Starter</h1>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-48 rounded-2xl bg-white/50 dark:bg-gray-800/50 animate-pulse" />)}
          </div>
        ) : loadError ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <RefreshCw className="text-[#D6C9B4] dark:text-gray-600 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Laden fehlgeschlagen</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2 mb-6">Prüfe deine Verbindung und versuch es nochmal.</p>
            <button onClick={load} className="inline-flex items-center gap-2 bg-[#8B7355] text-white px-6 py-3 rounded-2xl font-bold text-sm hover:bg-[#766248] transition-colors">
              <RefreshCw size={16} /> Nochmal versuchen
            </button>
          </div>
        ) : starters.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-[3rem] p-20 text-center border border-[#D6C9B4] dark:border-gray-700">
            <Sprout className="text-[#D6C9B4] dark:text-gray-700 mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-[#2C1A0E] dark:text-gray-100">Noch kein Starter angelegt</h2>
            <p className="text-[#A68B6A] dark:text-gray-500 mt-2">Leg deinen ersten Sauerteig-Starter an, um sein Fütterungsprotokoll zu verfolgen.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {starters.map(s => <StarterCard key={s.id} starter={s} />)}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowNewModal(true)}
        className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-40 bg-[#8B7355] text-white p-5 rounded-2xl shadow-2xl hover:scale-110 active:scale-95 transition-all"
      >
        <Plus size={24} strokeWidth={3} />
      </button>

      <NewStarterModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={() => load()}
      />
    </div>
  );
}
```

**Steps:**
1. Create the file with the content above.
2. Verify: `npx tsc --noEmit` shows no new errors. Then run `cd ui && npm run dev`, log in, and navigate to `/starters` in the browser: confirm the empty state renders, then click the FAB, create a starter via the modal, and confirm it appears as a card with a health bar.
3. Commit: `feat(starters): add starters list page`

---

## Task 13: `ui/src/app/starters/[id]/page.tsx` — Detail + Fütterungsformular

**Files:** `ui/src/app/starters/[id]/page.tsx` (neu)

```tsx
"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Droplets } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { healthColor, timeSinceFeeding } from '@/lib/starter-health';

export default function StarterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [starter, setStarter] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [flourGrams, setFlourGrams] = useState(50);
  const [waterGrams, setWaterGrams] = useState(50);
  const [discardGrams, setDiscardGrams] = useState<number | ''>('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [activityRating, setActivityRating] = useState(7);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setIsLoading(true);
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`)
      .then(res => { if (!res.ok) throw new Error('nicht gefunden'); return res.json(); })
      .then(data => { setStarter(data); setIsLoading(false); })
      .catch(() => { setIsLoading(false); setStarter(null); });
  };

  useEffect(() => { if (id) load(); }, [id]);

  const handleFeed = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}/feedings`, {
        method: 'POST',
        body: JSON.stringify({
          flour_grams: flourGrams,
          water_grams: waterGrams,
          discard_grams: discardGrams === '' ? undefined : discardGrams,
          temperature_celsius: temperature === '' ? undefined : temperature,
          activity_rating: activityRating,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Fehler beim Speichern');
        setIsSubmitting(false);
        return;
      }
      setDiscardGrams(''); setTemperature(''); setNotes('');
      setIsSubmitting(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A]" />;
  }
  if (!starter) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] flex items-center justify-center text-[#2C1A0E] dark:text-white">
        <p>Starter nicht gefunden.</p>
      </div>
    );
  }

  const color = healthColor(starter.health);

  return (
    <div className="min-h-screen bg-[#F5F0E8] dark:bg-[#0F172A] px-6 text-[#2C1A0E] dark:text-white transition-colors duration-200 pb-24">
      <div className="max-w-3xl mx-auto pt-8">
        <Link href="/starters" className="inline-flex items-center gap-2 text-sm text-[#A68B6A] dark:text-gray-400 hover:text-[#5C3D1E] dark:hover:text-gray-200 mb-6">
          <ArrowLeft size={16} /> Zurück
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <h1 className="text-2xl font-black mb-4">{starter.name}</h1>
          <div className="h-3 rounded-full bg-[#EDE5D6] dark:bg-gray-700 overflow-hidden mb-2">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, starter.health)}%`, backgroundColor: color }} />
          </div>
          <div className="flex items-center justify-between text-sm font-bold mb-1">
            <span className="text-[#5C3D1E] dark:text-gray-300">{starter.status}</span>
            <span className="text-[#A68B6A] dark:text-gray-500">{starter.health}%</span>
          </div>
          <p className="text-xs text-[#A68B6A] dark:text-gray-500">{timeSinceFeeding(starter.feedings?.[0]?.fed_at || null)}</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-black mb-4">Fütterung protokollieren</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Mehl (g)</label>
              <input type="number" value={flourGrams} onChange={e => setFlourGrams(Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Wasser (g)</label>
              <input type="number" value={waterGrams} onChange={e => setWaterGrams(Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Verworfen (g, optional)</label>
              <input type="number" value={discardGrams} onChange={e => setDiscardGrams(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400 flex items-center gap-1"><Droplets size={11} /> Temperatur (°C, optional)</label>
              <input type="number" value={temperature} onChange={e => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Aktivität ({activityRating}/10)</label>
            <input type="range" min={1} max={10} value={activityRating} onChange={e => setActivityRating(Number(e.target.value))}
              className="mt-1 w-full accent-[#8B7355]" />
          </div>

          <div className="mb-4">
            <label className="text-xs font-bold text-[#8B7355] dark:text-gray-400">Notizen (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full bg-[#F5F0E8] dark:bg-gray-900 border-2 border-[#D6C9B4] dark:border-gray-700 rounded-xl px-3 py-2 text-sm" />
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</div>}

          <button onClick={handleFeed} disabled={isSubmitting}
            className="w-full py-3 rounded-xl text-sm font-bold bg-[#8B7355] text-white disabled:opacity-50">
            {isSubmitting ? 'Wird gespeichert…' : 'Fütterung speichern'}
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <h2 className="text-lg font-black mb-4">Fütterungshistorie</h2>
          {(!starter.feedings || starter.feedings.length === 0) ? (
            <p className="text-sm text-[#A68B6A] dark:text-gray-500">Noch keine Fütterungen protokolliert.</p>
          ) : (
            <div className="space-y-2">
              {starter.feedings.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between text-sm border-b border-[#EDE5D6] dark:border-gray-700 pb-2 last:border-0">
                  <span className="text-[#2C1A0E] dark:text-gray-200">{f.flour_grams}g Mehl / {f.water_grams}g Wasser</span>
                  <span className="text-[#A68B6A] dark:text-gray-500 text-xs">{new Date(f.fed_at).toLocaleString('de-DE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Steps:**
1. Create the file with the content above.
2. Verify: `npx tsc --noEmit` shows no new errors. Then in the running dev
   server, open a starter's detail page from `/starters`, submit the feeding
   form, and confirm the health bar and history list update after submit.
3. Commit: `feat(starters): add starter detail page with feeding form`

---

## Task 14: Navigation — Starter-Eintrag

**Files:** `ui/src/components/Navigation.tsx` (modify)

1. Add `Sprout` to the lucide-react import (line 7):
   ```js
   import { LayoutGrid, FileDown, Clock, Sun, Moon, LogOut, ChevronDown, Download, Search, Settings, Flame, Sprout } from 'lucide-react';
   ```
2. Add a `Starter` entry to `navItems` (line 55):
   ```js
   const navItems=[{name:'Rezepte',href:'/',icon:LayoutGrid},{name:'Starter',href:'/starters',icon:Sprout},{name:'Suche',href:'/search',icon:Search},{name:'Import',href:'/new',icon:FileDown}];
   ```

**Steps:**
1. Apply both changes above.
2. Verify: run the dev server, confirm "Starter" appears in both the desktop
   header nav and the mobile bottom nav, and that clicking it navigates to
   `/starters` with the active-state underline/color applied correctly.
3. Commit: `feat(starters): add navigation entry`

---

## Task 15: `PlanModal.tsx` — Starter-Dropdown + Warnbanner

**Files:** `ui/src/components/PlanModal.tsx` (modify)

1. Add three new state hooks right after the existing
   `const [freieZeitOpen, setFreieZeitOpen] = useState(false);` (around line 233):
   ```tsx
   const [starters, setStarters] = useState<any[]>([]);
   const [selectedStarterId, setSelectedStarterId] = useState<string>("");
   const [starterWarningMsg, setStarterWarningMsg] = useState<string | null>(null);
   ```

2. In the existing `useEffect(() => { if (isOpen) { ... } }, [isOpen])` block,
   add starter-state resets and a fetch of the starters list. The block
   currently reads:
   ```tsx
   useEffect(() => {
     if (isOpen) {
       const s = loadSettings(); setSettings(s); setMultiplier(1); setManualHint(""); setPickerTarget(null); setDayOffset(0);
       setPlanOffset(snapTo(nowMin(), s.snapMin, true)); setScenario("jetzt"); setIsSubmitting(false); setSubmitError("");
       setFreieZeitOpen(false);
     }
   }, [isOpen]);
   ```
   Change it to:
   ```tsx
   useEffect(() => {
     if (isOpen) {
       const s = loadSettings(); setSettings(s); setMultiplier(1); setManualHint(""); setPickerTarget(null); setDayOffset(0);
       setPlanOffset(snapTo(nowMin(), s.snapMin, true)); setScenario("jetzt"); setIsSubmitting(false); setSubmitError("");
       setFreieZeitOpen(false);
       setSelectedStarterId(""); setStarterWarningMsg(null);
       fetch(`${process.env.NEXT_PUBLIC_API_URL}/starters`, { headers: { Authorization: `Bearer ${localStorage.getItem("crumb_token")}` } })
         .then(res => (res.ok ? res.json() : []))
         .then(data => setStarters(Array.isArray(data) ? data : []))
         .catch(() => setStarters([]));
     }
   }, [isOpen]);
   ```

3. Modify `handleConfirm` (currently ends with `onClose(); window.location.href = "/backplan";` on success). Replace the whole function body from
   `setIsSubmitting(true);` onward:
   ```tsx
   const handleConfirm = async () => {
     if (!canConfirm) return;
     const endDate = absMinToDate(planStart + planDur);
     const target = toLocalISOString(endDate);
     if (onConfirm) {
       const timeline = calculateBackplan(target, recipe?.dough_sections ?? []);
       onConfirm(target, multiplier, timeline, timeline);
       return;
     }
     setIsSubmitting(true);
     setSubmitError("");
     try {
       const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bake-sessions`, {
         method: "POST",
         headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("crumb_token")}` },
         body: JSON.stringify({
           recipe_id: recipe!.id,
           planned_at: target,
           multiplier,
           ...(selectedStarterId ? { starter_id: Number(selectedStarterId) } : {}),
         }),
       });
       if (!res.ok) { const err = await res.json(); setSubmitError(err.error || "Fehler beim Erstellen"); setIsSubmitting(false); return; }
       const data = await res.json();
       if (data.starterWarning) {
         setStarterWarningMsg(data.starterWarning.message);
         setIsSubmitting(false);
         return;
       }
       onClose();
       window.location.href = "/backplan";
     } catch (err: any) { setSubmitError(err.message || "Netzwerkfehler"); setIsSubmitting(false); }
   };

   const proceedDespiteStarterWarning = () => {
     onClose();
     window.location.href = "/backplan";
   };
   ```

4. Add the starter dropdown to the JSX, right after the `{warning && (...)}`
   block that follows `<TimelineCanvas .../>` and before the closing `</div>`
   of that section (i.e. immediately before the „Freie Zeit" collapsible
   section comment `{/* B: Freie Zeit — kollapsierbar */}`):
   ```tsx
   {starters.length > 0 && (
     <div className="px-4 pt-2">
       <label className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-widest">Sauerteig verknüpfen (optional)</label>
       <select
         value={selectedStarterId}
         onChange={(e) => setSelectedStarterId(e.target.value)}
         className="mt-1 w-full bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]"
       >
         <option value="">Keinen Starter verknüpfen</option>
         {starters.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
       </select>
     </div>
   )}
   ```

5. Add the warning banner right after the existing
   `{submitError && <div className="mx-4 mb-2 text-[11px] text-[#f85149] bg-[#f85149]/10 px-3 py-2 rounded-lg">{submitError}</div>}` line:
   ```tsx
   {starterWarningMsg && (
     <div className="mx-4 mb-2 flex items-center justify-between gap-2 text-[11px] text-[#e3b341] bg-[#e3b341]/10 px-3 py-2 rounded-lg">
       <span>{starterWarningMsg}</span>
       <button onClick={proceedDespiteStarterWarning} className="shrink-0 underline font-semibold">Trotzdem fortfahren</button>
     </div>
   )}
   ```

**Steps:**
1. Apply all five changes above to `ui/src/components/PlanModal.tsx`.
2. Verify: `npx tsc --noEmit` shows no new errors. Then in the dev server:
   - Open PlanModal for a recipe with no starters created yet → no dropdown
     shown, flow behaves exactly as before.
   - Create at least one starter, reopen PlanModal → dropdown appears with
     "Keinen Starter verknüpfen" plus the starter(s); confirm without
     selecting one → session created as before (no `starter_id` sent).
   - Backdate a starter's feeding so health < 60 (as in Task 7/8's
     verification), select it in the dropdown, click "Backplan starten" →
     the amber warning banner appears with a "Trotzdem fortfahren" button
     instead of navigating immediately; clicking that button navigates to
     `/backplan` and the created session has the correct `starter_id`.
3. Commit: `feat(planmodal): add optional starter link and health warning banner`

---

## Self-Review Checklist (to complete before handoff)

- **Spec coverage**: Datenmodell (Task 3) ✅, 8 Endpunkte + `/profiles` extra
  (Tasks 4–6) ✅, Health-Berechnung (Task 2) ✅, Notification-Integration
  (Task 7) ✅, Backplan-Kopplung (Task 8) ✅, 2 Frontend-Routen (Tasks 12–13) ✅,
  PlanModal-Warnbanner (Task 15) ✅, Cremeton-Palette/Deutsch (all frontend
  tasks) ✅.
- **No placeholders**: every task above contains complete, copy-pasteable code
  — no `// TODO` or `...` elisions in the actual file contents to be written.
- **Type/signature consistency**: `calculateHealth(feedings, targetProfile)`
  signature identical across `starter-health.js`, `starters.js`, and
  `bake-sessions.js`. `dispatch(pool, userId, sessionId, candidate)` call in
  `checkStarterFeedingDue` matches the existing signature in
  `notification-engine.js` exactly (verified against the real function body).
  `getSettings(poolRef, userId)` / `isInQuietHours(settings)` calls match the
  real exports of `notification-settings.js` exactly.
- **Auth-scoping**: every `:id` route in `starters.js` joins/filters on
  `user_id = req.user.userId`; verification steps in Tasks 5–6 explicitly
  include a cross-user 404 check.

---

## Execution Handoff

Two ways to execute this plan:

1. **Subagent-Driven (recommended)** — via `superpowers:subagent-driven-development`.
   A dispatcher agent runs each task in a fresh subagent context, verifying
   and committing before moving to the next. Best for a plan this size (15
   tasks across backend + frontend): keeps context clean per task and catches
   integration mistakes early since each task is independently verified.
2. **Inline Execution** — via `superpowers:executing-plans`. I execute the
   tasks directly in this conversation, one after another.

Which would you like?
