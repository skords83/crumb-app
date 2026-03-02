const axios = require('axios');
const cheerio = require('cheerio');
const { stepDuration, isBakingStep } = require('./utils');

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
  { re: /eistreich/i,   is_parallel: false },
  { re: /streich/i,     is_parallel: false },
];
// h3-Texte die keine Phasen sind
const NON_PHASE_H3 = ['das brauchst du', 'nährwerte', 'kommentar', 'hot in den socials', 'rezepteigenschaften'];

const detectIsParallel = (name) => {
  for (const p of PHASE_PATTERNS) if (p.re.test(name)) return p.is_parallel;
  return false;
};

const WAIT_KEYWORDS = ['reifen', 'ruhen', 'gehen', 'gare', 'quellen', 'rasten', 'kühlschrank', 'autolyse', 'abkühlen', 'entspannen', 'abgedeckt'];

function parseDurationAndType(text) {
  const lower = text.toLowerCase();
  let type = 'Aktion';
  if (isBakingStep(text)) {
    type = 'Backen';
  } else if (WAIT_KEYWORDS.some(kw => lower.includes(kw)) ||
    (extractFirstDurationLocal(lower) > 25 && !lower.includes('kneten') &&
     !lower.includes('mischen') && !lower.includes('backofen'))) {
    type = 'Warten';
  }
  return { duration: stepDuration(text, type) || 10, type };
}
function extractFirstDurationLocal(lower) {
  const h = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const m = lower.match(/(\d+)\s*(?:minuten?|min\.?\b)/);
  let t = 0;
  if (h) t += Math.round(parseFloat(h[1].replace(',','.')) * 60);
  if (m) t += parseInt(m[1]);
  return t;
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

    // ── 1. ZUTATEN ─────────────────────────────────────────
    // JoSemola: h3 direkt als Phasenname (kein "Für den/das/die" Prefix)
    // Danach ul > li mit "MENGE\nEINHEIT\nNAME" als Listenstruktur
    // Zutaten-Bereich liegt zwischen h2 "Zutaten" und nächster h2
    const zutatenH2 = $('h2').filter((_, el) => $(el).text().trim().toLowerCase() === 'zutaten').first();

    if (zutatenH2.length) {
      // Alle h3 + ul zwischen "Zutaten" h2 und nächster h2
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
            // Zeilenumbruch-Format: "100 g\nMilch" oder alles in einem
            const rawText = $(li).text().replace(/\s+/g, ' ').trim();

            // Versuche Menge + Einheit + Name zu trennen
            // Beispiele: "100 g Milch", "2 EL Milch (EL)", "5 g Hefe", "60 g Butter, weich"
            const match = rawText.match(/^([\d,./]+)\s+([a-zA-ZäöüÄÖÜ%]+)\s+(.+)$/);
            if (match) {
              let name = match[3].replace(/\s*\([^)]*\)\s*$/, '').trim(); // "(EL)" am Ende entfernen
              currentSection.ingredients.push({
                amount: evalFraction(match[1]),
                unit: match[2],
                name
              });
            } else {
              // Kein Mengen-Format → Zutat ohne Menge (z.B. "gesamtes Mehlkochstück")
              if (rawText.length > 1) {
                currentSection.ingredients.push({ amount: 0, unit: '', name: rawText });
              }
            }
          });
        }

        node = node.next();
      }
    }

    // Fallback: alle h3 im Dokument durchsuchen
    if (dough_sections.length === 0) {
      $('h3').each((_, h3) => {
        const name = $(h3).text().trim();
        if (!name || NON_PHASE_H3.some(s => name.toLowerCase().includes(s))) return;
        if (!PHASE_PATTERNS.some(p => p.re.test(name)) &&
            !['hauptteig','sauerteig','vorteig','teig','kochstück','streich'].some(k => name.toLowerCase().includes(k))) return;

        const ingredients = [];
        $(h3).nextUntil('h3', 'ul').find('li').each((_, li) => {
          const rawText = $(li).text().replace(/\s+/g, ' ').trim();
          const match = rawText.match(/^([\d,./]+)\s+([a-zA-ZäöüÄÖÜ%]+)\s+(.+)$/);
          if (match) {
            ingredients.push({ amount: evalFraction(match[1]), unit: match[2], name: match[3].replace(/\s*\([^)]*\)\s*$/, '').trim() });
          } else if (rawText.length > 1) {
            ingredients.push({ amount: 0, unit: '', name: rawText });
          }
        });
        if (ingredients.length > 0) {
          dough_sections.push({ name, is_parallel: detectIsParallel(name), ingredients, steps: [] });
        }
      });
    }

    // Keine Phasen → eine Hauptteig-Sektion
    if (dough_sections.length === 0) {
      dough_sections.push({ name: 'Hauptteig', is_parallel: false, ingredients: [], steps: [] });
    }

    // ── 2. SCHRITTE ────────────────────────────────────────
    // JoSemola: Schritte stehen als Fließtext nach "Step X von Y" + img[alt="step image"]
    // Im HTML-Text sieht das so aus:
    //   img[alt="step image"]
    //   "Step 1 von 5"
    //   img[Utensilien]
    //   "Werkzeuge..."
    //   INSTRUKTIONSTEXT
    //   (optional) img[icon] + "~ 3 Std. Teigruhe" (Zeitangabe)
    //
    // Zuverlässigste Methode: Alle p-Texte nach dem Rezeptbereich, die kein UI-Text sind

    const stepTexts = [];
    const UI_SKIP = ['step image', 'utensilien', 'jetzt backen', 'teilen', 'drucken', 'rezept ansehen', 'lets bake', 'enjoy', 'hot in den socials'];

    // Alle Text-Nodes die nach dem Zutaten-Block kommen
    // JoSemola rendert Steps als direkte Text-Nodes im Body, oft in p oder span
    $('p, span').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length < 20) return;
      if (UI_SKIP.some(s => text.toLowerCase().includes(s))) return;
      if (text.match(/^Step\s+\d+\s+von\s+\d+$/i)) return;
      if (text.match(/^\d+\s*Bewertungen?/)) return;
      if (text.match(/^(Kochtopf|Waage|Küchenmaschine|Backpinsel|Teigschaber)/)) return; // Werkzeug-Liste
      if (text.match(/^(Kommentare?|Das hilft|Community)/i)) return;
      if (text.match(/^~?\s*[\d.]+\s*(Std|Min|h)\b/i)) return; // reine Zeitangabe wie "~ 3 Std. Teigruhe"

      // Echte Schritte haben oft Aktion-Verben
      const lower = text.toLowerCase();
      const hasAction = ['kneten', 'mischen', 'falten', 'formen', 'backen', 'reifen', 'ruhen', 'zugeben',
        'verrühren', 'vorheizen', 'teilen', 'abdecken', 'erhitzen', 'bepinseln', 'auflösen',
        'verkneten', 'ausrollen', 'flechten', 'bestreichen', 'abkühlen', 'lassen'].some(k => lower.includes(k));
      if (hasAction) stepTexts.push(text);
    });

    // Schritte auf Phasen verteilen
    const hauptteigIdx = dough_sections.findIndex(s => s.name.toLowerCase().includes('hauptteig'));
    let currentIdx = hauptteigIdx >= 0 ? hauptteigIdx : dough_sections.length - 1;

    stepTexts.forEach(text => {
      dough_sections.forEach((sec, idx) => {
        if (text.toLowerCase().includes(sec.name.toLowerCase()) && sec.name !== 'Hauptteig') currentIdx = idx;
      });
      const { duration, type } = parseDurationAndType(text);
      dough_sections[currentIdx]?.steps.push({ instruction: text, duration, type });
    });

    // Phasen ohne Schritte: Platzhalter
    dough_sections.forEach(sec => {
      if (sec.steps.length === 0) {
        const lower = sec.name.toLowerCase();
        const duration = lower.includes('sauerteig') ? 240 : lower.includes('kochstück') ? 30 : lower.includes('streich') ? 5 : 60;
        const type = lower.includes('streich') ? 'Aktion' : 'Warten';
        sec.steps.push({ instruction: `${sec.name} vorbereiten`, duration, type });
      }
    });

    // ── 3. BILD ────────────────────────────────────────────
    // JoSemola: Bild steht als img[alt="recipe header image"] im DOM,
    // aber src ist leer (lazy-loaded per JS). Echter URL über og:image.
    let imageUrl = $('meta[property="og:image"]').attr('content') || '';
    if (!imageUrl) {
      // wp-content uploads Bilder
      $('img[src*="/wp-content/uploads/"]').each((_, img) => {
        const src = $(img).attr('src') || '';
        // Kein Thumbnail (100x100, 300x300)
        if (!src.match(/-\d{2,3}x\d{2,3}\./)) { imageUrl = src; return false; }
      });
    }

    // ── 4. BESCHREIBUNG ────────────────────────────────────
    // JoSemola: Blockquote-Zitat "Das perfekte Mitbringsel zum..."
    let description = '';
    // Suche nach dem Anführungszeichen-Zitat (steht als Text nach dem H1)
    $('p, div, blockquote').each((_, el) => {
      const text = $(el).text().trim();
      // Das Zitat beginnt mit „ oder " und ist 20-300 Zeichen lang
      if (text.match(/^[„"""]/) && text.length > 20 && text.length < 400) {
        description = text.replace(/^[„"""]+|["""]+$/g, '').trim();
        return false;
      }
    });
    if (!description) {
      description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    }

    const title = $('h1').first().text().trim() || $('title').text().replace(' - Jo Semola', '').trim();

    const result = {
      title,
      description,
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };

    console.log(`✅ JoSemola: "${title}" – ${result.dough_sections.length} Phasen, ${result.dough_sections.reduce((s,p) => s + p.steps.length, 0)} Schritte`);
    return result;

  } catch (error) {
    console.error('JoSemola Scraper Error:', error.message);
    return null;
  }
};

module.exports = scrapeJoSemola;