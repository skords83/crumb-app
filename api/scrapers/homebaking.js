const axios = require('axios');
const cheerio = require('cheerio');
const { detectPortionCount, scaleSectionsToOnePortion } = require('./utils');
const { parseStepsWithLLM } = require('./llm-refine');

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


    // 1. LAYOUT-ERKENNUNG + PHASEN + ZUTATEN
    //
    // Drei bekannte Layouts auf homebaking.at:
    //
    // Layout 1 (alt, ≤2019) – z.B. Bauernbrot (2014):
    //   Kein <table>. Zutaten als <ul><li> mit NBSP-Padding ("&nbsp; 10g Anstellgut").
    //   Schritte als <p> direkt nach dem <ul>, innerhalb jedes h3-Blocks.
    //   Kein <h3>Herstellung</h3>, kein <h4>.
    //
    // Layout 2 (mittel, ~2020) – z.B. Roggenmischbrot:
    //   Zutaten in <table> (td[0]=Menge, td[1]=Name, td[2]=%-Anteil).
    //   Mehrstufiger Sauerteig unter einem "Gesamtmengen-h3" mit <h4>-Stufen.
    //   Schritte als <p> direkt nach der Tabelle im h4-Block.
    //   Separate <h3>Herstellung</h3> mit <ul><li> für Hauptteig-Schritte.
    //
    // Layout 3 (neu, ≥2022) – z.B. Kassler (2025):
    //   Zutaten in <table> (td[0]=Menge, td[1]=Name, optional kein %-Anteil).
    //   Schritte als <figcaption> mit <br>-Trennern direkt in der <figure> nach der Tabelle.
    //   Kein <h3>Herstellung</h3>, kein <h4>.

    const recipeContent = $('.entry-content, article .content, .post-content, main article, .wp-block-group, article, main').first();
    console.log(`  → recipeContent matched: ${recipeContent.length > 0}, tag: ${recipeContent.prop('tagName')}, class: ${recipeContent.attr('class')}`);


    // ── Hilfsfunktionen ──────────────────────────────────────────────────────

    // Zutaten aus <li>-Text parsen (Layout 1: "10g Anstellgut" mit möglichem NBSP)
    const parseIngredientFromLi = (raw) => {
      const text = raw.replace(/[\u00a0\s]+/g, ' ').trim();
      if (!text) return null;
      const match = text.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)\s+(.+)$/);
      if (match) return { amount: evalFraction(match[1]), unit: match[2] || 'g', name: match[3].trim() };
      return { amount: 0, unit: '', name: text };
    };

    // Zutaten aus <table> parsen (Layout 2+3: td[0]=Menge, td[1]=Name)
    const parseIngredientsFromTable = (el) => {
      const ingredients = [];
      el.find('tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 2) return;
        const amountStr = $(tds[0]).text().trim();
        const ingName   = $(tds[1]).text().trim();
        if (!ingName) return;
        const amtMatch = amountStr.match(/^([\d,./]+)\s*([a-zA-ZäöüÄÖÜ%]*)$/);
        if (amtMatch) {
          ingredients.push({ amount: evalFraction(amtMatch[1]), unit: amtMatch[2] || 'g', name: ingName });
        } else if (amountStr === '+' || !amountStr) {
          ingredients.push({ amount: 0, unit: '', name: ingName });
        } else {
          ingredients.push({ amount: 0, unit: '', name: `${amountStr} ${ingName}`.trim() });
        }
      });
      return ingredients;
    };

    // Schritte aus <figcaption> parsen (Layout 3)
    // Struktur: <strong>1. Titel</strong><br>Text<br><br><strong>2. Titel</strong>...
    // Auch möglich: "4. <strong>Gare</strong>" (Nummer außerhalb von strong)
    const parseStepsFromFigcaption = (figEl) => {
      const caption = figEl.find('figcaption');
      if (!caption.length) return [];
      const raw = caption.html() || '';
      // Ersetze <br> durch Newlines, behalte <strong> als Marker
      const withMarkers = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '%%%STEP%%%$1%%%STEP%%%')
        .replace(/<[^>]+>/g, '')
        .replace(/\u00a0/g, ' ');
      const lines = withMarkers.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      // Zusammenführen: nummerierte Zeilen (via %%%STEP%%% oder "N. ") starten neuen Schritt
      const steps = [];
      let buf = '';
      for (const line of lines) {
        // Prüfen ob diese Zeile einen nummerierten Schritt-Header enthält
        const isHeader = /%%%STEP%%%\s*\d+\./.test(line) || /^\d+\.\s/.test(line);
        const cleanLine = line.replace(/%%%STEP%%%/g, '').trim();
        if (!cleanLine || cleanLine.length < 3) continue;
        if (isHeader && buf) {
          steps.push(buf.trim());
          buf = cleanLine;
        } else {
          buf += (buf ? ' ' : '') + cleanLine;
        }
      }
      if (buf.trim().length > 5) steps.push(buf.trim());
      return steps;
    };

    // NON_PHASE / isPhaseH3
    const NON_PHASE_RE = /herstellung|zubereitung|kommentar|newsletter|share|ähnliche/i;
    const PHASE_KEYWORDS = ['sauerteig', 'vorteig', 'hauptteig', 'brotaroma', 'teig', 'biga',
                            'sauer', 'poolish', 'levain', 'brühstück', 'kochstück', 'quellstück'];
    const isPhaseH3 = (name) => {
      const n = name.toLowerCase();
      if (NON_PHASE_RE.test(n)) return false;
      return PHASE_PATTERNS.some(p => p.re.test(n)) || PHASE_KEYWORDS.some(k => n.includes(k));
    };

    // ── LAYOUT-ERKENNUNG ─────────────────────────────────────────────────────
    // Layout 1 (alt): kein <table>, Zutaten als <ul><li>
    // Layout 2 (mittel): <h4>-Stufen + <table> + <h3>Herstellung</h3>
    // Layout 3 (neu): <table> + <figcaption>-Schritte, kein <h4>
    const h2Rezept = recipeContent.find('h2').filter((_, h2) =>
      $(h2).text().trim().toLowerCase() === 'rezept'
    ).first();

    // Scope: alles zwischen h2Rezept und nächstem h2
    const scopeEls = h2Rezept.length
      ? h2Rezept.nextUntil('h2')
      : recipeContent.children();

    const hasH4      = scopeEls.is('h4') || scopeEls.find('h4').length > 0;
    const hasTable   = scopeEls.find('table').length > 0;
    const hasFigcap  = scopeEls.find('figcaption').length > 0;

    // Gibt es eine <h3>Herstellung</h3> im Scope? (Layout-2-Merkmal)
    const hasHerstellungH3 = scopeEls.filter('h3').toArray().some(h3 =>
      /^(herstellung|zubereitung)$/i.test($(h3).text().replace(/:$/, '').trim())
    );

    const layout = (hasH4 || (hasTable && hasHerstellungH3)) ? 2
                 : hasFigcap ? 3
                 : hasTable  ? 3
                 : 1;
    console.log(`  → Layout erkannt: ${layout} (hasH4=${hasH4}, hasTable=${hasTable}, hasFigcap=${hasFigcap}, hasHerstellungH3=${hasHerstellungH3})`);

    // ── LAYOUT 1: <ul><li> Zutaten, <p> Schritte ─────────────────────────────
    if (layout === 1) {
      scopeEls.each((_, el) => {
        if (!$(el).is('h3')) return;
        const name = $(el).text().replace(/:$/, '').trim();
        if (!isPhaseH3(name)) return;
        const ingredients = [], rawSteps = [];
        let s = $(el).next();
        while (s.length && !s.is('h3, h2')) {
          if (s.is('ul')) {
            s.find('li').each((_, li) => {
              const ing = parseIngredientFromLi($(li).text());
              if (ing) ingredients.push(ing);
            });
          } else if (s.is('p')) {
            const t = s.text().trim();
            if (t.length > 15) rawSteps.push(t);
          }
          s = s.next();
        }
        dough_sections.push({ name, is_parallel: detectIsParallel(name), ingredients, rawSteps });
      });
    }

    // ── LAYOUT 2: h4-Stufen + table + p-Schritte + Herstellung-ul ────────────
    if (layout === 2) {
      scopeEls.each((_, el) => {
        if (!$(el).is('h3')) return;
        const h3Name = $(el).text().replace(/:$/, '').trim();
        if (NON_PHASE_RE.test(h3Name.toLowerCase())) return;

        let lookahead = $(el).next();
        let hasSubH4 = false;
        while (lookahead.length && !lookahead.is('h3, h2')) {
          if (lookahead.is('h4')) { hasSubH4 = true; break; }
          lookahead = lookahead.next();
        }

        if (hasSubH4) {
          let s = $(el).next();
          while (s.length && !s.is('h4')) s = s.next();
          while (s.length && !s.is('h3, h2')) {
            if (s.is('h4')) {
              const stufeName = s.text().replace(/:$/, '').trim();
              const ingredients = [], rawSteps = [];
              let ss = s.next();
              while (ss.length && !ss.is('h4, h3, h2')) {
                if (ss.is('figure') || ss.is('div')) ingredients.push(...parseIngredientsFromTable(ss));
                if (ss.is('p') && ss.text().trim().length > 15) rawSteps.push(ss.text().trim());
                ss = ss.next();
              }
              dough_sections.push({ name: stufeName, is_parallel: detectIsParallel(stufeName), ingredients, rawSteps });
            }
            s = s.next();
          }
        } else {
          const ingredients = [], rawSteps = [];
          let s = $(el).next();
          while (s.length && !s.is('h3, h2')) {
            if (s.is('figure') || s.is('div')) ingredients.push(...parseIngredientsFromTable(s));
            if (s.is('p') && s.text().trim().length > 15) rawSteps.push(s.text().trim());
            s = s.next();
          }
          dough_sections.push({ name: h3Name, is_parallel: detectIsParallel(h3Name), ingredients, rawSteps });
        }
      });
    }

    // ── LAYOUT 3: table + figcaption-Schritte ────────────────────────────────
    if (layout === 3) {
      scopeEls.each((_, el) => {
        if (!$(el).is('h3')) return;
        const name = $(el).text().replace(/:$/, '').trim();
        if (!isPhaseH3(name)) return;
        const ingredients = [], rawSteps = [];
        let s = $(el).next();
        while (s.length && !s.is('h3, h2')) {
          if (s.is('figure') || s.is('div')) {
            ingredients.push(...parseIngredientsFromTable(s));
            parseStepsFromFigcaption(s).forEach(t => rawSteps.push(t));
          }
          s = s.next();
        }
        dough_sections.push({ name, is_parallel: detectIsParallel(name), ingredients, rawSteps });
      });
    }

    // Fallback: keine Phasen erkannt → Hauptteig aus allen li
    if (dough_sections.length === 0) {
      const ingredients = [];
      recipeContent.find('li').each((_, li) => {
        const ing = parseIngredientFromLi($(li).text());
        if (ing) ingredients.push(ing);
      });
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients, rawSteps: [] });
    }

    // 2. SCHRITTE (Roh-Text sammeln für LLM)
    // Layout 2: Schritte stehen als <ul><li> unter <h3>Herstellung</h3>
    const SKIP_TEXT = /kommentar|newsletter|rezept drucken/i;

    if (layout === 2) {
      const hauptteigIdx = Math.max(0, dough_sections.findIndex(s => /hauptteig/i.test(s.name)));

      scopeEls.each((_, el) => {
        if (!$(el).is('h3')) return;
        const name = $(el).text().replace(/:$/, '').trim().toLowerCase();
        if (!['herstellung', 'zubereitung'].includes(name)) return;

        let s = $(el).next();
        while (s.length && !s.is('h3, h2')) {
          if (s.is('ul')) {
            const allLis = s.find('li');
            const hasOnlyImages = allLis.length > 0 && allLis.toArray().every(li =>
              $(li).find('img').length > 0 && $(li).text().trim().length < 5
            );
            if (!hasOnlyImages) {
              s.find('li').each((_, li) => {
                if ($(li).find('img').length) return;
                const text = $(li).text().trim();
                if (/\.(jpg|jpeg|png|webp|gif)\b/i.test(text) && text.includes('http')) return;
                if (text.length < 15 || SKIP_TEXT.test(text)) return;
                if (dough_sections[hauptteigIdx]) {
                  dough_sections[hauptteigIdx].rawSteps.push(text);
                }
              });
            }
          }
          s = s.next();
        }
      });
    }

    // 2b. LLM-Schritt-Parsing
    const phasesWithSteps = dough_sections.filter(sec => sec.rawSteps && sec.rawSteps.length > 0);

    if (phasesWithSteps.length > 0) {
      console.log(`  → Schritt-Parsing via LLM für ${phasesWithSteps.length} Phase(n)...`);
      const llmInput = phasesWithSteps.map(sec => ({ name: sec.name, rawSteps: sec.rawSteps }));
      const llmResult = await parseStepsWithLLM(llmInput, process.env.OPENROUTER_API_KEY);

      if (llmResult) {
        for (const sec of dough_sections) {
          const refined = llmResult.find(r => r.name === sec.name);
          if (refined && Array.isArray(refined.steps)) {
            sec.steps = refined.steps;
          }
        }
      } else {
        // Fallback: rawSteps als einzelne Schritte ohne Dauer
        console.warn('  ⚠ LLM fehlgeschlagen – Rohtext als Fallback');
        for (const sec of dough_sections) {
          if (!sec.steps) {
            sec.steps = (sec.rawSteps || []).map(t => ({ instruction: t, duration: 0, type: 'Kneten' }));
          }
        }
      }
    }

    // Phasen ohne Schritte bekommen Platzhalter
    for (const sec of dough_sections) {
      if (!sec.steps || sec.steps.length === 0) {
        const lower = sec.name.toLowerCase();
        const duration = lower.includes('sauerteig') ? 960
          : lower.includes('biga') || lower.includes('vorteig') || lower.includes('poolish') ? 1440
          : lower.includes('brotaroma') ? 120 : 60;
        sec.steps = [{ instruction: `${sec.name} ansetzen und reifen lassen`, duration, type: 'Warten' }];
      }
    }

    // rawSteps aus Ergebnis entfernen
    dough_sections.forEach(sec => delete sec.rawSteps);

    // 2c. PORTIONSGRÖSSE erkennen und auf 1 Stück skalieren
    let portionCount = 1;
    if (h2Rezept.length) {
      // Portionstext steht als erstes <p> nach dem h2Rezept
      const portionP = h2Rezept.nextAll('p').first();
      if (portionP.length) portionCount = detectPortionCount(portionP.text().trim());
    }
    // Fallback: alle p-Tags im Scope durchsuchen
    if (portionCount === 1) {
      scopeEls.filter('p').each((_, p) => {
        const t = $(p).text().trim();
        if (/für ein Teiggewicht|Teiggewicht von|\d+\s*Stück|\d+\s*Stk/i.test(t)) {
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

    // Beschreibung: Einleitungs-Absätze VOR dem "## Rezept"-h2
    let description = '';
    if (h2Rezept.length) {
      const descParts = [];
      h2Rezept.prevAll('p').each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 30) descParts.unshift(t); // unshift = richtige Reihenfolge
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
    console.log(JSON.stringify(dough_sections, null, 2));  // ← VOR return
    return result;

  } catch (error) {
    console.error('Homebaking Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeHomebaking;