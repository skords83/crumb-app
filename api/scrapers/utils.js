// scrapers/utils.js – Gemeinsame Hilfsfunktionen für alle Scraper
// ─────────────────────────────────────────────────────────────

/**
 * Summiert ALLE Zeitangaben im Text.
 * Wichtig für Backschritte wie:
 * "Nach 20 Min. Dampf ablassen und weitere 50 Min. backen." → 70 Min.
 *
 * Unterstützt:
 * - Einzel-Minuten:  "30 Min.", "30 Minuten"
 * - Einzel-Stunden:  "2 Std.", "2 Stunden", "2h"
 * - Ranges Minuten:  "45-50 Min." → Mittelwert 47,5 → 48
 * - Ranges Stunden:  "2-3 Std." → Mittelwert 2,5 → 150 Min.
 */
function sumAllDurations(text) {
  if (!text) return 0;
  let remaining = text;
  let total = 0;

  // 1. Stunden-Ranges zuerst (damit "2-3 Std." nicht als zwei einzelne Zahlen gezählt wird)
  for (const m of remaining.matchAll(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/gi)) {
    total += ((parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) / 2) * 60;
    remaining = remaining.replace(m[0], ' ');
  }
  // 2. Einzelne Stunden
  for (const m of remaining.matchAll(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/gi)) {
    total += Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    remaining = remaining.replace(m[0], ' ');
  }
  // 3. Minuten-Ranges
  for (const m of remaining.matchAll(/(\d+)\s*[-–]\s*(\d+)\s*(?:minuten?|min\.?\b)/gi)) {
    total += (parseInt(m[1]) + parseInt(m[2])) / 2;
    remaining = remaining.replace(m[0], ' ');
  }
  // 4. Einzelne Minuten
  for (const m of remaining.matchAll(/(\d+)\s*(?:minuten?|min\.?\b)/gi)) {
    total += parseInt(m[1]);
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
  const lower = text.toLowerCase();

  const hourRange = lower.match(/(\d+[,.]?\d*)\s*[-–]\s*(\d+[,.]?\d*)\s*(?:stunden?|std\.?)/);
  if (hourRange) return Math.round(((parseFloat(hourRange[1].replace(',', '.')) + parseFloat(hourRange[2].replace(',', '.'))) / 2) * 60);

  const hour = lower.match(/(\d+[,.]?\d*)\s*(?:stunden?|std\.?|h\b)/);
  const minRange = lower.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:minuten?|min\.?\b)/);
  const min = lower.match(/(\d+)\s*(?:minuten?|min\.?\b)/);

  let total = 0;
  if (hour)     total += Math.round(parseFloat(hour[1].replace(',', '.')) * 60);
  if (minRange) total += (parseInt(minRange[1]) + parseInt(minRange[2])) / 2;
  else if (min) total += parseInt(min[1]);

  return Math.round(total);
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

module.exports = { sumAllDurations, extractFirstDuration, isBakingStep, stepDuration };