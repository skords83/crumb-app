const axios = require('axios');
const cheerio = require('cheerio');
const { stepDuration, isBakingStep, detectPortionCount, scaleSectionsToOnePortion } = require('./utils');

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
  { re: /biga/i,        is_parallel: true  },  // Homebaking-spezifisch
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
      const nameLower = name.toLowerCase().replace(/:$/, '').trim();
      const NON_PHASE = ['herstellung', 'zubereitung', 'zutaten', 'kommentar', 'newsletter'];
      if (NON_PHASE.some(s => nameLower.includes(s))) return;
      const isPhase = PHASE_PATTERNS.some(p => p.re.test(nameLower)) ||
        ['sauerteig', 'vorteig', 'hauptteig', 'brotaroma', 'teig', 'biga'].some(k => nameLower.includes(k));
      if (!isPhase) return;

      // Phasennamen normalisieren (Doppelpunkt am Ende entfernen)
      const cleanName = name.replace(/:$/, '').trim();

      const ingredients = [];
      // ALLE ul-Blöcke unter diesem h3 einlesen (Stufe 1, Stufe 2, etc.)
      $(h3).nextUntil('h3', 'ul').each((_, ul) => {
        $(ul).find('li').each((_, li) => {
          const text = $(li).text().trim();
          if (!text) return;
          const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
          if (match) {
            ingredients.push({
              amount: evalFraction(match[1]),
              unit: match[2] || 'g',
              name: match[3].trim()
            });
          } else {
            ingredients.push({ amount: 0, unit: '', name: text });
          }
        });
      });

      // Fließtext-Fallback (Format: "400g Salz\n350g Wasser")
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
        name: cleanName,
        is_parallel: detectIsParallel(cleanName),
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
    // Schritte sammeln: aus <p>-Tags UND aus <li> unter "Herstellung:"-h3
    const allParas = [];
    const SKIP_STEP = ['kommentar', 'newsletter', 'rezept drucken', 'stufe 1', 'stufe 2', 'stufe 3'];

    // A) li-Schritte unter "Herstellung:" h3 (Homebaking-spezifisch)
    recipeContent.find('h3').each((_, h3) => {
      const name = $(h3).text().trim().toLowerCase().replace(/:$/, '');
      if (!['herstellung', 'zubereitung'].includes(name)) return;
      $(h3).nextUntil('h3', 'ul').find('li').each((_, li) => {
        const text = $(li).text().trim();
        if (text.length >= 15 && !SKIP_STEP.some(s => text.toLowerCase().includes(s))) {
          allParas.push(text);
        }
      });
    });

    // B) <p>-Tags im Content (Schritt-Paragraphen zwischen den Phasen)
    recipeContent.find('p').each((_, p) => {
      const text = $(p).text().trim();
      if (text.length < 20) return;
      if (SKIP_STEP.some(s => text.toLowerCase().includes(s))) return;
      // Keine reinen Stufenbezeichner ("Stufe 1:", "Stufe 2:")
      if (/^Stufe\s+\d+:/i.test(text)) return;
      allParas.push(text);
    });

    // Deduplizieren (falls ein Schritt sowohl als p als auch als li vorkommt)
    const seen = new Set();
    const uniqueParas = allParas.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });

    // Schritte der richtigen Phase zuordnen
    let currentSectionIdx = dough_sections.length > 0 ? dough_sections.length - 1 : 0;
    uniqueParas.forEach(text => {
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

    // 2b. PORTIONSGRÖSSE erkennen und auf 1 Stück skalieren
    // Typisch: <h2>Rezept</h2> gefolgt von <p>für ein Teiggewicht von 1773g / 2 Stück je 886g</p>
    let portionCount = 1;
    recipeContent.find('h2').each((_, h2) => {
      if ($(h2).text().trim().toLowerCase() !== 'rezept') return;
      const portionText = $(h2).next('p').text().trim();
      portionCount = detectPortionCount(portionText);
    });
    // Fallback: alle p-Tags nach h2 oder im Content durchsuchen
    if (portionCount === 1) {
      recipeContent.find('p').each((_, p) => {
        const t = $(p).text().trim();
        if (/für ein Teiggewicht/i.test(t) || /Teiggewicht von/i.test(t)) {
          portionCount = detectPortionCount(t);
          return false; // break
        }
      });
    }
    if (portionCount > 1) {
      console.log(`  → ${portionCount} Stück erkannt – skaliere auf 1 Stück`);
      dough_sections.splice(0, dough_sections.length,
        ...scaleSectionsToOnePortion(dough_sections, portionCount)
      );
    }

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
      portion_count: portionCount,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ Homebaking: "${title}" – ${result.dough_sections.length} Phasen, ${portionCount} Stück (auf 1 skaliert)`);
    return result;

  } catch (error) {
    console.error('Homebaking Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeHomebaking;