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

// ============================================================
// HELPER FUNCTIONS für Step-Extraktion
// ============================================================
function extractDuration(text) {
  if (!text) return 0;
  
  const patterns = [
    { regex: /(\d+[,.]?\d*)\s*Stunden?/i, multiplier: 60 },
    { regex: /(\d+[,.]?\d*)\s*h\b/i, multiplier: 60 },
    { regex: /(\d+)\s*Minuten?/i, multiplier: 1 },
    { regex: /(\d+)\s*min\b/i, multiplier: 1 },
    { regex: /(\d+):(\d+)\s*(Uhr|Stunden)?/i, special: 'time' }
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      if (pattern.special === 'time') {
        const hours = parseInt(match[1]);
        const mins = parseInt(match[2]);
        return hours * 60 + mins;
      } else {
        const value = parseFloat(match[1].replace(',', '.'));
        return Math.round(value * pattern.multiplier);
      }
    }
  }
  
  return 0;
}

function detectStepType(text) {
  if (!text) return 'Aktion';
  
  const lower = text.toLowerCase();
  
  // WARTEN = Zeitangaben mit "reifen", "ruhen", "gehen", etc.
  if (lower.match(/reifen|ruhen|gehen|aufgehen|stockgare|stückgare|gare\s/)) return 'Warten';
  if (lower.match(/\d+\s*(stunden?|minuten?|std|min|h)\s+(bei|reifen|ruhen|gehen)/i)) return 'Warten';
  if (lower.match(/^\d+[,.]?\d*\s*stunden?\s+bei/i)) return 'Warten';
  
  // AKTION = alles andere
  return 'Aktion';
}

// ============================================================
// HELPER: Parse wiederholende Aktionen - CLEAN TEXT
// ============================================================
function parseRepeatingActions(instruction, totalDuration) {
  const steps = [];
  
  const pattern = /dabei\s+nach\s+([\d,\sund]+)\s*minuten?\s+(.+)/i;
  const match = instruction.match(pattern);
  
  if (match) {
    const intervals = match[1]
      .replace(/\s*und\s*/g, ',')
      .split(/[,\s]+/)
      .map(n => parseInt(n))
      .filter(n => !isNaN(n));
    
    const action = match[2].trim();
    
    // Extrahiere Hauptaktion ohne Zeit/Temp
    let mainInstruction = instruction.replace(pattern, '').trim().replace(/\.$/, '');
    
    // Entferne Zeitangaben aus dem Text
    mainInstruction = mainInstruction
      .replace(/\d+[,.]?\d*\s*Stunden?\s*/gi, '')
      .replace(/bei\s+\d+\s*°C\s*/gi, '')
      .replace(/^\s*,?\s*/, '')
      .trim();
    
    console.log(`🔄 Wiederholende Aktion: ${intervals.join(', ')} Min → ${intervals.length * 2 + 1} Schritte`);
    console.log(`   Basis: "${mainInstruction}" | Aktion: "${action}"`);
    
    let lastTime = 0;
    intervals.forEach((time, idx) => {
      const waitDuration = time - lastTime;
      if (waitDuration > 0) {
        steps.push({
          instruction: mainInstruction,
          duration: waitDuration,
          type: 'Warten'
        });
      }
      
      steps.push({
        instruction: action.charAt(0).toUpperCase() + action.slice(1),
        duration: 5,
        type: 'Aktion'
      });
      
      lastTime = time + 5;
    });
    
    if (lastTime < totalDuration) {
      steps.push({
        instruction: mainInstruction,
        duration: totalDuration - lastTime,
        type: 'Warten'
      });
    }
    
    return steps;
  }
  
  return null;
}

// ============================================================
// Parse recipe from uploaded HTML file
// ============================================================
app.post('/api/import/html', async (req, res) => {
  try {
    const { html, filename } = req.body;
    
    if (!html) {
      return res.status(400).json({ error: 'No HTML content provided' });
    }

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    const fname = filename || 'uploaded.html';
    
    let recipeData = {
      title: $('h1.entry-title').first().text().trim() || 
             $('h1').first().text().trim() || 
             'Importiertes Rezept',
      description: '',  // Wird weiter unten gefüllt
      image_url: '',
      source_url: fname,
      ingredients: [],
      steps: [],
      dough_sections: []
    };
// ============================================================
// BILD EXTRAKTION - Cloudimg Original bevorzugen!
// ============================================================
let imageUrl = '';

// Priorität 1: Cloudimg entity/gallery URLs (Original vom Plötzblog)
const cloudimgMatch = html.match(/https?:\/\/[^"']*cloudimg\.io[^"']*\/entity\/gallery\/[^"']*\.jpg[^"']*/);
if (cloudimgMatch) {
  imageUrl = cloudimgMatch[0]
    .replace(/^\/\//, 'https://')
    .replace(/\?p=w\d+/, '?p=w800')
    .replace(/\?p=grid-[^&\s"']+/, '?p=w800');
  console.log('✅ Cloudimg Original gefunden:', imageUrl);
} else {
  // Priorität 2: Archive.is Bilder
  const imgCandidates = [];
  
  $('img').each((i, img) => {
    const src = $(img).attr('src');
    const parent = $(img).parent().text();
    
    if (parent.includes('Kommentare') || 
        parent.includes('Benötigtes Zubehör') || 
        parent.includes('Rezept drucken')) {
      return;
    }
    
    if (src && 
        !src.includes('scr.png') &&
        !src.includes('Partner') &&
        !src.includes('icon') &&
        !src.includes('logo') &&
        !src.includes('.svg') &&
        !src.startsWith('data:image/svg') &&
        (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) {
      
      const width = $(img).attr('width');
      const height = $(img).attr('height');
      const size = (parseInt(width) || 0) * (parseInt(height) || 0);
      
      imgCandidates.push({ src, size });
    }
  });
  
  imgCandidates.sort((a, b) => b.size - a.size);
  
  if (imgCandidates.length > 0) {
    const imgSrc = imgCandidates[0].src;
    console.log('🖼️ Archive.is Bild:', imgSrc.substring(0, 80));
    
    if (imgSrc.startsWith('data:image') && !imgSrc.startsWith('data:image/svg')) {
      imageUrl = imgSrc;
    }
    else if (imgSrc.match(/^\/[A-Z0-9]+\//) || imgSrc.includes('-Dateien/')) {
      imageUrl = 'https://archive.is/' + imgSrc.replace(/^\//, '');
    }
    else if (imgSrc.startsWith('http')) {
      imageUrl = imgSrc;
    }
    else if (!imgSrc.startsWith('data:')) {
      imageUrl = 'https://archive.is/' + imgSrc;
    }
  }
  
  // Priorität 3: og:image als letzter Fallback
  if (!imageUrl) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && !ogImage.includes('scr.png') && !ogImage.includes('.svg')) {
      imageUrl = ogImage;
      console.log('🖼️ og:image Fallback');
    }
  }
}

recipeData.image_url = imageUrl;

// ============================================================
// BESCHREIBUNG - Nur erster Absatz nach H1
// ============================================================
let description = $('meta[property="og:description"]').attr('content') || '';

if (!description || description.length < 50) {
  console.log('🔍 Suche Beschreibung im Text...');
  
  const skipWords = ['Produktempfehlung', 'Anzeige', 'Mitgliedschaft', 'Kommentare', 
    'Rezept drucken', 'Benötigtes Zubehör', 'Häufig gestellte Fragen',
    'Amazon', 'Otto', 'Steady', 'Newsletter', 'Copyright'];
  
  let foundH1 = false;
  
  $('h1, h2, p, div').each((i, elem) => {
    if (description) return false; // ← Stop wenn gefunden!
    
    const tag = elem.name || elem.tagName;
    const text = $(elem).text().trim();
    
    if (tag === 'h1') {
      foundH1 = true;
      return;
    }
    
    if (tag === 'h2' && foundH1) {
      return;
    }
    
    if (foundH1 && (tag === 'p' || tag === 'div')) {
  // Filter
  if (text.length < 50) return;
  if (skipWords.some(word => text.includes(word))) return;
  if (text.match(/^\d+\s*(g|ml|°C|Min|Std)/)) return;
  if (text.includes('Uhr') && text.length < 100) return;
  
  description = text.replace(/\s+/g, ' ').trim(); // ← Whitespace bereinigen
  console.log(`✅ Beschreibung gefunden: ${description.substring(0, 80)}...`);
  return false;
}
  });
}

recipeData.description = description;
    // ============================================================
    // ZUTATEN aus Tabellen extrahieren
    // ============================================================
    $('table tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 2) {
        const amount = $(cells[0]).text().trim();
        let name = $(cells[1]).text().trim();
        
        let temperature = '';
        const tempMatch = name.match(/(\d+)\s*°C/);
        if (tempMatch) {
          temperature = tempMatch[1];
          name = name.replace(/\d+\s*°C/g, '').trim();
        }
        
        let note = '';
        const noteMatch = name.match(/\(([^)]+)\)/);
        if (noteMatch) {
          note = noteMatch[1];
          name = name.replace(/\([^)]+\)/g, '').trim();
        }
        
        if (amount.match(/\d+[,.]?\d*\s*(g|kg|ml|l|%|EL|TL|Prise)/i) && name && name.length > 2) {
          recipeData.ingredients.push({
            name: name,
            amount: amount,
            unit: '',
            temperature: temperature,
            note: note
          });
        }
      }
    });

    console.log(`🥖 Aus Tabellen extrahiert: ${recipeData.ingredients.length} Zutaten`);

    // ============================================================
    // DEDUPLICATE INGREDIENTS
    // ============================================================
    if (recipeData.ingredients && Array.isArray(recipeData.ingredients)) {
      const seen = new Map();
      const uniqueIngredients = [];
      
      recipeData.ingredients.forEach(ing => {
        const normalizedName = ing.name.toLowerCase().replace(/\s+/g, ' ').trim();
        
        if (!seen.has(normalizedName)) {
          seen.set(normalizedName, true);
          uniqueIngredients.push(ing);
        }
      });
      
      recipeData.ingredients = uniqueIngredients;
      console.log(`✅ Dedupliziert: ${recipeData.ingredients.length} einzigartige Zutaten`);
    }

    // ============================================================
    // EXTRACT STEPS
    // ============================================================
    console.log('📋 Versuche Schritte zu extrahieren...');
    const stepsMap = new Map();

    $('div').each((i, elem) => {
      const $div = $(elem);
      const bgColor = $div.attr('style');
      
      if (bgColor && bgColor.includes('rgba(196, 173, 130')) {
        const numberDiv = $div.find('div').first();
        const stepNumber = numberDiv.text().trim();
        
        if (stepNumber.match(/^\d+$/)) {
          if (stepsMap.has(stepNumber)) {
            console.log(`  ⏭️  Step #${stepNumber} bereits vorhanden, überspringe Duplikat`);
            return;
          }
          
          console.log(`📍 Gefunden: Step #${stepNumber}`);
          
          let nextElem = $div;
          let stepText = '';
          
          for (let j = 0; j < 5; j++) {
            nextElem = nextElem.next();
            if (!nextElem.length) break;
            
            const text = nextElem.text().trim();
            
            if (text.match(/^\d+$/)) break;
            if (text.match(/^Quelle:/i)) break;
            
            if (text && text.length > 10) {
              stepText += text + ' ';
            }
          }
          
          stepText = stepText.trim();
          
          if (stepText && stepText.length > 20) {
            const duration = extractDuration(stepText);
            const type = detectStepType(stepText);
            stepsMap.set(stepNumber, {
              instruction: stepText,
              duration: duration || 0,
              type: type
            });
            console.log(`  ✓ ${stepText.substring(0, 60)}... [${type}, ${duration}min]`);
          }
        }
      }
    });

    let steps = Array.from(stepsMap.entries())
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([num, step]) => step);

    // ============================================================
    // EXPAND REPEATING ACTIONS
    // ============================================================
    const expandedSteps = [];
    steps.forEach(step => {
      const repeating = parseRepeatingActions(step.instruction, step.duration);
      if (repeating) {
        expandedSteps.push(...repeating);
      } else {
        expandedSteps.push(step);
      }
    });
    steps = expandedSteps;

    if (steps.length === 0) {
      console.log('⚠️ Keine Steps gefunden - nutze Defaults');
      steps.push(
        { instruction: 'Alle Zutaten mischen', duration: 10, type: 'Aktion' },
        { instruction: 'Teig ruhen lassen', duration: 90, type: 'Warten' },
        { instruction: 'Teig formen', duration: 10, type: 'Aktion' },
        { instruction: 'Gare im Gärkorb', duration: 60, type: 'Warten' },
        { instruction: 'Backen', duration: 45, type: 'Aktion' }
      );
    }

    recipeData.steps = steps;
    console.log(`✅ ${steps.length} Schritte final`);

    // ============================================================
    // DETECT PHASE TYPE
    // ============================================================
    let phaseName = 'Hauptteig';
    let isParallel = false;

    $('h2, h3, h4').each((i, elem) => {
      const text = $(elem).text().trim();
      
      if (text.match(/Sauerteig/i)) {
        phaseName = 'Sauerteig';
        isParallel = true;
        return false;
      } else if (text.match(/Vorteig|Poolish/i)) {
        phaseName = 'Vorteig / Poolish';
        isParallel = true;
        return false;
      } else if (text.match(/Quellstück|Kochstück/i)) {
        phaseName = 'Quellstück / Kochstück';
        isParallel = true;
        return false;
      } else if (text.match(/Autolyse/i)) {
        phaseName = 'Autolyse';
        isParallel = false;
        return false;
      } else if (text.match(/Hauptteig/i)) {
        phaseName = 'Hauptteig';
        isParallel = false;
        return false;
      }
    });

    recipeData.dough_sections = [{
      name: phaseName,
      is_parallel: isParallel,
      ingredients: recipeData.ingredients || [],
      steps: (recipeData.steps || []).map(step => ({
        instruction: step.instruction || '',
        duration: step.duration || 0,
        type: step.type || 'Aktion'
      }))
    }];

    console.log(`✅ Phase erkannt: ${phaseName} (parallel: ${isParallel})`);

    // ============================================================
    // BILD DOWNLOAD
    // ============================================================
    if (recipeData.image_url && 
        recipeData.image_url.startsWith('http') && 
        !recipeData.image_url.startsWith('data:')) {
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
        console.log('✅ Bild heruntergeladen');
      } catch (e) { 
        console.error("⚠️ Bild-Download Fehler:", e.message); 
      }
    }

    // ============================================================
    // FINAL DATA
    // ============================================================
    const finalData = {
      title: recipeData.title || 'Importiertes Rezept',
      description: recipeData.description || '',
      image_url: recipeData.image_url || '',
      source_url: recipeData.source_url || '',
      ingredients: recipeData.ingredients || [],
      steps: recipeData.steps || [],
      dough_sections: recipeData.dough_sections || []
    };

    console.log('📤 Sending to frontend:', {
      title: finalData.title,
      image: finalData.image_url ? '✅ OK' : '❌ none',
      ingredients: finalData.ingredients.length,
      steps: finalData.steps.length,
      dough_sections: finalData.dough_sections.length,
      phase: finalData.dough_sections[0]?.name
    });

    res.json(finalData);
    
  } catch (error) {
    console.error("🚨 HTML PARSE FEHLER:", error.message);
    res.status(500).json({ error: 'Failed to parse HTML file: ' + error.message });
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