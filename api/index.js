require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { getScraper } = require('./scrapers/index');
const parseHtmlImport = require('./scrapers/smry');
const { planWithNightWindow } = require('./scrapers/nightWindowPlanner');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, login, register, verify, requestPasswordReset, resetPassword, changePassword } = require('./auth');
const { categorizeRecipe } = require('./categorize');
const { router: bakeSessionsRouter, setPool: setBakeSessionsPool } = require('./bake-sessions');
const { router: pushRouter, setPool: setPushPool } = require('./push');
const { router: notificationSettingsRouter, setPool: setNotificationSettingsPool } = require('./notification-settings');
const { checkSoftDone, calculateProjectedEnd } = require('./bake-engine');
const { evaluateAndDispatch, cleanupOldNotifications, initWebPush, checkStarterFeedingDue } = require('./notification-engine');
const { router: startersRouter, setPool: setStartersPool } = require('./starters');
const { TARGET_PROFILES } = require('./starter-profiles');

const app = express();

// ============================================================
// MIDDLEWARE & SETUP
// ============================================================
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://crumb.skords.de',
      process.env.ALLOWED_ORIGIN
    ].filter(Boolean);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// ============================================================
// MULTER KONFIGURATION
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDir); },
  filename:    (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage });

// ============================================================
// DATENBANK POOL & INIT
// ============================================================
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Keine erzwungene UTC-Timezone
setBakeSessionsPool(pool);
setPushPool(pool);
setNotificationSettingsPool(pool);
setStartersPool(pool);

// Öffentliche Base-URL für generierte Datei-URLs.
// Traefik terminiert TLS → req.protocol ist intern immer "http".
// Deshalb: BASE_URL env-Variable bevorzugen, sonst X-Forwarded-Proto auswerten.
const getPublicBaseUrl = (req) => {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
};

const initDB = async () => {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      reset_token_hash TEXT,
      reset_token_expires TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

  const createRecipesTable = `
    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      image_url TEXT,
      source_url TEXT,
      original_source_url TEXT,
      ingredients JSONB,
      dough_sections JSONB,
      steps JSONB,
      is_favorite BOOLEAN DEFAULT false,
      planned_at TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

  const createIndex = `CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);`;

  const migrateRecipesTable = `
    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS original_source_url TEXT,
      ADD COLUMN IF NOT EXISTS dough_sections JSONB,
      ADD COLUMN IF NOT EXISTS planned_at TIMESTAMP WITHOUT TIME ZONE,
      ADD COLUMN IF NOT EXISTS planned_timeline JSONB,
      ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Sonstiges',
      ADD COLUMN IF NOT EXISTS multiplier NUMERIC(5,2) DEFAULT 1;`;

  // planned_at: TIMESTAMP WITH TIME ZONE → WITHOUT TIME ZONE
  // Konvertiert bestehende UTC-Werte nach Serverzeit (Europe/Berlin).
  // AT TIME ZONE konvertiert korrekt, danach ist die Spalte offset-frei.
  const migratePlannedAtType = `
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recipes' AND column_name = 'planned_at'
          AND data_type = 'timestamp with time zone'
      ) THEN
        ALTER TABLE recipes
          ALTER COLUMN planned_at TYPE TIMESTAMP WITHOUT TIME ZONE
          USING planned_at AT TIME ZONE 'Europe/Berlin';
      END IF;
    END $$;`;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createUsersTable);
      await pool.query(createRecipesTable);
      await pool.query(createIndex);
      await pool.query(migrateRecipesTable);
await pool.query(migratePlannedAtType);
      // ── Bake Sessions Tabelle ──
      await pool.query(`CREATE TABLE IF NOT EXISTS bake_sessions (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        planned_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        started_at TIMESTAMP WITHOUT TIME ZONE,
        finished_at TIMESTAMP WITHOUT TIME ZONE,
        projected_end TIMESTAMP WITHOUT TIME ZONE,
        multiplier NUMERIC(3,1) DEFAULT 1.0,
        step_states JSONB NOT NULL DEFAULT '{}',
        step_timestamps JSONB NOT NULL DEFAULT '{}',
        temperature_log JSONB DEFAULT '[]',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_bake_sessions_active ON bake_sessions(user_id) WHERE finished_at IS NULL;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_bake_sessions_recipe ON bake_sessions(recipe_id, finished_at DESC);`);
      // ── Sent Notifications: DB-basierte Dedup für Notification-Versand ──
      await pool.query(`CREATE TABLE IF NOT EXISTS sent_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id INTEGER REFERENCES bake_sessions(id) ON DELETE CASCADE,
        notification_id TEXT NOT NULL,
        sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, notification_id)
      );`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sent_notifs_session ON sent_notifications(session_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sent_notifs_sent_at ON sent_notifications(sent_at);`);
      // ── Push Subscriptions: Web Push Endpoints pro User/Gerät ──
      await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMP
      );`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);`);
      // ── User Notification Settings ──
