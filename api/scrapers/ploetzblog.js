const axios = require('axios');
const cheerio = require('cheerio');

const scrapePloetz = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // 1. TITEL & UNTERTITEL
    const title = $('h1').first().text().trim().replace(/\u00AD/g, '');
    const subtitle = $('h2').first().text().trim();

    // 2. BILD
    let imageUrl = '';
    imageUrl = $('meta[property="og:image"]').attr('content') || 
               $('meta[name="twitter:image"]').attr('content') || '';

    if (!imageUrl || imageUrl.includes('placeholder')) {
      const galleryImg = $('a[href*="/gallery/"] img, figure img').first();
      imageUrl = galleryImg.attr('data-src') || galleryImg.attr('src') || '';
    }

    if (!imageUrl) {
      $('img').each((_, el) => {
        const $el = $(el);
        const src = $el.attr('data-src') || $el.attr('src') || '';
        if (src && 
            !src.includes('Logo') && 
            !src.includes('Ploetz-Partner') && 
            (src.includes('cloudimg') || src.includes('entity') || src.includes('rezept'))) {
          imageUrl = src;
          return false;
        }
      });
    }

    if (imageUrl) {
      imageUrl = imageUrl.split(' ')[0];
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      if (imageUrl.startsWith('/')) imageUrl = 'https://www.ploetzblog.de' + imageUrl;
      if (imageUrl.includes('cloudimg.io')) {
        imageUrl = imageUrl.replace(/\?p=w\d+/, '?p=w800');
      }
    }

    // 3. BESCHREIBUNG
    const descParagraphs = [];
    let foundTitle = false, reachedTable = false;
    $('h1, h2, p, table').each((_, el) => {
      if (reachedTable) return false;
      const tag = (el.tagName || el.name || '').toLowerCase();
      if (tag === 'h1') { foundTitle = true; return; }
      if (tag === 'h2' && foundTitle) return;
      if (tag === 'table') { reachedTable = true; return false; }
      if (foundTitle && tag === 'p') {
        const text = $(el).text().trim();
        const skip = ['Produktempfehlung','Anzeige','Mitgliedschaft','Kommentare','Rezept drucken'];
        if (text.length > 20 && !skip.some(s => text.includes(s))) descParagraphs.push(text);
      }
    });

    // 4. METADATEN
    const bodyText = $('body').text();
    const sourceUrl = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || '';

    // 5. ZUTATEN & PHASEN MIT STEPS
    const ingredientOverview = [];
    const doughSections = [];

    const isIngredientTable = (table) => {
      const text = $(table).text().toLowerCase();
      if ((text.includes('amazon') || text.includes('otto')) &&
          (text.includes('abdeckfolie') || text.includes('backstein') ||
           text.includes('ofenhandschuh') || text.includes('knetmaschine') ||
           text.includes('schneebesen') || text.includes('teigreinigung'))) return false;
      if (text.includes('uhr') && text.includes('vorheizen')) return false;
      const uhrCount = (text.match(/uhr/gi) || []).length;
      if (uhrCount >= 3) return false;
      let hasGrams = false;
      $(table).find('tr').each((_, row) => {
        if (/^\d+[\.,]?\d*\s*g/.test($(row).find('td').first().text().trim())) hasGrams = true;
      });
      return hasGrams;
    };

    const parseIngredientTable = (table) => {
      const ingredients = [];
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const amountCell = $(cells[0]).text().trim();
        const nameCell = $(cells[1]).text().trim();
        let tempCell = '';
        let percentCell = '';
        if (cells.length >= 4) {
          tempCell = $(cells[2]).text().trim();
          percentCell = $(cells[3]).text().trim();
        } else if (cells.length === 3) {
          const thirdCell = $(cells[2]).text().trim();
          if (/\d+\s*\u00b0\s*C/.test(thirdCell)) tempCell = thirdCell;
          else percentCell = thirdCell;
        }
        if (!nameCell) return;
        const amountMatch = amountCell.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|Stk\.?|EL|TL|Prise)?(.*)$/);
        if (amountMatch) {
          const ing = {
            amount: amountMatch[1].replace(',', '.'),
            unit: (amountMatch[2] || 'g').trim(),
            name: nameCell,
          };
          const tempFromCol = tempCell.match(/(\d+)\s*\u00b0\s*C/);
          const tempFromName = nameCell.match(/(\d+)\s*\u00b0\s*C/);
          if (tempFromCol) ing.temperature = tempFromCol[1];
          else if (tempFromName) ing.temperature = tempFromName[1];
          const noteM = nameCell.match(/\(([^)]+)\)/g);
          if (noteM) ing.note = noteM.map(n => n.replace(/[()]/g, '').trim()).join(', ');
          ingredients.push(ing);
        } else if (nameCell && !amountCell) {
          const ing = { amount: '', unit: 'g', name: nameCell };
          const tempFromCol = tempCell.match(/(\d+)\s*\u00b0\s*C/);
          if (tempFromCol) ing.temperature = tempFromCol[1];
          ingredients.push(ing);
        }
      });
      return ingredients;
    };

    const sectionKeywords = [
      'sauerteig', 'vorteig', 'hauptteig', 'quellstück', 'brühstück',
      'autolyseteig', 'autolyse', 'kochstück', 'mehlkochstück', 'poolish',
      'biga', 'teig', 'dekoration', 'füllung', 'glasur', 'weizensauerteig',
      'roggensauerteig', 'lievito madre', 'starter', 'aromastück',
      'altbrot', 'einlage', 'streusel', 'belag', 'pâte fermentée', 'backen'
    ];

    const isSectionHeading = (text) => {
      const lower = (text || '').toLowerCase();
      return sectionKeywords.some(kw => lower.includes(kw));
    };

    // FIX 4: is_parallel korrekt – alle Vorteig-/Quellphasen, nicht nur Vorteig/Poolish/Biga
    const parallelKeywords = [
      'vorteig', 'poolish', 'biga', 'sauerteig', 'levain', 'lievito',
      'kochstück', 'brühstück', 'quellstück', 'aromastück', 'mehlkochstück'
    ];
    const isParallelSection = (name) => {
      const lower = (name || '').toLowerCase();
      return parallelKeywords.some(kw => lower.includes(kw));
    };

    const waitKeywords = [
      'reifen lassen', 'ruhen lassen', 'gehen lassen', 'gare', 'gehzeit',
      'stockgare', 'stückgare', 'über nacht', 'kühlschrank', 'quellen lassen',
      'abgedeckt', 'zugedeckt', 'auskühlen', 'vorheizen', 'aufheizen',
      'anbacken', 'ausbacken', 'backen', 'im ofen'
    ];

    const skipStepPatterns = [
      /^foto:/i, /produktempfehlung/i, /anzeige/i, /^copyright/i,
      /amazon/i, /mitgliedschaft/i, /newsletter/i, /nutzung nur f.r/i,
      /du findest das rezept/i, /rezept drucken/i, /otto\.de/i,
      /ketex\.de/i, /steadyhq/i, /häufig gestellte/i, /ähnliche rezepte/i,
      /kommentare/i, /gesamtzubereitungszeit/i, /^planungsbeispiel/i,
      /^neu berechnen/i, /^temperaturen$/i, /^bäckerprozente$/i,
      /^einsteiger/i, /wenn du .ber einen.*link/i
    ];

    const classifyStep = (text) => {
      const lower = text.toLowerCase();
      return waitKeywords.some(kw => lower.includes(kw)) ? 'Warten' : 'Aktion';
    };

    // FIX 1: Dezimalstunden korrekt parsen – alte Regex \d+ stoppte vor dem Komma,
    // sodass "1,5 Stunden" als "5 Stunden" → 300 min gelesen wurde.
    // Neue Regex (\d+[,.]?\d*) matcht "1,5" als ganzes → 1.5 * 60 = 90 min ✓
    const extractDurationMinutes = (text) => {
      const lower = text.toLowerCase();

      // Bereich: "2-3 Stunden" → nimm oberen Wert (3)
      const hourRangeMatch = lower.match(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(?:stunden?|std\.?)/);
      if (hourRangeMatch) {
        return Math.round(parseFloat(hourRangeMatch[2].replace(',', '.')) * 60);
      }

      const hourMatch = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?)/);

      // FIX: Minuten NUR addieren wenn kein "dabei/nach"-Kontext vorhanden.
      // Sonst würde "1,5 Stunden... nach 45 Minuten dehnen" fälschlich
      // 90 + 45 = 135 min ergeben statt korrekt 90 min.
      const hasDabei = /dabei|nach\s+\d+\s*min/i.test(text);
      const minMatch = !hasDabei ? lower.match(/(\d+)\s*(?:minuten?|min\.?)/) : null;

      let totalMinutes = 0;
      if (hourMatch) totalMinutes += Math.round(parseFloat(hourMatch[1].replace(',', '.')) * 60);
      if (minMatch) totalMinutes += parseInt(minMatch[1]);

      if (totalMinutes === 0) {
        const genericTime = lower.match(/(\d+)\s*(?:min|stunde)/);
        if (genericTime) totalMinutes = parseInt(genericTime[1]);
      }
      return totalMinutes === 0 ? 5 : totalMinutes;
    };

    const isValidStepText = (text) => {
      if (!text || text.length < 15) return false;
      if (skipStepPatterns.some(p => p.test(text))) return false;
      return true;
    };

    // FIX 2 & 3: parseRepeatingActions – "dehnen und falten"-Steps aufteilen.
    // Unterstützt beide Plötzblog-Formate:
    //   "dabei nach 30 und 60 Minuten dehnen und falten"
    //   "dabei alle 20 Minuten dehnen und falten (3x)"
    const parseRepeatingActions = (instruction, totalDuration) => {
      // Format A: "dabei nach X, Y und Z Minuten <Aktion>"
      const patternA = /dabei\s+nach\s+([\d,.\s]+(?:und\s+[\d,.]+)?)\s*minuten?\s+(.+)/i;
      const matchA = instruction.match(patternA);

      if (matchA) {
        const intervals = matchA[1]
          .replace(/\s*und\s*/gi, ',')
          .split(/[,\s]+/)
          .map(n => parseInt(n))
          .filter(n => !isNaN(n) && n > 0);

        if (intervals.length === 0) return null;

        const action = matchA[2].trim().replace(/\.$/, '');
        // FIX: Haupttext sauber kürzen – Zeitangabe und Temperatur entfernen,
        // sodass nur die eigentliche Tätigkeit bleibt (z.B. "Reifen lassen")
        let mainInstruction = instruction.split(/\.\s*[Dd]abei\b|,\s*[Dd]abei\b/)[0].trim();
        mainInstruction = mainInstruction
          .replace(/\d+[,.]?\d*\s*Stunden?\s*/gi, '')
          .replace(/bei\s+\d+\s*°C\s*/gi, '')
          .replace(/^\s*[,.]?\s*/, '')
          .trim() || instruction.split(',')[0].trim();

        const steps = [];
        let lastTime = 0;
        intervals.forEach((time) => {
          const waitDuration = time - lastTime;
          if (waitDuration > 0) {
            steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
          }
          steps.push({
            instruction: action.charAt(0).toUpperCase() + action.slice(1),
            duration: 5,
            type: 'Aktion'
          });
          lastTime = time + 5;
        });
        if (lastTime < totalDuration) {
          steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
        }
        return steps;
      }

      // Format B: "dabei alle X Minuten <Aktion> (Nx)"
      const patternB = /dabei\s+alle\s+(\d+)\s*minuten?\s+(.+?)(?:\s*\((\d+)x\))?\.?\s*$/i;
      const matchB = instruction.match(patternB);

      if (matchB) {
        const interval = parseInt(matchB[1]);
        const action = matchB[2].trim().replace(/\.$/, '');
        const count = matchB[3]
          ? parseInt(matchB[3])
          : Math.max(1, Math.floor(totalDuration / interval) - 1);

        let mainInstruction = instruction.split(/\.\s*[Dd]abei\b|,\s*[Dd]abei\b/)[0].trim();
        mainInstruction = mainInstruction
          .replace(/\d+[,.]?\d*\s*Stunden?\s*/gi, '')
          .replace(/bei\s+\d+\s*°C\s*/gi, '')
          .replace(/^\s*[,.]?\s*/, '')
          .trim() || instruction.split(',')[0].trim();

        const steps = [];
        let lastTime = 0;
        for (let i = 0; i < count; i++) {
          const nextTime = (i + 1) * interval;
          const waitDuration = nextTime - lastTime;
          if (waitDuration > 0) {
            steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
          }
          steps.push({
            instruction: action.charAt(0).toUpperCase() + action.slice(1),
            duration: 5,
            type: 'Aktion'
          });
          lastTime = nextTime + 5;
        }
        if (lastTime < totalDuration) {
          steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
        }
        return steps;
      }

      return null;
    };

    // SEQUENTIELLER PARSER
    let lastSectionHeading = null;
    let foundOverview = false;
    let currentSection = null;
    const stopKeywords = ['häufig gestellte fragen', 'ähnliche rezepte', 'kommentare'];
    const sectionMap = new Map();

    $('h4, h3, h5, table').each((_, el) => {
      const tag = (el.tagName || el.name || '').toLowerCase();
      const text = $(el).text().trim();
      const lower = text.toLowerCase();
      if (stopKeywords.some(kw => lower.includes(kw))) return false;
      if (tag === 'h4' || tag === 'h3' || tag === 'h5') {
        if (isSectionHeading(text)) { lastSectionHeading = text; }
        else if (lower.includes('zutatenübersicht')) { lastSectionHeading = '__overview__'; }
        else { lastSectionHeading = null; }
        return;
      }
      if (tag === 'table') {
        if (!isIngredientTable(el)) return;
        const ingredients = parseIngredientTable(el);
        if (ingredients.length === 0) return;
        const isOverview = lastSectionHeading === '__overview__' ||
                           (!foundOverview && !lastSectionHeading && $(el).find('tr').first().find('td, th').length === 3);
        if (isOverview) {
          foundOverview = true;
          ingredientOverview.push(...ingredients);
        } else {
          const sectionName = lastSectionHeading || (doughSections.length === 0 ? 'Teig' : 'Teig ' + (doughSections.length + 1));
          // FIX 4: isParallelSection statt inline-Check
          const section = { name: sectionName, ingredients, steps: [], is_parallel: isParallelSection(sectionName) };
          doughSections.push(section);
          sectionMap.set(el, section);
        }
        lastSectionHeading = null;
      }
    });

    // Normalisiert Schritt-Text für semantische Deduplizierung:
    // "reifen lassen" == "45 Minuten bei 20 °C reifen lassen."
    // "Dehnen und falten" == "Den Teig dehnen und falten."
    const normalizeStepText = (text) => {
      let t = text.toLowerCase();
      t = t.replace(/\d+[,.]?\d*\s*(?:stunden?|minuten?|min\.?|std\.?|°\s*c|h\b)/g, '');
      t = t.replace(/bei\s+(?:\d+\s*)?°?\s*c?/g, '');
      // Füllwörter + häufige Backkontext-Substantive entfernen
      // damit "Dehnen und falten" == "Den Teig dehnen und falten."
      t = t.replace(/\b(den|die|das|dem|der|ein|eine|einem|einer|und|oder|mit|auf|in|an|zu|von|nach|für|über|unter|teig|teigling|schüssel|wanne|arbeitsfläche|leicht|bemehlte|bemehlten)\b/g, '');
      t = t.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      return t;
    };

    const seenSteps = new Set();
    $('h4, h3, h5, table, p').each((_, el) => {
      const tag = (el.tagName || el.name || '').toLowerCase();
      const text = $(el).text().trim();
      if (stopKeywords.some(kw => text.toLowerCase().includes(kw))) return false;
      if (tag === 'h4' || tag === 'h3' || tag === 'h5') { currentSection = null; return; }
      if (tag === 'table' && sectionMap.has(el)) { currentSection = sectionMap.get(el); return; }
      if (tag === 'p' && currentSection) {
        if (/^\d+$/.test(text)) return;
        if (!isValidStepText(text)) return;
        // Einsteiger-exklusive Steps filtern: Plötzblog markiert versteckte
        // Steps mit data-step-hidden="true" am Container-Div
        if ($(el).closest('[data-step-hidden="true"]').length) return;
        // Exakter Key verhindert wortgleiche Duplikate
        const stepKey = `${currentSection.name}::${text}`;
        if (seenSteps.has(stepKey)) return;
        seenSteps.add(stepKey);
        // Normalisierter Key verhindert semantische Duplikate:
        // "reifen lassen" vs "45 Minuten bei 20 °C reifen lassen."
        const normKey = `${currentSection.name}::norm::${normalizeStepText(text)}`;
        if (seenSteps.has(normKey)) return;
        seenSteps.add(normKey);

        const duration = extractDurationMinutes(text);
        const type = classifyStep(text);

        // FIX 2+3: Dehnen-und-Falten Steps aufteilen
        const repeated = parseRepeatingActions(text, duration);
        if (repeated) {
          repeated.forEach(s => {
            currentSection.steps.push(s);
            // normKey der generierten Sub-Steps speichern, damit die
            // entsprechenden Original-HTML-Steps danach gefiltert werden
            const subNormKey = `${currentSection.name}::norm::${normalizeStepText(s.instruction)}`;
            seenSteps.add(subNormKey);
          });
        } else {
          currentSection.steps.push({ type, duration, instruction: text });
        }
      }
    });

    // BACKEN-PHASE AUSLAGERN
    if (doughSections.length > 0) {
      const lastSection = doughSections[doughSections.length - 1];
      const backSteps = [];
      let foundBackStep = false;
      for (let i = lastSection.steps.length - 1; i >= 0; i--) {
        const step = lastSection.steps[i];
        const lower = step.instruction.toLowerCase();
        const isBackStep = lower.includes('backen') || lower.includes('ofen') || lower.includes('°c');
        if (isBackStep || foundBackStep) {
          backSteps.unshift(step);
          foundBackStep = true;
        } else { break; }
      }
      if (backSteps.length >= 2 && backSteps.length < lastSection.steps.length) {
        lastSection.steps = lastSection.steps.slice(0, lastSection.steps.length - backSteps.length);
        doughSections.push({ name: 'Backen', ingredients: [], steps: backSteps, is_parallel: false });
      }
    }

    // ÜBERSICHT FALLBACK
    if (ingredientOverview.length === 0 && doughSections.length > 0) {
      const seen = new Map();
      for (const section of doughSections) {
        for (const ing of section.ingredients) {
          if (!ing.name) continue;
          const key = ing.name.split('(')[0].trim().toLowerCase();
          if (seen.has(key)) {
            const ex = seen.get(key);
            if (ex.amount && ing.amount) ex.amount = String(parseFloat(ex.amount) + parseFloat(ing.amount));
          } else { seen.set(key, { ...ing }); }
        }
      }
      ingredientOverview.push(...seen.values());
    }

    return {
      title,
      description: descParagraphs.join('\n\n'),
      image_url: imageUrl,
      source_url: sourceUrl,
      ingredients: ingredientOverview,
      dough_sections: doughSections,
      _scraped_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Ploetzblog Scraper Error:", error.message);
    return null;
  }
};

