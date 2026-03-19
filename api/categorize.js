// categorize.js — Shared Kategorisierungs-Funktion

const PATTERNS = {
  broetchen: [
    /brötchen/, /broetchen/, /semmel/, /schrippe/,
    /\bweck\b/, /laugenstange/, /laugenbrezel/, /\bbrezel\b/,
    /\bbagel\b/, /ciabattini/, /\bbun\b/, /\brolls?\b/,
    /\bsimit\b/,
  ],
  pizza: [
    /\bpizza\b/, /focaccia/, /\bfladen\b/, /\bpinsa\b/,
    /\bpide\b/, /lahmacun/, /flammkuchen/, /schiacciata/,
  ],
  suesses: [
    /brioche/, /zimtschnecke/, /hefezopf/, /\bzopf\b/,
    /\bbabka\b/, /kardamom/, /kanelbolle/, /kardemumma/,
    /croissant/, /\bstollen\b/, /panettone/, /hefekuchen/,
    /\bbuchteln\b/, /rohrnudeln/, /\bberliner\b/, /\bkrapfen\b/,
    /\bdonut\b/, /doughnut/, /\bchurro/,
  ],
  cracker: [
    /\bcracker\b/, /knäckebrot/, /knackebrot/, /flatbread/,
    /\blavash\b/, /\bmatze\b/, /\bgrissini\b/, /crostini/,
  ],
  // Explizite Brot-Marker — verhindert Fallthrough bei eindeutigen Brot-Titeln
  brot: [
    /\bbrot\b/, /\bbrote\b/, /\blaib\b/, /kastenbrot/,
    /kruste/, /sauerteigbrot/, /vollkornbrot/, /mischbrot/,
    /toastbrot/, /\btoast\b/, /bauernbrot/, /schwarzbrot/,
    /weißbrot/, /graubrot/, /roggenbrot/, /dinkelbrot/,
    /haferbrot/, /emmer.*brot/, /brot.*emmer/,
  ],
};

/**
 * Kategorisiert ein Rezept anhand von Titel (Vorrang) und Phasennamen.
 * Zutaten werden bewusst nicht durchsucht — zu viel Rauschen.
 * @param {Object} recipe - { title, dough_sections }
 * @returns {'brot'|'broetchen'|'pizza'|'suesses'|'cracker'} Kategorie
 */
function categorizeRecipe(recipe) {
  const title = (recipe.title || '').toLowerCase();
  const sections = recipe.dough_sections || [];
  const phaseNames = sections.map((s) => (s.name || '').toLowerCase()).join(' ');

  // Titel hat absolute Priorität
  for (const [cat, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some(rx => rx.test(title))) return cat;
  }

  // Fallback: Phasennamen (ohne brot)
  for (const [cat, patterns] of Object.entries(PATTERNS)) {
    if (cat === 'brot') continue;
    if (patterns.some(rx => rx.test(phaseNames))) return cat;
  }

  return 'brot';
}

module.exports = { categorizeRecipe };