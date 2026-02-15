const scrapePloetz = ($) => {
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

  // Versuch 3: Cleanup & Absolute URL erzwingen
  if (imageUrl) {
    if (imageUrl.includes('cloudimg.io')) imageUrl = imageUrl.replace(/\?p=w\d+/, '?p=w800');
    
    if (imageUrl.startsWith('//')) {
      imageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      imageUrl = 'https://www.ploetzblog.de' + imageUrl;
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
  const dateMatch = bodyText.match(/(\d{2}\.\s*\w+\s*\d{4})/);
  const sourceUrl = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || '';
  const piecesMatch = bodyText.match(/(?:Ursprungsrezept\s+)?f.r\s+(\d+)\s+St.ck\s+zu\s+\(je\)\s+ca\.\s+([\d.]+)\s*g/);
  const bookMatch = bodyText.match(/Du findest das Rezept im Buch\s*([^\n]+)/);
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

  // ============================================================
  // STEP KLASSIFIZIERUNG: Aktion vs. Warten + Dauer in Minuten
  // ============================================================

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

  // Extrahiert Dauer in Minuten aus dem Text
  const extractDurationMinutes = (text) => {
    const lower = text.toLowerCase();

    // "X Stunden" oder "X-Y Stunden"
    const hourMatch = lower.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:stunden?|std\.?)/);
    // "X Minuten" oder "X-Y Minuten"  
    const minMatch = lower.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:minuten?|min\.?)/);

    let totalMinutes = 0;

    if (hourMatch) {
      // Bei Bereich den höheren Wert nehmen
      const hours = hourMatch[2] ? parseInt(hourMatch[2]) : parseInt(hourMatch[1]);
      totalMinutes += hours * 60;
    }
    if (minMatch) {
      const mins = minMatch[2] ? parseInt(minMatch[2]) : parseInt(minMatch[1]);
      totalMinutes += mins;
    }

    // Fallback: "30-35 Minuten anbacken" im selben Text wie Stunden
    if (totalMinutes === 0) {
      // Versuche generisch Zahlen vor Zeiteinheiten zu finden
      const genericTime = lower.match(/(\d+)\s*(?:min|stunde)/);
      if (genericTime) totalMinutes = parseInt(genericTime[1]);
    }

    // Default: Aktion ohne Zeitangabe → 5 Minuten
    if (totalMinutes === 0) return 5;

    return totalMinutes;
  };

  const isValidStepText = (text) => {
    if (!text || text.length < 15) return false;
    if (skipStepPatterns.some(p => p.test(text))) return false;
    return true;
  };

  // ============================================================
  // SEQUENTIELLER PARSER: Phasen + Steps zuordnen
  // ============================================================
  // Plötzblog-Struktur: h4 (Phasenname) → table (Zutaten) → p/text (Steps) → h4 (nächste Phase)
  // Die Steps stehen als nummerierte Paragraphen NACH der Zutatentabelle

  let lastSectionHeading = null;
  let foundOverview = false;
  let currentSection = null;

  // Stopp-Keywords
  const stopKeywords = ['häufig gestellte fragen', 'ähnliche rezepte', 'kommentare'];

  // PHASE 1: Sammle alle h4-Überschriften und ihre zugehörigen Tabellen
  const sectionMap = new Map(); // sectionIndex → section object

  $('h4, h3, h5, table').each((_, el) => {
    const tag = (el.tagName || el.name || '').toLowerCase();
    const text = $(el).text().trim();
    const lower = text.toLowerCase();

    if (stopKeywords.some(kw => lower.includes(kw))) return false;

    if (tag === 'h4' || tag === 'h3' || tag === 'h5') {
      if (isSectionHeading(text)) {
        lastSectionHeading = text;
      } else if (lower.includes('zutatenübersicht')) {
        lastSectionHeading = '__overview__';
      } else {
        lastSectionHeading = null;
      }
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

        const section = {
          name: sectionName,
          ingredients: ingredients,
          steps: [],
          is_parallel: isParallel,
        };
        doughSections.push(section);
        // Merke die Tabelle als Marker für die Step-Zuordnung
        sectionMap.set(el, section);
      }

      lastSectionHeading = null;
    }
  });

  // PHASE 2: Für jede Phase die Steps zwischen ihrer Tabelle und der nächsten h4 sammeln
  // Wir gehen alle <p> Tags durch und schauen welche Phase-Tabelle vorher kam
  currentSection = null;
  const seenSteps = new Set();

  $('h4, h3, h5, table, p').each((_, el) => {
    const tag = (el.tagName || el.name || '').toLowerCase();
    const text = $(el).text().trim();
    const lower = text.toLowerCase();

    if (stopKeywords.some(kw => lower.includes(kw))) return false;

    // Bei einer Überschrift: Section wechseln oder zurücksetzen
    if (tag === 'h4' || tag === 'h3' || tag === 'h5') {
      // Wenn die nächste Überschrift eine neue Phase einleitet, wird currentSection
      // bei der nächsten Tabelle gesetzt
      currentSection = null;
      return;
    }

    // Bei einer Zutatentabelle: aktuelle Phase setzen
    if (tag === 'table' && sectionMap.has(el)) {
      currentSection = sectionMap.get(el);
      return;
    }

    // Paragraphen → Steps zur aktuellen Phase
    if (tag === 'p' && currentSection) {
      // Reine Ziffern überspringen (Schwierigkeitsgrad-Nummern)
      if (/^\d+$/.test(text)) return;

      if (!isValidStepText(text)) return;

      // Duplikate vermeiden
      const stepKey = `${currentSection.name}::${text}`;
      if (seenSteps.has(stepKey)) return;
      seenSteps.add(stepKey);

      // Links zu FAQ etc. überspringen
      const $el = $(el);
      if ($el.find('a[href*="/detail/"]').length > 0) return;
      if ($el.find('a[href*="/faq/"]').length > 0) return;

      currentSection.steps.push({
        type: classifyStep(text),
        duration: extractDurationMinutes(text),
        instruction: text,
      });
    }
  });

  // ============================================================
  // BACKEN-PHASE: Wenn die letzten Steps im Hauptteig Backschritte sind,
  // in eigene "Backen"-Phase auslagern
  // ============================================================

  if (doughSections.length > 0) {
    const lastSection = doughSections[doughSections.length - 1];
    const backSteps = [];
    const nonBackSteps = [];
    let foundBackStep = false;

    // Von hinten durchgehen und Backschritte sammeln
    for (let i = lastSection.steps.length - 1; i >= 0; i--) {
      const step = lastSection.steps[i];
      const lower = step.instruction.toLowerCase();
      const isBackStep = lower.includes('backen') || lower.includes('anbacken') ||
                         lower.includes('ausbacken') || lower.includes('vorheiz') ||
                         lower.includes('ofen') || lower.includes('deckel abnehmen') ||
                         (lower.includes('°c') && (lower.includes('minuten') || lower.includes('min')));

      if (isBackStep || foundBackStep) {
        backSteps.unshift(step);
        foundBackStep = true;
      } else {
        break;
      }
    }

    // Nur auslagern wenn es mindestens 2 Backschritte gibt und sie nicht die einzigen Steps sind
    if (backSteps.length >= 2 && backSteps.length < lastSection.steps.length) {
      // Entferne Backschritte aus der letzten Phase
      lastSection.steps = lastSection.steps.slice(0, lastSection.steps.length - backSteps.length);

      // Eigene Backen-Phase erstellen
      doughSections.push({
        name: 'Backen',
        ingredients: [{ name: '', unit: 'g', amount: '' }],
        steps: backSteps,
        is_parallel: false,
      });
    }
  }

  // ============================================================
  // FALLBACK: Wenn Phasen keine Steps haben, versuche sie nachträglich zuzuordnen
  // ============================================================

  const sectionsWithoutSteps = doughSections.filter(s => s.steps.length === 0);
  if (sectionsWithoutSteps.length > 0) {
    const allStepTexts = [];
    let pastLastTable = false;
    const fallbackSeenSteps = new Set();

    $('table, p').each((_, el) => {
      const tag = (el.tagName || el.name || '').toLowerCase();
      const text = $(el).text().trim();
      const lower = text.toLowerCase();

      if (tag === 'table' && isIngredientTable(el)) {
        pastLastTable = true;
        return;
      }
      if (!pastLastTable) return;
      if (stopKeywords.some(kw => lower.includes(kw))) return false;
      if (tag === 'table') return;
      if (/^\d+$/.test(text)) return;
      if (!isValidStepText(text)) return;

      allStepTexts.push(text);
    });

    // Weise die gefundenen Steps der letzten Phase ohne Steps zu
    if (allStepTexts.length > 0 && sectionsWithoutSteps.length > 0) {
      const targetSection = sectionsWithoutSteps[sectionsWithoutSteps.length - 1];
      allStepTexts.forEach(text => {
        if (targetSection.steps.some(s => s.instruction === text)) return;
        targetSection.steps.push({
          type: classifyStep(text),
          duration: extractDurationMinutes(text),
          instruction: text,
        });
      });
    }
  }

  // ============================================================
  // ÜBERSICHT: Fallback aus Phasen zusammenbauen
  // ============================================================

  if (ingredientOverview.length === 0 && doughSections.length > 0) {
    const seen = new Map();
    for (const section of doughSections) {
      for (const ing of section.ingredients) {
        if (!ing.name) continue;
        const key = ing.name.split('(')[0].trim().toLowerCase();
        if (key.startsWith('gesamt')) continue; // "gesamte Sauerteigstufe" überspringen
        if (seen.has(key)) {
          const ex = seen.get(key);
          if (ex.amount && ing.amount) {
            ex.amount = String(Math.round((parseFloat(ex.amount) + parseFloat(ing.amount)) * 100) / 100);
          }
        } else {
          seen.set(key, { ...ing });
        }
      }
    }
    ingredientOverview.push(...seen.values());
  }

  // ============================================================
  // ERGEBNIS
  // ============================================================

console.log(`📸 Scraper Ergebnis für "${title}": Bild-URL = ${imageUrl || 'KEIN BILD GEFUNDEN'}`);

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(descParagraphs.length ? { description: descParagraphs.join('\n\n') } : {}),
    image_url: imageUrl,
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    ingredients: ingredientOverview,
    dough_sections: doughSections,
    steps: [], // Legacy-Feld, wird nicht mehr genutzt
    _scraped_at: new Date().toISOString(),
  };
};

module.exports = scrapePloetz;