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

/**
 * Wie extractFirstDuration, gibt aber { duration, duration_min, duration_max } zurück.
 * duration_min/max sind nur gesetzt wenn ein echtes Zeitfenster erkannt wurde.
 */
function extractDurationRange(text) {
  if (!text) return { duration: 0 };
  const norm = text.replace(new RegExp(APPROX_PREFIX.source, 'gi'), ' ');
  const lower = norm.toLowerCase();
  const rangeM = lower.match(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(tage?n?|stunden?|std\.?|h\b|minuten?|min\.?\b)/);
  if (rangeM) {
    const min = _toMinutes(rangeM[1], rangeM[3]);
    const max = _toMinutes(rangeM[2], rangeM[3]);
    const duration = Math.round((min + max) / 2);
    return { duration, duration_min: min, duration_max: max };
  }
  const dayM  = lower.match(/(\d+[,.]?\d*)\s*tage?n?/);
  const hourM = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const minM  = lower.match(/(\d+)\s*(?:minuten?|min\.?\b)/);
  if (dayM)  return { duration: _toMinutes(dayM[1],  'Tage') };
  if (hourM) return { duration: _toMinutes(hourM[1], 'Stunden') };
  if (minM)  return { duration: _toMinutes(minM[1],  'Minuten') };
  return { duration: 0 };
}

function isBakingStep(text) {
  return /\b(?:backen|ausbacken|anbacken)\b/i.test(text) && !/^\s*(?:den\s+)?backofen\b/i.test(text.trim());
}

function stepDuration(text, type) {
  if (type === 'Backen' || isBakingStep(text)) return sumAllDurations(text) || 45;
  if (type === 'Warten') return extractFirstDuration(text) || 60;
  return extractFirstDuration(text) || 0;
}

/**
 * Wie stepDuration, gibt aber { duration, duration_min?, duration_max? } zurück.
 */
function stepDurationRange(text, type) {
  if (type === 'Backen' || isBakingStep(text)) {
    return { duration: sumAllDurations(text) || 45 };
  }
  if (type === 'Warten') {
    const r = extractDurationRange(text);
    return r.duration ? r : { duration: 60 };
  }
  const r = extractDurationRange(text);
  return r.duration ? r : { duration: 0 };
}

// ─── splitCompoundStep ───────────────────────────────────────────────────────

const WAIT_VERB_RE       = /(?:stehen|reifen|ruhen|gehen|rasten|quellen|kühlen|lagern|fermentieren|entspannen)\s+lassen/i;
const WAIT_VERB_NOLASSEN = /\b(?:lagern|kühlen|fermentieren)\b/i;
const WAIT_NOUN_RE       = /\b(?:reifezeit|ruhezeit|gehzeit|rastzeit|stockgare|stückgare|endgare|kühlzeit)\b/i;
const TRANSITION_RE      = /^(?:anschließend|dann|danach|nun|jetzt|zuletzt|abschließend|zum\s+schluss)\b\s*/i;

// Reifezeit-Appendix am Satzende, auch mit Teigtemperatur-Prefix:
// "... / Reifezeit 3 Stunden." oder "Teigtemperatur 28°C / Reifezeit 3 Stunden"
const REIFEZEIT_APPENDIX_RE = /[\s/|–\-]+(?:gewünschte\s+teigtemperatur[^/]*\/\s*)?(?:reifezeit|ruhezeit|gehzeit|rastzeit|stockgare|stückgare|gare(?:zeit)?|kühlzeit)\s*:?\s*[\d].*/i;

function _isWait(text) {
  return WAIT_VERB_RE.test(text) || WAIT_VERB_NOLASSEN.test(text)
    || /über\s+nacht/i.test(text)
    || WAIT_NOUN_RE.test(text);
}

function _classify(text) {
  if (_isWait(text))                      return 'Warten';
  if (isBakingStep(text))                 return 'Backen';
  if (/vorheizen|aufheizen/i.test(text))  return 'Vorheizen';
  return 'Kneten';
}

function _cleanInstr(t) {
  return t
    .replace(/\s+und\.?\s*$/i, '')         // hängendes "und" am Ende
    .replace(/(\.\s*)(anschließend\b)/i, ' $2')  // "und. anschließend" → "und anschließend"
    .replace(/\.\s*$/, '')
    .trim() + '.';
}

function _splitWaitChain(text, segments) {
  for (const part of text.split(/\s+und\s+(?:anschließend\s+|dann\s+|danach\s+)?/i)) {
    const p = part.replace(/\.\s*$/, '').trim();
    if (p.length > 3) segments.push({ text: p, type: _classify(p) });
  }
}

