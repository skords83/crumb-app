// scrapers/llm-refine.js
// LLM-basiertes Parsing für verschiedene Scraper
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_MODEL         = 'meta-llama/llama-3.3-70b-instruct:free';
const OPENROUTER_MODEL_FALLBACK = 'mistralai/mistral-small-3.1-24b-instruct:free';
const OPENROUTER_URL           = 'https://openrouter.ai/api/v1/chat/completions';

// ── SYSTEM PROMPTS ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_STEPS = `Du bist ein Experte für Brotbackrezepte. Du bekommst pro Teigphase einen Array von Rohtext-Schritten aus einem Rezept (oft von homebaking.at) und zerlegst jeden Rohtext in einzelne, sinnvolle Arbeitsschritte.

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
- Bei Zeitfenstern immer duration_min, duration_max UND duration (Durchschnitt) setzen
- Abgeschnittene oder unvollständige Sätze sinnvoll vervollständigen
- Gib NUR valides JSON zurück – kein Text, keine Erklärung, keine Markdown-Backticks

=== HOMEBAKING.AT SPEZIALREGELN ===

Regel 1 – TT / MZ / RZ Metadaten:
Zeilen wie "TT: 26-28°C     MZ: 3-4 Min.    RZ: 18-20 Stunden" enthalten Backkennzahlen:
- TT = Teigtemperatur → in die instruction des Misch-Schritts einbauen: "Zutaten zu einem Teig mischen (Teigtemperatur: 26-28°C)."
- MZ = Mischzeit/Knetzeit → eigener Kneten-Schritt pro Geschwindigkeit (siehe Regel 2 und 3)
- RZ = Reifezeit → eigener Warten-Schritt mit duration aus RZ-Wert
- Diese Zeilen NIEMALS ignorieren – sie sind die Hauptquelle für duration-Werte der Phase!

Regel 2 – MZ mit Schrägstrich (z.B. "MZ: 4/4 Min" oder "MZ: 7 / 5 Min"):
X/Y bedeutet X Minuten langsam, Y Minuten schnell → ZWEI separate Kneten-Schritte:
  1. { "instruction": "Teig 4 Minuten langsam mischen.", "duration": 4, "type": "Kneten" }
  2. { "instruction": "Teig 4 Minuten schnell auskneten.", "duration": 4, "type": "Kneten" }

Regel 3 – MZ ausgeschrieben mit mehreren Geschwindigkeiten:
"6-8 Minuten langsam und 5-6 Minuten schnell kneten" → ZWEI separate Kneten-Schritte:
  1. { "instruction": "Teig 6-8 Minuten langsam kneten.", "duration": 7, "duration_min": 6, "duration_max": 8, "type": "Kneten" }
  2. { "instruction": "Teig 5-6 Minuten schnell kneten.", "duration": 6, "duration_min": 5, "duration_max": 6, "type": "Kneten" }

Regel 4 – Erklärende Hinweissätze nach RZ:
Sätze wie "Der Vorteig hat seine volle Reife erreicht, wenn sich das Volumen verdreifacht hat." sind Hinweise, keine eigenen Schritte. Sie werden in die instruction des vorangehenden Warten-Schritts integriert:
{ "instruction": "Teig zugedeckt 6-8 Stunden reifen lassen. Reife ist erreicht, wenn sich das Volumen verdreifacht hat.", "duration": 420, "duration_min": 360, "duration_max": 480, "type": "Warten" }

Regel 5 – Auffrischungs-Phasen (mehrstufige Grundsauerführung):
Phasen wie "1. Vollsauer ansetzten" und "2. Weitere Auffrischungen" sind eigenständige Phasen mit eigenen Zutaten und TT/MZ/RZ-Angaben. Sie müssen vollständig mit allen Schritten ausgegeben werden, auch wenn sie strukturell identisch aussehen.

=== BACKZEIT-REGELN ===

- "Einschießen" ist aktive Handlung → type "Kneten", duration 0
- Danach folgt IMMER ein impliziter Backen-Schritt mit der Zeit bis zur nächsten Aktion
- "Temperatur reduzieren" ist aktive Handlung → type "Kneten", duration 0
- Danach Restback-Schritt → type "Backen", duration = Gesamtbackzeit minus vergangene Zeit
- Beispiel: "Teiglinge mit Schwaden einschießen. Nach 10 Minuten auf 195°C zurückschalten und ausbacken. Backzeit: 55 Minuten."
  → { "instruction": "Teiglinge mit reichlich Schwaden bei 250°C einschießen.", "duration": 0, "type": "Kneten" }
  → { "instruction": "10 Minuten bei 250°C anbacken.", "duration": 10, "type": "Backen" }
  → { "instruction": "Ofen auf 195°C zurückschalten.", "duration": 0, "type": "Kneten" }
  → { "instruction": "Bei 195°C knusprig ausbacken.", "duration": 45, "type": "Backen" }`;

const SYSTEM_PROMPT_FULL_RECIPE = `Du bist ein Experte für Brotbackrezepte. Du bekommst den Rohtext eines kompletten Rezepts und extrahierst daraus strukturierte Daten.

Ausgabe-Format: Ein JSON-Objekt mit:
- "title": string (Rezeptname)
- "description": string (kurze Beschreibung, max 300 Zeichen, leer wenn nicht vorhanden)
- "dough_sections": Array von Phasen

