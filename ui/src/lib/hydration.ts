export const FLOUR_KEYWORDS = ['mehl', 'schrot', 'flocken', 'kleie', 'grieß', 'stärke', 'dinkel', 'roggen', 'weizen', 'emmer', 'einkorn', 'kamut', 'hirse', 'buchweizen', 'hafer'];
export const WATER_KEYWORDS = ['wasser', 'milch'];
export const PREFERMENT_RE = /sauerteig|biga|poolish|levain|vorteig|starter|anstellgut|sauer$/i;

type Ingredient = { name?: string; amount?: string | number; unit?: string; hydration_percent?: string | number };
type Section = { name?: string; ingredients?: Ingredient[] };
const normalize = (value: string) => value.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');

export function hydrationDetails(sections: Section[] = []) {
  let flour = 0, water = 0, incomplete = false;
  const warnings = new Set<string>();
  for (const section of sections) {
    for (const ing of section.ingredients || []) {
      const name = (ing.name || '').toLowerCase();
      const preferment = PREFERMENT_RE.test(name);
      // An ingredient referring to another recipe phase is already represented
      // by that phase's individual ingredients. Never count it twice.
      if (preferment && sections.some(other => other !== section && other.name && PREFERMENT_RE.test(other.name) &&
        (normalize(name).includes(normalize(other.name)) || normalize(other.name).includes(normalize(name))))) continue;
      const milk = name.includes('milch');
      const liquid = milk || name.includes('wasser');
      const isFlour = !liquid && FLOUR_KEYWORDS.some(k => name.includes(k));
      if (!preferment && !liquid && !isFlour) continue;
      const amount = Number(String(ing.amount ?? '').trim().replace(',', '.'));
      const unit = (ing.unit || 'g').trim().toLowerCase();
      if (!Number.isFinite(amount) || amount < 0 || ing.amount === '' || ing.amount === undefined) {
        incomplete = true; warnings.add(`Menge für „${ing.name}“ fehlt oder ist ungültig.`); continue;
      }
      if (amount === 0) continue;
      let grams: number;
      if (['g', 'gramm'].includes(unit)) grams = amount;
      else if (['kg', 'kilogramm'].includes(unit)) grams = amount * 1000;
      else if (liquid && ['ml', 'l', 'cl', 'dl'].includes(unit)) {
        grams = amount * ({ ml: 1, l: 1000, cl: 10, dl: 100 }[unit] || 1) * (milk ? 1.03 : 1);
      } else { incomplete = true; warnings.add(`Einheit „${unit}“ für „${ing.name}“ nicht in Gramm umrechenbar.`); continue; }
      if (!ing.unit) warnings.add('Fehlende Einheiten werden als Gramm angenommen.');
      if (preferment) {
        const hydration = ing.hydration_percent === undefined || ing.hydration_percent === '' ? 100 : Number(ing.hydration_percent);
        if (!Number.isFinite(hydration) || hydration < 0) { incomplete = true; warnings.add('Ungültige Starter-Hydration.'); continue; }
        if (ing.hydration_percent === undefined || ing.hydration_percent === '') warnings.add('Separater Starter/Vorteig: 100 % Hydration angenommen; im Rezept anpassbar.');
        flour += grams / (1 + hydration / 100);
        water += grams * hydration / (100 + hydration);
      } else if (milk) {
        water += grams * 0.87;
        warnings.add('Milch: Wasseranteil mit 87 %, bei Volumenangaben Dichte mit 1,03 g/ml geschätzt.');
      } else if (liquid) water += grams;
      else flour += grams;
    }
  }
  return { value: !incomplete && flour > 0 ? Math.round(water / flour * 100) : null,
    approximate: warnings.size > 0, warnings: [...warnings] };
}

export const calcHydration = (sections: Section[]): number | null => hydrationDetails(sections).value;
