const axios = require('axios');
const cheerio = require('cheerio');
const { isBakingStep, splitCompoundStep, scaleSectionsToOnePortion } = require('./utils');

// ── PHASE-ERKENNUNG (gleiche Logik wie index.js) ─────────────
const PHASE_PATTERNS = [
  { re: /hauptteig$/i,  is_parallel: false },
  { re: /teig$/i,       is_parallel: true  },
  { re: /stück$/i,      is_parallel: true  },
  { re: /sauerteig/i,   is_parallel: true  },
  { re: /sauer$/i,      is_parallel: true  },   // Grundsauer, Weizensauer, etc.
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
          if (/^Tipp[:. ]/i.test(text)) return;
          splitCompoundStep(text).forEach(step => dough_sections[sectionIdx].steps.push(step));
        });
      });
    } else {
      // Einzelne Gruppe → alle Schritte in Hauptsektion
      let currentSectionIdx = 0;
      $('.wprm-recipe-instruction-text').each((_, el) => {
        const text = $(el).text().trim();
        if (!text) return;
        if (/^Tipp[:. ]/i.test(text)) return;

        // Sektionswechsel anhand von Erwähnungen
        dough_sections.forEach((sec, idx) => {
          if (idx > currentSectionIdx && text.toLowerCase().includes(sec.name.toLowerCase())) {
            currentSectionIdx = idx;
          }
        });

        const steps = splitCompoundStep(text);
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

    // PORTIONSGRÖSSE via WPRM-Servings-Feld (z.B. "2 Brote")
    // .wprm-recipe-servings enthält die Zahl, Container ggf. Text wie "2 Brote"
    const wPrmServings = parseInt($('.wprm-recipe-servings').text().trim()) || 1;
    const servingsUnit = $('.wprm-recipe-servings-unit').text().trim().toLowerCase();
    // Nur skalieren wenn es wirklich "Brote/Stück/Laibe" sind, nicht "Portionen" (das wäre Schneiden)
    const isLoafUnit = /brot|laib|stück|baguette|wecken|brötchen/i.test(servingsUnit);
    const portionCount = (isLoafUnit && wPrmServings >= 2) ? wPrmServings : 1;
    let scaledSections = dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0);
    if (portionCount > 1) {
      console.log(`  → ${portionCount} ${servingsUnit} erkannt – skaliere auf 1`);
      scaledSections = scaleSectionsToOnePortion(scaledSections, portionCount);
    }

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      portion_count: portionCount,
      dough_sections: scaledSections
    };

    console.log(`✅ Marcel Paa: "${title}" – ${result.dough_sections.length} Phasen, ${portionCount} Stück (auf 1 skaliert)`);
    return result;

  } catch (error) {
    console.error('Marcel Paa Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeMarcelPaa;