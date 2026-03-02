const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { sumAllDurations, extractFirstDuration, isBakingStep } = require('./utils');

// ── HILFSFUNKTIONEN ──────────────────────────────────────────
function htmlToText(str) {
  return (str || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
}

function findDivContentEnd(str, startPos) {
  const tagRe = /(<\/div>|<div(?:\s[^>]*)?>)/gi;
  tagRe.lastIndex = startPos;
  let depth = 1, m;
  while ((m = tagRe.exec(str)) !== null) {
    if (m[1].startsWith('</')) { depth--; if (depth === 0) return m.index; }
    else depth++;
  }
  return str.length;
}

function extractDuration(text) {
  if (!text) return 0;
  // Backschritte: alle Zeiten summieren ("Nach 20 Min. ... weitere 50 Min. backen" → 70)
  if (isBakingStep(text)) return sumAllDurations(text) || 45;
  // Sonst: erste/dominante Zeitangabe
  return extractFirstDuration(text) || 0;
}

function detectStepType(text) {
  if (!text) return 'Aktion';
  const lower = text.toLowerCase();
  if (isBakingStep(text)) return 'Backen';
  if (lower.match(/reifen|ruhen|gehen|aufgehen|stockgare|stückgare|gare\s/)) return 'Warten';
  if (lower.match(/\d+\s*(stunden?|minuten?|std|min|h)\s+(bei|reifen|ruhen|gehen)/i)) return 'Warten';
  if (lower.match(/^\d+[,.]?\d*\s*stunden?\s+bei/i)) return 'Warten';
  return 'Aktion';
}

function parseRepeatingActions(instruction, totalDuration) {
  const steps = [];
  const buildMainInstruction = (text) => {
    let main = text.split(/\.\s*[Dd]abei\b|,\s*[Dd]abei\b/)[0].trim();
    main = main
      .replace(/\d+[,.]?\d*\s*(?:Stunden?|Minuten?|h\b|min\.?)/gi, '')
      .replace(/bei\s+\d+\s*°C\s*/gi, '')
      .replace(/^[,.]?\s*/, '')
      .trim();
    if (!main) main = text.split(',')[0].trim();
    return main ? main.charAt(0).toUpperCase() + main.slice(1) : main;
  };
  const capitalizeAction = (raw) => {
    const s = raw.trim().replace(/\.$/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // Format A: "dabei nach X, Y und Z Minuten/Stunden <Aktion>"
  const matchA = instruction.match(/dabei\s+nach\s+([\d,.\sund]+)\s*(minuten?|stunden?)\s+(.+)/i);
  if (matchA) {
    const isStunden = /stunden?/i.test(matchA[2]);
    const intervals = matchA[1]
      .replace(/\s*und\s*/gi, ',').split(/[,\s]+/)
      .map(n => parseInt(n)).filter(n => !isNaN(n) && n > 0)
      .map(n => isStunden ? n * 60 : n);
    if (intervals.length > 0) {
      const action = capitalizeAction(matchA[3]);
      const mainInstruction = buildMainInstruction(instruction);
      let lastTime = 0;
      intervals.forEach((time) => {
        const waitDuration = time - lastTime;
        if (waitDuration > 0) steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
        steps.push({ instruction: action, duration: 5, type: 'Aktion' });
        lastTime = time + 5;
      });
      if (lastTime < totalDuration) steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
      return steps;
    }
  }

  // Format B: "dabei alle X Minuten <Aktion> (Nx)"
  const matchB = instruction.match(/dabei\s+alle\s+(\d+)\s*minuten?\s+(.+?)(?:\s*\((\d+)x\))?\.?\s*$/i);
  if (matchB) {
    const interval = parseInt(matchB[1]);
    const action = capitalizeAction(matchB[2]);
    const count = matchB[3] ? parseInt(matchB[3]) : Math.max(1, Math.floor(totalDuration / interval) - 1);
    const mainInstruction = buildMainInstruction(instruction);
    let lastTime = 0;
    for (let i = 0; i < count; i++) {
      const nextTime = (i + 1) * interval;
      const waitDuration = nextTime - lastTime;
      if (waitDuration > 0) steps.push({ instruction: mainInstruction, duration: waitDuration, type: 'Warten' });
      steps.push({ instruction: action, duration: 5, type: 'Aktion' });
      lastTime = nextTime + 5;
    }
    if (lastTime < totalDuration) steps.push({ instruction: mainInstruction, duration: totalDuration - lastTime, type: 'Warten' });
    return steps;
  }

  return null;
}

function extractIngredientsFromChunk(chunk) {
  const ingredients = [], seen = new Set();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(chunk)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cell;
    while ((cell = cellRe.exec(row[1])) !== null) cells.push(htmlToText(cell[1]));
    const filteredCells = cells.filter(c => c.trim().length > 0);
    if (filteredCells.length < 2) continue;
    const hasAmount = /^\d/.test(filteredCells[0].trim());
    const amount = hasAmount ? filteredCells[0].trim() : '';
    let name = hasAmount ? filteredCells[1].trim() : filteredCells[0].trim();
    const temperature = (hasAmount ? filteredCells[2] : filteredCells[1])
      ? (hasAmount ? filteredCells[2] : filteredCells[1]).replace('°C', '').trim() : '';
    let note = '';
    const noteMatch = name.match(/\(([^)]+)\)/);
    if (noteMatch) { note = noteMatch[1]; name = name.replace(/\([^)]+\)/g, '').trim(); }
    name = name.replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2 || name.length > 120) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ingredients.push({ name, amount: hasAmount ? amount : '', unit: '', temperature, note });
  }
  return ingredients;
}

