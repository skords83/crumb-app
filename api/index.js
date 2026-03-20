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
pool.on('connect', client => { client.query("SET timezone = 'UTC'"); });

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
      planned_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

  const createIndex = `CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);`;

  const migrateRecipesTable = `
    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS original_source_url TEXT;`;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createUsersTable);
      await pool.query(createRecipesTable);
      await pool.query(createIndex);
      await pool.query(migrateRecipesTable);
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
// NTFY LOGIK & TIMELINE BERECHNUNG
// ============================================================
const sentNotifications = new Set();
const NTFY_VORLAUF = parseInt(process.env.NTFY_VORLAUF) || 5;

function clearSentNotificationsForRecipe(recipeId) {
  for (const key of sentNotifications) {
    if (key.startsWith(`${recipeId}-`)) sentNotifications.delete(key);
  }
}

const sendNtfyNotification = async (title, message, tags = 'bread') => {
  try {
    const topic = process.env.NTFY_TOPIC || 'crumb-backplan';
    const baseUrl = (process.env.NTFY_URL || 'http://ntfy.local').replace(/\/$/, '');
    const shortTitle = title.length > 60
      ? title.slice(0, 60).replace(/\s+\S*$/, '') + '\u2026'
      : title;
    const payload = JSON.stringify({ topic, title: shortTitle, message, tags: [tags], priority: 4 });
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    await axios.post(baseUrl, payload, { headers });
    console.log(`🔔 Notification gesendet: ${shortTitle}`);
  } catch (err) {
    console.error('\u274c ntfy Fehler:', err.message);
  }
};

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
      timeline.push({ phase: section.name, instruction: step.instruction, type: step.type || 'Aktion', duration, start: stepStart, end: stepEnd, isParallel: (endOffsets[section.name] || 0) > 0 });
      stepMoment = stepEnd;
    });
  });
  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
};

