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
      ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Sonstiges';`;

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

// sentNotifications: Map von notifId → Zeitstempel des letzten Sendens (ms)
// Statt eines einfachen Set speichern wir den Sendezeitpunkt für Cooldown-Prüfung
const sentNotifications = new Map();

// Mindestabstand zwischen zwei Notifications zum gleichen inhaltlichen Schritt (Fix 2)
const MIN_NOTIF_COOLDOWN_MS = 15 * 60 * 1000; // 15 Minuten

const NTFY_VORLAUF = parseInt(process.env.NTFY_VORLAUF) || 5;

// ── Fix 1: Inhaltsbasierte Notification-ID ──────────────────
// Basiert auf Phasenname + Schrittinhalt (normiert), NICHT auf Timestamp.
// Dadurch erzeugt eine Timeline-Neuberechnung mit minimal verschobener
// Uhrzeit keine neue Notification.
function buildNotifId(recipeId, type, contentKey) {
  // contentKey: stabiler Inhaltsbeschreiber (z.B. Phasenname + erste 30 Zeichen Anweisung)
  const normalized = contentKey
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
  return `${recipeId}-${type}-${normalized}`;
}

// ── Fix 2: Cooldown-Prüfung ─────────────────────────────────
function hasRecentlySent(notifId) {
  const lastSent = sentNotifications.get(notifId);
  if (!lastSent) return false;
  return (Date.now() - lastSent) < MIN_NOTIF_COOLDOWN_MS;
}

function markSent(notifId) {
  sentNotifications.set(notifId, Date.now());
}

function clearSentNotificationsForRecipe(recipeId) {
  for (const key of sentNotifications.keys()) {
    if (key.startsWith(`${recipeId}-`)) sentNotifications.delete(key);
  }
}

// ── Basis ntfy-Sender ────────────────────────────────────────
const sendNtfyNotification = async (title, message, tags = 'bread', priority = 4, extraHeaders = {}) => {
  try {
    const topic = process.env.NTFY_TOPIC || 'crumb-backplan';
    const baseUrl = (process.env.NTFY_URL || 'http://ntfy.local').replace(/\/$/, '');
    const shortTitle = title.length > 60
      ? title.slice(0, 60).replace(/\s+\S*$/, '') + '…'
      : title;
    const payload = JSON.stringify({ topic, title: shortTitle, message, tags: [tags], priority });
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    await axios.post(baseUrl, payload, { headers });
    console.log(`🔔 Notification gesendet: ${shortTitle}`);
  } catch (err) {
    console.error('❌ ntfy Fehler:', err.message);
  }
};

// ── Fix 4: Persistente Status-Notification ───────────────────
// Eine einzelne Low-Priority-Notification die sich in-place aktualisiert.
// Zeigt immer den nächsten anstehenden Schritt — kein Kanal-Spam.
const STATUS_TOPIC_SUFFIX = '-status';
let statusSequenceId = null; // ntfy sequence-ID für in-place Update

const sendStatusNotification = async (recipeTitle, nextCluster, plannedAt) => {
  try {
    const topic = process.env.NTFY_TOPIC || 'crumb-backplan';
    const statusTopic = topic + STATUS_TOPIC_SUFFIX;
    const baseUrl = (process.env.NTFY_URL || 'http://ntfy.local').replace(/\/$/, '');

    const now = new Date();
    const minutesUntil = Math.round((nextCluster.start.getTime() - now.getTime()) / 60000);
    const timeStr = nextCluster.start.toLocaleTimeString('de-DE', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    });

    let countdownText;
    if (minutesUntil <= 0) {
      countdownText = 'Jetzt';
    } else if (minutesUntil < 60) {
      countdownText = `in ${minutesUntil} Min`;
    } else {
      const h = Math.floor(minutesUntil / 60);
      const m = minutesUntil % 60;
      countdownText = m > 0 ? `in ${h}h ${m}min` : `in ${h}h`;
    }

    const stepLabel = nextCluster.isBaking
      ? '🔥 Backen'
      : nextCluster.steps[0]?.instruction.substring(0, 40) || 'Nächster Schritt';

    const title = `⏱ ${countdownText} · ${stepLabel}`;
    const message = `${recipeTitle} · Um ${timeStr} Uhr`;

    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    if (statusSequenceId) headers['X-Ntfy-Replace'] = statusSequenceId;

    const payload = JSON.stringify({
      topic: statusTopic,
      title,
      message,
      tags: ['bread'],
      priority: 2, // Low priority — kein Ton, kein Aufwachen
    });

    const response = await axios.post(baseUrl, payload, { headers });
    // Sequence-ID aus Response merken für künftige In-place-Updates
    if (response.data?.id) statusSequenceId = response.data.id;
  } catch (err) {
    console.error('❌ Status-Notification Fehler:', err.message);
  }
};