function extractAllSteps(str) {
  const steps = [];

  // Methode 2: smry.app – <div[data-step-explain]><div><p>ZAHL</p>...</div><p>INSTRUCTION</p></div>
  const smryRe = /<div[^>]*>\s*<div>\s*<p>\s*(\d+)\s*<\/p>\s*<\/div>\s*<p>\s*([\s\S]*?)\s*<\/p>\s*<\/div>/gi;
  let smryM;
  while ((smryM = smryRe.exec(str)) !== null) {
    const instruction = htmlToText(smryM[2]);
    if (instruction.length >= 5) steps.push({ pos: smryM.index, stepNum: parseInt(smryM[1]), instruction });
  }
  if (steps.length > 0) {
    // Fallback: prose-divs (Schritte die durch Werbung aus der Nummerierung gefallen sind)
    const proseRe = /class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let proseM;
    while ((proseM = proseRe.exec(str)) !== null) {
      const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let pM;
      while ((pM = pRe.exec(proseM[1])) !== null) {
        const instruction = htmlToText(pM[1]);
        if (instruction.length >= 10 && !steps.some(s => s.instruction === instruction)) {
          steps.push({ pos: proseM.index, stepNum: 0, instruction });
        }
      }
    }
    steps.sort((a, b) => a.pos - b.pos);
    return steps;
  }

  // Methode 1: archive.ph / Plötzblog Originalstruktur (rgba Kreise)
  const rgbaRe = /rgba\(196,\s*173,\s*130[^)]*\)/g;
  let m;
  while ((m = rgbaRe.exec(str)) !== null) {
    const pos = m.index;
    const before = str.slice(Math.max(0, pos - 2000), pos);
    const displayMatches = before.match(/display:\s*(none|block|flex|grid)/g) || [];
    if (!displayMatches.length) continue;
    const lastDisplay = displayMatches[displayMatches.length - 1].replace(/display:\s*/, '').trim();
    if (lastDisplay !== 'flex') continue;
    const after = str.slice(pos, pos + 2000);
    const numMatch = after.match(/>(\d+)<\/div>\s*<\/div>/);
    if (!numMatch) continue;
    const circleEndAbs = pos + numMatch.index + numMatch[0].length;
    const rest = str.slice(circleEndAbs, circleEndAbs + 8000);
    const divStart = rest.indexOf('<div');
    if (divStart === -1) continue;
    const tagEndInRest = rest.indexOf('>', divStart + 4);
    if (tagEndInRest === -1) continue;
    const contentStart = tagEndInRest + 1;
    const contentEnd = findDivContentEnd(rest, contentStart);
    const instruction = htmlToText(rest.slice(contentStart, contentEnd));
    if (instruction.length < 5) continue;
    steps.push({ pos, stepNum: parseInt(numMatch[1]), instruction });
  }
  return steps;
}