function _tokenize(text) {
  const sentences = text
    .split(/(?<!(?:ca|min|std|bzw|ca|mind|max|inkl|bspw))\.\s+(?=[A-ZÄÖÜ0-9])|(?<!(?:ca|min|std|bzw|mind|max|inkl|bspw))\.\s+(?=(?:anschließend|dann|danach|nun|jetzt|zuletzt|abschließend)\b)|(?<![.])\s+(?=(?:Anschließend|Dann|Danach|Nun|Jetzt|Zuletzt|Abschließend)\b)/i)
    .map(s => s.trim()).filter(s => s.length > 3);

  const segments = [];
  for (const sentence of sentences) {
    // Transition-Wort nur entfernen wenn der Satz *selbst* damit beginnt –
    // nicht wenn es ein Satzrest nach einem internen Split ist (z.B. "Danach lässt man...")
    const startsWithTransition = TRANSITION_RE.test(sentence.trimStart());
    const s = startsWithTransition ? sentence.replace(TRANSITION_RE, '').trim() : sentence.trim();

    // Reifezeit-Appendix: "Aktion. Reifezeit 3 Stunden." oder "Aktion / Reifezeit 3 Std."
    // Auch mit Teigtemperatur-Prefix: "Aktion. Gewünschte Teigtemperatur 28°C / Reifezeit 3 Std."
    const reifezeitM = s.match(/^(.{10,?}?)\s*[.!]?\s*((?:(?:gewünschte\s+)?teigtemperatur[^/\.]*[/\\|]\s*)?(?:reifezeit|ruhezeit|gehzeit|rastzeit|stockgare|stückgare|gare(?:zeit)?|kühlzeit)\s*:?\s*[\d].*)$/i);
    if (reifezeitM) {
      const action = reifezeitM[1].trim();
      const wait   = reifezeitM[2].trim();
      if (action.length >= 5) segments.push({ text: action, type: _classify(action) });
      segments.push({ text: wait, type: 'Warten' });
      continue;
    }

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
      // Pronomen-Reste am Anfang des Warte-Teils entfernen ("diesen", "ihn", "es", "sie")
      const wait = undParts[undParts.length - 1].trim()
        .replace(/^(?:diesen?|ihn|es|sie|den\s+teig)\s+/i, '');
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
// Erkennt ob ein Text eine Backphase beschreibt
const BACKZEIT_RE  = /\b(?:backzeit|gesamtbackzeit)\b/i;
const BACKEN_BROAD = /\b(?:gebacken|backen|ausbacken|anbacken|einschießen|schwaden|backrohr)\b/i;

function _isBakingBlock(text) {
  const hasBakenSignal = BACKEN_BROAD.test(text) || BACKZEIT_RE.test(text);
  if (!hasBakenSignal || !/\d/.test(text)) return false;
  // Reines Vorheizen ohne echtes Backen ausschließen
  const hasRealBaking = /\b(?:gebacken|backen|ausbacken|anbacken|einschießen|schwaden|backzeit|gesamtbackzeit)\b/i.test(text);
  if (!hasRealBaking && /\b(?:vorheizen|aufheizen)\b/i.test(text)) return false;
  return true;
}
// Extrahiert die explizite Backzeit ("Backzeit 55 Minuten", "Gesamtbackzeit 65 Min")
// Fallback: größte einzelne Zeitangabe im Text (nicht Summe)
function _bakingDuration(text) {
  const m = text.match(/\b(?:backzeit|gesamtbackzeit)\s*:?\s*(?:ca\.?\s*)?(\d+)\s*(?:minuten?|min\.?\b)/i);
  if (m) return parseInt(m[1]);
  const UNIT = String.raw`(?:tage?n?|stunden?|std\.?|h\b|minuten?|min\.?\b)`;
  let max = 0;
  for (const rm of text.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*[-\u2013]\\s*(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    const avg = (parseFloat(rm[1]) + parseFloat(rm[2])) / 2;
    max = Math.max(max, _toMinutes(String(avg), rm[3]));
  }
  for (const sm of text.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    max = Math.max(max, _toMinutes(sm[1], sm[2]));
  }
  return max || 45;
}

function splitCompoundStep(text) {
  if (!text || text.length < 15) {
    const type = _classify(text || '');
    const dr = stepDurationRange(text || '', type);
    return [{ instruction: text || '', ...dr, type }];
  }

  if (_isBakingBlock(text)) {
    return [{ instruction: text.trim(), duration: _bakingDuration(text), type: 'Backen' }];
  }

  const segments = _tokenize(text);
  if (segments.length <= 1) {
    const type = _classify(text);
    const dr = stepDurationRange(text, type);
    return [{ instruction: text, ...dr, type }];
  }

  // Aufeinanderfolgende Kneten-Segmente zusammenfassen –
  // aber NUR wenn das pending-Segment keine eigene Zeitangabe hat (sonst eigenständiger Schritt)
  const merged = [];
  let pending = null;
  for (const seg of segments) {
    if (seg.type !== 'Kneten') {
      if (pending) { merged.push(pending); pending = null; }
      merged.push(seg);
    } else {
      if (pending && extractFirstDuration(pending.text) > 0) {
        // pending hat eigene Dauer → eigenständig lassen, neues pending starten
        merged.push(pending);
        pending = { ...seg };
      } else {
        pending = pending
          ? { ...pending, text: pending.text.replace(/\.\s*$/, '') + '. ' + seg.text }
          : { ...seg };
      }
    }
  }
  if (pending) merged.push(pending);

  return merged.map(({ text: t, type }) => {
    const dr = stepDurationRange(t, type);
    return { instruction: _cleanInstr(t), ...dr, type };
  });
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

/**
 * Stellt sicher dass eine Bild-URL https:// verwendet.
 * Verhindert Mixed-Content-Fehler wenn der Scraper http:// zurückliefert.
 */
function ensureHttps(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/^http:\/\//i, 'https://');
}

module.exports = {
  sumAllDurations,
  extractFirstDuration,
  extractDurationRange,
  isBakingStep,
  stepDuration,
  stepDurationRange,
  detectPortionCount,
  scaleSectionsToOnePortion,
  splitCompoundStep,
  ensureHttps
};