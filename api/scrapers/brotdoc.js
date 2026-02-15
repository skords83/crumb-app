const axios = require('axios');
const cheerio = require('cheerio');

const scrapeBrotdoc = async (url) => {
  try {
    const { data } = await axios.get(url.trim(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    const dough_sections = [];

    // 1. ZUTATEN-GRUPPEN EXTRAHIEREN
    $('.wprm-recipe-ingredient-group').each((_, group) => {
      const sectionName = $(group).find('.wprm-recipe-group-name').text().trim() || 'Hauptteig';
      const ingredients = [];

      $(group).find('.wprm-recipe-ingredient').each((_, ing) => {
        const amount = $(ing).find('.wprm-recipe-ingredient-amount').text().trim();
        const unit = $(ing).find('.wprm-recipe-ingredient-unit').text().trim();
        const name = $(ing).find('.wprm-recipe-ingredient-name').text().trim();
        const notes = $(ing).find('.wprm-recipe-ingredient-notes').text().trim();

        ingredients.push({
          amount: evalFraction(amount),
          unit: unit || 'g',
          name: notes ? `${name} (${notes})` : name
        });
      });

      dough_sections.push({
        name: sectionName,
        is_parallel: !sectionName.toLowerCase().includes('hauptteig') && !sectionName.toLowerCase().includes('backen'),
        ingredients: ingredients,
        steps: [] 
      });
    });

    // 2. ANWEISUNGEN MIT PARALLEL-LOGIK & PRÄZISER TYP-TRENNUNG
    let currentSectionIdx = 0;
    const instructions = $('.wprm-recipe-instruction-text');
    
    const waitKeywords = [
      'reifen', 'ruhen', 'gehen', 'gare', 'stockgare', 'stückgare', 
      'abkühlen', 'quellen', 'rasten', 'entspannen', 'kühlschrank', 'autolyse'
    ];

    instructions.each((i, el) => {
      const text = $(el).text().trim();
      const lowerText = text.toLowerCase();
      
      // --- ZEIT-ERKENNUNG (Mittelwert bei Spannen) ---
      // Stunden-Spannen (z.B. "10-14 Std")
      const hourMatch = lowerText.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:std|h|stunden)/i);
      // Minuten-Spannen (z.B. "20-30 Min")
      const minMatch = lowerText.match(/(\d+)(?:\s*(?:bis|zu|-)\s*(\d+))?\s*(?:min)/i);
      
      let duration = 10; 
      let isLongFermentation = false;

      if (hourMatch) {
        const h1 = parseInt(hourMatch[1]);
        const h2 = hourMatch[2] ? parseInt(hourMatch[2]) : h1;
        duration = ((h1 + h2) / 2) * 60; 
        if (duration >= 120 && waitKeywords.some(kw => lowerText.includes(kw))) {
            isLongFermentation = true;
        }
      } else if (minMatch) {
        const m1 = parseInt(minMatch[1]);
        const m2 = minMatch[2] ? parseInt(minMatch[2]) : m1;
        duration = (m1 + m2) / 2;
      }

      // --- TYP-ERKENNUNG ---
      let calculatedType = 'Aktion'; 

      if (lowerText.includes('backen') || lowerText.includes('ofen')) {
        calculatedType = 'Backen';
      } 
      else if (
        waitKeywords.some(kw => lowerText.includes(kw)) || 
        (duration > 25 && !lowerText.includes('kneten') && !lowerText.includes('mischen'))
      ) {
        calculatedType = 'Warten';
      }

      // --- SEKTIONS-LOGIK ---
      dough_sections.forEach((sec, idx) => {
        if (lowerText.includes(sec.name.toLowerCase()) && idx > currentSectionIdx) {
          currentSectionIdx = idx;
        }
      });

      if (dough_sections[currentSectionIdx]) {
        dough_sections[currentSectionIdx].steps.push({
          instruction: text,
          duration: duration,
          type: calculatedType
        });
      }

      // --- PHASEN-VORSCHUB ---
      if (isLongFermentation && currentSectionIdx < dough_sections.length - 1) {
          const currentSection = dough_sections[currentSectionIdx];
          if (currentSection.is_parallel) {
              currentSectionIdx++;
          }
      }
    });

    // --- VERBESSERTER BILD-IMPORT MIT PRIO AUF LARGE ---
    let imageUrl = '';

    // Prio 1: Gezielte Suche nach "size-large" (Deine Entdeckung)
    const largeImage = $('.wp-block-image.size-large img').first();
    
    // Prio 2: Falls nicht da, allgemein nach Galerie/Inhalt suchen
    const fallbackImage = !largeImage.length ? $('.wp-block-gallery img, .wp-block-image img, .wp-entry-content img').first() : largeImage;
    
    if (fallbackImage.length) {
      const srcset = fallbackImage.attr('srcset');
      if (srcset) {
        const sources = srcset.split(',').map(s => {
          const part = s.trim().split(' ');
          return { url: part[0], width: parseInt(part[1]) || 0 };
        });
        // Sortiere nach Breite absteigend und nimm das größte
        const bestSource = sources.sort((a, b) => b.width - a.width)[0];
        imageUrl = bestSource.url;
      }
      
      // Falls kein srcset existiert, nimm die Standard-Attribute
      if (!imageUrl) {
        imageUrl = fallbackImage.attr('data-lazy-src') || fallbackImage.attr('src');
      }
    }

    // Prio 3: Letzter Fallback auf das WPRM-eigene Vorschaubild
    if (!imageUrl || imageUrl.includes('150x150')) {
      const wprmImg = $('.wprm-recipe-image img');
      imageUrl = wprmImg.attr('data-lazy-src') || wprmImg.attr('src');
    }

    // WordPress-Thumbnail-Bereinigung (Sicherheitsnetz)
    if (imageUrl) {
      imageUrl = imageUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, '');
    }

    return {
      title: $('.wprm-recipe-name').text().trim() || $('h1').text().trim(),
      description: $('.wprm-recipe-summary').text().trim(),
      image_url: imageUrl,
      source_url: url,
      dough_sections: dough_sections.filter(s => s.ingredients.length > 0 || s.steps.length > 0)
    };
  } catch (error) {
    console.error("Brotdoc Scraper Error:", error.message);
    return null;
  }
};

function evalFraction(amount) {
  if (!amount) return 0;
  let cleanAmount = amount.replace(',', '.').trim();
  if (cleanAmount.includes('/')) {
    const parts = cleanAmount.split('/');
    if (parts.length === 2) return parseFloat(parts[0]) / parseFloat(parts[1]);
  }
  return parseFloat(cleanAmount) || 0;
}

module.exports = scrapeBrotdoc;