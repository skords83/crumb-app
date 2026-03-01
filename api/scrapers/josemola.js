const axios = require('axios');
const cheerio = require('cheerio');

// ── HILFSFUNKTIONEN ──────────────────────────────────────────
function evalFraction(amount) {
  if (!amount) return 0;
  const clean = amount.replace(',', '.').trim();
  if (clean.includes('/')) { const [a, b] = clean.split('/'); return parseFloat(a) / parseFloat(b); }
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
  { re: /kochstück/i,   is_parallel: true  },
];

const detectIsParallel = (name) => {
  for (const p of PHASE_PATTERNS) if (p.re.test(name)) return p.is_parallel;
  return false;
};

const WAIT_KEYWORDS = ['reifen', 'ruhen', 'gehen', 'gare', 'quellen', 'rasten', 'kühlschrank', 'autolyse', 'abkühlen'];

function parseDurationAndType(text) {
  const lower = text.toLowerCase();
  // JoSemola schreibt Zeiten oft als "4-5 Stunden" oder "60 Minuten"
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
  else if (WAIT_KEYWORDS.some(kw => lower.includes(kw)) || (duration > 25 && !lower.includes('kneten') && !lower.includes('mischen') && !lower.includes('erhitzen'))) type = 'Warten';
  return { duration, type };
}

