const axios = require('axios');
const cheerio = require('cheerio');
const { stepDuration, isBakingStep, splitCompoundStep } = require('./utils');
const { parseFullRecipeWithLLM } = require('./llm-refine');

const scrapeBrotdoc = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const dough_sections = [];

    // ── LAYOUT-ERKENNUNG ─────────────────────────────────────────────────────
    // Neu (WPRM): .wprm-recipe-ingredient-group vorhanden
    // Alt (pre-WPRM): Rezept als Fließtext in .entry-content
    const hasWprm = $('.wprm-recipe-ingredient-group').length > 0;
    console.log(`  → Brotdoc Layout: ${hasWprm ? 'WPRM' : 'Alt (Freitext → LLM)'}`);

    // ── WPRM-LAYOUT ──────────────────────────────────────────────────────────
    if (hasWprm) {
      // 1. ZUTATEN-GRUPPEN
      $('.wprm-recipe-ingredient-group').each((_, group) => {
        const sectionName = $(group).find('.wprm-recipe-group-name').text().trim() || 'Hauptteig';
        const ingredients = [];

        $(group).find('.wprm-recipe-ingredient').each((_, ing) => {
          const amount = $(ing).find('.wprm-recipe-ingredient-amount').text().trim();
          const unit = $(ing).find('.wprm-recipe-ingredient-unit').text().trim();
          const name = $(ing).find('.wprm-recipe-ingredient-name').text().trim();
          const notes = $(ing).find('.wprm-recipe-ingredient-notes').text().trim();

          ingredients.push({
            amount: evalFraction(amount),
            unit: unit || 'g',
            name: notes ? `${name} (${notes})` : name
          });
        });

        dough_sections.push({
          name: sectionName,
          is_parallel: !sectionName.toLowerCase().includes('hauptteig') && !sectionName.toLowerCase().includes('backen'),
          ingredients,
          steps: []
        });
      });

      // 2. ANWEISUNGEN
      let currentSectionIdx = 0;
      $('.wprm-recipe-instruction-text').each((i, el) => {
        const text = $(el).text().trim();
        const lowerText = text.toLowerCase();

        dough_sections.forEach((sec, idx) => {
          if (lowerText.includes(sec.name.toLowerCase()) && idx > currentSectionIdx) {
            currentSectionIdx = idx;
          }
        });

        if (dough_sections[currentSectionIdx]) {
          splitCompoundStep(text).forEach(step => {
            dough_sections[currentSectionIdx].steps.push(step);
          });
        }
      });
    }

    // ── ALTES LAYOUT (pre-WPRM) → LLM ───────────────────────────────────────
    if (!hasWprm) {
      // Relevanten Rezepttext aus .entry-content extrahieren
      // Stopp vor Kommentarbereich und englischer Übersetzung (falls vorhanden)
      const entry = $('.entry-content, .post-content, article').first();

      // Englische Übersetzung entfernen: alles ab "ENGLISH RECIPE" oder "English recipe"
      entry.find('*').each((_, el) => {
        const text = $(el).text().trim();
        if (/^ENGLISH\s+RECIPE/i.test(text)) {
          // Dieses Element und alle folgenden Siblings entfernen
          $(el).nextAll().remove();
          $(el).remove();
          return false;
        }
      });

      // Kommentare & Footer entfernen
      entry.find('.comments-area, .sharedaddy, .jp-relatedposts, nav, footer').remove();

      const rawText = entry.text().replace(/\s{3,}/g, '\n\n').trim();

      if (rawText.length > 100) {
        console.log(`  → LLM-Vollrezept-Parsing (${rawText.length} Zeichen)...`);
        const llmResult = await parseFullRecipeWithLLM(rawText, process.env.OPENROUTER_API_KEY);

        if (llmResult) {
          // Bild separat ermitteln (LLM liefert kein Bild)
          const imageUrl = extractImage($);
          return {
            title: llmResult.title || $('h1').first().text().trim(),
            description: llmResult.description || '',
            image_url: imageUrl,
            source_url: url,
            dough_sections: llmResult.dough_sections.filter(s =>
              s.ingredients?.length > 0 || s.steps?.length > 0
            )
          };
        }
      }

      // LLM fehlgeschlagen → leeres Ergebnis mit Titel
      console.warn('  ⚠ LLM fehlgeschlagen – Rezept konnte nicht extrahiert werden');
      return {
        title: $('h1').first().text().trim(),
        description: '',
        image_url: extractImage($),
        source_url: url,
        dough_sections: [{ name: 'Hauptteig', is_parallel: false, ingredients: [], steps: [] }]
      };
    }

    // ── BILD (WPRM-Pfad) ─────────────────────────────────────────────────────
    const imageUrl = extractImage($);

    return {
      title: $('.wprm-recipe-name').text().trim() || $('h1').text().trim(),
      description: $('.wprm-recipe-summary').text().trim(),
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

  } catch (error) {
    console.error("Brotdoc Scraper Error:", error.message);
    return null;
  }
};

// ── HILFSFUNKTIONEN ───────────────────────────────────────────────────────────

function extractImage($) {
  let imageUrl = '';

  const largeImage = $('.wp-block-image.size-large img').first();
  const fallbackImage = !largeImage.length
    ? $('.wp-block-gallery img, .wp-block-image img, .wp-entry-content img, .entry-content img').first()
    : largeImage;

  if (fallbackImage.length) {
    const srcset = fallbackImage.attr('srcset');
    if (srcset) {
      const best = srcset.split(',')
        .map(s => { const p = s.trim().split(' '); return { url: p[0], width: parseInt(p[1]) || 0 }; })
        .sort((a, b) => b.width - a.width)[0];
      imageUrl = best.url;
    }
    if (!imageUrl) {
      imageUrl = fallbackImage.attr('data-lazy-src') || fallbackImage.attr('src') || '';
    }
  }

  if (!imageUrl || imageUrl.includes('150x150')) {
    const wprmImg = $('.wprm-recipe-image img');
    imageUrl = wprmImg.attr('data-lazy-src') || wprmImg.attr('src') || '';
  }

  if (imageUrl) {
    imageUrl = imageUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
  }

  return imageUrl;
}

function evalFraction(amount) {
  if (!amount) return 0;
  let cleanAmount = amount.replace(',', '.').trim();
  if (cleanAmount.includes('/')) {
    const parts = cleanAmount.split('/');
    if (parts.length === 2) return parseFloat(parts[0]) / parseFloat(parts[1]);
  }
  return parseFloat(cleanAmount) || 0;
}

module.exports = scrapeBrotdoc;