// categorize.js — Shared Kategorisierungs-Funktion
// Wird beim Scrapen/Import und im Migration-Script verwendet.
// Gibt eine der folgenden Kategorien zurück:
//   'brot' | 'broetchen' | 'pizza' | 'suesses' | 'cracker'

const KEYWORDS = {
  broetchen: [
    'brötchen', 'broetchen', 'semmel', 'schrippe', 'weck', 'wecken',
    'bun', 'buns', 'roll ', 'rolls', 'laugenstange', 'laugenbrezel',
    'brezel', 'bagel', 'ciabattini',
  ],
  pizza: [
    'pizza', 'focaccia', 'fladen', 'fladenbrot', 'pinsa', 'pide',
    'lahmacun', 'tarte flambée', 'flammkuchen', 'schiacciata',
  ],
  suesses: [
    'brioche', 'zimtschnecke', 'zimtschnecken', 'hefezopf', 'zopf',
    'babka', 'kardamom', 'kanelbolle', 'kardemumma', 'croissant',
    'pain au', 'danish', 'cinnamon', 'stollen', 'panettone',
    'colomba', 'hefekuchen', 'streusel', 'buchteln', 'rohrnudeln',
    'berliner', 'krapfen', 'donut', 'doughnut', 'churro',
  ],
  cracker: [
    'cracker', 'knäckebrot', 'knackebrot', 'flatbread', 'lavash',
    'matze', 'matzah', 'grissini', 'chips', 'crostini',
  ],
};

/**
 * Kategorisiert ein Rezept anhand von Titel, Phasennamen und Zutaten.
 * @param {Object} recipe - { title, dough_sections }
 * @returns {string} Kategorie
 */
function categorizeRecipe(recipe) {
  const title = (recipe.title || '').toLowerCase();
  const sections = recipe.dough_sections || [];

  // Alle Phasennamen + Zutaten als durchsuchbaren String
  const sectionContent = JSON.stringify(sections).toLowerCase();

  // Titel hat Vorrang — er beschreibt das Endprodukt am direktesten
  for (const [cat, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some(kw => title.includes(kw))) {
      return cat;
    }
  }

  // Fallback: Phasennamen und Zutaten durchsuchen
  for (const [cat, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some(kw => sectionContent.includes(kw))) {
      return cat;
    }
  }

  // Default: Brot — größte Kategorie, sicherer Fallback
  return 'brot';
}

module.exports = { categorizeRecipe };
