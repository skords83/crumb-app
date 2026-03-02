// scrapers/utils.js – Gemeinsame Hilfsfunktionen für alle Scraper
// ─────────────────────────────────────────────────────────────

// Wort-Zahlen und Annäherungs-Präfixe ("über 2 Tage", "ca. 3 Stunden", "mehr als 12 Stunden")
const APPROX_PREFIX = /(?:über|ca\.?|circa|mehr als|mindestens|bis zu|etwa|ungefähr)\s*/i;

// Hilfsfunktion: wandelt eine Zahl (als String, inkl. Komma) in Minuten um
function _toMinutes(numStr, unit) {
  const n = parseFloat(numStr.replace(',', '.'));
  if (/tage?n?/i.test(unit))    return Math.round(n * 24 * 60);
  if (/stunden?|std\.?|h\b/i.test(unit)) return Math.round(n * 60);
  if (/minuten?|min\.?\b/i.test(unit))   return Math.round(n);
  return 0;
}

/**
 * Summiert ALLE Zeitangaben im Text.
 * Wichtig für Backschritte wie:
 * "Nach 20 Min. Dampf ablassen und weitere 50 Min. backen." → 70 Min.
 *
 * Unterstützt:
 * - Einzel-Minuten:  "30 Min.", "30 Minuten"
 * - Einzel-Stunden:  "2 Std.", "2 Stunden", "2h"
 * - Einzel-Tage:     "2 Tage", "über 2 Tage" → 2880 Min.
 * - Ranges Minuten:  "45-50 Min." → Mittelwert 47,5 → 48
 * - Ranges Stunden:  "2-3 Std." → Mittelwert 2,5 → 150 Min.
 * - Ranges Tage:     "1-2 Tage" → Mittelwert 1,5 → 2160 Min.
 * - Annäherungen:    "über 2 Tage", "ca. 3 Stunden", "mehr als 12 Stunden"
 */
function sumAllDurations(text) {
  if (!text) return 0;
  // Normalisiere Annäherungs-Präfixe weg (ersetzen durch Leerzeichen)
  let remaining = text.replace(new RegExp(APPROX_PREFIX.source, 'gi'), ' ');
  let total = 0;
  const UNIT = '(?:tage?n?|stunden?|std\\.?|h\\b|minuten?|min\\.?\\b)';

  // 1. Ranges: "2-3 Tage/Stunden/Minuten"
  for (const m of remaining.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*[-–]\\s*(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    const avg = (parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) / 2;
    total += _toMinutes(String(avg), m[3]);
    remaining = remaining.replace(m[0], ' ');
  }
  // 2. Einzelwerte: "2 Tage", "3 Stunden", "30 Minuten"
  for (const m of remaining.matchAll(new RegExp(`(\\d+[,.]?\\d*)\\s*(${UNIT})`, 'gi'))) {
    total += _toMinutes(m[1], m[2]);
    remaining = remaining.replace(m[0], ' ');
  }

  return Math.round(total);
}

/**
 * Einfache Duration-Extraktion: nur die ERSTE / dominante Zeitangabe.
 * Für Warte-/Aktionsschritte wo nur eine Zeit relevant ist.
 * Für Backschritte sumAllDurations() verwenden.
 */
function extractFirstDuration(text) {
  if (!text) return 0;
  // Normalisiere Annäherungs-Präfixe
  const norm = text.replace(new RegExp(APPROX_PREFIX.source, 'gi'), ' ');
  const lower = norm.toLowerCase();
  const UNIT = '(?:tage?n?|stunden?|std\\.?|h\\b|minuten?|min\\.?\\b)';

  // Range zuerst
  const rangeM = lower.match(new RegExp(`(\\d+[,.]?\\d*)\\s*[-–]\\s*(\\d+[,.]?\\d*)\\s*(${UNIT})`));
  if (rangeM) {
    const avg = (parseFloat(rangeM[1].replace(',', '.')) + parseFloat(rangeM[2].replace(',', '.'))) / 2;
    return _toMinutes(String(avg), rangeM[3]);
  }

  // Einzelwert – größte Einheit zuerst (Tage > Stunden > Minuten)
  const dayM  = lower.match(/(\d+[,.]?\d*)\s*tage?n?/);
  const hourM = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const minM  = lower.match(/(\d+)\s*(?:minuten?|min\.?\b)/);

  if (dayM)  return _toMinutes(dayM[1], 'Tage');
  if (hourM) return _toMinutes(hourM[1], 'Stunden');
  if (minM)  return _toMinutes(minM[1], 'Minuten');
  return 0;
}

/**
 * Erkennt ob ein Schritt ein Backschritt ist.
 * "backen" als Verb – aber NICHT "Backofen" oder "vorheizen" allein.
 */
function isBakingStep(text) {
  return /\bbacken\b/i.test(text) && !/^\s*(?:den\s+)?backofen\b/i.test(text.trim());
}

/**
 * Bestimmt die Duration für einen Schritt:
 * - Backschritt → sumAllDurations (alle Zeiten addieren)
 * - Sonst       → extractFirstDuration
 */
function stepDuration(text, type) {
  if (type === 'Backen' || isBakingStep(text)) return sumAllDurations(text) || 45;
  return extractFirstDuration(text) || 10;
}

/**
 * Erkennt die Stückzahl aus einem Portionshinweis-Text.
 * Typische Formate bei Homebaking.at:
 *   "für ein Teiggewicht von 1773g / 2 Stück je 886g Teigeinlage"
 *   "für ein Teiggewicht von 834g / 2 Stück – 417g Teigeinlage"
 *   "für ein Teiggewicht von 1938g / 3 Stück zu je 646g"
 *   "für ein Teiggewicht von 910g ( 2 Stück zu je 455g)"
 *   "Rezept für ein Teiggewicht von 2422g / 3Stk 807g"
 *
 * Gibt die Anzahl der Stücke zurück (2, 3, ...) oder 1 wenn kein Mehrfachrezept.
 */
function detectPortionCount(text) {
  if (!text) return 1;
  // Muster: "/", "(", "von" gefolgt von Zahl + "Stück"/"Stk"
  const match = text.match(/[\/\(]\s*(\d+)\s*St(?:ück|k)\b/i)
    || text.match(/\b(\d+)\s*St(?:ück|k)\s+(?:zu je|je|à)/i)
    || text.match(/(\d+)\s*St(?:ück|k)[,\s]/i);
  if (match) {
    const n = parseInt(match[1]);
    return n >= 2 ? n : 1;
  }
  return 1;
}

/**
 * Skaliert alle Zutatenmenngen in dough_sections auf 1 Portion.
 * Teilt jede amount durch portionCount.
 * Gibt ein neues Array zurück (kein Mutate).
 */
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

module.exports = { sumAllDurations, extractFirstDuration, isBakingStep, stepDuration, detectPortionCount, scaleSectionsToOnePortion };