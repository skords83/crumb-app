// scrapers/llm-refine.js
// Optionaler Post-Processing-Schritt: Groq korrigiert Backschritte
// die der Regex-Parser nicht sauber aufgelöst hat.
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_MODEL = 'google/gemma-3-27b-it:free';
const OPENROUTER_URL   = 'https://openrouter.ai/api/v1/chat/completions';

// ── Quality-Gate ─────────────────────────────────────────────────────────────

function _needsRefinement(steps) {
  for (const step of steps) {
    const instr = step.instruction || '';

    // Abgeschnittener Satz: beginnt mit Kleinbuchstabe
    if (/^[a-zäöü]/.test(instr)) return true;

    // Sehr kurzer Satz der wahrscheinlich ein Fragment ist
    if (instr.replace(/\.$/, '').trim().split(/\s+/).length < 4) return true;

    // Schritt hat Zeitangabe im Text aber duration = 0
    if (step.duration === 0 && /\d+\s*(?:minuten?|min\.?|stunden?|std\.?|h\b|tage?)/i.test(instr)) return true;

    // Warte-Verb im Text aber type = Kneten
    if (step.type === 'Kneten' && /(?:stehen|reifen|ruhen|gehen|rasten|quellen|kühlen|lagern|fermentieren)\s+lassen/i.test(instr)) return true;
  }
  return false;
}

function needsRefinement(dough_sections) {
  return dough_sections.some(sec => _needsRefinement(sec.steps));
}

// ── Groq-Call ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist ein Experte für Brotbackrezepte. Du bekommst automatisch geparste Backschritte als JSON-Array und korrigierst sie.

Regeln:
- Behalte ALLE Schritte – lösche nichts, füge nichts hinzu
- Korrigiere nur: abgeschnittene Sätze (vervollständige sie sinnvoll auf Deutsch), falsche Typen, fehlende oder falsche Zeitangaben
- "duration" ist immer in Minuten (ganze Zahl, 0 wenn keine Wartezeit)
- Erlaubte Typen: "Kneten", "Warten", "Backen", "Vorheizen"
- "Kneten" = aktive Handarbeit ohne Wartezeit
- "Warten" = Teigruhe, Gare, Kühlschrank, Reifezeit
- "Backen" = im Ofen backen (nicht Vorheizen)
- "Vorheizen" = Ofen vorheizen
- Wenn ein Schritt sowohl Aktion als auch Wartezeit beschreibt, behalte ihn als einen Schritt mit dem dominanten Typ
- Gib NUR ein valides JSON-Array zurück – kein Text, keine Erklärung, keine Markdown-Backticks
- Das Array hat genau so viele Objekte wie die Eingabe`;

async function refineWithOpenRouter(dough_sections, apiKey) {
  if (!apiKey) {
    console.warn('  ⚠ OPENROUTER_API_KEY nicht gesetzt – LLM-Refinement übersprungen');
    return dough_sections;
  }

  const sectionsForLLM = dough_sections.map(sec => ({
    name: sec.name,
    steps: sec.steps.map(({ instruction, duration, duration_min, duration_max, type }) => ({
      instruction,
      duration,
      ...(duration_min !== undefined ? { duration_min } : {}),
      ...(duration_max !== undefined ? { duration_max } : {}),
      type
    }))
  }));

  const userPrompt = `Korrigiere diese Backschritte und gib ein JSON-Array zurück:\n${JSON.stringify(sectionsForLLM, null, 2)}`;

  let raw = '';
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://crumb.skords.de',
        'X-Title': 'Crumb Recipe Scraper'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt }
        ]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  ✗ OpenRouter API Fehler ${res.status}:`, err.slice(0, 200));
      return dough_sections;
    }

    const data = await res.json();
    raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) {
      console.warn('  ⚠ OpenRouter: leere Antwort');
      return dough_sections;
    }

    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const refined = JSON.parse(clean);

    return dough_sections.map((sec, i) => {
      const refinedSec = Array.isArray(refined) ? refined[i] : null;
      if (!refinedSec || !Array.isArray(refinedSec.steps)) {
        console.warn(`  ⚠ OpenRouter: keine Schritte für Phase "${sec.name}" – Original behalten`);
        return sec;
      }
      return { ...sec, steps: refinedSec.steps };
    });

  } catch (err) {
    console.error('  ✗ OpenRouter Refinement fehlgeschlagen:', err.message);
    if (raw) console.error('  Raw response:', raw.slice(0, 300));
    return dough_sections;
  }
}

// ── Haupt-Export ──────────────────────────────────────────────────────────────

/**
 * Verbessert geparste Backschritte mit Groq wenn nötig.
 * Gibt immer dough_sections zurück – im Fehlerfall das Original.
 *
 * @param {Array} dough_sections  - Ergebnis des Regex-Parsers
 * @param {string} apiKey         - process.env.GROQ_API_KEY
 * @returns {Promise<Array>}
 */
async function refineSections(dough_sections, apiKey) {
  if (!needsRefinement(dough_sections)) {
    console.log('  ✓ LLM-Refinement nicht nötig (Qualität OK)');
    return dough_sections;
  }

  console.log('  → Qualitätsprobleme erkannt – OpenRouter wird aufgerufen...');
  const result = await refineWithOpenRouter(dough_sections, apiKey);
  console.log('  ✓ OpenRouter Refinement abgeschlossen');
  return result;
}

module.exports = { refineSections, needsRefinement };