Jede Phase hat:
- "name": string (z.B. "Vorteig", "Hauptteig", "Sauerteig", "Poolish", "Kochstück")
- "is_parallel": boolean (true wenn Vorteig/Sauerteig/Poolish, false für Hauptteig)
- "ingredients": Array von { "amount": number, "unit": string, "name": string }
- "steps": Array von Step-Objekten

Jeder Step hat:
- "instruction": string (vollständiger Satz auf Deutsch)
- "duration": number (Minuten, 0 wenn keine Wartezeit)
- "duration_min": number (optional, bei Zeitfenster)
- "duration_max": number (optional, bei Zeitfenster)
- "type": "Kneten" | "Warten" | "Backen" | "Vorheizen"

Typen-Regeln:
- "Kneten" = aktive Handarbeit (mischen, falten, formen) – duration meist 0
- "Warten" = passive Ruhezeit (Teigruhe, Gare, Kühlschrank) – duration > 0
- "Backen" = im Ofen backen – duration > 0
- "Vorheizen" = Ofen vorheizen – duration = 0

Wichtige Regeln:
- Phasen sauber trennen: Vorteige (Poolish, Sauerteig, Kochstück) sind is_parallel: true
- Jede Zutat mit korrekter Menge (number), Einheit (g/ml/TL/EL etc.) und Namen
- Zeitangaben korrekt in Minuten umrechnen (1 Stunde = 60)
- Bei Zeitfenstern (z.B. "12-15 Stunden") duration_min, duration_max UND duration (Durchschnitt) setzen
- Backschritte aufteilen: Einschießen (Kneten, 0) → Anbacken (Backen, X min) → Temperatur reduzieren (Kneten, 0) → Ausbacken (Backen, Y min)
- Wenn der Text eine englische Übersetzung enthält: NUR den deutschen Teil verarbeiten
- Gib NUR valides JSON zurück – kein Text, keine Erklärung, keine Markdown-Backticks`;

// ── HTTP-HELPER ───────────────────────────────────────────────────────────────

async function callOpenRouter(model, systemPrompt, userPrompt, apiKey) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://crumb.skords.de',
      'X-Title': 'Crumb Recipe Scraper'
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  if (!raw) throw new Error('Leere Antwort vom Modell');

  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(clean);
  return parsed;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callWithFallback(systemPrompt, userPrompt, apiKey) {
  const models = [OPENROUTER_MODEL, OPENROUTER_MODEL_FALLBACK];

  for (const model of models) {
    // Bei 429: einmal kurz warten und nochmal versuchen
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await callOpenRouter(model, systemPrompt, userPrompt, apiKey);
        console.log(`  ✓ OpenRouter abgeschlossen (${model})`);
        return result;
      } catch (err) {
        const is429 = err.message.includes('429');
        if (is429 && attempt === 1) {
          console.warn(`  ⚠ ${model} rate-limited – warte 5s...`);
          await sleep(5000);
          continue;
        }
        console.warn(`  ⚠ Modell ${model} fehlgeschlagen: ${err.message.slice(0, 120)}`);
        break; // nächstes Modell
      }
    }
  }
  console.error('  ✗ Alle Modelle fehlgeschlagen');
  return null;
}

// ── ÖFFENTLICHE FUNKTIONEN ────────────────────────────────────────────────────

/**
 * Parst Roh-Schritttexte per LLM in strukturierte Step-Objekte.
 * Verwendet für: homebaking.at (Steps bereits nach Phasen sortiert)
 *
 * @param {Array<{name: string, rawSteps: string[]}>} phases
 * @param {string} apiKey
 * @returns {Promise<Array<{name: string, steps: object[]}> | null>}
 */
async function parseStepsWithLLM(phases, apiKey) {
  if (!apiKey) {
    console.warn('  ⚠ OPENROUTER_API_KEY nicht gesetzt – LLM-Schritt-Parsing übersprungen');
    return phases.map(p => ({ name: p.name, steps: [] }));
  }

  const userPrompt = `Zerlege diese Backschritte in einzelne Arbeitsschritte:\n${JSON.stringify(phases, null, 2)}`;
  const result = await callWithFallback(SYSTEM_PROMPT_STEPS, userPrompt, apiKey);
  return Array.isArray(result) ? result : null;
}

/**
 * Parst einen kompletten Rezept-Freitext per LLM.
 * Verwendet für: alte brotdoc.at-Rezepte, josemola.de
 *
 * @param {string} rawText  - Vollständiger Rezepttext (nur relevanter Teil, kein Nav/Footer)
 * @param {string} apiKey
 * @returns {Promise<{title, description, dough_sections} | null>}
 */
async function parseFullRecipeWithLLM(rawText, apiKey) {
  if (!apiKey) {
    console.warn('  ⚠ OPENROUTER_API_KEY nicht gesetzt – LLM-Vollrezept-Parsing übersprungen');
    return null;
  }

  const userPrompt = `Extrahiere das folgende Rezept als strukturiertes JSON:\n\n${rawText}`;
  const result = await callWithFallback(SYSTEM_PROMPT_FULL_RECIPE, userPrompt, apiKey);

  // Validierung
  if (!result || !Array.isArray(result.dough_sections)) return null;
  return result;
}

module.exports = { parseStepsWithLLM, parseFullRecipeWithLLM };