const clearStatusNotification = async () => {
  if (!statusSequenceId) return;
  try {
    const topic = process.env.NTFY_TOPIC || 'crumb-backplan';
    const statusTopic = topic + STATUS_TOPIC_SUFFIX;
    const baseUrl = (process.env.NTFY_URL || 'http://ntfy.local').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    await axios.post(baseUrl, JSON.stringify({
      topic: statusTopic,
      title: '✅ Backen abgeschlossen',
      message: 'Kein aktiver Backvorgang',
      tags: ['white_check_mark'],
      priority: 1,
    }), { headers });
    statusSequenceId = null;
  } catch (err) {
    console.error('❌ clearStatus Fehler:', err.message);
  }
};

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

// ── Aktions-Cluster bilden ───────────────────────────────────
function buildActionClusters(timeline) {
  const clusters = [];
  let current = null;

  for (const step of timeline) {
    if (step.type === 'Warten' || step.type === 'Kühl' || step.type === 'Ruhen') {
      if (current) { clusters.push(current); current = null; }
      continue;
    }

    if (step.type === 'Backen') {
      if (current) { clusters.push(current); current = null; }
      clusters.push({
        start: step.start,
        end: step.end,
        steps: [step],
        totalDuration: step.duration,
        isBaking: true,
      });
      continue;
    }

    if (!current) {
      current = { start: step.start, end: step.end, steps: [step], totalDuration: step.duration, isBaking: false };
    } else {
      current.steps.push(step);
      current.end = step.end;
      current.totalDuration += step.duration;
    }
  }
  if (current) clusters.push(current);
  return clusters;
}

// ── Fix 3: Nur wichtige Cluster benachrichtigen ──────────────
// Kriterien für "benachrichtigungswürdig":
// - Backen-Cluster: immer
// - Cluster mit aktiver Handlung (kneten, formen, falten, einschießen, …)
// - Cluster der mindestens 2 Aktionsschritte enthält
// - Cluster nach einer langen Pause (>= 30 Min Wartezeit davor)
const IMPORTANT_KEYWORDS = [
  'kneten', 'falten', 'formen', 'wirken', 'einschießen', 'einschneiden',
  'schwaden', 'stürzen', 'dehnen', 'vorformen', 'aufarbeiten', 'portionieren',
  'mischen', 'autolyse', 'vermengen', 'verkneten', 'rundwirken', 'langwirken',
];

function isImportantCluster(cluster, allClusters, clusterIndex) {
  if (cluster.isBaking) return true;
  if (cluster.steps.length >= 2) return true;

  const instruction = (cluster.steps[0]?.instruction || '').toLowerCase();
  if (IMPORTANT_KEYWORDS.some(kw => instruction.includes(kw))) return true;

  // Nach langer Pause (>= 30 Min) immer benachrichtigen
  if (clusterIndex > 0) {
    const prevCluster = allClusters[clusterIndex - 1];
    const pauseMs = cluster.start.getTime() - prevCluster.end.getTime();
    if (pauseMs >= 30 * 60 * 1000) return true;
  }

  // Erster Cluster des Tages immer
  if (clusterIndex === 0) return true;

  return false;
}

// ── Vorheiz-Notifications ────────────────────────────────────
const PREHEAT_VORLAUF = 45;