const checkAndNotify = async () => {
  try {
    const result = await pool.query(`SELECT r.*, u.email as user_email FROM recipes r JOIN users u ON r.user_id = u.id WHERE r.planned_at IS NOT NULL`);
    const now = new Date();
    for (const recipe of result.rows) {
      if (!recipe.dough_sections) continue;
      const timeline = calculateTimeline(recipe.planned_at, recipe.dough_sections);
      for (const step of timeline) {
        if (step.type === 'Warten') continue;
        const notifId = `${recipe.id}-${step.start.getTime()}`;
        if (sentNotifications.has(notifId)) continue;
        const notifyAt = new Date(step.start.getTime() - NTFY_VORLAUF * 60000);
        if (now >= notifyAt && now < step.start) {
          const startTime = step.start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
          await sendNtfyNotification(`🔔 ${step.instruction.substring(0, 60)}`, `${recipe.title} · ${step.phase} · Um ${startTime} Uhr`);
          sentNotifications.add(notifId);
        }
      }
    }
  } catch (err) { console.error('❌ Check-Fehler:', err.message); }
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
                 OR ing->>'name' ~* 'mehl typ 0{1,2}\\M|tipo 0{1,2}\\M|type 0{1,2}\\M|farina 0{1,2}\\M|W\\d{3,4}\\M'
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
              WHERE ing->>'name' ~* 'emmer|einkorn|kamut|khorasan|urdinkel|urgerste'
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

    // Sortierung
    const orderMap = {
      newest:   'created_at DESC',
      oldest:   'created_at ASC',
      az:       'title ASC',
      za:       'title DESC',
      shortest: `(SELECT COALESCE(SUM((step->>'duration')::int), 0) FROM jsonb_array_elements(dough_sections) AS section, jsonb_array_elements(section->'steps') AS step) ASC`,
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
    const result = await pool.query('SELECT * FROM recipes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes', async (req, res) => {
  const { title, description, image_url, source_url, original_source_url, ingredients, dough_sections, steps, category: manualCategory } = req.body;
  try {
    const category = manualCategory || categorizeRecipe({ title, dough_sections });
    const result = await pool.query(
      `INSERT INTO recipes (user_id, title, description, image_url, source_url, original_source_url, ingredients, dough_sections, steps, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *;`,
      [req.user.userId, title, description, image_url, source_url || '', original_source_url || '',
       JSON.stringify(ingredients || []), JSON.stringify(dough_sections || []), JSON.stringify(steps || []), category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Datenbankfehler" }); }
});

app.put('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, image_url, ingredients, steps, description, dough_sections, source_url, original_source_url, category: manualCategory } = req.body;
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
    const result = await pool.query('DELETE FROM recipes WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.user.userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ message: "Gelöscht" });
  } catch (err) { res.status(500).json({ error: "Löschfehler" }); }
});

app.patch('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { is_favorite, planned_at, planned_timeline } = req.body;
  try {
    let result;
    if (planned_at !== undefined) {
      // Rezept holen um dough_sections zu bekommen
      const recipeResult = await pool.query(
        'SELECT dough_sections FROM recipes WHERE id=$1 AND user_id=$2',
        [id, req.user.userId]
      );
      if (recipeResult.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });

      let timelineToSave = planned_timeline ?? null;
      // Wenn keine Timeline mitkommt, mit planWithNightWindow berechnen (kennt Abhängigkeiten)
      if (!timelineToSave && planned_at && recipeResult.rows[0].dough_sections) {
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
        "UPDATE recipes SET planned_at=$1, planned_timeline=$2 WHERE id=$3 AND user_id=$4 RETURNING *",
        [planned_at ? new Date(planned_at).toISOString() : null, timelineToSave ? JSON.stringify(timelineToSave) : null, id, req.user.userId]
      );
    } else if (is_favorite !== undefined) {
      result = await pool.query("UPDATE recipes SET is_favorite=$1 WHERE id=$2 AND user_id=$3 RETURNING *", [is_favorite, id, req.user.userId]);
    }
    if (!result || result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Patch-Fehler" }); }
});

// ============================================================
// COMPLETE STEP (Early completion + ntfy reschedule)
// ============================================================
app.post('/api/recipes/:id/complete-step', async (req, res) => {
  const { id } = req.params;
  const { stepIndex, completedAt, newPlannedAt } = req.body;

  if (stepIndex === undefined || !completedAt || !newPlannedAt) {
    return res.status(400).json({ error: 'stepIndex, completedAt und newPlannedAt erforderlich' });
  }

  try {
    const result = await pool.query(
      'UPDATE recipes SET planned_at=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [new Date(newPlannedAt).toISOString(), id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });

    const recipe = result.rows[0];

    // Alle alten Notifications für dieses Rezept aus dem Cache löschen
    // → nächste checkAndNotify-Runde bewertet alle Schritte mit neuen Zeiten
    clearSentNotificationsForRecipe(id);

    // Sofortige Notification wenn nächster Aktion-Schritt < NTFY_VORLAUF Minuten entfernt
    if (recipe.dough_sections) {
      const timeline = calculateTimeline(newPlannedAt, recipe.dough_sections);
      const now = new Date();
      const nextAction = timeline.find(step =>
        step.type !== 'Warten' &&
        step.start > new Date(completedAt) &&
        step.start > now
      );

      if (nextAction) {
        const minutesUntil = (nextAction.start.getTime() - now.getTime()) / 60000;
        const notifId = `${id}-${nextAction.start.getTime()}`;

        if (minutesUntil >= 1 && minutesUntil < NTFY_VORLAUF) {
          // Zu wenig Vorlauf für normale Notification → sofort senden
          const startTime = nextAction.start.toLocaleTimeString('de-DE', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
          });
          await sendNtfyNotification(
            `⏰ Gleich: ${nextAction.instruction.substring(0, 50)}`,
            `${recipe.title} · ${nextAction.phase} · Um ${startTime} Uhr`
          );
          sentNotifications.add(notifId);
        }
        // < 1 Min: keine Notification, User steht in der Küche
        // > NTFY_VORLAUF: checkAndNotify übernimmt zur richtigen Zeit
      }
    }

    res.json({ ok: true, newPlannedAt });
  } catch (err) {
    console.error('❌ complete-step Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// NACHTFENSTER-PLANUNG
// ============================================================

/**
 * POST /api/recipes/:id/plan-night
 *
 * Body: { nightWindow: { start: "22:00", end: "06:30" } }
 *
 * Response (viable):
 * { viable: true, startTime, endTime, nightPhase, nightStart, nightEnd, plan }
 *
 * Response (nicht viable):
 * { viable: false, fallbackStartTime, fallbackEndTime }
 */
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

    // Bei viablem Plan: planned_at und planned_timeline direkt in DB speichern
    if (planResult.viable && planResult.endTime && planResult.plan?.length > 0) {
      try {
        await pool.query(
          'UPDATE recipes SET planned_at=$1, planned_timeline=$2 WHERE id=$3 AND user_id=$4',
          [new Date(planResult.endTime).toISOString(), JSON.stringify(planResult.plan), id, req.user.userId]
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

/**
 * POST /api/recipes/:id/plan-night/save
 *
 * Speichert den berechneten plannedAt in der DB.
 *
 * Body: { plannedAt: "2024-03-14T08:00:00.000Z" }
 */
app.post('/api/recipes/:id/plan-night/save', async (req, res) => {
  try {
    const { id } = req.params;
    const { plannedAt } = req.body;

    if (!plannedAt) {
      return res.status(400).json({ error: 'plannedAt erforderlich' });
    }

    const result = await pool.query(
      'UPDATE recipes SET planned_at = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [new Date(plannedAt).toISOString(), id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rezept nicht gefunden' });
    }

    clearSentNotificationsForRecipe(id);
    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('❌ plan-night/save Fehler:', err.message);
    res.status(500).json({ error: 'Speicherfehler', details: err.message });
  }
});

app.get('/api/ntfy/status', (req, res) => {
  res.json({ ntfy_url: process.env.NTFY_URL || 'http://ntfy.local', topic: process.env.NTFY_TOPIC || 'crumb-backplan', gesendete_notifications: sentNotifications.size });
});

// ============================================================
// SERVER STARTEN
// ============================================================
const PORT = 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  await initDB();
  setInterval(checkAndNotify, 60000);
});