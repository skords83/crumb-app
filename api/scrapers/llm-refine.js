// scrapers/llm-refine.js
// Optionaler Post-Processing-Schritt: Gemini Flash korrigiert Backschritte
// die der Regex-Parser nicht sauber aufgelöst hat.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Quality-Gate ─────────────────────────────────────────────────────────────
// Prüft ob die Schritte einer Phase LLM-Korrektur brauchen.
// Gibt true zurück wenn mindestens eines der Kriterien zutrifft.

function _needsRefinement(steps) {
  for (const step of steps) {
    const instr = step.instruction || '';

    // Abgeschnittener Satz: beginnt mit Kleinbuchstabe (kein Eigenname, keine Zahl)
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

// Gibt true zurück wenn mindestens eine Phase Korrektur braucht
function needsRefinement(dough_sections) {
  return dough_sections.some(sec => _needsRefinement(sec.steps));
}

// ── Gemini-Call ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist ein Experte für Brotbackrezepte. Du bekommst automatisch geparste Backschritte als JSON und korrigierst sie.

Regeln:
- Behalte alle Schritte – lösche nichts, füge nichts hinzu
- Korrigiere nur: abgeschnittene Sätze (vervollständige sie sinnvoll), falsche Typen, fehlende oder falsche Zeitangaben
- "duration" ist immer in Minuten (ganze Zahl)
- Erlaubte Typen: "Kneten", "Warten", "Backen", "Vorheizen"
- "Kneten" = aktive Handarbeit ohne Wartezeit
- "Warten" = Teigruhe, Gare, Kühlschrank, Reifezeit
- "Backen" = im Ofen backen (nicht Vorheizen)
- "Vorheizen" = Ofen vorheizen
- Wenn ein Schritt sowohl Aktion als auch Wartezeit beschreibt, behalte ihn als einen Schritt mit dem dominanten Typ
- Gib NUR valides JSON zurück – kein Text, keine Erklärung, keine Markdown-Backticks`;

async function refineWithGemini(dough_sections, apiKey) {
  if (!apiKey) {
    console.warn('  ⚠ GEMINI_API_KEY nicht gesetzt – LLM-Refinement übersprungen');
    return dough_sections;
  }

  // Nur Schritte an Gemini schicken, Zutaten bleiben unverändert
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

  const userPrompt = `Korrigiere diese Backschritte:\n${JSON.stringify(sectionsForLLM, null, 2)}`;

  let raw = '';
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.1,       // möglichst deterministisch
          responseMimeType: 'application/json'
        }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  ✗ Gemini API Fehler ${res.status}:`, err.slice(0, 200));
      return dough_sections;
    }

    const data = await res.json();
    raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) {
      console.warn('  ⚠ Gemini: leere Antwort');
      return dough_sections;
    }

    // JSON parsen – Backticks entfernen falls Gemini sie doch hinzufügt
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const refined = JSON.parse(clean);

    // Ergebnis zurückmergen: Schritte ersetzen, Zutaten und Metadaten behalten
    return dough_sections.map((sec, i) => {
      const refinedSec = Array.isArray(refined) ? refined[i] : refined?.sections?.[i];
      if (!refinedSec || !Array.isArray(refinedSec.steps)) {
        console.warn(`  ⚠ Gemini: keine Schritte für Phase "${sec.name}" – Original behalten`);
        return sec;
      }
      return { ...sec, steps: refinedSec.steps };
    });

  } catch (err) {
    console.error('  ✗ Gemini Refinement fehlgeschlagen:', err.message);
    if (raw) console.error('  Raw response:', raw.slice(0, 300));
    return dough_sections; // Fallback: Regex-Ergebnis unverändert zurückgeben
  }
}

// ── Haupt-Export ──────────────────────────────────────────────────────────────

/**
 * Verbessert geparste Backschritte mit Gemini Flash wenn nötig.
 * Gibt immer dough_sections zurück – im Fehlerfall das Original.
 *
 * @param {Array} dough_sections  - Ergebnis des Regex-Parsers
 * @param {string} apiKey         - process.env.GEMINI_API_KEY
 * @returns {Promise<Array>}
 */
async function refineSections(dough_sections, apiKey) {
  if (!needsRefinement(dough_sections)) {
    console.log('  ✓ LLM-Refinement nicht nötig (Qualität OK)');
    return dough_sections;
  }

  console.log('  → Qualitätsprobleme erkannt – Gemini Flash wird aufgerufen...');
  const result = await refineWithGemini(dough_sections, apiKey);
  console.log('  ✓ Gemini Refinement abgeschlossen');
  return result;
}

module.exports = { refineSections, needsRefinement };