function extractTemp(instruction) {
  const match = instruction.match(/(\d{2,3})\s*°\s*C?|(\d{2,3})\s*[Gg]rad/);
  return match ? (match[1] || match[2]) : null;
}

function buildPreheatNotifications(clusters, recipeTitle, recipeId) {
  const notifications = [];
  for (const cluster of clusters) {
    if (!cluster.isBaking) continue;
    const step = cluster.steps[0];
    const preheatTime = new Date(cluster.start.getTime() - PREHEAT_VORLAUF * 60000);
    const temp = extractTemp(step.instruction);

    // Fix 1: Inhaltsbasierte ID — nicht timestamp-abhängig
    const contentKey = `preheat-${cluster.steps[0]?.phase || 'backen'}-${temp || 'x'}`;
    const notifId = buildNotifId(recipeId, 'preheat', contentKey);

    const backTimeStr = cluster.start.toLocaleTimeString('de-DE', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    });

    notifications.push({
      notifId,
      notifyAt: preheatTime,
      deadline: cluster.start,
      title: temp ? `🔥 Ofen vorheizen auf ${temp}°C` : `🔥 Ofen vorheizen`,
      message: `${recipeTitle} · Backen startet um ${backTimeStr} Uhr`,
    });
  }
  return notifications;
}

// ── Cluster-Notification formatieren ────────────────────────
function formatClusterNotification(cluster, recipeTitle, allClusters, clusterIndex) {
  const startTime = cluster.start.toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
  });

  // Nächster Schritt als Ausblick
  const nextCluster = allClusters && clusterIndex < allClusters.length - 1
    ? allClusters[clusterIndex + 1]
    : null;
  const nextTimeStr = nextCluster
    ? nextCluster.start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
    : null;
  const nextLabel = nextCluster
    ? (nextCluster.isBaking ? '🔥 Backen' : nextCluster.steps[0]?.instruction.substring(0, 25))
    : null;
  const outlookSuffix = nextLabel ? ` · Danach: ${nextLabel} um ${nextTimeStr}` : '';

  if (cluster.isBaking) {
    const step = cluster.steps[0];
    return {
      title: `🔥 Backen: ${step.instruction.substring(0, 50)}`,
      message: `${recipeTitle} · ${step.phase} · Um ${startTime} Uhr · ${step.duration} Min${outlookSuffix}`,
    };
  }

  if (cluster.steps.length === 1) {
    const step = cluster.steps[0];
    return {
      title: `🔔 ${step.instruction.substring(0, 55)}`,
      message: `${recipeTitle} · ${step.phase} · Um ${startTime} Uhr${outlookSuffix}`,
    };
  }

  const stepNames = cluster.steps.map(s => {
    const short = s.instruction.substring(0, 25);
    return short.length < s.instruction.length ? short.replace(/\s+\S*$/, '') + '…' : short;
  });
  const summary = stepNames.length <= 3
    ? stepNames.join(' → ')
    : `${stepNames.slice(0, 2).join(' → ')} → +${stepNames.length - 2} weitere`;

  return {
    title: `🔔 ${cluster.steps.length} Schritte ab ${startTime}`,
    message: `${recipeTitle} · ${summary} · ca. ${cluster.totalDuration} Min aktive Zeit${outlookSuffix}`,
  };
}

// ── Smart Vorlauf-Berechnung ─────────────────────────────────
function calculateSmartVorlauf(cluster, allClusters, clusterIndex) {
  // Wie lange ist die Pause vor diesem Cluster?
  if (clusterIndex === 0) return NTFY_VORLAUF;
  const prevCluster = allClusters[clusterIndex - 1];
  const pauseMin = (cluster.start.getTime() - prevCluster.end.getTime()) / 60000;

  // Skalierung: kurze Pause → kurzer Vorlauf, lange Pause → langer Vorlauf
  if (pauseMin < 15) return 3;
  if (pauseMin < 30) return 5;
  if (pauseMin < 60) return 8;
  if (pauseMin < 120) return 12;
  return 20;
}