// ── PHASE-DEFINITIONEN ───────────────────────────────────────
const KNOWN_PHASES = {
  'Kochstück':       { is_parallel: true  },
  'Brühstück':       { is_parallel: true  },
  'Quellstück':      { is_parallel: true  },
  'Roggensauerteig': { is_parallel: true  },
  'Weizensauerteig': { is_parallel: true  },
  'Sauerteig':       { is_parallel: true  },
  'Vorteig':         { is_parallel: true  },
  'Poolish':         { is_parallel: true  },
  'Levain':          { is_parallel: true  },
  'Autolyse':        { is_parallel: false },
  'Hauptteig':       { is_parallel: false },
};
const PHASE_PATTERNS = [
  { re: /hauptteig$/i,  is_parallel: false },
  { re: /teig$/i,       is_parallel: true  },
  { re: /stück$/i,      is_parallel: true  },
  { re: /sauerteig/i,   is_parallel: true  },
  { re: /poolish/i,     is_parallel: true  },
  { re: /levain/i,      is_parallel: true  },
  { re: /autolyse/i,    is_parallel: false },
  { re: /vorteig/i,     is_parallel: true  },
];
const NON_PHASE_H4 = ['zubehör', 'zutatenübersicht', 'planungsbeispiel', 'häufig', 'ähnliche', 'kommentar', 'fragen'];

