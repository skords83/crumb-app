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
  { re: /sauer$/i,      is_parallel: true  },   // Grundsauer, Weizensauer, etc.
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

    // ── LAYOUT-ÜBERSICHT ─────────────────────────────────────
    // Layout 1 – Alt (≤2019):  h3 + ul-Zutaten + p/ul-Schritte direkt danach
    //                           kein separater "Herstellung"-Block nötig
    // Layout 2 – Mittel (~2020): h2 Rezept + h4-Stufen + figure.wp-block-table
    //                            Herstellung als eigener h3 mit ul-Schritten
    // Layout 3 – Neu (≥2022):  h2 Rezept + h3-Phasen + Tabellen
    //                           Schritte als ul direkt nach Zutatentabelle (kein Herstellungs-Block)

    const recipeContent = $('article.post-type-hb_recipe, .entry-content, article .content, .post-content, main article, article, main').first();
    console.log(`  → recipeContent: ${recipeContent.prop('tagName')}, class: ${recipeContent.attr('class')?.slice(0, 60)}`);

    // ── ZUTAT-PARSE-HELFER ───────────────────────────────────

    const parseTableIngredients = (tableEl) => {
      const ings = [];
      $(tableEl).find('tr').each((_, tr) => {
        const cells = $(tr).find('td');
        if (cells.length < 2) return;
        const amountRaw = $(cells[0]).text().trim();
        const ingName   = $(cells[1]).text().trim();
        if (!ingName) return;
        const m = amountRaw.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)$/);
        if (m) {
          ings.push({ amount: evalFraction(m[1]), unit: m[2] || 'g', name: ingName });
        } else if (amountRaw === '' || amountRaw === '-') {
          ings.push({ amount: 0, unit: '', name: ingName });
        }
        // 3-spaltige Tabellen (Menge | Zutat | Prozent): Prozent-Spalte ignorieren
      });
      return ings;
    };

    const parseUlIngredients = (ulEl) => {
      const ings = [];
      $(ulEl).find('li').each((_, li) => {
        const text = $(li).text().trim();
        if (!text) return;
        const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
        if (match) {
          ings.push({ amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() });
        }
        // Items ohne führende Zahl sind Schritte, nicht Zutaten → überspringen
      });
      return ings;
    };

    const isIngredientContainer = (el) =>
      ($(el).is('figure') && $(el).hasClass('wp-block-table')) ||
      ($(el).is('div') && $(el).hasClass('wp-block-group')) ||
      $(el).is('ul') ||
      $(el).is('table');

    // Prüft ob eine ul Zutaten enthält (mindestens ein Item mit führendem Zahlenwert)
    const ulHasIngredients = (ulEl) =>
      $(ulEl).find('li').toArray().some(li =>
        /^[\d,./]+\s*[a-zA-ZäöüÄÖÜ%]*\s+\S/.test($(li).text().trim())
      );

    // Info-Tabellen (z.B. "Richtwerte") haben keine Zahl in der ersten Zelle
    const isInfoTable = (tableEl) => {
      const firstCell = $(tableEl).find('tr').first().find('td').first().text().trim();
      return firstCell !== '' && firstCell !== '-' && !/^[\d,./]/.test(firstCell);
    };

    const parseIngredients = (el) => {
      if ($(el).is('ul')) return parseUlIngredients(el);
      const table = $(el).find('table').first()[0] || ($(el).is('table') ? el : null);
      if (table && !isInfoTable(table)) return parseTableIngredients(table);
      return [];
    };

    // ── PHASEN-ERKENNUNG ─────────────────────────────────────
    const NON_PHASE     = ['herstellung', 'zubereitung', 'zutaten', 'kommentar', 'newsletter', 'gesamtmenge', 'richtwerte', 'hinweis', 'tipp'];
    const PHASE_KEYWORDS = ['sauerteig', 'vorteig', 'hauptteig', 'brotaroma', 'teig', 'biga', 'sauer', 'poolish', 'levain', 'quellstück', 'brühstück', 'kochstück', 'autolyse'];

    const isPhaseHeading = (text) => {
      const lower = text.toLowerCase().replace(/:$/, '').trim();
      if (lower.length > 80) return false;
      if (NON_PHASE.some(s => lower.includes(s))) return false;
      return PHASE_PATTERNS.some(p => p.re.test(lower)) || PHASE_KEYWORDS.some(k => lower.includes(k));
    };

    const cleanHeading = (text) => text.replace(/:$/, '').trim();

    const getSiblings = (headingEl, stopSelector) => {
      const elems = [];
      let cur = $(headingEl).next();
      while (cur.length && !cur.is(stopSelector)) {
        elems.push(cur);
        cur = cur.next();
      }
      return elems;
    };

    // ── LAYOUT ERKENNEN ──────────────────────────────────────
    const h2Rezept = recipeContent.find('h2').filter((_, h2) =>
      $(h2).text().trim().toLowerCase() === 'rezept'
    ).first();

    const hasH4Stufen = h2Rezept.length > 0 &&
      recipeContent.find('h4').filter((_, h4) =>
        /^\d+\.\s*Stufe/i.test($(h4).text().trim())
      ).length > 0;

    const hasHerstellungH3 = recipeContent.find('h3').filter((_, h3) =>
      ['herstellung', 'zubereitung'].includes($(h3).text().trim().toLowerCase().replace(/:$/, ''))
    ).length > 0;

    const isLayout3 = h2Rezept.length > 0 && !hasH4Stufen && !hasHerstellungH3;
    const isLayout2 = h2Rezept.length > 0 && hasH4Stufen;
    // isLayout1 = everything else

    console.log(`  → Layout: ${isLayout3 ? '3 (Neu/Tabellen)' : isLayout2 ? '2 (Mittel/h4-Stufen)' : '1 (Alt/ul)'}, h2Rezept=${h2Rezept.length > 0}, hasH4Stufen=${hasH4Stufen}, hasHerstellung=${hasHerstellungH3}`);

    // ── LAYOUT 3: Neu (≥2022) ─────────────────────────────────
    // Phasen als h3, Zutaten als Tabelle, Schritte als ul/p direkt nach Tabelle
    if (isLayout3) {
      let scanning = false;
      recipeContent.find('h2, h3').each((_, heading) => {
        const tag  = heading.tagName.toLowerCase();
        const text = $(heading).text().trim();

        if (tag === 'h2') { scanning = text.toLowerCase() === 'rezept'; return; }
        if (!scanning || !isPhaseHeading(text)) return;

        const cleanName  = cleanHeading(text);
        const siblings   = getSiblings(heading, 'h3, h2');
        const ingredients = [];
        const steps       = [];
        let foundIngredients = false;

        siblings.forEach(el => {
          // Tabellen / wp-block-* immer als Zutaten-Container
          const isTable = ($(el[0]).is('figure') && $(el[0]).hasClass('wp-block-table')) ||
            ($(el[0]).is('div') && $(el[0]).hasClass('wp-block-group')) ||
            $(el[0]).is('table');
          if (isTable) {
            const ings = parseIngredients(el[0]);
            if (ings.length > 0) { ingredients.push(...ings); foundIngredients = true; }
            return;
          }
          // ul: Zutaten wenn Items mit Zahlenwert, sonst Schritte
          if ($(el).is('ul')) {
            if (ulHasIngredients(el[0])) {
              const ings = parseUlIngredients(el[0]);
              if (ings.length > 0) { ingredients.push(...ings); foundIngredients = true; }
            } else if (foundIngredients) {
              $(el).find('li').each((_, li) => {
                if ($(li).find('img').length) return;
                const t = $(li).text().trim();
                if (t.length < 10) return;
                splitCompoundStep(t).forEach(step => steps.push(step));
              });
            }
            return;
          }
          if (!foundIngredients) return; // vor Zutaten: p nicht als Schritt werten
          // p nach Zutaten → Schritt-Absatz
          if ($(el).is('p')) {
            const t = $(el).text().trim();
            if (t.length < 15 || /^<[a-z]/i.test(t)) return;
            if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(t)) return;
            splitCompoundStep(t).forEach(step => steps.push(step));
          }
        });

        dough_sections.push({ name: cleanName, is_parallel: detectIsParallel(cleanName), ingredients, steps });
      });
    }

    // ── LAYOUT 2: Mittel (~2020) ──────────────────────────────
    // h4-Stufen unter Sauerteig-h3, Tabellen als Zutaten, separater Herstellungs-Block
    if (isLayout2) {
      let scanning = false;
      recipeContent.find('h2, h3, h4').each((_, heading) => {
        const tag  = heading.tagName.toLowerCase();
        const text = $(heading).text().trim();

        if (tag === 'h2') { scanning = text.toLowerCase() === 'rezept'; return; }
        if (!scanning) return;

        if (tag === 'h4') {
          const stufenM = text.match(/^(\d+)\.\s*Stufe\s+(.+)$/i);
          if (stufenM) {
            const name = `${stufenM[2].trim()} (Stufe ${stufenM[1]})`;
            const ings = [];
            getSiblings(heading, 'h3, h4, h2').forEach(el => {
              if (isIngredientContainer(el[0])) ings.push(...parseIngredients(el[0]));
            });
            dough_sections.push({ name, is_parallel: true, ingredients: ings, steps: [] });
            return;
          }
          if (isPhaseHeading(text)) {
            const name = cleanHeading(text);
            const ings = [];
            getSiblings(heading, 'h3, h4, h2').forEach(el => {
              if (isIngredientContainer(el[0])) ings.push(...parseIngredients(el[0]));
            });
            dough_sections.push({ name, is_parallel: detectIsParallel(name), ingredients: ings, steps: [] });
          }
          return;
        }

        if (tag === 'h3') {
          if (!isPhaseHeading(text)) return;
          const cleanName = cleanHeading(text);
          // Übersichts-h3 mit h4-Stufen → überspringen
          const firstH4 = $(heading).nextUntil('h3, h2').filter('h4').first();
          if (firstH4.length && /^\d+\.\s*Stufe/i.test(firstH4.text().trim())) return;
          const ings = [];
          getSiblings(heading, 'h3, h2').forEach(el => {
            if (isIngredientContainer(el[0])) ings.push(...parseIngredients(el[0]));
          });
          dough_sections.push({ name: cleanName, is_parallel: detectIsParallel(cleanName), ingredients: ings, steps: [] });
        }
      });
    }

    // ── LAYOUT 1: Alt (≤2019) ────────────────────────────────
    // h3-Phasen + ul-Zutaten, manchmal direkte Schritte, manchmal Herstellungs-Block
    if (!isLayout2 && !isLayout3) {
      let scanning = !h2Rezept.length;
      recipeContent.find('h2, h3').each((_, heading) => {
        const tag  = heading.tagName.toLowerCase();
        const text = $(heading).text().trim();

        if (tag === 'h2') { scanning = text.toLowerCase() === 'rezept'; return; }
        if (!scanning || !isPhaseHeading(text)) return;

        const cleanName = cleanHeading(text);
        const siblings  = getSiblings(heading, 'h3, h2');

        // Altes Stufen-Format: <p>Stufe 1:</p> gefolgt von <ul>
        const stufenPs = siblings.filter(el => {
          if (!$(el).is('p')) return false;
          const t = $(el).text().trim();
          if (/^Stufe\s+\d+[:.]?\s*$/i.test(t)) return true;
          const inner = $(el).children().first();
          return inner.is('strong, b') && /^Stufe\s+\d+[:.]?\s*$/i.test(inner.text().trim());
        });

        if (stufenPs.length >= 2) {
          let stufenIdx = 0;
          let inStufe   = false;
          siblings.forEach(el => {
            const t = $(el).text().trim();
            if ($(el).is('p') && /^Stufe\s+\d+[:.]?\s*$/i.test(t)) {
              stufenIdx++; inStufe = true; return;
            }
            if (!inStufe || !isIngredientContainer(el[0])) return;
            dough_sections.push({
              name: `${cleanName} Stufe ${stufenIdx}`,
              is_parallel: detectIsParallel(cleanName),
              ingredients: parseIngredients(el[0]),
              steps: []
            });
          });
        } else {
          const ingredients = [];
          siblings.forEach(el => {
            if (!isIngredientContainer(el[0])) return;
            ingredients.push(...parseIngredients(el[0]));
          });
          // Sehr alte Rezepte: Zutaten als Fließtext im ersten <p>
          if (ingredients.length === 0) {
            $(heading).next('p').text().split('\n').forEach(line => {
              const m = line.trim().match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
              if (m) ingredients.push({ amount: evalFraction(m[1]), unit: m[2] || 'g', name: m[3].trim() });
            });
          }
          dough_sections.push({ name: cleanName, is_parallel: detectIsParallel(cleanName), ingredients, steps: [] });
        }
      });
    }

    // ── LETZTER FALLBACK ─────────────────────────────────────
    if (dough_sections.length === 0) {
      const ingredients = [];
      recipeContent.find('li').each((_, li) => {
        const text = $(li).text().trim();
        const m = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
        if (m) ingredients.push({ amount: evalFraction(m[1]), unit: m[2] || 'g', name: m[3].trim() });
      });
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients, steps: [] });
    }

    // ── SCHRITTE (nur Layout 1 + 2) ──────────────────────────
    // Layout 3 hat Schritte bereits beim Phasen-Parsing
    if (!isLayout3) {
      const SKIP_TEXT  = /kommentar|newsletter|rezept drucken/i;
      const SKIP_EXACT = /^(?:Stufe\s+\d+[:.]?\s*|für ein Teiggewicht.*|Teiggewicht von.*)$/i;
      const hauptteigIdx = Math.max(0, dough_sections.findIndex(s => /hauptteig/i.test(s.name)));
      const isIngredientList = (t) => /^[A-ZÄÖÜ][a-zäöüß]+(?:teig|laib|biga|poolish|levain)?[,]\s/.test(t);

      let currentSectionIdx = 0;

      function assignStep(text) {
        const mentionedIdxs = dough_sections
          .map((sec, idx) => ({
            idx,
            mentioned: new RegExp('\\b' + sec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' (Stufe')[0] + '\\b', 'i').test(text)
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
        if (dough_sections[currentSectionIdx]) {
          splitCompoundStep(text).forEach(step => {
            dough_sections[currentSectionIdx].steps.push(step);
          });
        }
      }

      let inRecipeScope   = !h2Rezept.length;
      let inHerstellung   = false;
      let herstellungDone = false;

      recipeContent.find('h2, h3, h4, p, ul').each((_, el) => {
        const tag     = el.tagName.toLowerCase();
        const rawText = $(el).text().trim();

        if (tag === 'h2') {
          if (rawText.toLowerCase() === 'rezept') { inRecipeScope = true; return; }
          if (inRecipeScope) inRecipeScope = false;
          return;
        }
        if (!inRecipeScope) return;

        // ── Heading ──
        if (tag === 'h3' || tag === 'h4') {
          const lower = rawText.toLowerCase().replace(/:$/, '').trim();
          const wasHerstellung = inHerstellung;
          inHerstellung = ['herstellung', 'zubereitung'].includes(lower);
          if (wasHerstellung && !inHerstellung) herstellungDone = true;

          if (!inHerstellung) {
            // Layout 2: h4 "N. Stufe XYZ"
            const stufenM = rawText.match(/^(\d+)\.\s*Stufe\s+(.+)$/i);
            if (stufenM) {
              const name = `${stufenM[2].trim()} (Stufe ${stufenM[1]})`;
              const idx  = dough_sections.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
              if (idx >= 0) currentSectionIdx = idx;
              return;
            }
            const idx = dough_sections.findIndex(s =>
              new RegExp('\\b' + s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' Stufe')[0].split(' (Stufe')[0] + '\\b', 'i').test(rawText)
            );
            if (idx >= 0 && idx > currentSectionIdx) currentSectionIdx = idx;
          }
          return;
        }

        // ── <p> ──
        if (tag === 'p') {
          if (herstellungDone) return;
          if ($(el).find('img').length) return;

          // Stufen-Marker: <p>Stufe 1:</p> oder <p><strong>Stufe 1:</strong></p>
          const checkStufe = (t) => {
            const m = t.match(/^Stufe\s+(\d+)[:.]?\s*$/i);
            if (!m) return false;
            const nr   = parseInt(m[1]);
            const base = dough_sections[currentSectionIdx]?.name.replace(/\s+Stufe\s+\d+$/i, '');
            const idx  = dough_sections.findIndex(s =>
              s.name.replace(/\s+Stufe\s+\d+$/i, '') === base &&
              new RegExp(`Stufe\\s+${nr}$`, 'i').test(s.name)
            );
            if (idx >= 0) currentSectionIdx = idx;
            return true;
          };
          if (checkStufe(rawText)) return;
          const firstChild = $(el).children().first();
          if (firstChild.is('strong, b') && checkStufe(firstChild.text().trim())) return;

          if (rawText.length < 15) return;
          if (SKIP_TEXT.test(rawText) || SKIP_EXACT.test(rawText)) return;
          if (/^<[a-z]/i.test(rawText)) return;
          if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(rawText) && rawText.includes('http')) return;
          assignStep(rawText);
          return;
        }

        // ── <ul> ──
        // Layout 1+2: Herstellungs-Block ist die primäre Schritt-Quelle
        // Layout 1 ohne Herstellungs-Block: ul direkt nach Phase
        const wantUl = inHerstellung || (!hasHerstellungH3 && !herstellungDone);
        if (tag === 'ul' && wantUl) {
          const allLis = $(el).find('li');
          const onlyImages = allLis.length > 0 && allLis.toArray().every(li =>
            $(li).find('img').length > 0 && $(li).text().trim().length < 5
          );
          if (onlyImages) return;

          $(el).find('li').each((_, li) => {
            if ($(li).find('img').length) return;
            const text = $(li).text().trim();
            if (/^<[a-z]/i.test(text)) return;
            if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(text) && text.includes('http')) return;
            if (text.length < 10 || SKIP_TEXT.test(text)) return;
            assignStep(text);
          });

          if (inHerstellung) herstellungDone = true;
        }
      });
    }

    // ── PLATZHALTER-SCHRITTE ─────────────────────────────────
    dough_sections.forEach(sec => {
      if (sec.steps.length === 0) {
        const lower = sec.name.toLowerCase();
        const duration =
          lower.includes('sauerteig') || lower.includes('sauer') ? 960 :
          lower.includes('biga') || lower.includes('vorteig') || lower.includes('poolish') ? 1440 :
          lower.includes('brotaroma') ? 120 :
          lower.includes('brühstück') || lower.includes('kochstück') ? 30 :
          lower.includes('quellstück') ? 360 : 60;
        sec.steps.push({ instruction: `${sec.name} ansetzen und reifen lassen`, duration, type: 'Warten' });
      }
    });

    // ── PORTIONSGRÖSSE ───────────────────────────────────────
    let portionCount = 1;
    if (h2Rezept.length) {
      const portionP = h2Rezept.next('p');
      if (portionP.length) portionCount = detectPortionCount(portionP.text().trim());
    }
    if (portionCount === 1) {
      recipeContent.find('p').each((_, p) => {
        const t = $(p).text().trim();
        if (/für ein Teiggewicht|Teiggewicht von/i.test(t)) {
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

    // ── BILD ─────────────────────────────────────────────────
    let imageUrl = '';
    const galleryImg = $('img[src*="/app/uploads/"]').first();
    if (galleryImg.length) {
      imageUrl = (galleryImg.attr('src') || '').replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
    }
    if (!imageUrl) imageUrl = $('meta[property="og:image"]').attr('content') || '';

    // ── TITEL + BESCHREIBUNG ─────────────────────────────────
    const title = $('h1').first().text().trim() || $('title').text().replace(' – HOMEBAKING BLOG', '').trim();

    let description = '';
    if (h2Rezept.length) {
      const descParts = [];
      h2Rezept.prevAll('p').each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 30) descParts.unshift(t);
      });
      description = descParts.join(' ').slice(0, 500).trim();
    }
    if (!description) description = $('meta[property="og:description"]').attr('content') || '';

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      portion_count: portionCount,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ Homebaking: "${title}" – ${result.dough_sections.length} Phasen, Layout ${isLayout3 ? 3 : isLayout2 ? 2 : 1}, ${portionCount} Stück`);
    return result;

  } catch (error) {
    console.error('Homebaking Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeHomebaking;