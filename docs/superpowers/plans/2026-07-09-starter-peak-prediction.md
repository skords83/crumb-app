# Ergänzung zum Starter-Tracker-Plan: Peak-Vorhersage + UI-Politur

Bezug: `2026-07-06-starter-tracker.md` (Tasks 1–15), „Zielprofil-Sichtbarkeit"
(Tasks 16–17), `2026-07-09-starter-plan-adherence-addendum.md` (Tasks 18–19,
Plantreue).

## Hintergrund

Zwei unabhängige Ergänzungen:

1. **Peak-Vorhersage** auf der Starter-Detailseite: ein Zeitfenster, wann der
   nächste Aktivitäts-Peak erwartet wird. Bewusst **keine** neue manuelle
   Eingabe (kein Peak-Klick) — aus denselben Gründen, die bereits gegen einen
   manuellen Peak-Klick bei der Plantreue-Kennzahl sprachen (Nutzer pflegen
   sowas erfahrungsgemäß nicht konsistent). Stattdessen zwei Datenquellen mit
   klarer Fallback-Hierarchie:
   - **Regel-basiert** (Fallback, immer verfügbar): fester Zeitbereich aus dem
     aktiven Zielprofil.
   - **Daten-basiert** (sobald genug Historie vorhanden): Median der
     Fütterungsabstände, gefiltert auf Fütterungen mit hohem
     `activity_rating`, als Näherung für "Fütterung erfolgte nahe am Peak".
   - **Explizit als Heuristik kommuniziert, nicht als Messung.** Kein Wort wie
     "berechnet" oder "erkannt" in der UI — nur "Richtwert" bzw. "basierend
     auf deinen letzten Fütterungen".

2. **UI-Politur** auf der bestehenden Detailseite: Entfernen eines ungenutzten
   Formularfelds, visuelle Überarbeitung des Aktivitäts-Sliders, und ein
   Zwei-Spalten-Layout für breitere Viewports, damit Desktop-Nutzer nicht
   scrollen müssen.

## Task 20: `api/starter-peak.js` — `predictNextPeak()`

**Files:** `api/starter-peak.js` (neu), `api/starters.js` (modify: `GET /:id`)

1. Neue reine Funktion, analog zu `calculateHealth` / `calculatePlanAdherence`.
   Nutzt `target_profile_at_feeding` (aus Task 18) statt des aktuellen
   Zielprofils, damit ein Profilwechsel die Historie nicht verfälscht —
   gleiches Prinzip wie bei Plantreue.

   ```js
   const { TARGET_PROFILES } = require('./starter-profiles');
   const PROFILE_BY_KEY = Object.fromEntries(TARGET_PROFILES.map(p => [p.profile_key, p]));

   const MIN_CYCLES_FOR_DATA_BASED = 3;
   const HIGH_ACTIVITY_THRESHOLD = 7;

   function predictNextPeak(feedings, currentProfileKey) {
     const profile = PROFILE_BY_KEY[currentProfileKey];
     if (!profile) return null;

     // feedings kommt sortiert nach fed_at DESC (neueste zuerst) - für den
     // Intervall-Vergleich brauchen wir chronologische Reihenfolge
     // (aufsteigend), gleiches Muster wie calculatePlanAdherence.
     const chronological = feedings
       .slice()
       .sort((a, b) => new Date(a.fed_at) - new Date(b.fed_at));

     const lastFeeding = chronological[chronological.length - 1];
     if (!lastFeeding) return null;
     const lastFedAt = new Date(lastFeeding.fed_at);

     // Nur Zeilen mit Snapshot + hohem Aktivitäts-Rating: Näherung für
     // "Fütterung erfolgte nahe am Peak". Kein Beweis, nur Heuristik.
     const highActivityGaps = [];
     for (let i = 1; i < chronological.length; i++) {
       const prev = chronological[i - 1];
       const curr = chronological[i];
       if (
         curr.target_profile_at_feeding === currentProfileKey &&
         curr.activity_rating != null &&
         curr.activity_rating >= HIGH_ACTIVITY_THRESHOLD
       ) {
         const hours = (new Date(curr.fed_at) - new Date(prev.fed_at)) / 36e5;
         if (hours > 0) highActivityGaps.push(hours);
       }
     }

     if (highActivityGaps.length >= MIN_CYCLES_FOR_DATA_BASED) {
       highActivityGaps.sort((a, b) => a - b);
       const median = percentile(highActivityGaps, 50);
       const p25 = percentile(highActivityGaps, 25);
       const p75 = percentile(highActivityGaps, 75);
       return {
         source: 'historical',
         windowStart: addHours(lastFedAt, p25),
         windowEnd: addHours(lastFedAt, p75),
         median: addHours(lastFedAt, median),
       };
     }

     // Fallback: feste Profil-Regel, Fenster = Soll-Intervall des Profils.
     const { feeding_interval_hours_min: min, feeding_interval_hours_max: max } = profile;
     return {
       source: 'profile_rule',
       windowStart: addHours(lastFedAt, min),
       windowEnd: addHours(lastFedAt, max),
       median: null,
     };
   }

   function percentile(sortedArr, p) {
     const idx = (p / 100) * (sortedArr.length - 1);
     const lower = Math.floor(idx);
     const upper = Math.ceil(idx);
     if (lower === upper) return sortedArr[lower];
     return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
   }

   function addHours(date, hours) {
     return new Date(date.getTime() + hours * 36e5);
   }

   module.exports = { predictNextPeak };
   ```