// ── HAUPT-FUNKTION ───────────────────────────────────────────
const parseHtmlImport = async (html, filename, hostUrl) => {
  const $ = cheerio.load(html);

  let recipeData = {
    title: $('h1.entry-title').first().text().trim() || $('h1').first().text().trim() || 'Importiertes Rezept',
    description: '',
    image_url: '',
    source_url: filename || 'uploaded.html',
    ingredients: [],
    steps: [],
    dough_sections: []
  };

  // BILD
  let imageUrl = '';
  const cloudimgMatch = html.match(/https?:\/\/[^"']*cloudimg\.io[^"']*\/entity\/gallery\/[^"']*\.jpg[^"']*/);
  if (cloudimgMatch) {
    imageUrl = cloudimgMatch[0]
      .replace(/^\/\//, 'https://')
      .replace(/\?p=w\d+/, '?p=w800')
      .replace(/\?p=grid-[^&\s"']+/, '?p=w800');
  } else {
    const imgCandidates = [];
    $('img').each((i, img) => {
      const src = $(img).attr('src');
      const parent = $(img).parent().text();
      if (parent.includes('Kommentare') || parent.includes('Benötigtes Zubehör') || parent.includes('Rezept drucken')) return;
      if (src && !src.includes('scr.png') && !src.includes('Partner') && !src.includes('icon') && !src.includes('logo') && !src.includes('.svg') && !src.startsWith('data:image/svg') &&
          (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp'))) {
        const size = (parseInt($(img).attr('width')) || 0) * (parseInt($(img).attr('height')) || 0);
        imgCandidates.push({ src, size });
      }
    });
    imgCandidates.sort((a, b) => b.size - a.size);
    if (imgCandidates.length > 0) {
      const imgSrc = imgCandidates[0].src;
      if (imgSrc.startsWith('data:image') && !imgSrc.startsWith('data:image/svg')) imageUrl = imgSrc;
      else if (imgSrc.match(/^\/[A-Z0-9]+\//) || imgSrc.includes('-Dateien/')) imageUrl = 'https://archive.is/' + imgSrc.replace(/^\//, '');
      else if (imgSrc.startsWith('http')) imageUrl = imgSrc;
      else if (!imgSrc.startsWith('data:')) imageUrl = 'https://archive.is/' + imgSrc;
    }
    if (!imageUrl) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage && !ogImage.includes('scr.png') && !ogImage.includes('.svg')) imageUrl = ogImage;
    }
    // smry.app: lokale Dateipfade → Plötzblog-Originalbild holen
    if (imageUrl && (imageUrl.includes('_files/') || imageUrl.startsWith('Article%20'))) {
      imageUrl = '';
      const ogUrl = $('meta[property="og:url"]').attr('content') || '';
      const ploetzMatch = ogUrl.match(/https?:\/\/(?:smry\.ai\/)?(.+ploetzblog\.de.+)/);
      if (ploetzMatch) {
        const ploetzUrl = ploetzMatch[1].startsWith('http') ? ploetzMatch[1] : 'https://' + ploetzMatch[1];
        try {
          const ploetzRes = await axios.get(ploetzUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          const $p = cheerio.load(ploetzRes.data);
          const ploetzOgImage = $p('meta[property="og:image"]').attr('content') || '';
          if (ploetzOgImage && ploetzOgImage.startsWith('http') && !ploetzOgImage.includes('.svg')) {
            imageUrl = ploetzOgImage.replace(/[?&]p=w\d+/g, '').replace(/[?&]width=\d+/g, '');
          }
          const ploetzDesc = $p('meta[property="og:description"]').attr('content') || '';
          if (ploetzDesc.length > 20) recipeData.description = ploetzDesc;
        } catch(e) { console.log('⚠️ Plötzblog nicht abrufbar:', e.message); }
      }
    }
  }
  recipeData.image_url = imageUrl;

  // BESCHREIBUNG
  let description = $('meta[property="og:description"]').attr('content') || '';
  if (!description || description.length < 50) {
    const skipWords = ['Produktempfehlung','Anzeige','Mitgliedschaft','Kommentare','Rezept drucken','Benötigtes Zubehör','Häufig gestellte Fragen','Amazon','Otto','Steady','Newsletter','Copyright'];
    let foundH1 = false;
    $('h1, h2, p, div').each((i, elem) => {
      if (description) return false;
      const tag = elem.name || elem.tagName;
      const text = $(elem).text().trim();
      if (tag === 'h1') { foundH1 = true; return; }
      if (tag === 'h2' && foundH1) return;
      if (foundH1 && (tag === 'p' || tag === 'div')) {
        if (text.length < 50) return;
        if (skipWords.some(w => text.includes(w))) return;
        if (text.match(/^\d+\s*(g|ml|°C|Min|Std)/)) return;
        if (text.includes('Uhr') && text.length < 100) return;
        description = text.replace(/\s+/g, ' ').trim();
        return false;
      }
    });
  }
  if (!recipeData.description) recipeData.description = description;

  // ZUTATEN (Tabellen-Fallback)
  $('table tr').each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length >= 2) {
      const amount = $(cells[0]).text().trim();
      let name = $(cells[1]).text().trim();
      let temperature = '';
      const tempMatch = name.match(/(\d+)\s*°C/);
      if (tempMatch) { temperature = tempMatch[1]; name = name.replace(/\d+\s*°C/g, '').trim(); }
      let note = '';
      const noteMatch = name.match(/\(([^)]+)\)/);
      if (noteMatch) { note = noteMatch[1]; name = name.replace(/\([^)]+\)/g, '').trim(); }
      if (amount.match(/\d+[,.]?\d*\s*(g|kg|ml|l|%|EL|TL|Prise)/i) && name && name.length > 2) {
        recipeData.ingredients.push({ name, amount, unit: '', temperature, note });
      }
    }
  });
  const seenIng = new Map();
  recipeData.ingredients = recipeData.ingredients.filter(ing => {
    const key = ing.name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenIng.has(key)) return false;
    seenIng.set(key, true);
    return true;
  });

  // SCHRITTE
  const rawHtml = html;
  const allSteps = (() => {
    const raw = extractAllSteps(rawHtml);
    const deduped = [];
    const seenInBlock = new Set();
    let lastNum = -1;
    raw.forEach(step => {
      if (step.stepNum <= lastNum) seenInBlock.clear();
      if (!seenInBlock.has(step.stepNum)) {
        seenInBlock.add(step.stepNum);
        deduped.push(step);
      }
      lastNum = step.stepNum;
    });
    return deduped;
  })();

  // PHASEN ERKENNEN
  const detectedPhases = [];
  const h4Re = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
  let h4Match;
  while ((h4Match = h4Re.exec(rawHtml)) !== null) {
    const h4Text = htmlToText(h4Match[1]);
    if (!h4Text || h4Text.length > 60) continue;
    if (NON_PHASE_H4.some(s => h4Text.toLowerCase().includes(s))) continue;
    let found = false;
    for (const [phaseName, opts] of Object.entries(KNOWN_PHASES)) {
      if (h4Text.toLowerCase() === phaseName.toLowerCase()) {
        detectedPhases.push({ name: phaseName, is_parallel: opts.is_parallel, charPos: h4Match.index });
        found = true; break;
      }
    }
    if (found) continue;
    for (const pat of PHASE_PATTERNS) {
      if (pat.re.test(h4Text)) {
        detectedPhases.push({ name: h4Text, is_parallel: pat.is_parallel, charPos: h4Match.index });
        break;
      }
    }
  }
  const uniquePhases = detectedPhases.filter((p, i) => i === 0 || p.name !== detectedPhases[i - 1].name);

  // DOUGH SECTIONS AUFBAUEN
  let dough_sections = [];
  if (uniquePhases.length === 0) {
    console.log('⚠️ Keine Phasen – Fallback Hauptteig');
    const expanded = [];
    allSteps.forEach(s => {
      const duration = extractDuration(s.instruction) || 5;
      const step = { instruction: s.instruction, duration, type: detectStepType(s.instruction) };
      const rep = parseRepeatingActions(step.instruction, step.duration);
      rep ? expanded.push(...rep) : expanded.push(step);
    });
    dough_sections = [{
      name: 'Hauptteig', is_parallel: false, ingredients: recipeData.ingredients || [],
      steps: expanded.length > 0 ? expanded : [
        { instruction: 'Alle Zutaten mischen', duration: 10, type: 'Aktion' },
        { instruction: 'Teig ruhen lassen',    duration: 90, type: 'Warten' },
        { instruction: 'Backen',               duration: 45, type: 'Aktion' },
      ],
    }];
  } else {
    for (let i = 0; i < uniquePhases.length; i++) {
      const phase   = uniquePhases[i];
      const nextPos = i + 1 < uniquePhases.length ? uniquePhases[i + 1].charPos : rawHtml.length;
      const phaseChunk = rawHtml.slice(phase.charPos, nextPos).slice(0, 100000);
      const phaseIngredients = extractIngredientsFromChunk(phaseChunk);
      const expandedSteps = [];
      allSteps
        .filter(s => s.pos > phase.charPos && s.pos < nextPos)
        .forEach(s => {
          const duration = extractDuration(s.instruction) || 5;
          const step = { instruction: s.instruction, duration, type: detectStepType(s.instruction) };
          const rep = parseRepeatingActions(step.instruction, step.duration);
          rep ? expandedSteps.push(...rep) : expandedSteps.push(step);
        });
      dough_sections.push({ name: phase.name, ingredients: phaseIngredients, steps: expandedSteps });
    }
  }

  recipeData.steps          = allSteps.map(s => ({ instruction: s.instruction, duration: extractDuration(s.instruction) || 5, type: detectStepType(s.instruction) }));
  recipeData.dough_sections = dough_sections;
  recipeData.ingredients    = dough_sections.flatMap(s => s.ingredients);
  console.log(`✅ ${dough_sections.length} Phasen, ${recipeData.steps.length} Schritte, ${recipeData.ingredients.length} Zutaten gesamt`);

  return {
    title: recipeData.title || 'Importiertes Rezept',
    description: recipeData.description || '',
    image_url: recipeData.image_url || '',
    source_url: recipeData.source_url || '',
    ingredients: recipeData.ingredients || [],
    steps: recipeData.steps || [],
    dough_sections: recipeData.dough_sections || []
  };
};

module.exports = parseHtmlImport;