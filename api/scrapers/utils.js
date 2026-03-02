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