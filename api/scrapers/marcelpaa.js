const axios = require('axios');
const cheerio = require('cheerio');

// ── PHASE-ERKENNUNG (gleiche Logik wie index.js) ─────────────
const PHASE_PATTERNS = [
  { re: /hauptteig$/i,  is_parallel: false },
  { re: /teig$/i,       is_parallel: true  },
  { re: /stück$/i,      is_parallel: true  },
  { re: /sauerteig/i,   is_parallel: true  },
  { re: /poolish/i,     is_parallel: true  },
  { re: /levain/i,      is_parallel: true  },
  { re: /autolyse/i,    is_parallel: false },
  { re: /vorteig/i,     is_parallel: true  },
  { re: /quellstück/i,  is_parallel: true  },
];

const detectIsParallel = (name) => {
  for (const p of PHASE_PATTERNS) {
    if (p.re.test(name)) return p.is_parallel;
  }
  return false;
};

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

const WAIT_KEYWORDS = [
  'reifen', 'ruhen', 'gehen', 'gare', 'stockgare', 'stückgare',
  'abkühlen', 'quellen', 'rasten', 'entspannen', 'kühlschrank', 'autolyse'
];

function parseDurationAndType(text) {
  const lower = text.toLowerCase();
  const hourMatch = lower.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:std|h|stunden?)/i);
  const minMatch  = lower.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:min)/i);

  let duration = 10;
  if (hourMatch) {
    const h1 = parseInt(hourMatch[1]);
    const h2 = hourMatch[2] ? parseInt(hourMatch[2]) : h1;
    duration = ((h1 + h2) / 2) * 60;
  } else if (minMatch) {
    const m1 = parseInt(minMatch[1]);
    const m2 = minMatch[2] ? parseInt(minMatch[2]) : m1;
    duration = (m1 + m2) / 2;
  }

  let type = 'Aktion';
  // "backen" als eigenständiges Verb, aber NICHT "Backofen" oder "vorheizen" allein
  const isBaking = /\bbacken\b/i.test(text) && !/\bbackofen\b/i.test(text);
  if (isBaking) {
    type = 'Backen';
  } else if (
    WAIT_KEYWORDS.some(kw => lower.includes(kw)) ||
    (duration > 25 && !lower.includes('kneten') && !lower.includes('mischen') && !lower.includes('vorheizen') && !lower.includes('backofen'))
  ) {
    type = 'Warten';
  }

  return { duration, type };
}

// ── SCHRITT-SPLITTING ─────────────────────────────────────────
// Marcel Paa verbindet oft Aktion + Wartezeit in einem Satz:
// "...dehnen und falten. Danach den Teig wieder abdecken und weitere 30 Min. ruhen lassen."
// Wir splitten an ". Danach/Anschliessend/Dann/Nun" wenn der zweite Teil eine Zeitangabe
// UND ein Wartewort enthält.
const SPLIT_AFTER = /\.\s*(Danach|Anschliessend|Dann|Nun)\b/;
const HAS_WAIT_AND_TIME = (text) => {
  const lower = text.toLowerCase();
  const hasTime = /\d+\s*(?:min|std|stunden?|h\b)/i.test(text);
  const hasWait = ['ruhen lassen', 'aufgehen lassen', 'gehen lassen', 'quellen lassen',
    'reifen lassen', 'abkühlen', 'kühl stellen', 'stehen lassen'].some(kw => lower.includes(kw));
  return hasTime && hasWait;
};

function splitStepIfNeeded(text) {
  const match = text.match(SPLIT_AFTER);
  if (!match) return null;

  const splitIdx = text.indexOf(match[0]);
  const part1 = text.slice(0, splitIdx + 1).trim(); // bis einschl. Punkt
  const part2 = text.slice(splitIdx + match[0].length - match[1].length).trim(); // ab Schlüsselwort

  // Nur splitten wenn der zweite Teil wirklich eine Wartezeit ist
  if (part1.length > 10 && HAS_WAIT_AND_TIME(part2)) {
    return [part1, part2];
  }
  return null;
}

function processInstruction(text) {
  // FIX: "Tipp: ..." Schritte komplett ignorieren
  if (/^Tipp[:. ]/i.test(text.trim())) return [];

  const parts = splitStepIfNeeded(text);
  if (parts) {
    return parts.map(p => {
      const { duration, type } = parseDurationAndType(p);
      return { instruction: p, duration, type };
    });
  }

  const { duration, type } = parseDurationAndType(text);
  return [{ instruction: text, duration, type }];
}