// ── Haupt-Notification-Schleife ──────────────────────────────
const checkAndNotify = async () => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.email as user_email FROM recipes r JOIN users u ON r.user_id = u.id WHERE r.planned_at IS NOT NULL`
    );
    const now = new Date();
    let hasActiveBaking = false;

    for (const recipe of result.rows) {
      if (!recipe.dough_sections) continue;
      const timeline = calculateTimeline(recipe.planned_at, recipe.dough_sections);
      const clusters = buildActionClusters(timeline);

      // Gibt es noch zukünftige Cluster?
      const futureClusters = clusters.filter(c => c.end > now);
      if (futureClusters.length > 0) hasActiveBaking = true;

      // 1) Vorheiz-Notifications (45 Min vor Backen)
      const preheatNotifs = buildPreheatNotifications(clusters, recipe.title, recipe.id);
      for (const pn of preheatNotifs) {
        // Fix 1+2: inhaltsbasierte ID + Cooldown
        if (hasRecentlySent(pn.notifId)) continue;
        if (now >= pn.notifyAt && now < pn.deadline) {
          await sendNtfyNotification(pn.title, pn.message);
          markSent(pn.notifId);
        }
      }

      // 2) Cluster-Notifications
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];

        // Fix 3: Nur wichtige Cluster
        if (!isImportantCluster(cluster, clusters, i)) continue;

        // Fix 1: Inhaltsbasierte ID
        const contentKey = cluster.isBaking
          ? `backen-${cluster.steps[0]?.phase}`
          : cluster.steps.map(s => s.instruction.substring(0, 20)).join('|');
        const notifId = buildNotifId(recipe.id, 'cluster', contentKey);

        // Fix 2: Cooldown
        if (hasRecentlySent(notifId)) continue;

        const smartVorlauf = calculateSmartVorlauf(cluster, clusters, i);
        const notifyAt = new Date(cluster.start.getTime() - smartVorlauf * 60000);

        if (now >= notifyAt && now < cluster.start) {
          const { title, message } = formatClusterNotification(cluster, recipe.title, clusters, i);
          await sendNtfyNotification(title, message);
          markSent(notifId);
        }
      }

      // Fix 4: Status-Notification aktualisieren
      const nextCluster = clusters.find(c => c.start > now);
      if (nextCluster) {
        await sendStatusNotification(recipe.title, nextCluster, recipe.planned_at);
      }
    }

    // Fix 4: Wenn kein aktiver Backvorgang mehr → Status löschen
    if (!hasActiveBaking && statusSequenceId) {
      await clearStatusNotification();
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
      if (f === 'Favoriten') {
        conditions.push('is_favorite = true');
      } else if (f === 'Geplant') {
        conditions.push('planned_at IS NOT NULL');
      } else if (f === 'Sauerteig') {
        const idx = params.push('%sauerteig%');
        conditions.push(`(title ILIKE $${idx} OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(dough_sections) AS sec
          WHERE sec->>'name' ILIKE $${idx}
        ))`);
      } else if (f === 'Hefe') {
        const idx = params.push('%hefe%');
        conditions.push(`(title ILIKE $${idx} OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(dough_sections) AS sec,
                        jsonb_array_elements(sec->'ingredients') AS ing
          WHERE ing->>'name' ILIKE $${idx}
        ))`);
      } else if (f === 'Vollkorn') {
        const idx = params.push('%vollkorn%');
        conditions.push(`(title ILIKE $${idx} OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(dough_sections) AS sec,
                        jsonb_array_elements(sec->'ingredients') AS ing
          WHERE ing->>'name' ILIKE $${idx}
        ))`);
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
  const { is_favorite, planned_at, planned_timeline } = req.body;
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

      // planned_at auf null → Notifications aufräumen
      if (!planned_at) {
        clearSentNotificationsForRecipe(id);
      }

      result = await pool.query(
        "UPDATE recipes SET planned_at=$1, planned_timeline=$2 WHERE id=$3 AND user_id=$4 RETURNING *",
        [planned_at || null, timelineToSave ? JSON.stringify(timelineToSave) : null, id, req.user.userId]
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
      [newPlannedAt, id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });

    const recipe = result.rows[0];

    // Notifications für dieses Rezept aus dem Cache löschen
    // → nächste checkAndNotify-Runde bewertet alle Cluster mit neuen Zeiten neu
    // Fix 1+2: clearSentNotificationsForRecipe löscht Map-Einträge für dieses Rezept,
    // aber der 15-Min-Cooldown verhindert sofortigen Spam bei sehr kurzem Zeitversatz.
    clearSentNotificationsForRecipe(id);

    // Sofortige Notification bei early completion wenn nächster Cluster sehr bald
    if (recipe.dough_sections) {
      const timeline = calculateTimeline(newPlannedAt, recipe.dough_sections);
      const clusters = buildActionClusters(timeline);
      const now = new Date();
      const completedTime = new Date(completedAt);

      // Vorheiz-Notifications prüfen
      const preheatNotifs = buildPreheatNotifications(clusters, recipe.title, id);
      for (const pn of preheatNotifs) {
        if (hasRecentlySent(pn.notifId)) continue;
        if (now >= pn.notifyAt && now < pn.deadline) {
          await sendNtfyNotification(pn.title, pn.message);
          markSent(pn.notifId);
        }
      }

      // Nächster wichtiger Cluster
      const nextImportantCluster = clusters.find((c, i) =>
        c.start > completedTime && c.start > now && isImportantCluster(c, clusters, i)
      );

      if (nextImportantCluster) {
        const clusterIndex = clusters.indexOf(nextImportantCluster);
        const smartVorlauf = calculateSmartVorlauf(nextImportantCluster, clusters, clusterIndex);
        const minutesUntil = (nextImportantCluster.start.getTime() - now.getTime()) / 60000;

        const contentKey = nextImportantCluster.isBaking
          ? `backen-${nextImportantCluster.steps[0]?.phase}`
          : nextImportantCluster.steps.map(s => s.instruction.substring(0, 20)).join('|');
        const notifId = buildNotifId(id, 'cluster', contentKey);

        if (minutesUntil >= 1 && minutesUntil < smartVorlauf && !hasRecentlySent(notifId)) {
          const { title, message } = formatClusterNotification(nextImportantCluster, recipe.title, clusters, clusterIndex);
          await sendNtfyNotification(`⏰ ${title}`, message);
          markSent(notifId);
        }

        // Status-Notification sofort aktualisieren
        await sendStatusNotification(recipe.title, nextImportantCluster, newPlannedAt);
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

    clearSentNotificationsForRecipe(id);
    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('❌ plan-night/save Fehler:', err.message);
    res.status(500).json({ error: 'Speicherfehler', details: err.message });
  }
});

app.get('/api/ntfy/status', (req, res) => {
  res.json({
    ntfy_url: process.env.NTFY_URL || 'http://ntfy.local',
    topic: process.env.NTFY_TOPIC || 'crumb-backplan',
    gesendete_notifications: sentNotifications.size,
    status_sequence_id: statusSequenceId,
  });
});

// ============================================================
// SERVER STARTEN
// ============================================================
const PORT = 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  await initDB();
  // Haupt-Schleife: alle 60 Sek prüfen + Status alle 15 Min aktualisieren
  setInterval(checkAndNotify, 60000);
  // Status-Notification alle 15 Min auch ohne neue Schritt-Events aktualisieren
  setInterval(async () => {
    try {
      const result = await pool.query(
        'SELECT r.*, u.email as user_email FROM recipes r JOIN users u ON r.user_id = u.id WHERE r.planned_at IS NOT NULL'
      );
      const now = new Date();
      for (const recipe of result.rows) {
        if (!recipe.dough_sections) continue;
        const timeline = calculateTimeline(recipe.planned_at, recipe.dough_sections);
        const clusters = buildActionClusters(timeline);
        const nextCluster = clusters.find(c => c.start > now);
        if (nextCluster) {
          await sendStatusNotification(recipe.title, nextCluster, recipe.planned_at);
          break; // Nur für das erste aktive Rezept
        }
      }
    } catch (err) { console.error('❌ Status-Update Fehler:', err.message); }
  }, 15 * 60 * 1000);
});