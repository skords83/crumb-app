// scrapers/llm-refine.js
// LLM-basiertes Schritt-Parsing für homebaking.at
// Bekommt Roh-Texte der Herstellungsschritte und gibt fertige Step-Objekte zurück.
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_MODEL = 'google/gemma-3-27b-it:free';
const OPENROUTER_URL   = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `Du bist ein Experte für Brotbackrezepte. Du bekommst pro Teigphase einen Array von Rohtext-Schritten aus einem Rezept und zerlegst jeden Rohtext in einzelne, sinnvolle Arbeitsschritte.

Ausgabe-Format: Ein JSON-Array von Phasen. Jede Phase hat "name" und "steps".
Jeder Step hat:
- "instruction": string (vollständiger, sinnvoller Satz auf Deutsch)
- "duration": number (Minuten als ganze Zahl, 0 wenn keine Wartezeit)
- "duration_min": number (optional, nur bei echtem Zeitfenster z.B. "12-15 Stunden")
- "duration_max": number (optional, nur bei echtem Zeitfenster)
- "type": "Kneten" | "Warten" | "Backen" | "Vorheizen"

Typen-Regeln:
- "Kneten" = aktive Handarbeit (mischen, falten, formen, aufarbeiten) – duration meist 0
- "Warten" = passive Ruhezeit (Teigruhe, Gare, Kühlschrank, Reifezeit, akklimatisieren) – duration > 0
- "Backen" = aktiv im Ofen backen – duration = verbleibende Backzeit in Minuten
- "Vorheizen" = Ofen vorheizen – duration = 0

Wichtige Regeln:
- Jeden Rohtext in so viele Schritte aufteilen wie sinnvoll (Aktion + Wartezeit = 2 Schritte)
- Zeitangaben aus dem Text korrekt in Minuten umrechnen (1 Stunde = 60, 12-15 Stunden = duration_min:720, duration_max:900, duration:810)
- Bei Zeitfenstern (z.B. "12-15 Stunden") immer duration_min, duration_max UND duration (Durchschnitt) setzen
- Abgeschnittene oder unvollständige Sätze sinnvoll vervollständigen
- Gib NUR valides JSON zurück – kein Text, keine Erklärung, keine Markdown-Backticks

Spezialregel Kneten mit mehreren Geschwindigkeiten:
- "6-8 Minuten langsam und 5-6 Minuten schnell kneten" → ZWEI separate Kneten-Schritte:
  1. { instruction: "Teig 6-8 Minuten langsam kneten.", duration: 7, duration_min: 6, duration_max: 8, type: "Kneten" }
  2. { instruction: "Teig 5-6 Minuten schnell kneten, bis er sich von den Schüsselwänden löst.", duration: 5, duration_min: 5, duration_max: 6, type: "Kneten" }
- Jede Knetphase mit eigener Geschwindigkeit oder Zeitangabe ist ein eigener Schritt.

Spezialregel Backzeit:
- "Einschießen" (Teigling in den Ofen schieben) ist eine aktive Handlung → type "Kneten", duration 0
- Danach folgt IMMER ein impliziter Backen-Schritt mit der Zeit bis zur nächsten Aktion (z.B. Temperatur reduzieren) – dieser Schritt steht nicht explizit im Text, muss aber ergänzt werden
- "Temperatur reduzieren" ist selbst eine aktive Handlung → type "Kneten", duration 0
- Danach folgt der Restback-Schritt → type "Backen", duration = Gesamtbackzeit minus bereits vergangene Zeit
- Beispiel: "Die reifen Teiglinge mit Schwaden in den Ofen schieben. Backtemperatur nach 10 Minuten auf 210°C reduzieren und kräftig ausbacken. Backzeit: 35-40 Minuten."
  → Schritt 1: { instruction: "Die reifen Teiglinge mit kräftigen Schwaden in den Ofen schieben.", duration: 0, type: "Kneten" }
  → Schritt 2: { instruction: "10 Minuten bei Anbacktemperatur backen.", duration: 10, type: "Backen" }
  → Schritt 3: { instruction: "Backtemperatur auf 210°C reduzieren.", duration: 0, type: "Kneten" }
  → Schritt 4: { instruction: "Bei 210°C kräftig ausbacken.", duration: 27, duration_min: 25, duration_max: 30, type: "Backen" }
- Die Gesamtbackzeit (35-40 Min) minus die bereits vergangene Zeit (10 Min) ergibt die Restbackzeit (25-30 Min).`;

/**
 * Parst Roh-Schritttexte per LLM in strukturierte Step-Objekte.
 *
 * @param {Array<{name: string, rawSteps: string[]}>} phases
 * @param {string} apiKey - process.env.OPENROUTER_API_KEY
 * @returns {Promise<Array<{name: string, steps: object[]}>>}
 */
async function parseStepsWithLLM(phases, apiKey) {
  if (!apiKey) {
    console.warn('  ⚠ OPENROUTER_API_KEY nicht gesetzt – LLM-Schritt-Parsing übersprungen');
    return phases.map(p => ({ name: p.name, steps: [] }));
  }

  const userPrompt = `Zerlege diese Backschritte in einzelne Arbeitsschritte:\n${JSON.stringify(phases, null, 2)}`;

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
      return null;
    }

    const data = await res.json();
    raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) {
      console.warn('  ⚠ OpenRouter: leere Antwort');
      return null;
    }

    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(clean);
    console.log('  ✓ OpenRouter Schritt-Parsing abgeschlossen');
    return Array.isArray(parsed) ? parsed : null;

  } catch (err) {
    console.error('  ✗ OpenRouter Parsing fehlgeschlagen:', err.message);
    if (raw) console.error('  Raw response:', raw.slice(0, 300));
    return null;
  }
}

module.exports = { parseStepsWithLLM };