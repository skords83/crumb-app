/**
 * Konfigurierbare Farbzuordnung für Rezept-Kategorien.
 *
 * Jeder DB-Wert (z.B. "brot") wird auf ein Label, eine Rand-/Akzentfarbe
 * und jeweils eine Textfarbe für Light- und Dark-Mode gemappt.
 *
 * Die borderColor wird für den linken Seitenstreifen der Karte verwendet,
 * textLight/textDark für die Untertitelzeile "Kategorie · quelle.de".
 *
 * Zum Anpassen: einfach Hex-Werte ändern oder neue Kategorien hinzufügen.
 */

export interface CategoryStyle {
  label: string;
  borderColor: string;   // linker Seitenstreifen
  textLight: string;     // Untertitel-Farbe im Light Mode
  textDark: string;      // Untertitel-Farbe im Dark Mode
}

export const CATEGORY_COLORS: Record<string, CategoryStyle> = {
  brot: {
    label: 'Brot',
    borderColor: '#8a9a6a',
    textLight: '#5a6e3a',
    textDark: '#8a9a6a',
  },
  broetchen: {
    label: 'Brötchen',
    borderColor: '#c4956a',
    textLight: '#96683a',
    textDark: '#c4956a',
  },
  pizza: {
    label: 'Pizza & Fladen',
    borderColor: '#b89a60',
    textLight: '#8a7030',
    textDark: '#b89a60',
  },
  suesses: {
    label: 'Süßes Gebäck',
    borderColor: '#c27a8a',
    textLight: '#9a4a5a',
    textDark: '#c27a8a',
  },
  cracker: {
    label: 'Knäcke & Cracker',
    borderColor: '#7a8a6a',
    textLight: '#556648',
    textDark: '#7a8a6a',
  },
};

/**
 * Gibt den Kategorie-Style zurück, oder null wenn nicht vorhanden.
 */
export function getCategoryStyle(category: string | null | undefined): CategoryStyle | null {
  if (!category) return null;
  return CATEGORY_COLORS[category] ?? null;
}

/**
 * Hydration-Farbskala: Blautöne von hell (niedrig) bis dunkel (hoch).
 * Gibt einen Hex-Farbwert zurück.
 */
export function getHydrationColor(hydration: number): { light: string; dark: string } {
  if (hydration <= 55)  return { light: '#5b9fc7', dark: '#7cb5d4' };  // niedrig
  if (hydration <= 70)  return { light: '#4a8ab5', dark: '#a0b8d0' };  // mittel
  if (hydration <= 90)  return { light: '#3a75a0', dark: '#7ca0c0' };  // hoch
  return                       { light: '#2a6090', dark: '#5a8ab0' };  // sehr hoch
}