2. `GET /api/starters/:id`: `predictNextPeak(feedingsRes.rows, starterRow.target_profile)`
   aufrufen und als `next_peak_prediction` in die Response mergen (Objekt mit
   `source`, `window_start`, `window_end`, `median` — oder `null` bei fehlenden
   Feedings/Profil).

**Verify:**
- Starter ohne Feedings → `next_peak_prediction: null`.
- Starter mit < 3 hoch-aktiven Feedings im aktuellen Profil → `source: 'profile_rule'`,
  Fenster = Profil-Intervall ab letzter Fütterung.
- Starter mit ≥ 3 hoch-aktiven Feedings im aktuellen Profil → `source: 'historical'`,
  Fenster aus 25./75. Perzentil, `median` gesetzt.
- Profilwechsel zwischen Feedings → nur Feedings mit `target_profile_at_feeding`
  gleich dem *aktuellen* Profil zählen in die Historie; alte Feedings unter
  anderem Profil werden nicht mitgezählt (frisches Sammeln von Historie nach
  jedem Wechsel, kein Cross-Profil-Mischen).

**Commit:** `feat(starters): add next-peak-window prediction`

## Task 21: Detailseite — Peak-Box, entferntes Feld, Slider-Redesign, Zwei-Spalten-Layout

**Files:** `ui/src/app/starters/[id]/page.tsx` (modify),
`ui/src/components/starters/FeedingForm.tsx` (modify, falls als eigene
Komponente ausgelagert)

1. **Peak-Box** in der Zielprofil-Karte, unterhalb der Profil-Stat-Grid,
   oberhalb der Profil-Beschreibung. Zeigt `window_start`–`window_end` als
   lokale Uhrzeit (heute/morgen-Präfix je nach Datum), plus relative Angabe
   ("in ~5h") aus der Differenz zu `now()`. Text hängt von `source` ab:
   - `profile_rule` → Label "Richtwert laut Zielprofil"
   - `historical` → Label "Basierend auf deinen letzten Fütterungen"
   - `null` (keine Daten/kein Profil) → Box wird nicht gerendert, kein
     Platzhaltertext nötig.

   Icon: Trend-/Peak-Symbol (siehe Mockup), kein neues Farbschema — nutzt
   bestehende `--brand`-Akzentfarbe.

2. **Entferntes Feld:** `Verworfen (g, optional)` aus dem Fütterungsformular
   entfernen (Feld, Label, zugehöriger State/Formular-Handler). Prüfen, ob
   `discard_grams` serverseitig noch anderswo referenziert wird (z. B. in
   `calculatePlanAdherence` — dort **nicht** verwendet, siehe Addendum Task 19,
   also unkritisch) bevor das Feld komplett verschwindet. Backend-Spalte
   `discard_grams` bleibt in der DB bestehen (nullable, keine Migration nötig)
   — nur das UI-Feld verschwindet, `POST /:id/feedings` sendet es künftig
   einfach nicht mehr mit.

3. **Slider-Redesign:** Aktivitäts-Slider (0–10) bekommt statt Emoji-Enden
   zwei kleine runde Icon-Chips unterhalb des Tracks (ruhig/aktiv-Symbol,
   siehe Mockup) plus Text-Label darunter ("ruhig" / "aktiv"). Reine
   CSS/Markup-Änderung, keine Logikänderung am Rating selbst.

4. **Zwei-Spalten-Layout** ab Viewport-Breite > 860px: linke Spalte =
   Starter-Übersicht-Karte + Zielprofil-Karte (inkl. neuer Peak-Box), rechte
   Spalte = Fütterungsformular-Karte + Historie-Karte. Unterhalb 860px
   Breite (Mobile) fällt das Layout auf eine Spalte zurück, Reihenfolge bleibt
   wie bisher (Übersicht → Profil → Formular → Historie). Umsetzung als CSS
   Grid mit `grid-template-columns: 380px 1fr` oberhalb des Breakpoints,
   `1fr` darunter — kein JS nötig, reine Media Query.

**Verify:**
- Starter mit `next_peak_prediction: null` → keine Peak-Box sichtbar, Rest der
  Zielprofil-Karte unverändert.
- Starter mit `source: 'profile_rule'` → Box zeigt "Richtwert laut Zielprofil"
  + Zeitfenster aus Profil-Intervall.
- Starter mit `source: 'historical'` → Box zeigt "Basierend auf deinen
  letzten Fütterungen" + engeres, datenbasiertes Fenster.
- Fütterungsformular zeigt kein "Verworfen"-Feld mehr, `POST` schickt kein
  `discard_grams` mehr mit, Server akzeptiert das weiterhin (Feld war schon
  optional).
- Viewport > 860px: zwei sichtbare Spalten, kein vertikales Scrollen bei
  Standard-Fensterhöhe (≥ 900px) nötig, um alle vier Karten zu sehen.
- Viewport ≤ 860px: eine Spalte, Reihenfolge wie zuvor, kein horizontales
  Scrollen.

**Commit:** `feat(starters): add peak prediction, streamline feeding form, two-column layout`

---

## Selbstprüfung

- **Kein erfundener Wissenschafts-Anspruch:** Peak-Fenster ist explizit als
  Richtwert/Heuristik gekennzeichnet, nie als "berechnet" oder "erkannt".
  Die Kern-Annahme ("hohe Aktivität bei Fütterung ≈ Fütterung nahe am Peak")
  ist eine Näherung, keine Messung — das wird über die Perzentil-Fensterbreite
  (statt eines einzelnen Zeitpunkts) in der UI sichtbar gemacht.
- **Kein neuer Eingabe-Zwang:** bewusst kein manueller Peak-Klick, konsistent
  mit der Entscheidung bei Plantreue.
- **Profilwechsel-Robustheit:** wie bei Plantreue nutzt die Historie
  `target_profile_at_feeding`, sodass ein Profilwechsel keine alten Zyklen
  fälschlich mit dem neuen Profil vermischt.
- **Offen/bewusst nicht gelöst:** Die Schwellenwerte (`MIN_CYCLES_FOR_DATA_BASED = 3`,
  `HIGH_ACTIVITY_THRESHOLD = 7`) sind, wie schon bei Plantreue die
  Gewichtungen, eine gesetzte Design-Entscheidung ohne empirische Herleitung —
  sollte bei Bedarf später anhand echter Nutzungsdaten nachjustiert werden,
  nicht als validierter Wert kommuniziert werden.