// ── HAUPT-SCRAPER ────────────────────────────────────────────
const scrapeMarcelPaa = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Crumb/1.0)' },
      timeout: 12000
    });

    const $ = cheerio.load(data);
    const dough_sections = [];

    // 1. ZUTATEN-GRUPPEN
    $('.wprm-recipe-ingredient-group').each((_, group) => {
      const rawName = $(group).find('.wprm-recipe-group-name').text().trim();
      const sectionName = rawName || 'Brotteig';

      const ingredients = [];
      $(group).find('.wprm-recipe-ingredient').each((_, ing) => {
        const amount = $(ing).find('.wprm-recipe-ingredient-amount').text().trim();
        const unit   = $(ing).find('.wprm-recipe-ingredient-unit').text().trim();
        const name   = $(ing).find('.wprm-recipe-ingredient-name').text().trim();
        const notes  = $(ing).find('.wprm-recipe-ingredient-notes').text().trim();
        if (!name) return;
        ingredients.push({
          amount: evalFraction(amount),
          unit: unit || 'g',
          name: notes ? `${name} (${notes})` : name
        });
      });

      dough_sections.push({
        name: sectionName,
        is_parallel: detectIsParallel(sectionName),
        ingredients,
        steps: []
      });
    });

    // Fallback: Wenn keine Gruppen gefunden → eine Hauptsektion
    if (dough_sections.length === 0) {
      dough_sections.push({ name: 'Brotteig', is_parallel: false, ingredients: [], steps: [] });
    }

    // 2. ANWEISUNGEN
    // Marcel Paa hat oft eine Instruction-Group pro Zutatens-Gruppe
    // Prüfen ob es mehrere Instruction-Groups gibt
    const instructionGroups = $('.wprm-recipe-instruction-group');

    if (instructionGroups.length > 1) {
      // Mehrere Gruppen → jede Gruppe gehört zur gleichnamigen Zutatens-Sektion
      instructionGroups.each((gIdx, group) => {
        const groupName = $(group).find('.wprm-recipe-group-name').text().trim();
        // Passende Sektion finden
        let sectionIdx = dough_sections.findIndex(s =>
          groupName && s.name.toLowerCase() === groupName.toLowerCase()
        );
        if (sectionIdx < 0) sectionIdx = Math.min(gIdx, dough_sections.length - 1);

        $(group).find('.wprm-recipe-instruction-text').each((_, el) => {
          const text = $(el).text().trim();
          if (!text) return;
          const steps = processInstruction(text);
          dough_sections[sectionIdx].steps.push(...steps);
        });
      });
    } else {
      // Einzelne Gruppe → alle Schritte in Hauptsektion
      let currentSectionIdx = 0;
      $('.wprm-recipe-instruction-text').each((_, el) => {
        const text = $(el).text().trim();
        if (!text) return;

        // Sektionswechsel anhand von Erwähnungen
        dough_sections.forEach((sec, idx) => {
          if (idx > currentSectionIdx && text.toLowerCase().includes(sec.name.toLowerCase())) {
            currentSectionIdx = idx;
          }
        });

        const steps = processInstruction(text);
        dough_sections[currentSectionIdx].steps.push(...steps);

        // Nach langer Fermentation zur nächsten parallelen Phase vorspringen
        const lastStep = steps[steps.length - 1];
        if (lastStep?.type === 'Warten' && lastStep.duration >= 120 && currentSectionIdx < dough_sections.length - 1) {
          if (dough_sections[currentSectionIdx].is_parallel) currentSectionIdx++;
        }
      });
    }

    // 3. BILD – Marcel Paa hat ein großes Blog-Bild oben
    let imageUrl = '';

    // Prio 1: WPRM-eigenes Rezeptbild (meist hochauflösend)
    const wprmImg = $('.wprm-recipe-image img').first();
    if (wprmImg.length) {
      const srcset = wprmImg.attr('srcset') || wprmImg.attr('data-srcset');
      if (srcset) {
        const best = srcset.split(',')
          .map(s => { const p = s.trim().split(' '); return { url: p[0], w: parseInt(p[1]) || 0 }; })
          .sort((a, b) => b.w - a.w)[0];
        imageUrl = best?.url || '';
      }
      if (!imageUrl) imageUrl = wprmImg.attr('data-lazy-src') || wprmImg.attr('src') || '';
    }

    // Prio 2: Großes Blog-Headerbild
    if (!imageUrl || imageUrl.includes('150x150')) {
      const headerImg = $('img[src*="Blog-MP"]').first();
      if (headerImg.length) {
        imageUrl = headerImg.attr('src') || '';
      }
    }

    // Prio 3: Erstes großes Bild im Content
    if (!imageUrl || imageUrl.includes('150x150')) {
      const contentImg = $('.wp-block-image img, .size-large img, .entry-content img').first();
      if (contentImg.length) {
        const srcset = contentImg.attr('srcset') || contentImg.attr('data-srcset');
        if (srcset) {
          const best = srcset.split(',')
            .map(s => { const p = s.trim().split(' '); return { url: p[0], w: parseInt(p[1]) || 0 }; })
            .sort((a, b) => b.w - a.w)[0];
          imageUrl = best?.url || contentImg.attr('src') || '';
        } else {
          imageUrl = contentImg.attr('data-lazy-src') || contentImg.attr('src') || '';
        }
      }
    }

    // WordPress-Thumbnail-Suffix entfernen
    if (imageUrl) {
      imageUrl = imageUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
    }

    // 4. BESCHREIBUNG
    const description = $('.wprm-recipe-summary').text().trim()
      || $('meta[name="description"]').attr('content')?.trim()
      || '';

    // 5. TITEL
    const title = $('.wprm-recipe-name').text().trim() || $('h1').first().text().trim();

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ Marcel Paa: "${title}" – ${result.dough_sections.length} Phasen`);
    return result;

  } catch (error) {
    console.error('Marcel Paa Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeMarcelPaa;