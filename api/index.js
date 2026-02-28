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
      ingredients JSONB,
      dough_sections JSONB,
      steps JSONB,
      is_favorite BOOLEAN DEFAULT false,
      planned_at TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

  const createIndex = `CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);`;

  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query(createUsersTable);
      await pool.query(createRecipesTable);
      await pool.query(createIndex);
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

const sendNtfyNotification = async (title, message, tags = 'bread') => {
  try {
    const url = `${process.env.NTFY_URL || 'http://ntfy.local'}/${process.env.NTFY_TOPIC || 'crumb-backplan'}`;
    const body = { topic: process.env.NTFY_TOPIC || 'crumb-backplan', title, message, tags: [tags], priority: 4 };
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NTFY_TOKEN) headers['Authorization'] = `Bearer ${process.env.NTFY_TOKEN}`;
    await axios.post(url, body, { headers });
    console.log(`🔔 Notification gesendet: ${title}`);
  } catch (err) {
    console.error('❌ ntfy Fehler:', err.message);
  }
};

const calculateTimeline = (plannedAt, sections) => {
  if (!sections || sections.length === 0) return [];
  const target = new Date(plannedAt);
  const timeline = [];

  // --- Dependency Graph aufbauen ---
  // Erkennt "gesamte Sauerteigstufe 1" in Zutaten → Phase hängt von "Sauerteigstufe 1" ab
  const phaseNames = sections.map(s => s.name);
  const deps = {};
  sections.forEach(section => {
    deps[section.name] = [];
    (section.ingredients || []).forEach(ing => {
      const ingName = (ing.name || '').toLowerCase();
      phaseNames.forEach(otherName => {
        if (otherName !== section.name && ingName.includes(otherName.toLowerCase())) {
          if (!deps[section.name].includes(otherName)) {
            deps[section.name].push(otherName);
          }
        }
      });
    });
  });

  // --- Start/End-Offsets berechnen (Minuten vor Zielzeit) ---
  const sectionMap = Object.fromEntries(sections.map(s => [s.name, s]));
  const endOffsets = {};
  const startOffsets = {};

  function calcEndOffset(name, visited = new Set()) {
    if (name in endOffsets) return endOffsets[name];
    if (visited.has(name)) return 0; // Zyklusschutz
    visited.add(name);

    // Wer braucht diese Phase als Input?
    const dependents = sections
      .map(s => s.name)
      .filter(n => deps[n] && deps[n].includes(name));

    if (dependents.length === 0) {
      // Niemand braucht diese Phase explizit → endet beim Ziel (offset 0)
      endOffsets[name] = 0;
    } else {
      // Endet wenn der früheste Dependent startet
      const minStart = Math.min(...dependents.map(d => calcStartOffset(d, new Set(visited))));
      endOffsets[name] = minStart;
    }
    return endOffsets[name];
  }

  function calcStartOffset(name, visited = new Set()) {
    if (name in startOffsets) return startOffsets[name];
    const end = calcEndOffset(name, visited);
    const dur = (sectionMap[name].steps || []).reduce(
      (sum, s) => sum + (parseInt(s.duration) || 0), 0
    );
    startOffsets[name] = end + dur;
    return startOffsets[name];
  }

  sections.forEach(s => calcStartOffset(s.name));

  // --- Timeline aufbauen ---
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
        isParallel: (endOffsets[section.name] || 0) > 0,
      });
      stepMoment = stepEnd;
    });
  });

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
};


