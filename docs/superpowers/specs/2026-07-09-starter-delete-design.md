# Sourdough-Starter löschen — Design

## Kontext & Ziel

Der Starter-Tracker (siehe `2026-07-06-starter-tracker-design.md`) erlaubt bisher
kein Löschen eines Starters über die UI. Dieses Feature fügt einen Lösch-Button
auf der Starter-Detailseite hinzu.

**Wichtiger Befund aus der Bestandsaufnahme:** Ein `DELETE /api/starters/:id`
Endpoint existiert bereits (`api/starters.js:158-173`). Er ist ein Soft-Delete
(setzt `archived_at = NOW()`), korrekt user-gescoped
(`WHERE id = $1 AND user_id = $2`), IDOR-sicher. Alle bestehenden Reads
(`GET /`, `GET /:id`, `PATCH /:id`, `GET /:id/feedings`) filtern bereits
`archived_at IS NULL`, d.h. ein archivierter Starter verschwindet vollständig
aus Liste, Detailansicht und Fütterungshistorie.

**Entscheidung (mit User abgestimmt):** Soft-Delete wird beibehalten, kein
Hard-Delete. Begründung: kein Datenverlust, keine Migrations-/Cascade-Entscheidung
für `bake_sessions.starter_id` nötig (das FK hat aktuell kein `ON DELETE`, ein
Hard-Delete würde bei verknüpften Bake-Sessions mit FK-Fehler abbrechen — das
Risiko entfällt komplett bei Soft-Delete).

Damit ist dieses Feature reine Frontend-Arbeit: Backend-Endpoint existiert und
ist bereits korrekt.

## Scope

✅ Lösch-Button (Trash2-Icon) auf der Starter-Detailseite
✅ Bestätigungsdialog vor dem Löschen
✅ Aufruf des bestehenden `DELETE /api/starters/:id`
✅ Redirect zur Starter-Übersicht nach Erfolg
✅ Inline-Fehlermeldung bei fehlgeschlagenem Löschen

❌ Kein neuer Backend-Endpoint, keine Migration
❌ Kein Hard-Delete, keine Cascade-Logik für `bake_sessions`
❌ Kein neues Toast-System (Redirect selbst ist das Erfolgs-Feedback,
  analog zum bestehenden Lösch-Pattern auf `recipes/[id]/page.tsx`)
❌ Keine "Restore"/"Wiederherstellen"-UI für archivierte Starter (out of scope,
  könnte als separates Feature später ergänzt werden)

## Implementierung

**Datei:** `ui/src/app/starters/[id]/page.tsx`

1. **State:** `showDeleteConfirm` (boolean), `isDeleting` (boolean),
   `deleteError` (string)
2. **Trigger-Button:** Trash2-Icon (lucide-react, bereits im Projekt genutzt)
   in der obersten Karte neben `starter.name`, öffnet den Bestätigungsdialog
3. **Bestätigungsdialog:** Inline-Modal-Komponente in der Datei, analog zu
   `DeleteConfirmModal` in `recipes/[id]/page.tsx`, aber mit dem
   Cremeton-Farbschema der Starter-Seiten (`bg-white dark:bg-gray-800`,
   `border-[#D6C9B4] dark:border-gray-700`, `text-[#2C1A0E] dark:text-white`):
   - Titel: "Starter wirklich löschen?"
   - Text: "Diese Aktion kann nicht rückgängig gemacht werden."
   - Abbrechen-Button: neutraler Card-Stil (wie bestehende Buttons auf der Seite)
   - Löschen-Button: bestehende Rot-Konvention aus `BakeHistory.tsx`
     (`text-red-500`, `bg-red-50 dark:bg-red-900/20`,
     `border-red-200 dark:border-red-800`) — im Projekt bereits etabliert für
     Lösch-Aktionen, hier wiederverwendet statt neu erfunden
4. **`handleDelete`:** ruft `apiFetch(`${API_URL}/starters/${id}`, { method: 'DELETE' })`
   auf (gleiches Helper-Pattern wie der Rest der Seite, siehe `handleFeed`).
   - Erfolg → `router.push('/starters')`
   - Fehler → `deleteError` setzen, Dialog bleibt offen, Fehlertext wird im
     Dialog angezeigt (gleiches Pattern wie der `error`-State beim
     Fütterungsformular)

## Testing

- Manuelles Durchklicken: Button → Dialog → Abbrechen (Dialog schließt, kein
  Request) → Button → Dialog → Löschen bestätigen → Redirect zu `/starters`,
  Starter nicht mehr in der Liste
- IDOR-Check: bereits durch bestehenden Endpoint abgedeckt, keine neue
  Backend-Logik zu testen
