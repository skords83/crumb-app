const axios = require('axios');
const cheerio = require('cheerio');

// ── HILFSFUNKTIONEN ──────────────────────────────────────────
function evalFraction(amount) {
  if (!amount) return 0;
  const clean = amount.replace(',', '.').trim();
  if (clean.includes('/')) {
    const [a, b] = clean.split('/');
    return parseFloat(a) / parseFloat(b);
  }
  return parseFloat(clean) || 0;
}

const PHASE_PATTERNS = [
  { re: /hauptteig$/i,  is_parallel: false },
  { re: /teig$/i,       is_parallel: true  },
  { re: /stück$/i,      is_parallel: true  },
  { re: /sauerteig/i,   is_parallel: true  },
  { re: /poolish/i,     is_parallel: true  },
  { re: /levain/i,      is_parallel: true  },
  { re: /autolyse/i,    is_parallel: false },
  { re: /vorteig/i,     is_parallel: true  },
  { re: /brotaroma/i,   is_parallel: true  },  // Homebaking-spezifisch
  { re: /kochstück/i,   is_parallel: true  },
  { re: /brühstück/i,   is_parallel: true  },
  { re: /quellstück/i,  is_parallel: true  },
];

const detectIsParallel = (name) => {
  for (const p of PHASE_PATTERNS) if (p.re.test(name)) return p.is_parallel;
  return false;
};

const WAIT_KEYWORDS = ['reifen', 'ruhen', 'gehen', 'gare', 'stockgare', 'stückgare', 'abkühlen', 'quellen', 'rasten', 'entspannen', 'kühlschrank', 'autolyse'];

function parseDurationAndType(text) {
  const lower = text.toLowerCase();
  const hourMatch = lower.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:std|h|stunden?)/i);
  const minMatch  = lower.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:min)/i);
  let duration = 10;
  if (hourMatch) {
    const h1 = parseInt(hourMatch[1]), h2 = hourMatch[2] ? parseInt(hourMatch[2]) : h1;
    duration = ((h1 + h2) / 2) * 60;
  } else if (minMatch) {
    const m1 = parseInt(minMatch[1]), m2 = minMatch[2] ? parseInt(minMatch[2]) : m1;
    duration = (m1 + m2) / 2;
  }
  let type = 'Aktion';
  if (lower.includes('backen') || lower.includes('ofen')) type = 'Backen';
  else if (WAIT_KEYWORDS.some(kw => lower.includes(kw)) || (duration > 25 && !lower.includes('kneten') && !lower.includes('mischen'))) type = 'Warten';
  return { duration, type };
}

