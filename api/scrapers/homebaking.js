const axios = require('axios');
const cheerio = require('cheerio');
const { stepDuration, isBakingStep, detectPortionCount, scaleSectionsToOnePortion, splitCompoundStep } = require('./utils');


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
  { re: /brotaroma/i,   is_parallel: true  },
  { re: /kochstück/i,   is_parallel: true  },
  { re: /brühstück/i,   is_parallel: true  },
  { re: /quellstück/i,  is_parallel: true  },
  { re: /biga/i,        is_parallel: true  },
];

const detectIsParallel = (name) => {
  for (const p of PHASE_PATTERNS) if (p.re.test(name)) return p.is_parallel;
  return false;
};

// ── HAUPT-SCRAPER ────────────────────────────────────────────
const scrapeHomebaking = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Crumb/1.0)' },
      timeout: 12000
    });
    const $ = cheerio.load(data);
    const dough_sections = [];

    // Zwischenprodukte (reifer Vorteig etc.) aus Zutaten herausfiltern
    const isIntermediate = (name) =>
      /\b(?:reife[rs]?|gereifter?)\b/i.test(name) ||
      /\b(?:sauerteig|biga|poolish|levain|vorteig)\b.{0,25}(?:stufe\s*\d|von stufe)/i.test(name);

    // 1. PHASEN + ZUTATEN aus h3/ul-Struktur
    const recipeContent = $('.entry-content, article .content, .post-content, main article').first();

    recipeContent.find('h3').each((_, h3) => {
      const name = $(h3).text().trim();
      if (!name || name.length > 60) return;
      const nameLower = name.toLowerCase().replace(/:$/, '').trim();
      const NON_PHASE = ['herstellung', 'zubereitung', 'zutaten', 'kommentar', 'newsletter'];
      if (NON_PHASE.some(s => nameLower.includes(s))) return;
      const isPhase = PHASE_PATTERNS.some(p => p.re.test(nameLower)) ||
        ['sauerteig', 'vorteig', 'hauptteig', 'brotaroma', 'teig', 'biga'].some(k => nameLower.includes(k));
      if (!isPhase) return;

      const cleanName = name.replace(/:$/, '').trim();

      const siblings = [];
      let cur = $(h3).next();
      while (cur.length && !cur.is('h3')) {
        siblings.push(cur);
        cur = cur.next();
      }

      const stufenPs = siblings.filter(el =>
        el.is('p') && /^Stufe\s+\d+[:.]?\s*$/i.test(el.text().trim())
      );

      if (stufenPs.length >= 2) {
        let stufenIdx = 0;
        let collectingIngredients = [];
        let inStufe = false;

        siblings.forEach(el => {
          const text = el.text().trim();
          if (el.is('p') && /^Stufe\s+(\d+)[:.]?\s*$/i.test(text)) {
            stufenIdx++;
            inStufe = true;
            collectingIngredients = [];
            return;
          }
          if (!inStufe) return;
          if (el.is('ul')) {
            el.find('li').each((_, li) => {
              const liText = $(li).text().trim();
              if (!liText) return;
              const match = liText.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
              if (match) {
                const ingName = match[3].trim();
                if (isIntermediate(ingName)) return;
                collectingIngredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: ingName });
              } else {
                if (!isIntermediate(liText))
                  collectingIngredients.push({ amount: 0, unit: '', name: liText });
              }
            });
            dough_sections.push({
              name: `${cleanName} Stufe ${stufenIdx}`,
              is_parallel: detectIsParallel(cleanName),
              ingredients: [...collectingIngredients],
              steps: []
            });
            collectingIngredients = [];
          }
        });
      } else {
        const ingredients = [];
        siblings.forEach(el => {
          if (!el.is('ul')) return;
          el.find('li').each((_, li) => {
            const text = $(li).text().trim();
            if (!text) return;
            const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
            if (match) {
              const ingName = match[3].trim();
              if (isIntermediate(ingName)) return;
              ingredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: ingName });
            } else {
              if (!isIntermediate(text))
                ingredients.push({ amount: 0, unit: '', name: text });
            }
          });
        });

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
      }
    });

    if (dough_sections.length === 0) {
      const ingredients = [];
      recipeContent.find('li').each((_, li) => {
        const text = $(li).text().trim();
        const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
        if (match) ingredients.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() });
      });
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients, steps: [] });
    }

    // 2. SCHRITTE – in DOM-Reihenfolge sammeln und sofort Phase zuordnen
    const SKIP_TEXT = /kommentar|newsletter|rezept drucken/i;
    const SKIP_EXACT = /^(?:Stufe\s+\d+[:.]?\s*|für ein Teiggewicht.*|Teiggewicht von.*)$/i;

    const hauptteigIdx = Math.max(0, dough_sections.findIndex(s => /hauptteig/i.test(s.name)));
    const isIngredientList = (t) => /^[A-ZÄÖÜ][a-zäöüß]+(?:teig|laib|biga|poolish|levain)?[,]\s/.test(t);

    let currentSectionIdx = 0;

    function assignStep(text) {
      const mentionedIdxs = dough_sections
        .map((sec, idx) => ({
          idx,
          mentioned: new RegExp('\\b' + sec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)
        }))
        .filter(x => x.mentioned)
        .map(x => x.idx);

      if (mentionedIdxs.length > 1) {
        currentSectionIdx = hauptteigIdx;
      } else if (mentionedIdxs.length === 1) {
        const newIdx = mentionedIdxs[0];
        if (isIngredientList(text) && newIdx !== hauptteigIdx) {
          currentSectionIdx = hauptteigIdx;
        } else if (newIdx > currentSectionIdx) {
          currentSectionIdx = newIdx;
        }
      }

      // splitCompoundStep zerlegt "Aktion und X Stunden reifen lassen" in Einzel-Schritte
      if (dough_sections[currentSectionIdx]) {
        splitCompoundStep(text).forEach(step => {
          dough_sections[currentSectionIdx].steps.push(step);
        });
      }
    }

    let inRecipeScope = false;
    let inHerstellung = false;

    recipeContent.find('h2, h3, p, ul').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const rawText = $(el).text().trim();

      if (tag === 'h2') {
        if (rawText.toLowerCase() === 'rezept') { inRecipeScope = true; return; }
        if (inRecipeScope) { inRecipeScope = false; }
        return;
      }
      if (!inRecipeScope) return;

      if (tag === 'h3') {
        const h3Name = rawText.toLowerCase().replace(/:$/, '').trim();
        inHerstellung = ['herstellung', 'zubereitung'].includes(h3Name);
        if (!inHerstellung) {
          const matchIdx = dough_sections.findIndex(s =>
            new RegExp('\\b' + s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' Stufe')[0] + '\\b', 'i').test(rawText)
          );
          if (matchIdx >= 0 && matchIdx > currentSectionIdx) {
            currentSectionIdx = matchIdx;
          }
        }
        return;
      }

      if (tag === 'p') {
        if ($(el).find('img').length) return;
        // "Stufe N:" VOR Längenfilter prüfen – hat nur 8 Zeichen
        const stufenM = rawText.match(/^Stufe\s+(\d+)[:.]?\s*$/i);
        if (stufenM) {
          const stufenNr = parseInt(stufenM[1]);
          const curBaseName = dough_sections[currentSectionIdx]?.name.replace(/\s+Stufe\s+\d+$/i, '');
          const nextStufenIdx = dough_sections.findIndex(s =>
            s.name.replace(/\s+Stufe\s+\d+$/i, '') === curBaseName &&
            new RegExp(`Stufe\\s+${stufenNr}$`, 'i').test(s.name)
          );
          if (nextStufenIdx >= 0) currentSectionIdx = nextStufenIdx;
          return;
        }
        if (rawText.length < 15) return;
        if (SKIP_TEXT.test(rawText)) return;
        if (SKIP_EXACT.test(rawText)) return;
        if (/^<[a-z]/i.test(rawText)) return;
        if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(rawText) && rawText.includes('http')) return;
        assignStep(rawText);
        return;
      }

      if (tag === 'ul' && inHerstellung) {
        const allLis = $(el).find('li');
        const hasOnlyImages = allLis.length > 0 && allLis.toArray().every(li =>
          $(li).find('img').length > 0 && $(li).text().trim().length < 5
        );
        if (hasOnlyImages) return;

        $(el).find('li').each((_, li) => {
          if ($(li).find('img').length) return;
          const text = $(li).text().trim();
          if (/^<[a-z]/i.test(text)) return;
          if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(text) && text.includes('http')) return;
          if (text.length < 15 || SKIP_TEXT.test(text)) return;
          assignStep(text);
        });
      }
    });

    // Phasen ohne Schritte → Platzhalter
    dough_sections.forEach(sec => {
      if (sec.steps.length === 0) {
        const lower = sec.name.toLowerCase();
        const duration = lower.includes('sauerteig') ? 960
          : lower.includes('biga') || lower.includes('vorteig') || lower.includes('poolish') ? 1440
          : lower.includes('brotaroma') ? 120 : 60;
        sec.steps.push({ instruction: `${sec.name} ansetzen und reifen lassen`, duration, type: 'Warten' });
      }
    });

    // 2b. PORTIONSGRÖSSE erkennen und auf 1 Stück skalieren
    let portionCount = 1;
    recipeContent.find('h2').each((_, h2) => {
      if ($(h2).text().trim().toLowerCase() !== 'rezept') return;
      const portionText = $(h2).next('p').text().trim();
      portionCount = detectPortionCount(portionText);
    });
    if (portionCount === 1) {
      recipeContent.find('p').each((_, p) => {
        const t = $(p).text().trim();
        if (/für ein Teiggewicht/i.test(t) || /Teiggewicht von/i.test(t)) {
          portionCount = detectPortionCount(t);
          return false;
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
    const galleryImg = $('img[src*="/app/uploads/"]').first();
    if (galleryImg.length) {
      imageUrl = galleryImg.attr('src') || '';
      imageUrl = imageUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
    }
    if (!imageUrl) {
      imageUrl = $('meta[property="og:image"]').attr('content') || '';
    }

    const title = $('h1').first().text().trim() || $('title').text().replace(' – HOMEBAKING BLOG', '').trim();

    let description = '';
    const h2Rezept = recipeContent.find('h2').filter((_, h2) => $(h2).text().trim().toLowerCase() === 'rezept').first();
    if (h2Rezept.length) {
      const descParts = [];
      h2Rezept.prevAll('p').each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 30) descParts.unshift(t);
      });
      description = descParts.join(' ').slice(0, 500).trim();
    }
    if (!description) {
      description = $('meta[property="og:description"]').attr('content') || '';
    }

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