await pool.query(`CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  master_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  step_ready_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  step_ready_vorlauf_min INTEGER NOT NULL DEFAULT 5,
  preheat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  preheat_vorlauf_min INTEGER NOT NULL DEFAULT 45,
  bake_done_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  plan_done_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_start TIME NOT NULL DEFAULT '22:00:00',
  quiet_end TIME NOT NULL DEFAULT '07:00:00',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);`);

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

      console.log("✅ Datenbank bereit");
      return;
    } catch (err) {
      console.log(`🔌 DB-Init Fehler: ${err.message} (${retries} Versuche verbleibend)`);
      retries--;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  console.error("❌ DB-Init nach mehreren Versuchen fehlgeschlagen");
};

// ============================================================
// TIMELINE-BERECHNUNG (für planned_timeline Speicherung)
// ============================================================

// ── Timeline-Berechnung ──────────────────────────────────────
const calculateTimeline = (plannedAt, sections) => {
  if (!sections || sections.length === 0) return [];
  const target = new Date(plannedAt);
  const timeline = [];
  const phaseNames = sections.map(s => s.name);
  const deps = {};
  sections.forEach(section => {
    deps[section.name] = [];
    (section.ingredients || []).forEach(ing => {
      const ingName = (ing.name || '').toLowerCase();
      phaseNames.forEach(otherName => {
        if (otherName !== section.name && ingName.includes(otherName.toLowerCase())) {
          if (!deps[section.name].includes(otherName)) deps[section.name].push(otherName);
        }
      });
    });
  });
  const sectionMap = Object.fromEntries(sections.map(s => [s.name, s]));
  const endOffsets = {}, startOffsets = {};
  function calcEndOffset(name, visited = new Set()) {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const dependents = sections.map(s => s.name).filter(n => deps[n] && deps[n].includes(name));
    endOffsets[name] = dependents.length === 0 ? 0 : Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
    return endOffsets[name];
  }
  function calcStartOffset(name, visited = new Set()) {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name].steps || []).reduce((sum, s) => sum + (parseInt(s.duration) || 0), 0);
    startOffsets[name] = end + dur;
    return startOffsets[name];
  }
  sections.forEach(s => calcStartOffset(s.name));
  sections.forEach(section => {
    const offset = startOffsets[section.name] || 0;
    const sectionStart = new Date(target.getTime() - offset * 60000);
    let stepMoment = new Date(sectionStart.getTime());
    (section.steps || []).forEach(step => {
      const duration = parseInt(step.duration) || 0;
      const stepStart = new Date(stepMoment.getTime());
      const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
      timeline.push({
        phase: section.name,
        instruction: step.instruction,
        type: step.type || 'Aktion',
        duration,
        start: stepStart,
        end: stepEnd,
        isParallel: (endOffsets[section.name] || 0) > 0
      });
      stepMoment = stepEnd;
    });
  });
  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
};


// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/login', login);
app.post('/api/auth/register', register);
app.get('/api/auth/verify', authenticateToken, verify);
app.post('/api/auth/request-reset', requestPasswordReset);
app.post('/api/auth/reset-password', resetPassword);
app.post('/api/auth/change-password', authenticateToken, changePassword);

// ============================================================
// API ROUTES (Protected)
// ============================================================
app.use(authenticateToken);

// Alle API-Responses: kein Caching (personalisierte Daten)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Surrogate-Control', 'no-store'); // Cloudflare CDN
  next();
});

// ── Bake Sessions Router ──
app.use('/api/bake-sessions', bakeSessionsRouter);

// ── Push Subscriptions Router ──
app.use('/api/push', pushRouter);

// ── Notification Settings Router ──
app.use('/api/notification-settings', notificationSettingsRouter);

// ── Starters Router ──
app.use('/api/starters', startersRouter);

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const imageUrl = `${getPublicBaseUrl(req)}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

app.post('/api/import', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Keine URL angegeben" });
  try {
    if (typeof getScraper !== 'function') {
      console.error("❌ getScraper ist keine Funktion!", typeof getScraper);
      return res.status(500).json({ error: "Server Konfigurationsfehler" });
    }
    const scraper = getScraper(url);
    if (!scraper) return res.status(400).json({ error: "Webseite nicht unterstützt" });
    console.log("🔍 Starte Scraping für:", url);
    const recipeData = await scraper(url);
    if (!recipeData) return res.status(500).json({ error: "Konnte keine Daten extrahieren" });
    if (!recipeData.source_url) recipeData.source_url = url;
    if (recipeData.image_url && recipeData.image_url.startsWith('http')) {
      try {
        const response = await axios.get(recipeData.image_url, { responseType: 'arraybuffer', timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        fs.writeFileSync(path.join(uploadDir, fileName), response.data);
        recipeData.image_url = `${getPublicBaseUrl(req)}/uploads/${fileName}`;
      } catch (e) { console.error("⚠️ Bild-Fehler:", e.message); }
    }
    res.json(recipeData);
  } catch (error) {
    console.error("🚨 IMPORT FEHLER:", error.message);
    res.status(500).json({ error: "Fehler beim Verarbeiten" });
  }
});

// ============================================================
// HTML IMPORT
// ============================================================
app.post('/api/import/html', async (req, res) => {
  try {
    const { html, filename } = req.body;
    if (!html) return res.status(400).json({ error: 'No HTML content provided' });

    const recipeData = await parseHtmlImport(html, filename);
    if (!recipeData) return res.status(500).json({ error: 'Konnte HTML nicht parsen' });

    if (recipeData.image_url && recipeData.image_url.startsWith('http') && !recipeData.image_url.startsWith('data:')) {
      try {
        const response = await axios.get(recipeData.image_url, { responseType: 'arraybuffer', timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        fs.writeFileSync(path.join(uploadDir, fileName), response.data);
        recipeData.image_url = `${getPublicBaseUrl(req)}/uploads/${fileName}`;
        console.log('✅ Bild heruntergeladen');
      } catch (e) { console.error("⚠️ Bild-Download Fehler:", e.message); }
    }

    res.json(recipeData);
  } catch (error) {
    console.error("🚨 HTML PARSE FEHLER:", error.message);
    res.status(500).json({ error: 'Failed to parse HTML file: ' + error.message });
  }
});

// ============================================================
// RECIPE CRUD
// ============================================================
app.get('/api/recipes', async (req, res) => {
  try {
    const { q, category, filter, sort } = req.query;
    const params = [req.user.userId];
    const conditions = ['user_id = $1'];

    // Volltextsuche über title, description und Zutaten-Namen in dough_sections
    if (q) {
      const idx = params.push(`%${q}%`);
      conditions.push(`(
        title ILIKE $${idx}
        OR description ILIKE $${idx}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                        jsonb_array_elements(section->'ingredients') AS ing
          WHERE ing->>'name' ILIKE $${idx}
        )
      )`);
    }

    // Primärfilter: Produktkategorie (direkte DB-Spalte, schnell via Index)
    if (category && category !== 'alle') {
      const idx = params.push(category);
      conditions.push(`category = $${idx}`);
    }

// Sekundärfilter: kombinierbar, kommagetrennt z.B. filter=Sauerteig,Vollkorn
    const filters = filter ? (Array.isArray(filter) ? filter : filter.split(',')) : [];
    for (const f of filters) {
      switch (f.trim()) {
        case 'Favoriten':
          conditions.push('is_favorite = true');
          break;
        case 'Geplant':
          conditions.push('planned_at IS NOT NULL');
          break;
        case 'Sauerteig':
          conditions.push(`(
            title ILIKE '%sauerteig%' OR description ILIKE '%sauerteig%'
            OR title ILIKE '%anstellgut%' OR description ILIKE '%anstellgut%'
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%sauerteig%' OR ing->>'name' ILIKE '%anstellgut%'
            )
          )`);
          break;
        case 'Hefe':
          // Nur reine Hefe-Rezepte — kein Sauerteig/Anstellgut vorhanden
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ~* '\\mhefe\\M|\\mfrischhefe\\M|\\mtrockenhefe\\M'
            )
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%sauerteig%' OR ing->>'name' ILIKE '%anstellgut%'
                 OR ing->>'name' ILIKE '%lievito%'
            )
          )`);
          break;
        case 'Hybrid':
          // Sauerteig + Hefe gleichzeitig
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ~* '\\mhefe\\M|\\mfrischhefe\\M|\\mtrockenhefe\\M'
            )
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%sauerteig%' OR ing->>'name' ILIKE '%anstellgut%'
            )
          )`);
          break;
        case 'LM':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%lievito madre%'
            )
          )`);
          break;
        case 'Weizen':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%weizen%'
                 OR ing->>'name' ~* '\\mmehl typ (0|4|5)\\d{1,2}\\M'
                 OR ing->>'name' ~* '\\mtipo 0{1,2}\\M'
                 OR ing->>'name' ~* '\\mW\\d{3,4}\\M'
            )
          )`);
          break;
        case 'Roggen':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%roggen%'
            )
          )`);
          break;
        case 'Dinkel':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%dinkel%'
            )
          )`);
          break;
        case 'Hafer':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%hafer%'
            )
          )`);
          break;
        case 'Urkorn':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ~* 'emmer|einkorn|kamut|khorasan|urdinkel|urgerste|waldstaudenroggen'
            )
          )`);
          break;
        case 'Vollkorn':
          conditions.push(`(
            title ILIKE '%vollkorn%' OR description ILIKE '%vollkorn%'
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'ingredients') AS ing
              WHERE ing->>'name' ILIKE '%vollkorn%'
            )
          )`);
          break;
        case 'Uebernacht':
          conditions.push(`(
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(dough_sections) AS section,
                            jsonb_array_elements(section->'steps') AS step
              WHERE (step->>'type' = 'Warten') AND (step->>'duration')::int >= 360
            )
          )`);
          break;
        case 'Schnell':
          conditions.push(`(
            (SELECT COALESCE(SUM((step->>'duration')::int), 0)
             FROM jsonb_array_elements(dough_sections) AS section,
                  jsonb_array_elements(section->'steps') AS step
            ) < 240
          )`);
          break;
      }
    }
    
    const orderMap = {
      'newest':    'created_at DESC',
      'oldest':    'created_at ASC',
      'az':        'title ASC',
      'za':        'title DESC',
      'shortest':  `(SELECT COALESCE(SUM((step->>'duration')::int), 0)
                     FROM jsonb_array_elements(dough_sections) AS section,
                          jsonb_array_elements(section->'steps') AS step) ASC`,
    };
    const orderBy = orderMap[sort] || 'created_at DESC';

    const where = conditions.join(' AND ');
    const result = await pool.query(
      `SELECT * FROM recipes WHERE ${where} ORDER BY ${orderBy}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ recipes GET Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recipes/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recipes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Datenbankfehler" }); }
});

