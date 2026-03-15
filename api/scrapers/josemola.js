const axios = require('axios');
const cheerio = require('cheerio');
const { parseFullRecipeWithLLM } = require('./llm-refine');

// ── HAUPT-SCRAPER ────────────────────────────────────────────
const scrapeJoSemola = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Crumb/1.0)' },
      timeout: 12000
    });
    const $ = cheerio.load(data);

    // ── ZUTATEN per strukturiertem HTML ──────────────────────
    // JoSemola hat Zutaten sauber als h3 + ul im Zutaten-Abschnitt.
    // Diese direkt scrapen ist zuverlässiger als LLM für Mengenangaben.
    const dough_sections = [];
    const PHASE_PATTERNS = [
      { re: /hauptteig$/i,  is_parallel: false },
      { re: /teig$/i,       is_parallel: true  },
      { re: /stück$/i,      is_parallel: true  },
      { re: /sauerteig/i,   is_parallel: true  },
      { re: /sauer$/i,      is_parallel: true  },
      { re: /poolish/i,     is_parallel: true  },
      { re: /levain/i,      is_parallel: true  },
      { re: /autolyse/i,    is_parallel: false },
      { re: /vorteig/i,     is_parallel: true  },
      { re: /kochstück/i,   is_parallel: true  },
      { re: /brühstück/i,   is_parallel: true  },
      { re: /quellstück/i,  is_parallel: true  },
      { re: /eistreich/i,   is_parallel: false },
      { re: /streich/i,     is_parallel: false },
    ];
    const NON_PHASE_H3 = ['das brauchst du', 'nährwerte', 'kommentar', 'hot in den socials', 'rezepteigenschaften', 'werkzeug'];
    const detectIsParallel = (name) => {
      for (const p of PHASE_PATTERNS) if (p.re.test(name)) return p.is_parallel;
      return false;
    };

    const zutatenH2 = $('h2').filter((_, el) => $(el).text().trim().toLowerCase() === 'zutaten').first();
    if (zutatenH2.length) {
      let node = zutatenH2.next();
      let currentSection = null;
      while (node.length && node[0].tagName !== 'h2') {
        const tag = node[0].tagName;
        if (tag === 'h3') {
          const name = node.text().trim();
          if (name && !NON_PHASE_H3.some(s => name.toLowerCase().includes(s))) {
            currentSection = { name, is_parallel: detectIsParallel(name), ingredients: [], steps: [] };
            dough_sections.push(currentSection);
          }
        }
        if (tag === 'ul' && currentSection) {
          node.find('li').each((_, li) => {
            const rawText = $(li).text().replace(/\s+/g, ' ').trim();
            const match = rawText.match(/^([\d,./]+)\s+([a-zA-ZäöüÄÖÜ%]+)\s+(.+)$/);
            if (match) {
              const name = match[3].replace(/\s*\([^)]*\)\s*$/, '').trim();
              currentSection.ingredients.push({ amount: evalFraction(match[1]), unit: match[2], name });
            } else if (rawText.length > 1) {
              currentSection.ingredients.push({ amount: 0, unit: '', name: rawText });
            }
          });
        }
        node = node.next();
      }
    }

    // ── SCHRITTE per LLM ─────────────────────────────────────
    // Anleitung-Bereich isolieren: h2 "Zubereitung" / "Anleitung" / "So geht's"
    const anleitungH2 = $('h2').filter((_, el) => {
      const t = $(el).text().trim().toLowerCase();
      return ['zubereitung', 'anleitung', "so geht's", 'so gehts', 'zubereitung & tipps'].some(k => t.includes(k));
    }).first();

    let stepsRawText = '';
    if (anleitungH2.length) {
      // Alles zwischen Anleitung-H2 und nächstem h2 (Kommentare etc.)
      const parts = [];
      let node = anleitungH2.next();
      while (node.length && node[0].tagName !== 'h2') {
        const t = node.text().replace(/\s+/g, ' ').trim();
        if (t.length > 10) parts.push(t);
        node = node.next();
      }
      stepsRawText = parts.join('\n');
    }

    // Fallback: alle sichtbaren Step-Paragraphen
    if (!stepsRawText) {
      const parts = [];
      $('p').each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 30 && !/newsletter|impressum|datenschutz/i.test(t)) parts.push(t);
      });
      stepsRawText = parts.slice(0, 20).join('\n');
    }

    if (stepsRawText && process.env.OPENROUTER_API_KEY) {
      // Phasennamen mitgeben damit LLM die Schritte korrekt zuordnen kann
      const phaseNames = dough_sections.map(s => s.name);
      const userText = phaseNames.length
        ? `Phasen: ${phaseNames.join(', ')}\n\nSchritte:\n${stepsRawText}`
        : stepsRawText;

      console.log(`  → JoSemola LLM Step-Parsing (${stepsRawText.length} Zeichen)...`);

      // Für josemola: Steps als Phases-Array formatieren für parseStepsWithLLM-kompatibler Output
      const { parseStepsWithLLM } = require('./llm-refine');
      const llmInput = [{ name: 'Rezept', rawSteps: [userText] }];
      const llmResult = await parseStepsWithLLM(llmInput, process.env.OPENROUTER_API_KEY);

      if (llmResult) {
        // LLM-Ergebnis auf dough_sections mappen
        // Das LLM gibt eine oder mehrere Phasen zurück – nach Namen matchen
        const allLLMPhases = llmResult;

        for (const sec of dough_sections) {
          // Passende Phase im LLM-Ergebnis suchen
          const match = allLLMPhases.find(p =>
            p.name.toLowerCase().includes(sec.name.toLowerCase()) ||
            sec.name.toLowerCase().includes(p.name.toLowerCase())
          );
          if (match?.steps?.length > 0) {
            sec.steps = match.steps;
          }
        }

        // Wenn LLM nur eine Phase "Rezept" zurückgibt, alle Steps in Hauptteig
        const rezeptPhase = allLLMPhases.find(p => p.name === 'Rezept');
        if (rezeptPhase?.steps?.length > 0) {
          // Verteile Steps auf Phasen anhand von Namensnennungen im Step-Text
          const hauptteig = dough_sections.find(s => /hauptteig/i.test(s.name))
            || dough_sections[dough_sections.length - 1];
          if (hauptteig && hauptteig.steps.length === 0) {
            hauptteig.steps = rezeptPhase.steps;
          }
        }
      }
    }

    // Phasen ohne Schritte: Platzhalter
    dough_sections.forEach(sec => {
      if (!sec.steps || sec.steps.length === 0) {
        const lower = sec.name.toLowerCase();
        const duration = lower.includes('sauerteig') ? 240
          : lower.includes('kochstück') || lower.includes('brühstück') ? 30
          : lower.includes('streich') ? 5 : 60;
        const type = lower.includes('streich') ? 'Kneten' : 'Warten';
        sec.steps = [{ instruction: `${sec.name} vorbereiten`, duration, type }];
      }
    });

    // ── BILD ─────────────────────────────────────────────────
    let imageUrl = $('meta[property="og:image"]').attr('content') || '';
    if (!imageUrl) {
      $('img[src*="/wp-content/uploads/"]').each((_, img) => {
        const src = $(img).attr('src') || '';
        if (!src.match(/-\d{2,3}x\d{2,3}\./)) { imageUrl = src; return false; }
      });
    }

    // ── BESCHREIBUNG ─────────────────────────────────────────
    let description = '';
    $('p, div, blockquote').each((_, el) => {
      const text = $(el).text().trim();
      if (text.match(/^[„"""]/) && text.length > 20 && text.length < 400) {
        description = text.replace(/^[„"""]+|["""]+$/g, '').trim();
        return false;
      }
    });
    if (!description) {
      description = $('meta[name="description"]').attr('content')?.trim()
        || $('meta[property="og:description"]').attr('content')?.trim()
        || '';
    }

    const title = $('h1').first().text().trim()
      || $('title').text().replace(/[-–|].*$/, '').trim();

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ JoSemola: "${title}" – ${result.dough_sections.length} Phasen, ${result.dough_sections.reduce((s, p) => s + p.steps.length, 0)} Schritte`);
    return result;

  } catch (error) {
    console.error('JoSemola Scraper Error:', error.message);
    return null;
  }
};

function evalFraction(amount) {
  if (!amount) return 0;
  const clean = amount.replace(',', '.').trim();
  if (clean.includes('/')) { const [a, b] = clean.split('/'); return parseFloat(a) / parseFloat(b); }
  return parseFloat(clean) || 0;
}

module.exports = scrapeJoSemola;