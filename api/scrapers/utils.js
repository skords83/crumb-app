// scrapers/utils.js – Gemeinsame Hilfsfunktionen für alle Scraper
// ─────────────────────────────────────────────────────────────

const APPROX_PREFIX = /(?:über|ca\.?|circa|mehr als|mindestens|bis zu|etwa|ungefähr)\s*/i;

function _toMinutes(numStr, unit) {
  const n = parseFloat(numStr.replace(',', '.'));
  if (/tage?n?/i.test(unit))             return Math.round(n * 24 * 60);
  if (/stunden?|std\.?|h\b/i.test(unit)) return Math.round(n * 60);
  if (/minuten?|min\.?\b/i.test(unit))   return Math.round(n);
  return 0;
}

function sumAllDurations(text) {
  if (!text) return 0;
  let remaining = text.replace(/\([^)]*(?:minuten?|min\.?|stunden?|std\.?|h\b|tage?)[^)]*\)/gi, ' ');
  remaining = remaining.replace(new RegExp(APPROX_PREFIX.source, 'gi'), ' ');
  let total = 0;
  const UNIT = '(?:tage?n?|stunden?|std\\.?|h\\b|minuten?|min\\.?\\b)';
  for (const m of remaining.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*[-–]\\s*(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    const avg = (parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) / 2;
    total += _toMinutes(String(avg), m[3]);
    remaining = remaining.replace(m[0], ' ');
  }
  for (const m of remaining.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    total += _toMinutes(m[1], m[2]);
    remaining = remaining.replace(m[0], ' ');
  }
  return Math.round(total);
}

function extractFirstDuration(text) {
  if (!text) return 0;
  const norm = text.replace(new RegExp(APPROX_PREFIX.source, 'gi'), ' ');
  const lower = norm.toLowerCase();
  const rangeM = lower.match(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(tage?n?|stunden?|std\.?|h\b|minuten?|min\.?\b)/);
  if (rangeM) {
    const avg = (parseFloat(rangeM[1]) + parseFloat(rangeM[2])) / 2;
    return _toMinutes(String(avg), rangeM[3]);
  }
  const dayM  = lower.match(/(\d+[,.]?\d*)\s*tage?n?/);
  const hourM = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const minM  = lower.match(/(\d+)\s*(?:minuten?|min\.?\b)/);
  if (dayM)  return _toMinutes(dayM[1],  'Tage');
  if (hourM) return _toMinutes(hourM[1], 'Stunden');
  if (minM)  return _toMinutes(minM[1],  'Minuten');
  return 0;
}

function isBakingStep(text) {
  return /\bbacken\b/i.test(text) && !/^\s*(?:den\s+)?backofen\b/i.test(text.trim());
}

function stepDuration(text, type) {
  if (type === 'Backen' || isBakingStep(text)) return sumAllDurations(text) || 45;
  if (type === 'Warten') return extractFirstDuration(text) || 60;
  return extractFirstDuration(text) || 0;
}

// ─── splitCompoundStep ───────────────────────────────────────────────────────

const WAIT_VERB_RE       = /(?:stehen|reifen|ruhen|gehen|rasten|quellen|kühlen|lagern|fermentieren|entspannen)\s+lassen/i;
const WAIT_VERB_NOLASSEN = /\b(?:lagern|kühlen|fermentieren)\b/i;
const TRANSITION_RE      = /^(?:anschließend|dann|danach|nun|jetzt|zuletzt|abschließend|zum\s+schluss)\b\s*/i;

function _isWait(text) {
  return WAIT_VERB_RE.test(text) || WAIT_VERB_NOLASSEN.test(text) || /über\s+nacht/i.test(text);
}

function _classify(text) {
  if (_isWait(text))                      return 'Warten';
  if (isBakingStep(text))                 return 'Backen';
  if (/vorheizen|aufheizen/i.test(text))  return 'Vorheizen';
  return 'Kneten';
}

function _cleanInstr(t) {
  return t.replace(/\s+und\.?\s*$/i, '').replace(/\.\s*$/, '').trim() + '.';
}