// FIX: Nur Aktions-Steps notifizieren, Warteschritte ignorieren
// Title = Aktion, Body = Kontext (Rezept · Phase · Uhrzeit)
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
        // Warteschritte ignorieren – nur Aktionen notifizieren
        if (step.type === 'Warten') continue;

        const notifId = `${recipe.id}-${step.start.getTime()}`;
        if (sentNotifications.has(notifId)) continue;

        const notifyAt = new Date(step.start.getTime() - NTFY_VORLAUF * 60000);
        if (now >= notifyAt && now < step.start) {
          const startTime = step.start.toLocaleTimeString('de-DE', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
          });
          const title = `🔔 ${step.instruction.substring(0, 60)}`;
          const body  = `${recipe.title} · ${step.phase} · Um ${startTime} Uhr`;
          await sendNtfyNotification(title, body);
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
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
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
    if (recipeData.image_url && recipeData.image_url.startsWith('http')) {
      try {
        const response = await axios.get(recipeData.image_url, { responseType: 'arraybuffer', timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        fs.writeFileSync(path.join(uploadDir, fileName), response.data);
        recipeData.image_url = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      } catch (e) { console.error("⚠️ Bild-Fehler:", e.message); }
    }
    res.json(recipeData);
  } catch (error) {
    console.error("🚨 IMPORT FEHLER:", error.message);
    res.status(500).json({ error: "Fehler beim Verarbeiten" });
  }
});

// ============================================================
// HELPER FUNCTIONS für Step-Extraktion
// ============================================================

// FIX: Intervall-Minuten ("dabei nach 45 Minuten") nicht zur Gesamtdauer addieren
function extractDuration(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();

  const hourRangeMatch = lower.match(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(?:stunden?|std\.?)/);
  if (hourRangeMatch) return Math.round(parseFloat(hourRangeMatch[2].replace(',', '.')) * 60);

  const hourMatch = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const hasDabei  = /dabei|nach\s+\d+\s*min/i.test(text);
  const minMatch  = !hasDabei ? lower.match(/(\d+)\s*(?:minuten?|min\.?|min\b)/) : null;

  let total = 0;
  if (hourMatch) total += Math.round(parseFloat(hourMatch[1].replace(',', '.')) * 60);
  if (minMatch)  total += parseInt(minMatch[1]);

  if (total === 0) {
    const timeMatch = text.match(/(\d+):(\d+)\s*(?:Uhr|Stunden)?/i);
    if (timeMatch) total = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }
  return total;
}

function detectStepType(text) {
  if (!text) return 'Aktion';
  const lower = text.toLowerCase();
  if (lower.match(/reifen|ruhen|gehen|aufgehen|stockgare|stückgare|gare\s/)) return 'Warten';
  if (lower.match(/\d+\s*(stunden?|minuten?|std|min|h)\s+(bei|reifen|ruhen|gehen)/i)) return 'Warten';
  if (lower.match(/^\d+[,.]?\d*\s*stunden?\s+bei/i)) return 'Warten';
  return 'Aktion';
}

