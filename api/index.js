require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { getScraper } = require('./scrapers/index');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, login, register, verify, requestPasswordReset, resetPassword, changePassword } = require('./auth');

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
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// ============================================================
// MULTER KONFIGURATION
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDir); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });

// ============================================================
// DATENBANK POOL & INIT
// ============================================================
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const initDB = async () => {
  const createRecipesTable = `
    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY, 
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, 
      subtitle TEXT, 
      description TEXT, 
      image_url TEXT, 
      source_url TEXT,
      ingredients JSONB, 
      dough_sections JSONB, 
      steps JSONB, 
      is_favorite BOOLEAN DEFAULT false,
      planned_at TIMESTAMP WITHOUT TIME ZONE, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  const createRecipesUserIdIndex = `
    CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
  `;
  
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
    );
  `;
  
  let retries = 10;
  while (retries > 0) {
    try { 
      await pool.query(createUsersTable);
      await pool.query(createRecipesTable);
      await pool.query(createRecipesUserIdIndex);
      console.log("✅ Datenbank bereit"); 
      return;
    } catch (err) { 
      console.log(`🔌 DB-Init Fehler: ${err.message} (${retries} Versuche verbleibend)`);
      retries -= 1;
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

const sendNtfyNotification = async (title, message, tags = 'bread') => {
  try {
    const headers = { 
      'Title': title.replace(/[^\x20-\x7E]/g, ''), 
      'Tags': tags, 
      'Priority': '4' 
    };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    
    const url = `${process.env.NTFY_URL || 'http://ntfy.local'}/${process.env.NTFY_TOPIC || 'crumb-backplan'}`;
    await axios.post(url, message, { headers });
    console.log(`🔔 Notification gesendet: ${title}`);
  } catch (err) { 
    console.error('❌ ntfy Fehler:', err.message); 
  }
};

const calculateTimeline = (plannedAt, sections) => {
    if (!sections || sections.length === 0) return [];
    const target = new Date(plannedAt);
    let currentMoment = new Date(target.getTime());
    const timeline = [];
    const reversedSections = [...sections].reverse();
    let mergePoint = new Date(currentMoment.getTime());
  
    reversedSections.forEach((section) => {
      const steps = section.steps || [];
      const totalDuration = steps.reduce((sum, step) => sum + (parseInt(step.duration) || 0), 0);
      const isParallel = (section.name || '').toLowerCase().includes('vorteig') || section.is_parallel;
      const endTime = isParallel ? new Date(mergePoint.getTime()) : new Date(currentMoment.getTime());
      const startTime = new Date(endTime.getTime() - totalDuration * 60000);
      let stepMoment = new Date(startTime.getTime());
      
      const detailedSteps = steps.map((step) => {
        const duration = parseInt(step.duration) || 0;
        const stepStart = new Date(stepMoment.getTime());
        const stepEnd = new Date(stepMoment.getTime() + duration * 60000);
        stepMoment = stepEnd;
        return { 
          phase: section.name, 
          instruction: step.instruction, 
          type: step.type, 
          duration, 
          start: stepStart, 
          end: stepEnd 
        };
      });
      timeline.push(...detailedSteps);
      if (!isParallel) {
        currentMoment = startTime;
        mergePoint = startTime;
      }
    });
    return timeline.reverse(); 
};

const checkAndNotify = async () => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.email as user_email 
      FROM recipes r 
      JOIN users u ON r.user_id = u.id 
      WHERE r.planned_at IS NOT NULL
    `);
    const now = new Date();
    for (const recipe of result.rows) {
      if (!recipe.dough_sections) continue;
      const timeline = calculateTimeline(recipe.planned_at, recipe.dough_sections);
      for (const step of timeline) {
        const notifId = `${recipe.id}-${step.start.getTime()}`;
        if (sentNotifications.has(notifId)) continue;

        const notifyAt = new Date(step.start.getTime() - NTFY_VORLAUF * 60000);
        if (now >= notifyAt && now < step.start) {
          const startTime = step.start.toLocaleTimeString('de-DE', { 
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' 
          });
          await sendNtfyNotification(recipe.title, `Um ${startTime}: ${step.instruction} (${step.phase})`);
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

// Apply authentication middleware to all routes below
app.use(authenticateToken);

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

app.post('/api/import', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Keine URL angegeben" });

  try {
    // Sicherstellen, dass getScraper existiert
    if (typeof getScraper !== 'function') {
        console.error("❌ Kritischer Fehler: getScraper ist keine Funktion!", typeof getScraper);
        return res.status(500).json({ error: "Server Konfigurationsfehler" });
    }

    const scraper = getScraper(url);
    if (!scraper) return res.status(400).json({ error: "Webseite nicht unterstützt" });
    
    console.log("🔍 Starte Scraping für:", url);
    const recipeData = await scraper(url);

    if (!recipeData) return res.status(500).json({ error: "Konnte keine Daten extrahieren" });

    // Bild-Download Logik
    if (recipeData.image_url && recipeData.image_url.startsWith('http')) {
      try {
        const response = await axios.get(recipeData.image_url, { 
          responseType: 'arraybuffer',
          timeout: 7000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        const fullPath = path.join(uploadDir, fileName);
        fs.writeFileSync(fullPath, response.data);
        recipeData.image_url = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      } catch (e) { console.error("⚠️ Bild-Fehler:", e.message); }
    }

    res.json(recipeData);
  } catch (error) {
    console.error("🚨 IMPORT FEHLER:", error.message);
    res.status(500).json({ error: "Fehler beim Verarbeiten" });
  }
});

// Parse recipe from uploaded HTML file
app.post('/api/import/html', async (req, res) => {
  try {
    const { html, filename } = req.body;
    
    if (!html) {
      return res.status(400).json({ error: 'No HTML content provided' });
    }

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    let recipeData = null;
    const fname = filename || 'uploaded.html';
    
    // Try to detect source and parse
    if (fname.includes('ploetzblog')) {
      const { parseHtml } = require('./scrapers/ploetzblog');
      recipeData = await parseHtml($, fname);
    } else if (fname.includes('homebaking')) {
      const { parseHtml } = require('./scrapers/homebaking');
      recipeData = await parseHtml($, fname);
    } else {
      // Default to Plötzblog parser
      const { parseHtml } = require('./scrapers/ploetzblog');
      recipeData = await parseHtml($, fname);
    }

    if (!recipeData) {
      return res.status(400).json({ 
        error: 'Could not parse recipe from HTML. Make sure it\'s a supported recipe page.' 
      });
    }

    // Bild-Download Logik (wie bei /api/import)
    if (recipeData.image_url && recipeData.image_url.startsWith('http')) {
      try {
        const response = await axios.get(recipeData.image_url, { 
          responseType: 'arraybuffer',
          timeout: 7000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        const fullPath = path.join(uploadDir, fileName);
        fs.writeFileSync(fullPath, response.data);
        recipeData.image_url = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      } catch (e) { console.error("⚠️ Bild-Fehler:", e.message); }
    }

    res.json(recipeData);
  } catch (error) {
    console.error("🚨 HTML PARSE FEHLER:", error.message);
    res.status(500).json({ error: 'Failed to parse HTML file' });
  }
});

app.get('/api/recipes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM recipes WHERE user_id = $1 ORDER BY created_at DESC', [req.user.userId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/recipes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM recipes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes', async (req, res) => {
  const { title, description, image_url, ingredients, dough_sections, steps } = req.body;
  try {
    const query = `INSERT INTO recipes (user_id, title, description, image_url, ingredients, dough_sections, steps) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;`;
    const values = [req.user.userId, title, description, image_url, JSON.stringify(ingredients || []), JSON.stringify(dough_sections || []), JSON.stringify(steps || [])];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Datenbankfehler" }); }
});

app.put('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, image_url, ingredients, steps, description, dough_sections } = req.body;
  try {
    const query = `UPDATE recipes SET title = $1, image_url = $2, ingredients = $3, steps = $4, description = $5, dough_sections = $6 WHERE id = $7 AND user_id = $8 RETURNING *;`;
    const values = [title, image_url, JSON.stringify(ingredients), JSON.stringify(steps), description, JSON.stringify(dough_sections), id, req.user.userId];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Update-Fehler" }); }
});

app.delete('/api/recipes/:id', async (req, res) => {
  try { 
    const result = await pool.query('DELETE FROM recipes WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.user.userId]); 
    if (result.rowCount === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json({ message: "Gelöscht" }); 
  } catch (err) { res.status(500).json({ error: "Löschfehler" }); }
});

app.patch('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { is_favorite, planned_at } = req.body;
  try {
    let result;
    if (planned_at !== undefined) result = await pool.query("UPDATE recipes SET planned_at = $1 WHERE id = $2 AND user_id = $3 RETURNING *", [planned_at, id, req.user.userId]);
    else if (is_favorite !== undefined) result = await pool.query("UPDATE recipes SET is_favorite = $1 WHERE id = $2 AND user_id = $3 RETURNING *", [is_favorite, id, req.user.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Patch-Fehler" }); }
});

app.get('/api/ntfy/status', (req, res) => {
  res.json({ 
    ntfy_url: process.env.NTFY_URL || 'http://ntfy.local', 
    topic: process.env.NTFY_TOPIC || 'crumb-backplan', 
    gesendete_notifications: sentNotifications.size 
  });
});

// ============================================================
// SERVER STARTEN
// ============================================================
const PORT = 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Backend läuft auf Port ${PORT}`);
  console.log('DEBUG: Typ von getScraper ist:', typeof getScraper);
  await initDB();
  setInterval(checkAndNotify, 60000);
});