function _splitWaitChain(text, segments) {
  for (const part of text.split(/\s+und\s+(?:anschließend\s+|dann\s+|danach\s+)?/i)) {
    const p = part.replace(/\.\s*$/, '').trim();
    if (p.length > 3) segments.push({ text: p, type: _classify(p) });
  }
}

function _tokenize(text) {
  const sentences = text
    .split(/(?<=\.)\s+(?=[A-ZÄÖÜ0-9])|(?<![.])\s+(?=(?:Anschließend|Dann|Danach|Nun|Jetzt|Zuletzt|Abschließend)\b)/i)
    .map(s => s.trim()).filter(s => s.length > 3);

  const segments = [];
  for (const sentence of sentences) {
    const s = sentence.replace(TRANSITION_RE, '').trim();

    // Komma vor Wartezeit: "Aktion, ZEIT reifen lassen [und ZEIT lagern]"
    const commaM = s.match(/^(.{5,}?),\s*((?:.*?(?:reifen|stehen|ruhen|lagern|kühlen|fermentieren|quellen|rasten|gehen)\s*(?:lassen)?.*))$/i);
    if (commaM && _isWait(commaM[2])) {
      if (commaM[1].trim().length >= 5) segments.push({ text: commaM[1].trim(), type: 'Kneten' });
      _splitWaitChain(commaM[2].trim(), segments);
      continue;
    }

    // Letztes "und [WarteTeil]" – greedy damit "Wasser und Anstellgut" zusammenbleibt
    const undParts = s.split(/\s+und\s+/);
    if (undParts.length >= 2 && _isWait(undParts[undParts.length - 1])) {
      const action = undParts.slice(0, -1).join(' und ').trim();
      const wait   = undParts[undParts.length - 1].trim();
      if (action.length >= 5) segments.push({ text: action, type: _classify(action) });
      _splitWaitChain(wait, segments);
      continue;
    }

    segments.push({ text: sentence.trim(), type: _classify(s) });
  }
  return segments;
}

/**
 * Zerlegt einen zusammengesetzten Schritt in Einzel-Schritte.
 * @param {string} text
 * @returns {Array<{instruction: string, duration: number, type: string}>}
 */
function splitCompoundStep(text) {
  if (!text || text.length < 15) {
    const type = _classify(text || '');
    return [{ instruction: text || '', duration: stepDuration(text || '', type), type }];
  }

  const segments = _tokenize(text);
  if (segments.length <= 1) {
    const type = _classify(text);
    return [{ instruction: text, duration: stepDuration(text, type), type }];
  }

  // Aufeinanderfolgende Kneten-Segmente zusammenfassen
  const merged = [];
  let pending = null;
  for (const seg of segments) {
    if (seg.type !== 'Kneten') {
      if (pending) { merged.push(pending); pending = null; }
      merged.push(seg);
    } else {
      pending = pending
        ? { ...pending, text: pending.text.replace(/\.\s*$/, '') + '. ' + seg.text }
        : { ...seg };
    }
  }
  if (pending) merged.push(pending);

  return merged.map(({ text: t, type }) => ({
    instruction: _cleanInstr(t),
    duration: stepDuration(t, type),
    type
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

function detectPortionCount(text) {
  if (!text) return 1;
  const match = text.match(/[\/\(]\s*(\d+)\s*St(?:ück|k)\b/i)
    || text.match(/\b(\d+)\s*St(?:ück|k)\s+(?:zu je|je|à)/i)
    || text.match(/(\d+)\s*St(?:ück|k)[,\s]/i);
  if (match) {
    const n = parseInt(match[1]);
    return n >= 2 ? n : 1;
  }
  return 1;
}

function scaleSectionsToOnePortion(sections, portionCount) {
  if (!portionCount || portionCount <= 1) return sections;
  return sections.map(sec => ({
    ...sec,
    ingredients: sec.ingredients.map(ing => ({
      ...ing,
      amount: ing.amount ? Math.round((ing.amount / portionCount) * 10) / 10 : ing.amount
    }))
  }));
}

module.exports = {
  sumAllDurations,
  extractFirstDuration,
  isBakingStep,
  stepDuration,
  detectPortionCount,
  scaleSectionsToOnePortion,
  splitCompoundStep
};