// Parse from pre-loaded cheerio $
const parseHtml = async ($, filename) => {
  try {
    const title = $('h1').first().text().trim().replace(/\uAD/g, '');
    const subtitle = $('h2').first().text().trim();

    let imageUrl = $('meta[property="og:image"]').attr('content') || 
                   $('meta[name="twitter:image"]').attr('content') || '';
    
    if (!imageUrl || imageUrl.includes('placeholder')) {
      const galleryImg = $('a[href*="/gallery/"] img, figure img').first();
      imageUrl = galleryImg.attr('data-src') || galleryImg.attr('src') || '';
    }

    if (imageUrl) {
      imageUrl = imageUrl.split(' ')[0];
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      if (imageUrl.startsWith('/')) imageUrl = 'https://www.ploetzblog.de' + imageUrl;
      if (imageUrl.includes('cloudimg.io')) {
        imageUrl = imageUrl.replace(/\?p=w\d+/, '?p=w800');
      }
    }

    const descParagraphs = [];
    let foundTitle = false, reachedTable = false;
    $('h1, h2, p, table').each((_, el) => {
      if (reachedTable) return false;
      const tag = (el.tagName || el.name || '').toLowerCase();
      if (tag === 'h1') { foundTitle = true; return; }
      if (tag === 'h2' && foundTitle) return;
      if (tag === 'table') { reachedTable = true; return false; }
      if (foundTitle && tag === 'p') {
        const text = $(el).text().trim();
        const skip = ['Produktempfehlung','Anzeige','Mitgliedschaft','Kommentare','Rezept drucken'];
        if (text.length > 20 && !skip.some(s => text.includes(s))) descParagraphs.push(text);
      }
    });

    const description = descParagraphs.join('\n\n');

    const isIngredientTable = (table) => {
      const text = $(table).text().toLowerCase();
      if ((text.includes('amazon') || text.includes('otto')) &&
          (text.includes('abdeckfolie') || text.includes('backstein') ||
           text.includes('ofenhandschuh') || text.includes('knetmaschine') ||
           text.includes('schneebesen') || text.includes('teigreinigung'))) return false;
      if (text.includes('uhr') && text.includes('vorheizen')) return false;
      const uhrCount = (text.match(/uhr/gi) || []).length;
      if (uhrCount >= 3) return false;
      let hasGrams = false;
      $(table).find('tr').each((_, row) => {
        if (/^\d+[\.,]?\d*\s*g/.test($(row).find('td').first().text().trim())) hasGrams = true;
      });
      return hasGrams;
    };

    const parseIngredientTable = (table) => {
      const ingredients = [];
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const amountCell = $(cells[0]).text().trim();
        const nameCell = $(cells[1]).text().trim();
        let tempCell = '';
        if (cells.length >= 3) {
          const thirdCell = $(cells[2]).text().trim();
          if (/\d+\s*\u00b0\s*C/.test(thirdCell)) tempCell = thirdCell;
        }
        if (amountCell && nameCell) {
          ingredients.push({ name: nameCell, amount: amountCell.replace(/[^\d,.]/g, '').trim(), unit: 'g', temperature: tempCell });
        }
      });
      return ingredients;
    };

    // FIX 4: parallelKeywords auch in parseHtml
    const parallelKeywords = [
      'vorteig', 'poolish', 'biga', 'sauerteig', 'levain', 'lievito',
      'kochstück', 'brühstück', 'quellstück', 'aromastück', 'mehlkochstück'
    ];
    const isParallelSection = (name) => {
      const lower = (name || '').toLowerCase();
      return parallelKeywords.some(kw => lower.includes(kw));
    };

    const doughSections = [];
    const ingredientTables = $('table').filter((_, table) => isIngredientTable(table));

    if (ingredientTables.length > 0) {
      ingredientTables.each((i, table) => {
        const tableText = $(table).text().toLowerCase();
        let sectionName = 'Zutaten';
        if (tableText.includes('vorteig') || tableText.includes('poolish')) sectionName = 'Vorteig / Poolish';
        else if (tableText.includes('sauer')) sectionName = 'Sauerteig';
        else if (tableText.includes('quell') || tableText.includes('koch')) sectionName = 'Quellstück / Kochstück';
        else if (tableText.includes('auto')) sectionName = 'Autolyse';
        else if (tableText.includes('haupt')) sectionName = 'Hauptteig';
        else if (tableText.includes('stock')) sectionName = 'Stockgare';
        else if (tableText.includes('stück')) sectionName = 'Stückgare';

        doughSections.push({
          name: sectionName,
          // FIX 4: isParallelSection statt hartcodiertem Vergleich
          is_parallel: isParallelSection(sectionName),
          ingredients: parseIngredientTable(table)
        });
      });
    }

    return { title, subtitle, description, image_url: imageUrl, dough_sections: doughSections };
  } catch (error) {
    console.error("Ploetzblog HTML Parse Error:", error.message);
    return null;
  }
};

module.exports = { scrapePloetz, parseHtml };