// FIX: Haupttext wird vor "Dabei" abgeschnitten und von Zeit/Temp bereinigt
function parseRepeatingActions(instruction, totalDuration) {
  const steps = [];

  const buildMainInstruction = (text) => {
    let main = text.split(/\.\s*[Dd]abei\b|,\s*[Dd]abei\b/)[0].trim();
    main = main
      .replace(/\d+[,.]?\d*\s*(?:Stunden?|Minuten?|h\b|min\.?)/gi, '')
      .replace(/bei\s+\d+\s*°C\s*/gi, '')
      .replace(/^[,.]?\s*/, '')
      .trim();
    if (!main) main = text.split(',')[0].trim();
    return main ? main.charAt(0).toUpperCase() + main.slice(1) : main;
  };

  const capitalizeAction = (raw) => {
    const s = raw.trim().replace(/\.$/, '');
    // Nur erstes Wort groß (Satzanfang), Rest unverändert
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // Format A: "dabei nach X, Y und Z Minuten/Stunden <Aktion>"
  const matchA = instruction.match(/dabei\s+nach\s+([\d,.\sund]+)\s*(minuten?|stunden?)\s+(.+)/i);
  if (matchA) {
    const isStunden = /stunden?/i.test(matchA[2]);
    const intervals = matchA[1]
      .replace(/\s*und\s*/gi, ',')
      .split(/[,\s]+/)
      .map(n => parseInt(n))
      .filter(n => !isNaN(n) && n > 0)
      .map(n => isStunden ? n * 60 : n);

    if (intervals.length > 0) {
      const action = capitalizeAction(matchA[3]);
      const mainInstruction = buildMainInstruction(instruction);
      console.log(`🔄 Format A: ${intervals.join(', ')} Min → ${intervals.length * 2 + 1} Schritte`);
      let lastTime = 0;
      intervals.forEach((time) => {
        const waitDuration = time - lastTime;
        if (waitDuration > 0) steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
        steps.push({ instruction: action, duration: 5, type: 'Aktion' });
        lastTime = time + 5;
      });
      if (lastTime < totalDuration) steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
      return steps;
    }
  }

  // Format B: "dabei alle X Minuten <Aktion> (Nx)"
  const matchB = instruction.match(/dabei\s+alle\s+(\d+)\s*minuten?\s+(.+?)(?:\s*\((\d+)x\))?\.?\s*$/i);
  if (matchB) {
    const interval = parseInt(matchB[1]);
    const action = capitalizeAction(matchB[2]);
    const count = matchB[3]
      ? parseInt(matchB[3])
      : Math.max(1, Math.floor(totalDuration / interval) - 1);
    const mainInstruction = buildMainInstruction(instruction);
    console.log(`🔄 Format B: alle ${interval} Min × ${count} → ${count * 2 + 1} Schritte`);
    let lastTime = 0;
    for (let i = 0; i < count; i++) {
      const nextTime = (i + 1) * interval;
      const waitDuration = nextTime - lastTime;
      if (waitDuration > 0) steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
      steps.push({ instruction: action, duration: 5, type: 'Aktion' });
      lastTime = nextTime + 5;
    }
    if (lastTime < totalDuration) steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
    return steps;
  }

  return null;
}

// ============================================================
// HTML IMPORT
// ============================================================
app.post('/api/import/html', async (req, res) => {
  try {
    const { html, filename } = req.body;
    if (!html) return res.status(400).json({ error: 'No HTML content provided' });

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    let recipeData = {
      title: $('h1.entry-title').first().text().trim() || $('h1').first().text().trim() || 'Importiertes Rezept',
      description: '',
      image_url: '',
      source_url: filename || 'uploaded.html',
      ingredients: [],
      steps: [],
      dough_sections: []
    };

    // ---- BILD ------------------------------------------------
    let imageUrl = '';
    const cloudimgMatch = html.match(/https?:\/\/[^"']*cloudimg\.io[^"']*\/entity\/gallery\/[^"']*\.jpg[^"']*/);
    if (cloudimgMatch) {
      imageUrl = cloudimgMatch[0]
        .replace(/^\/\//, 'https://')
        .replace(/\?p=w\d+/, '?p=w800')
        .replace(/\?p=grid-[^&\s"']+/, '?p=w800');
      console.log('✅ Cloudimg gefunden:', imageUrl);
    } else {
      const imgCandidates = [];
      $('img').each((i, img) => {
        const src = $(img).attr('src');
        const parent = $(img).parent().text();
        if (parent.includes('Kommentare') || parent.includes('Benötigtes Zubehör') || parent.includes('Rezept drucken')) return;
        if (src && !src.includes('scr.png') && !src.includes('Partner') && !src.includes('icon') && !src.includes('logo') && !src.includes('.svg') && !src.startsWith('data:image/svg') &&
            (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) {
          const size = (parseInt($(img).attr('width')) || 0) * (parseInt($(img).attr('height')) || 0);
          imgCandidates.push({ src, size });
        }
      });
      imgCandidates.sort((a, b) => b.size - a.size);
      if (imgCandidates.length > 0) {
        const imgSrc = imgCandidates[0].src;
        if (imgSrc.startsWith('data:image') && !imgSrc.startsWith('data:image/svg')) imageUrl = imgSrc;
        else if (imgSrc.match(/^\/[A-Z0-9]+\//) || imgSrc.includes('-Dateien/')) imageUrl = 'https://archive.is/' + imgSrc.replace(/^\//, '');
        else if (imgSrc.startsWith('http')) imageUrl = imgSrc;
        else if (!imgSrc.startsWith('data:')) imageUrl = 'https://archive.is/' + imgSrc;
      }
      if (!imageUrl) {
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && !ogImage.includes('scr.png') && !ogImage.includes('.svg')) imageUrl = ogImage;
      }
      // smry.app: lokale Dateipfade → Plötzblog-Originalbild + Beschreibung holen
      if (imageUrl && (imageUrl.includes('_files/') || imageUrl.startsWith('Article%20'))) {
        imageUrl = '';
        const ogUrl = $('meta[property="og:url"]').attr('content') || '';
        const ploetzMatch = ogUrl.match(/https?:\/\/(?:smry\.ai\/)?(.+ploetzblog\.de.+)/);
        if (ploetzMatch) {
          const ploetzUrl = ploetzMatch[1].startsWith('http') ? ploetzMatch[1] : 'https://' + ploetzMatch[1];
          try {
            console.log('🔍 Hole Plötzblog-Seite für Bild:', ploetzUrl);
            const ploetzRes = await axios.get(ploetzUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $p = cheerio.load(ploetzRes.data);
            const ploetzOgImage = $p('meta[property="og:image"]').attr('content') || '';
            console.log('🖼️ Plötzblog og:image:', ploetzOgImage.slice(0, 100));
            if (ploetzOgImage && ploetzOgImage.startsWith('http') && !ploetzOgImage.includes('.svg')) {
              imageUrl = ploetzOgImage.replace(/[?&]p=w\d+/g, '').replace(/[?&]width=\d+/g, '');
              console.log('✅ Plötzblog-Bild:', imageUrl.slice(0, 80));
            }
            const ploetzDesc = $p('meta[property="og:description"]').attr('content') || '';
            if (ploetzDesc.length > 20) {
              recipeData.description = ploetzDesc;
              console.log('📝 Plötzblog-Beschreibung:', ploetzDesc.slice(0, 80));
            }
          } catch(e) {
            console.log('⚠️ Plötzblog nicht abrufbar:', e.message);
          }
        }
      }
    }
    recipeData.image_url = imageUrl;

    // ---- BESCHREIBUNG ----------------------------------------
    let description = $('meta[property="og:description"]').attr('content') || '';
    if (!description || description.length < 50) {
      const skipWords = ['Produktempfehlung','Anzeige','Mitgliedschaft','Kommentare','Rezept drucken','Benötigtes Zubehör','Häufig gestellte Fragen','Amazon','Otto','Steady','Newsletter','Copyright'];
      let foundH1 = false;
      $('h1, h2, p, div').each((i, elem) => {
        if (description) return false;
        const tag = elem.name || elem.tagName;
        const text = $(elem).text().trim();
        if (tag === 'h1') { foundH1 = true; return; }
        if (tag === 'h2' && foundH1) return;
        if (foundH1 && (tag === 'p' || tag === 'div')) {
          if (text.length < 50) return;
          if (skipWords.some(w => text.includes(w))) return;
          if (text.match(/^\d+\s*(g|ml|°C|Min|Std)/)) return;
          if (text.includes('Uhr') && text.length < 100) return;
          description = text.replace(/\s+/g, ' ').trim();
          return false;
        }
      });
    }
    if (!recipeData.description) recipeData.description = description;

    // ---- ZUTATEN ---------------------------------------------
    $('table tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 2) {
        const amount = $(cells[0]).text().trim();
        let name = $(cells[1]).text().trim();
        let temperature = '';
        const tempMatch = name.match(/(\d+)\s*°C/);
        if (tempMatch) { temperature = tempMatch[1]; name = name.replace(/\d+\s*°C/g, '').trim(); }
        let note = '';
        const noteMatch = name.match(/\(([^)]+)\)/);
        if (noteMatch) { note = noteMatch[1]; name = name.replace(/\([^)]+\)/g, '').trim(); }
        if (amount.match(/\d+[,.]?\d*\s*(g|kg|ml|l|%|EL|TL|Prise)/i) && name && name.length > 2) {
          recipeData.ingredients.push({ name, amount, unit: '', temperature, note });
        }
      }
    });

    // Deduplizierung Zutaten
    const seenIng = new Map();
    recipeData.ingredients = recipeData.ingredients.filter(ing => {
      const key = ing.name.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenIng.has(key)) return false;
      seenIng.set(key, true);
      return true;
    });
    console.log(`🥖 ${recipeData.ingredients.length} Zutaten extrahiert`);

    // ---- STEPS & PHASEN --------------------------------------
    console.log('📋 Extrahiere Phasen und Schritte...');
    const rawHtml = html;

    function htmlToText(str) {
      return (str || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function findDivContentEnd(str, startPos) {
      // depth=1: wir sind bereits innerhalb des öffnenden <div> (nach dem >)
      const tagRe = /(<\/div>|<div(?:\s[^>]*)?>)/gi;
      tagRe.lastIndex = startPos;
      let depth = 1, m;
      while ((m = tagRe.exec(str)) !== null) {
        if (m[1].startsWith('</')) { depth--; if (depth === 0) return m.index; }
        else depth++;
      }
      return str.length;
    }

    const KNOWN_PHASES = {
      'Kochstück':       { is_parallel: true  },
      'Brühstück':       { is_parallel: true  },
      'Quellstück':      { is_parallel: true  },
      'Roggensauerteig': { is_parallel: true  },
      'Weizensauerteig': { is_parallel: true  },
      'Sauerteig':       { is_parallel: true  },
      'Vorteig':         { is_parallel: true  },
      'Poolish':         { is_parallel: true  },
      'Levain':          { is_parallel: true  },
      'Autolyse':        { is_parallel: false },
      'Hauptteig':       { is_parallel: false },
    };
    // Muster für unbekannte Phasen-Namen (z.B. "Mischsauerteig", "Roggenpoolish")
    const PHASE_PATTERNS = [
      { re: /hauptteig$/i,  is_parallel: false },
      { re: /teig$/i,       is_parallel: true  },
      { re: /stück$/i,      is_parallel: true  },
      { re: /sauerteig/i,   is_parallel: true  },
      { re: /poolish/i,     is_parallel: true  },
      { re: /levain/i,      is_parallel: true  },
      { re: /autolyse/i,    is_parallel: false },
      { re: /vorteig/i,     is_parallel: true  },
    ];
    // h4-Texte die keine Phasen sind
    const NON_PHASE_H4 = ['zubehör', 'zutatenübersicht', 'planungsbeispiel', 'häufig', 'ähnliche', 'kommentar', 'fragen'];

    const detectedPhases = [];
    const h4Re = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
    let h4Match;
    while ((h4Match = h4Re.exec(rawHtml)) !== null) {
      const h4Text = htmlToText(h4Match[1]);
      if (!h4Text || h4Text.length > 60) continue;
      if (NON_PHASE_H4.some(s => h4Text.toLowerCase().includes(s))) continue;
      // Bekannte Phase?
      let found = false;
      for (const [phaseName, opts] of Object.entries(KNOWN_PHASES)) {
        if (h4Text.toLowerCase() === phaseName.toLowerCase()) {
          detectedPhases.push({ name: phaseName, is_parallel: opts.is_parallel, charPos: h4Match.index });
          found = true; break;
        }
      }
      if (found) continue;
      // Unbekannte Phase via Pattern
      for (const pat of PHASE_PATTERNS) {
        if (pat.re.test(h4Text)) {
          detectedPhases.push({ name: h4Text, is_parallel: pat.is_parallel, charPos: h4Match.index });
          break;
        }
      }
    }
    const uniquePhases = detectedPhases.filter((p, i) => i === 0 || p.name !== detectedPhases[i - 1].name);
    console.log(`Erkannte Phasen: ${uniquePhases.map(p => p.name).join(', ')}`);


    function extractIngredientsFromChunk(chunk, phaseName) {
      const ingredients = [], seen = new Set();
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let row, rowCount = 0;
      while ((row = rowRe.exec(chunk)) !== null) {
        rowCount++;
        const cells = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cell;
        while ((cell = cellRe.exec(row[1])) !== null) cells.push(htmlToText(cell[1]));
        // Leere Zellen entfernen
        const filteredCells = cells.filter(c => c.trim().length > 0);
        if (filteredCells.length < 2) continue;
        // Zutaten ohne Mengenangabe (z.B. "gesamter Roggensauerteig") haben kein Gewicht in cells[0]
        const hasAmount = /^\d/.test(filteredCells[0].trim());
        const amount = hasAmount ? filteredCells[0].trim() : '';
        let name = hasAmount ? filteredCells[1].trim() : filteredCells[0].trim();
        const temperature = (hasAmount ? filteredCells[2] : filteredCells[1]) ? (hasAmount ? filteredCells[2] : filteredCells[1]).replace('°C', '').trim() : '';
        let note = '';
        const noteMatch = name.match(/\(([^)]+)\)/);
        if (noteMatch) { note = noteMatch[1]; name = name.replace(/\([^)]+\)/g, '').trim(); }
        name = name.replace(/\s+/g, ' ').trim();
        if (!name || name.length < 2 || name.length > 120) {
          console.log(`  SKIP LEN: "${name}" len=${name.length} hasAmount=${hasAmount} cells0="${cells[0].slice(0,30)}"`);
          continue;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) { console.log(`  SKIP DUPLIKAT: "${name}"`); continue; }
        seen.add(key);
        ingredients.push({ name, amount: hasAmount ? amount : '', unit: '', temperature, note });
      }
      if (phaseName) console.log(`  [${phaseName}] rows=${rowCount} found=${ingredients.length} names=${JSON.stringify(ingredients.map(i=>i.name))}`);
      return ingredients;
    }

    function extractAllSteps(str) {
      const steps = [];

      // Methode 2: smry.app Struktur – <div><div><p>ZAHL</p></div><p>INSTRUCTION</p></div>
      const smryRe = /<div[^>]*>\s*<div>\s*<p>\s*(\d+)\s*<\/p>\s*<\/div>\s*<p>\s*([\s\S]*?)\s*<\/p>\s*<\/div>/gi;
      let smryM;
      while ((smryM = smryRe.exec(str)) !== null) {
        const instruction = htmlToText(smryM[2]);
        if (instruction.length >= 5) {
          steps.push({ pos: smryM.index, stepNum: parseInt(smryM[1]), instruction });
        }
      }
      if (steps.length > 0) {
        console.log('📋 smry.app Struktur erkannt');
        // Fallback: prose-divs mit Schritten die durch Werbung aus der Nummerierung gefallen sind
        const proseRe = /class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        let proseM;
        while ((proseM = proseRe.exec(str)) !== null) {
          // Extrahiere alle <p>-Tags aus dem prose-div
          const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
          let pM;
          while ((pM = pRe.exec(proseM[1])) !== null) {
            const instruction = htmlToText(pM[1]);
            // Nur wenn nicht schon vorhanden und lang genug
            if (instruction.length >= 10 && !steps.some(s => s.instruction === instruction)) {
              steps.push({ pos: proseM.index, stepNum: 0, instruction });
            }
          }
        }
        steps.sort((a, b) => a.pos - b.pos);
        return steps;
      }

      // Methode 1: archive.ph / Plötzblog Originalstruktur (rgba Kreise)
      const rgbaRe = /rgba\(196,\s*173,\s*130[^)]*\)/g;
      let m;
      while ((m = rgbaRe.exec(str)) !== null) {
        const pos = m.index;
        // FIX: Buffer 2000 Zeichen (rgba-style-Attribut ist >1000 Zeichen lang)
        const before = str.slice(Math.max(0, pos - 2000), pos);
        const displayMatches = before.match(/display:\s*(none|block|flex|grid)/g) || [];
        if (!displayMatches.length) continue;
        const lastDisplay = displayMatches[displayMatches.length - 1].replace(/display:\s*/, '').trim();
        if (lastDisplay !== 'flex') continue;

        const after = str.slice(pos, pos + 2000);
        const numMatch = after.match(/>(\d+)<\/div>\s*<\/div>/);
        if (!numMatch) continue;

        const circleEndAbs = pos + numMatch.index + numMatch[0].length;
        const rest = str.slice(circleEndAbs, circleEndAbs + 8000);
        const divStart = rest.indexOf('<div');
        if (divStart === -1) continue;
        const tagEndInRest = rest.indexOf('>', divStart + 4);
        if (tagEndInRest === -1) continue;
        const contentStart = tagEndInRest + 1;
        const contentEnd = findDivContentEnd(rest, contentStart);
        const instruction = htmlToText(rest.slice(contentStart, contentEnd));
        if (instruction.length < 5) continue;

        steps.push({ pos, stepNum: parseInt(numMatch[1]), instruction });
      }
      return steps;
    }

    // FIX: Deduplizierung – Reset bei jeder kleineren/gleichen Schrittnummer (neue Phase)
    const allSteps = (() => {
      const raw = extractAllSteps(rawHtml);
      console.log(`📋 ${raw.length} Schritte extrahiert (roh)`);
      const deduped = [];
      const seenInBlock = new Set();
      let lastNum = -1;
      raw.forEach(step => {
        if (step.stepNum <= lastNum) seenInBlock.clear();
        if (!seenInBlock.has(step.stepNum)) {
          seenInBlock.add(step.stepNum);
          deduped.push(step);
        }
        lastNum = step.stepNum;
      });
      console.log(`📋 ${deduped.length} Schritte nach Deduplizierung`);
      return deduped;
    })();

    // Phasen zusammenbauen
    let dough_sections = [];
    if (uniquePhases.length === 0) {
      console.log('⚠️  Keine Phasen – Fallback Hauptteig');
      const expanded = [];
      allSteps.forEach(s => {
        const duration = extractDuration(s.instruction) || 5;
        const step = { instruction: s.instruction, duration, type: detectStepType(s.instruction) };
        const rep = parseRepeatingActions(step.instruction, step.duration);
        rep ? expanded.push(...rep) : expanded.push(step);
      });
      dough_sections = [{
        name: 'Hauptteig', is_parallel: false, ingredients: recipeData.ingredients || [],
        steps: expanded.length > 0 ? expanded : [
          { instruction: 'Alle Zutaten mischen', duration: 10, type: 'Aktion' },
          { instruction: 'Teig ruhen lassen',    duration: 90, type: 'Warten' },
          { instruction: 'Backen',               duration: 45, type: 'Aktion' },
        ],
      }];
    } else {
      for (let i = 0; i < uniquePhases.length; i++) {
        const phase   = uniquePhases[i];
        const nextPos = i + 1 < uniquePhases.length ? uniquePhases[i + 1].charPos : rawHtml.length;
        const phaseChunk = rawHtml.slice(phase.charPos, nextPos);
        console.log(`  CHUNK ${phase.name}: charPos=${phase.charPos}, nextPos=${nextPos}, len=${phaseChunk.length}, hasGesamter=${phaseChunk.includes('gesamter')}`);
        // FIX: Chunk auf max 100000 Zeichen begrenzen (2.2MB Chunks verursachen Regex-Probleme)
        const limitedChunk = phaseChunk.slice(0, 100000);
        const phaseIngredients = extractIngredientsFromChunk(limitedChunk, phase.name);
        const expandedSteps = [];
        allSteps
          .filter(s => s.pos > phase.charPos && s.pos < nextPos)
          .forEach(s => {
            const duration = extractDuration(s.instruction) || 5;
            const step = { instruction: s.instruction, duration, type: detectStepType(s.instruction) };
            const rep = parseRepeatingActions(step.instruction, step.duration);
            rep ? expandedSteps.push(...rep) : expandedSteps.push(step);
          });
        console.log(`  -> ${phase.name}: ${phaseIngredients.length} Zutaten, ${expandedSteps.length} Schritte`);
        dough_sections.push({
          name: phase.name,
          ingredients: phaseIngredients,
          steps: expandedSteps,
        });
      }
    }

    recipeData.steps          = allSteps.map(s => ({ instruction: s.instruction, duration: extractDuration(s.instruction) || 5, type: detectStepType(s.instruction) }));
    recipeData.dough_sections = dough_sections;
    recipeData.ingredients    = dough_sections.flatMap(s => s.ingredients);
    console.log(`✅ ${dough_sections.length} Phasen, ${recipeData.steps.length} Schritte, ${recipeData.ingredients.length} Zutaten gesamt`);

    // Bild herunterladen
    if (recipeData.image_url && recipeData.image_url.startsWith('http') && !recipeData.image_url.startsWith('data:')) {
      try {
        const response = await axios.get(recipeData.image_url, { responseType: 'arraybuffer', timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const fileName = `import-${Date.now()}-${uuidv4().substring(0, 8)}.jpg`;
        fs.writeFileSync(path.join(uploadDir, fileName), response.data);
        recipeData.image_url = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
        console.log('✅ Bild heruntergeladen');
      } catch (e) { console.error("⚠️ Bild-Download Fehler:", e.message); }
    }

    const finalData = {
      title: recipeData.title || 'Importiertes Rezept',
      description: recipeData.description || '',
      image_url: recipeData.image_url || '',
      source_url: recipeData.source_url || '',
      ingredients: recipeData.ingredients || [],
      steps: recipeData.steps || [],
      dough_sections: recipeData.dough_sections || []
    };

    console.log('📤 Sending to frontend:', { title: finalData.title, image: finalData.image_url ? '✅' : '❌', ingredients: finalData.ingredients.length, steps: finalData.steps.length, phases: finalData.dough_sections.length });
    res.json(finalData);

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
    const result = await pool.query(
      `INSERT INTO recipes (user_id, title, description, image_url, ingredients, dough_sections, steps) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;`,
      [req.user.userId, title, description, image_url, JSON.stringify(ingredients || []), JSON.stringify(dough_sections || []), JSON.stringify(steps || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Datenbankfehler" }); }
});

app.put('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, image_url, ingredients, steps, description, dough_sections } = req.body;
  try {
    const result = await pool.query(
      `UPDATE recipes SET title=$1, image_url=$2, ingredients=$3, steps=$4, description=$5, dough_sections=$6 WHERE id=$7 AND user_id=$8 RETURNING *;`,
      [title, image_url, JSON.stringify(ingredients), JSON.stringify(steps), description, JSON.stringify(dough_sections), id, req.user.userId]
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
  const { is_favorite, planned_at } = req.body;
  try {
    let result;
    if (planned_at !== undefined)   result = await pool.query("UPDATE recipes SET planned_at=$1 WHERE id=$2 AND user_id=$3 RETURNING *", [planned_at, id, req.user.userId]);
    else if (is_favorite !== undefined) result = await pool.query("UPDATE recipes SET is_favorite=$1 WHERE id=$2 AND user_id=$3 RETURNING *", [is_favorite, id, req.user.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Nicht gefunden" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: "Patch-Fehler" }); }
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
  console.log('DEBUG: Typ von getScraper ist:', typeof getScraper);
  await initDB();
  setInterval(checkAndNotify, 60000);
});