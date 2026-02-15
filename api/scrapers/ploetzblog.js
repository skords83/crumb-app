const axios = require('axios');
const cheerio = require('cheerio');

const scrapePloetz = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    // ============================================================
    // AB HIER DEIN ORIGINALER CODE (UNGEKÜRZT)
    // ============================================================

    // 1. TITEL & UNTERTITEL
    const title = $('h1').first().text().trim().replace(/\u00AD/g, '');
    const subtitle = $('h2').first().text().trim();

    // 2. BILD (Spezial-Logik für Plötzblog / Cloudimg)
    let imageUrl = '';

    // Prio 1: Meta-Tags (Der sicherste Weg)
    imageUrl = $('meta[property="og:image"]').attr('content') || 
               $('meta[name="twitter:image"]').attr('content') || '';

    // Prio 2: Gezielte Suche nach dem Hauptbild in der Figure/Gallery
    if (!imageUrl || imageUrl.includes('placeholder')) {
      // Suche nach dem ersten Bild in einem Link, der zur Gallery führt
      const galleryImg = $('a[href*="/gallery/"] img, figure img').first();
      imageUrl = galleryImg.attr('data-src') || galleryImg.attr('src') || '';
    }

    // Prio 3: Alle Bilder durchsuchen, falls noch nichts gefunden wurde
    if (!imageUrl) {
      $('img').each((_, el) => {
        const $el = $(el);
        const src = $el.attr('data-src') || $el.attr('src') || '';
        
        // Filter: Ignoriere Logos, Partner und Avatare
        if (src && 
            !src.includes('Logo') && 
            !src.includes('Ploetz-Partner') && 
            (src.includes('cloudimg') || src.includes('entity') || src.includes('rezept'))) {
          imageUrl = src;
          return false; // Schleife abbrechen
        }
      });
    }

    // Bereinigung und absolute URL
    if (imageUrl) {
      // Entferne eventuelle Zusätze wie " 800w" bei srcset-Resten
      imageUrl = imageUrl.split(' ')[0];

      // Sicherstellen, dass es eine https-URL ist
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      if (imageUrl.startsWith('/')) imageUrl = 'https://www.ploetzblog.de' + imageUrl;
      
      // Cloudimg-Parameter für gute Qualität erzwingen
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
    const totalTimeMatch = bodyText.match(/Gesamtzubereitungszeit:\s*(.+?)(?:\n|$)/);

    // 5. ZUTATEN & PHASEN MIT STEPS
    const ingredientOverview = [];
    const doughSections = [];

    // Prüft ob eine Tabelle Zutaten enthält
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

    // Parst eine Zutatentabelle
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
          if (/\d+\s*\u00b0\s*C/.test(thirdCell)) {
            tempCell = thirdCell;
          } else {
            percentCell = thirdCell;
          }
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

    // Bekannte Abschnitts-Keywords
    const sectionKeywords = [
      'sauerteig', 'vorteig', 'hauptteig', 'quellst\u00fcck', 'br\u00fchst\u00fcck',
      'autolyseteig', 'autolyse', 'kochst\u00fcck', 'mehlkochst\u00fcck', 'poolish',
      'biga', 'teig', 'dekoration', 'f\u00fcllung', 'glasur', 'weizensauerteig',
      'roggensauerteig', 'lievito madre', 'starter', 'aromast\u00fcck',
      'altbrot', 'einlage', 'streusel', 'belag', 'p\u00e2te ferment\u00e9e',
      'backen'
    ];

    const isSectionHeading = (text) => {
      const lower = (text || '').toLowerCase();
      return sectionKeywords.some(kw => lower.includes(kw));
    };

    // STEP KLASSIFIZIERUNG
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
      const isWait = waitKeywords.some(kw => lower.includes(kw));
      return isWait ? 'Warten' : 'Aktion';
    };

    const extractDurationMinutes = (text) => {
      const lower = text.toLowerCase();
      const hourMatch = lower.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:stunden?|std\.?)/);
      const minMatch = lower.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:minuten?|min\.?)/);
      let totalMinutes = 0;
      if (hourMatch) {
        const hours = hourMatch[2] ? parseInt(hourMatch[2]) : parseInt(hourMatch[1]);
        totalMinutes += hours * 60;
      }
      if (minMatch) {
        const mins = minMatch[2] ? parseInt(minMatch[2]) : parseInt(minMatch[1]);
        totalMinutes += mins;
      }
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
          const sectionLower = (lastSectionHeading || '').toLowerCase();
          const isParallel = sectionLower.includes('vorteig') || sectionLower.includes('poolish') || sectionLower.includes('biga');
          const section = { name: sectionName, ingredients: ingredients, steps: [], is_parallel: isParallel };
          doughSections.push(section);
          sectionMap.set(el, section);
        }
        lastSectionHeading = null;
      }
    });

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
        const stepKey = `${currentSection.name}::${text}`;
        if (seenSteps.has(stepKey)) return;
        seenSteps.add(stepKey);
        currentSection.steps.push({
          type: classifyStep(text),
          duration: extractDurationMinutes(text),
          instruction: text,
        });
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

module.exports = scrapePloetz;