// ── HAUPT-SCRAPER ────────────────────────────────────────────
const scrapeJoSemola = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Crumb/1.0)' },
      timeout: 12000
    });
    const $ = cheerio.load(data);
    const dough_sections = [];

    // JoSemola Custom Theme:
    // Zutaten: h3 "Für den Hauptteig" / "Für den Sauerteig" → ul > li
    //   li: "3 g\nAnstellgut" (amount in span, name als text)
    // Schritte: "Step X von Y" Divs mit Schritt-Text

    // 1. ZUTATEN-GRUPPEN via h3
    $('h3').each((_, h3) => {
      const heading = $(h3).text().trim();
      // "Für den Sauerteig", "Für das Kochstück", "Für den Hauptteig"
      const nameMatch = heading.match(/^für\s+(?:den|die|das)\s+(.+)$/i);
      if (!nameMatch) return;
      const phaseName = nameMatch[1].trim();

      const ingredients = [];
      // ul direkt nach h3
      $(h3).nextUntil('h3').filter('ul').find('li').each((_, li) => {
        // JoSemola: "3 g\nAnstellgut" – amount und name durch Whitespace getrennt
        const liText = $(li).text().replace(/\s+/g, ' ').trim();
        const amountEl = $(li).find('.wprm-recipe-ingredient-amount, [class*="amount"]');
        const unitEl   = $(li).find('.wprm-recipe-ingredient-unit,   [class*="unit"]');
        const nameEl   = $(li).find('.wprm-recipe-ingredient-name,   [class*="name"]');

        if (nameEl.length) {
          // WPRM-Klassen vorhanden
          ingredients.push({
            amount: evalFraction(amountEl.text().trim()),
            unit: unitEl.text().trim() || 'g',
            name: nameEl.text().trim()
          });
        } else {
          // Kein WPRM → manuell parsen
          // Format: "3 g Anstellgut" oder "3\ng\nAnstellgut"
          const match = liText.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]{0,5})\s+(.+)$/);
          if (match) {
            ingredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() });
          } else if (liText.length > 1) {
            ingredients.push({ amount: 0, unit: '', name: liText });
          }
        }
      });

      if (ingredients.length > 0) {
        dough_sections.push({
          name: phaseName,
          is_parallel: detectIsParallel(phaseName),
          ingredients,
          steps: []
        });
      }
    });

    // Fallback WPRM (falls doch vorhanden)
    if (dough_sections.length === 0) {
      $('.wprm-recipe-ingredient-group').each((_, group) => {
        const rawName = $(group).find('.wprm-recipe-group-name').text().trim() || 'Hauptteig';
        const ingredients = [];
        $(group).find('.wprm-recipe-ingredient').each((_, ing) => {
          const name = $(ing).find('.wprm-recipe-ingredient-name').text().trim();
          if (!name) return;
          ingredients.push({
            amount: evalFraction($(ing).find('.wprm-recipe-ingredient-amount').text().trim()),
            unit: $(ing).find('.wprm-recipe-ingredient-unit').text().trim() || 'g',
            name
          });
        });
        dough_sections.push({ name: rawName, is_parallel: detectIsParallel(rawName), ingredients, steps: [] });
      });
    }

    // Wenn noch immer leer → eine Hauptteig-Sektion
    if (dough_sections.length === 0) {
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients: [], steps: [] });
    }

    // 2. SCHRITTE – JoSemola Custom: Schritte stehen in Paragraphen nach "Step X von Y"
    // Oder in .wprm-recipe-instruction-text
    const stepTexts = [];

    // Methode A: Schritt-Paragraphen (Custom Theme)
    // JoSemola hat "Step 1 von 6" als Heading, dann Instruktionstext als p
    // Alternativ direkt Paragraphen mit Step-Inhalt
    $('[class*="step"], [class*="Step"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20 && !text.match(/^Step\s+\d+/i)) stepTexts.push(text);
    });

    // Methode B: WPRM-Instruktionen
    if (stepTexts.length === 0) {
      $('.wprm-recipe-instruction-text').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 10) stepTexts.push(text);
      });
    }

    // Methode C: Strukturierte Paragraphen mit Schritt-Keywords
    if (stepTexts.length === 0) {
      $('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text.length < 25) return;
        const lower = text.toLowerCase();
        const hasKw = ['kneten', 'mischen', 'falten', 'formen', 'backen', 'reifen', 'ruhen', 'zugeben', 'verrühren', 'vorheizen'].some(k => lower.includes(k));
        if (hasKw) stepTexts.push(text);
      });
    }

    // Schritte Phasen zuordnen
    let currentIdx = dough_sections.length - 1; // Start beim letzten (Hauptteig)
    stepTexts.forEach(text => {
      // Phasenwechsel erkennen
      dough_sections.forEach((sec, idx) => {
        if (text.toLowerCase().includes(sec.name.toLowerCase())) currentIdx = idx;
      });
      const { duration, type } = parseDurationAndType(text);
      dough_sections[currentIdx]?.steps.push({ instruction: text, duration, type });
    });

    // Phasen ohne Schritte: Platzhalter
    dough_sections.forEach(sec => {
      if (sec.steps.length === 0) {
        const duration = sec.name.toLowerCase().includes('sauerteig') ? 240 :
                         sec.name.toLowerCase().includes('kochstück') ? 30 : 60;
        sec.steps.push({ instruction: `${sec.name} vorbereiten und reifen lassen`, duration, type: 'Warten' });
      }
    });

    // 3. BILD – JoSemola hat og:image oder recipe header image
    let imageUrl = $('meta[property="og:image"]').attr('content') || '';
    if (!imageUrl) {
      // recipe header image (lazy-loaded)
      const headerImg = $('img[class*="header"], img[class*="recipe"], .recipe-image img').first();
      if (headerImg.length) imageUrl = headerImg.attr('src') || headerImg.attr('data-src') || '';
    }
    if (!imageUrl) {
      // Erstes großes Bild im Content
      const contentImg = $('main img, article img').first();
      if (contentImg.length) imageUrl = contentImg.attr('src') || '';
    }

    // 4. BESCHREIBUNG – Jo Semola hat blockquote-Zitate als "Mein Rezept"-Beschreibung
    let description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    if (!description || description.length < 30) {
      // Suche nach dem Anführungszeichen-Zitat im Rezept
      $('blockquote, [class*="quote"], em').each((_, el) => {
        const text = $(el).text().trim().replace(/[""„"]/g, '');
        if (text.length > 40 && text.length < 300) { description = text; return false; }
      });
    }

    const title = $('h1').first().text().trim() || $('title').text().replace(' - Jo Semola', '').trim();

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ JoSemola: "${title}" – ${result.dough_sections.length} Phasen`);
    return result;

  } catch (error) {
    console.error('JoSemola Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeJoSemola;