// ── HAUPT-SCRAPER ────────────────────────────────────────────
const scrapeHomebaking = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Crumb/1.0)' },
      timeout: 12000
    });
    const $ = cheerio.load(data);
    const dough_sections = [];

    // Homebaking.at: Rezept steht unter .entry-content oder article
    // Phasen sind h3 innerhalb des Rezeptbereichs (Sauerteig, Brotaroma, Hauptteig)
    // Zutaten als ul > li unter jedem h3
    // Schritte als Fließtext-Paragraphen nach dem Zutatenblock

    // 1. PHASEN + ZUTATEN aus h3/ul-Struktur
    const recipeContent = $('.entry-content, article .content, .post-content, main article').first();

    // Finde alle h3 im Rezeptbereich die Phasen sind
    recipeContent.find('h3').each((_, h3) => {
      const name = $(h3).text().trim();
      if (!name || name.length > 60) return;
      // Prüfen ob es eine Phase ist
      const isPhase = PHASE_PATTERNS.some(p => p.re.test(name)) ||
        ['sauerteig', 'vorteig', 'hauptteig', 'brotaroma', 'teig'].some(k => name.toLowerCase().includes(k));
      if (!isPhase) return;

      const ingredients = [];
      // Zutaten: ul direkt nach h3
      const ul = $(h3).nextUntil('h3', 'ul').first();
      if (ul.length) {
        ul.find('li').each((_, li) => {
          const text = $(li).text().trim();
          if (!text) return;
          // Format: "400g Roggenmehl /960" oder "400 g Roggenmehl"
          const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
          if (match) {
            ingredients.push({
              amount: evalFraction(match[1]),
              unit: match[2] || 'g',
              name: match[3].trim()
            });
          } else {
            // Kein Mengenformat → als Zutat ohne Menge
            ingredients.push({ amount: 0, unit: '', name: text });
          }
        });
      }

      // Auch Fließtext direkt nach h3 parsen (Format: "400g Salz\n350g Wasser")
      if (ingredients.length === 0) {
        const nextP = $(h3).next('p');
        if (nextP.length) {
          nextP.text().split('\n').forEach(line => {
            line = line.trim();
            const match = line.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
            if (match) ingredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() });
          });
        }
      }

      dough_sections.push({
        name,
        is_parallel: detectIsParallel(name),
        ingredients,
        steps: []
      });
    });

    // Fallback: Wenn keine h3-Phasen → Hauptteig aus allen Zutaten
    if (dough_sections.length === 0) {
      const ingredients = [];
      recipeContent.find('li').each((_, li) => {
        const text = $(li).text().trim();
        const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
        if (match) ingredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() });
      });
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients, steps: [] });
    }

    // 2. SCHRITTE – Homebaking schreibt Anweisungen als Paragraphen nach den Zutaten
    // Alle Paragraphen sammeln die nach dem Rezept-Block kommen
    const allParas = [];
    recipeContent.find('p').each((_, p) => {
      const text = $(p).text().trim();
      if (text.length < 20) return; // Zu kurz = kein Schritt
      // Kommentare und andere Nicht-Rezept-Texte ausfiltern
      const lower = text.toLowerCase();
      if (lower.includes('kommentar') || lower.includes('newsletter') || lower.includes('rezept drucken')) return;
      allParas.push(text);
    });

    // Schritte der richtigen Phase zuordnen
    let currentSectionIdx = dough_sections.length > 0 ? dough_sections.length - 1 : 0; // Hauptteig zuletzt
    // Finde ersten Hauptteig-Schritt (nach Phasen-Erwähnungen)
    allParas.forEach(text => {
      // Phasenwechsel prüfen
      dough_sections.forEach((sec, idx) => {
        if (text.toLowerCase().includes(sec.name.toLowerCase())) currentSectionIdx = idx;
      });
      const { duration, type } = parseDurationAndType(text);
      if (dough_sections[currentSectionIdx]) {
        dough_sections[currentSectionIdx].steps.push({ instruction: text, duration, type });
      }
    });

    // Phasen ohne Schritte bekommen einen Platzhalter-Warten-Schritt
    dough_sections.forEach(sec => {
      if (sec.steps.length === 0 && sec.name.toLowerCase() !== 'hauptteig') {
        const lower = sec.name.toLowerCase();
        const duration = lower.includes('sauerteig') ? 960 : lower.includes('brotaroma') ? 120 : 60;
        sec.steps.push({ instruction: `${sec.name} ansetzen und reifen lassen`, duration, type: 'Warten' });
      }
    });

    // 3. BILD
    let imageUrl = '';
    // Homebaking: Bilder unter /app/uploads/JJJJ/MM/
    const galleryImg = $('img[src*="/app/uploads/"]').first();
    if (galleryImg.length) {
      imageUrl = galleryImg.attr('src') || '';
      // Thumbnail-Suffix entfernen (-780x520 etc.)
      imageUrl = imageUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
    }
    if (!imageUrl) {
      imageUrl = $('meta[property="og:image"]').attr('content') || '';
    }

    const title = $('h1').first().text().trim() || $('title').text().replace(' – HOMEBAKING BLOG', '').trim();
    const description = $('meta[property="og:description"]').attr('content') || '';

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ Homebaking: "${title}" – ${result.dough_sections.length} Phasen`);
    return result;

  } catch (error) {
    console.error('Homebaking Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeHomebaking;
