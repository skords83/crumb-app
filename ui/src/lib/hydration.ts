export const FLOUR_KEYWORDS = [
  'mehl', 'schrot', 'flocken', 'kleie', 'grieß', 'stärke',
  'dinkel', 'roggen', 'weizen', 'emmer', 'einkorn', 'kamut',
  'hirse', 'buchweizen', 'hafer', 'biga', 'poolish',
];

export const WATER_KEYWORDS = ['wasser', 'milch'];

// Zutaten die auf Vorteig/Sauerteig-Phasen verweisen – nicht doppelt zählen
const PREFERM_SKIP_RE = /\b(sauerteig|biga|poolish|levain|vorteig|starter|anstellgut)\b|sauer$/i;

export const calcHydration = (sections: any[]): number | null => {
  let flour = 0, water = 0;
  sections?.forEach(sec => {
    sec.ingredients?.forEach((ing: any) => {
      const name = (ing.name || '').toLowerCase();
      const amount = parseFloat(String(ing.amount || '0').replace(',', '.'));
      if (isNaN(amount) || amount === 0) return;
      if (PREFERM_SKIP_RE.test(name)) {
        console.log('SKIP:', name, amount);
        return;
      }
      if (FLOUR_KEYWORDS.some(k => name.includes(k))) { console.log('MEHL:', name, amount); flour += amount; }
      if (WATER_KEYWORDS.some(k => name.includes(k))) { console.log('WASSER:', name, amount); water += amount; }
    });
  });
  console.log('flour:', flour, 'water:', water);
  if (flour === 0) return null;
  return Math.round((water / flour) * 100);
};