app.post('/api/recipes', async (req, res) => {
  const { title, description, ingredients, steps, image_url, source_url, original_source_url, dough_sections } = req.body;
  if (!title) return res.status(400).json({ error: "Titel erforderlich" });
  try {
    const category = categorizeRecipe({ title, dough_sections });
    const result = await pool.query(
      `INSERT INTO recipes (user_id, title, description, ingredients, steps, image_url, source_url, original_source_url, dough_sections, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.userId, title, description, JSON.stringify(ingredients || []), JSON.stringify(steps || []),
       image_url, source_url || '', original_source_url || '', JSON.stringify(dough_sections || []), category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Speicherfehler" }); }
});

app.put('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, ingredients, steps, image_url, source_url, original_source_url, dough_sections, category: manualCategory } = req.body;
  try {
    const category = manualCategory || categorizeRecipe({ title, dough_sections });
    const result = await pool.query(
      `UPDATE recipes SET title=$1, image_url=$2, ingredients=$3, steps=$4, description=$5, dough_sections=$6, source_url=$7, original_source_url=$8, category=$9
       WHERE id=$10 AND user_id=$11 RETURNING *;`,
      [title, image_url, JSON.stringify(ingredients), JSON.stringify(steps), description,
       JSON.stringify(dough_sections), source_url || '', original_source_url || '', category, id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Update-Fehler" }); }
});

app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM recipes WHERE id=$1 AND user_id=$2 RETURNING *',
      [req.params.id, req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ message: "Gelöscht" });
  } catch (err) { res.status(500).json({ error: "Löschfehler" }); }
});

app.patch('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { is_favorite, planned_at, planned_timeline, multiplier } = req.body;
  try {
    let result;
    if (planned_at !== undefined) {
      const recipeResult = await pool.query(
        'SELECT dough_sections FROM recipes WHERE id=$1 AND user_id=$2',
        [id, req.user.userId]
      );
      if (recipeResult.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });

      let timelineToSave = null;
      if (planned_at && recipeResult.rows[0].dough_sections) {
        try {
          const nightResult = planWithNightWindow(
            recipeResult.rows[0].dough_sections,
            { start: '22:00', end: '06:30' },
            new Date(planned_at),
            0
          );
          timelineToSave = nightResult.plan?.length > 0
            ? nightResult.plan
            : calculateTimeline(new Date(planned_at), recipeResult.rows[0].dough_sections);
        } catch {
          try { timelineToSave = calculateTimeline(new Date(planned_at), recipeResult.rows[0].dough_sections); } catch {}
        }
      }

      result = await pool.query(
  "UPDATE recipes SET planned_at=$1, planned_timeline=$2, multiplier=$3 WHERE id=$4 AND user_id=$5 RETURNING *",
  [planned_at || null, timelineToSave ? JSON.stringify(timelineToSave) : null, multiplier ?? 1, id, req.user.userId]
);
    } else if (is_favorite !== undefined) {
      result = await pool.query(
        "UPDATE recipes SET is_favorite=$1 WHERE id=$2 AND user_id=$3 RETURNING *",
        [is_favorite, id, req.user.userId]
      );
    }
    if (!result || result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Patch-Fehler" }); }
});

// ============================================================
// NACHTFENSTER-PLANUNG
// ============================================================
app.post('/api/recipes/:id/plan-night', async (req, res) => {
  try {
    const { id } = req.params;
    const { nightWindow } = req.body;

    if (!nightWindow?.start || !nightWindow?.end) {
      return res.status(400).json({ error: 'nightWindow mit start und end erforderlich' });
    }

    const result = await pool.query(
      'SELECT * FROM recipes WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rezept nicht gefunden' });
    }

    const sections = result.rows[0].dough_sections;
    if (!sections || sections.length === 0) {
      return res.status(400).json({ error: 'Rezept hat keine Phasen (dough_sections)' });
    }

    const tzOffsetMin = req.body.tzOffset || 0;
    const planResult = planWithNightWindow(sections, nightWindow, new Date(), tzOffsetMin);

    if (planResult.viable && planResult.endTime && planResult.plan?.length > 0) {
      try {
        await pool.query(
          'UPDATE recipes SET planned_at=$1, planned_timeline=$2 WHERE id=$3 AND user_id=$4',
          [planResult.endTime, JSON.stringify(planResult.plan), id, req.user.userId]
        );
      } catch (saveErr) {
        console.error('plan-night: Timeline speichern fehlgeschlagen:', saveErr.message);
      }
    }

    res.json(planResult);
  } catch (err) {
    console.error('❌ plan-night Fehler:', err.message);
    res.status(500).json({ error: 'Planungsfehler', details: err.message });
  }
});

app.post('/api/recipes/:id/plan-night/save', async (req, res) => {
  try {
    const { id } = req.params;
    const { plannedAt } = req.body;

    if (!plannedAt) {
      return res.status(400).json({ error: 'plannedAt erforderlich' });
    }

    const result = await pool.query(
      'UPDATE recipes SET planned_at = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [plannedAt, id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rezept nicht gefunden' });
    }

    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('❌ plan-night/save Fehler:', err.message);
    res.status(500).json({ error: 'Speicherfehler', details: err.message });
  }
});

// ============================================================
// SERVER STARTEN
// ============================================================
const PORT = 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  await initDB();
  initWebPush();

  // ── Notification-Sweep ───────────────────────────────────
  // Iteriert über aktive Bake-Sessions, prüft soft_done-Übergänge
  // (Warten-Timer abgelaufen) und ruft den Notification-Evaluator auf.
  // Dispatch geht über DB-Dedup (sent_notifications) und Web-Push-Transport.
  // State-Transitions durch User-Aktionen triggern parallel den gleichen
  // Evaluator direkt im bake-sessions Router — der Sweep ist das Safety-Net.
  const notificationSweep = async () => {
    try {
      const result = await pool.query(
        `SELECT bs.*, r.title, r.dough_sections
         FROM bake_sessions bs
         JOIN recipes r ON r.id = bs.recipe_id
         WHERE bs.finished_at IS NULL`
      );
      for (const session of result.rows) {
        const sections = session.dough_sections || [];
        const states = session.step_states || {};
        const timestamps = session.step_timestamps || {};

        // Soft-Done Check: Warten-Timer abgelaufen?
        const { states: updatedStates, softDoneSteps } = checkSoftDone(sections, states, timestamps);
        if (softDoneSteps.length > 0) {
          await pool.query(
            'UPDATE bake_sessions SET step_states = $1 WHERE id = $2',
            [JSON.stringify(updatedStates), session.id]
          );
        }

        // Projected End neu berechnen (für UI)
        const projectedEnd = calculateProjectedEnd(sections, updatedStates, timestamps);
        await pool.query(
          'UPDATE bake_sessions SET projected_end = $1 WHERE id = $2',
          [projectedEnd, session.id]
        );

        // Notifications auswerten und versenden (idempotent, DB-Dedup)
        await evaluateAndDispatch(pool, { ...session, step_states: updatedStates }, sections);
      }

      // Sauerteig-Fütterungs-Check (unabhängig von Bake-Sessions)
      await checkStarterFeedingDue(pool);
    } catch (err) {
      console.error('❌ Notification-Sweep Fehler:', err.message);
    }
  };

  // Erster Sweep direkt beim Start (für Sessions, die einen Restart überdauert haben)
  await notificationSweep();

  // Cleanup alter Notification-Einträge (24h nach Session-Ende, 7 Tage absolut)
  await cleanupOldNotifications(pool);

  // Sweep alle 60s, Cleanup alle 6h
  setInterval(notificationSweep, 60 * 1000);
  setInterval(() => cleanupOldNotifications(pool), 6 * 60 * 60 * 1000);
});