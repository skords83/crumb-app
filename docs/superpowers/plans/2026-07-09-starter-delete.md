# Starter Löschen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a delete action for sourdough starters on the starter detail page, using the DELETE /api/starters/:id endpoint that already exists.

**Architecture:** Frontend-only change. `DELETE /api/starters/:id` (`api/starters.js:158-173`) already soft-deletes a starter (`archived_at = NOW()`) with correct user-scoping and IDOR protection, and every read query already filters `archived_at IS NULL`. No backend or migration work is needed — this plan wires a delete button, a confirmation modal, and the API call into `ui/src/app/starters/[id]/page.tsx`.

**Tech Stack:** Next.js App Router, React (client component), TypeScript, Tailwind CSS, lucide-react icons.

## Global Constraints

- No backend changes. Do not touch `api/starters.js` or add a migration — the existing soft-delete endpoint is the one this plan calls.
- No new toast/notification system. Redirect to `/starters` is the success feedback (per spec, matches the existing pattern in `ui/src/app/recipes/[id]/page.tsx`).
- Destructive-action color must reuse the existing red convention already used in `ui/src/components/BakeHistory.tsx`: `text-red-500`, `bg-red-50 dark:bg-red-900/20`, `border-red-200 dark:border-red-800`. Do not introduce a new color token.
- Confirmation dialog copy is fixed: title "Starter wirklich löschen?", body "Diese Aktion kann nicht rückgängig gemacht werden."
- This project has no frontend test framework (no Jest/RTL, no `test` script in `ui/package.json`). Verification is via `tsc --noEmit` and manual browser walkthrough, per this repo's CLAUDE.md instruction to test UI changes in a browser before reporting done — not via new automated tests.
- Reference spec: `docs/superpowers/specs/2026-07-09-starter-delete-design.md`.

---

### Task 1: Delete button, confirmation modal, and delete handler on starter detail page

**Files:**
- Modify: `ui/src/app/starters/[id]/page.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/api` (existing helper — already imported in this file, sends `Authorization: Bearer <token>`, redirects to `/login` on 401), `useRouter` from `next/navigation` (already imported as `router`, currently unused in this file).
- Produces: nothing consumed by other tasks — this is the only task in the plan.

- [ ] **Step 1: Add `Trash2` to the lucide-react import**

Current line 5:
```tsx
import { ArrowLeft, Droplets } from 'lucide-react';
```
Change to:
```tsx
import { ArrowLeft, Droplets, Trash2 } from 'lucide-react';
```

- [ ] **Step 2: Add a `StarterDeleteConfirmModal` component above `StarterDetailPage`**

Insert this new function directly above `export default function StarterDetailPage() {` (i.e., right after the imports, before line 10):

```tsx
function StarterDeleteConfirmModal({
  isDeleting,
  error,
  onConfirm,
  onCancel,
}: {
  isDeleting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 max-w-sm w-full shadow-xl">
        <h3 className="font-black text-lg text-[#2C1A0E] dark:text-gray-100 mb-2">
          Starter wirklich löschen?
        </h3>
        <p className="text-sm text-[#A68B6A] dark:text-gray-400 mb-6">
          Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 mb-4">{error}</div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl border border-[#D6C9B4] dark:border-gray-600 text-sm font-bold text-[#5C3D1E] dark:text-gray-300 hover:bg-[#F5F0E8] dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm font-bold text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
          >
            {isDeleting ? 'Wird gelöscht…' : 'Löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add delete state next to the existing `error` state**

Current (inside `StarterDetailPage`):
```tsx
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
```
Change to:
```tsx
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
```

- [ ] **Step 4: Add `handleDelete`, right after the existing `handleFeed` function**

`handleFeed` currently ends with:
```tsx
    } catch (err: any) {
      setError(err.message || 'Netzwerkfehler');
      setIsSubmitting(false);
    }
  };
```
Insert this new function immediately after that closing `};`:
```tsx

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/starters/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.error || 'Fehler beim Löschen');
        setIsDeleting(false);
        return;
      }
      router.push('/starters');
    } catch (err: any) {
      setDeleteError(err.message || 'Netzwerkfehler');
      setIsDeleting(false);
    }
  };
```

- [ ] **Step 5: Add the Trash2 trigger button to the header card**

Current:
```tsx
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <h1 className="text-2xl font-black mb-4">{starter.name}</h1>
```
Change to:
```tsx
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black">{starter.name}</h1>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Starter löschen"
              className="p-2 rounded-xl text-[#A68B6A] dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
```

- [ ] **Step 6: Render the modal at the end of the page**

Current end of the component's JSX:
```tsx
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <h2 className="text-lg font-black mb-4">Fütterungshistorie</h2>
          {(!starter.feedings || starter.feedings.length === 0) ? (
            <p className="text-sm text-[#A68B6A] dark:text-gray-500">Noch keine Fütterungen protokolliert.</p>
          ) : (
            <div className="space-y-2">
              {starter.feedings.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between text-sm border-b border-[#EDE5D6] dark:border-gray-700 pb-2 last:border-0">
                  <span className="text-[#2C1A0E] dark:text-gray-200">{f.flour_grams}g Mehl / {f.water_grams}g Wasser</span>
                  <span className="text-[#A68B6A] dark:text-gray-500 text-xs">{new Date(f.fed_at).toLocaleString('de-DE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```
Change to:
```tsx
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-[#D6C9B4] dark:border-gray-700 p-6">
          <h2 className="text-lg font-black mb-4">Fütterungshistorie</h2>
          {(!starter.feedings || starter.feedings.length === 0) ? (
            <p className="text-sm text-[#A68B6A] dark:text-gray-500">Noch keine Fütterungen protokolliert.</p>
          ) : (
            <div className="space-y-2">
              {starter.feedings.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between text-sm border-b border-[#EDE5D6] dark:border-gray-700 pb-2 last:border-0">
                  <span className="text-[#2C1A0E] dark:text-gray-200">{f.flour_grams}g Mehl / {f.water_grams}g Wasser</span>
                  <span className="text-[#A68B6A] dark:text-gray-500 text-xs">{new Date(f.fed_at).toLocaleString('de-DE')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showDeleteConfirm && (
          <StarterDeleteConfirmModal
            isDeleting={isDeleting}
            error={deleteError}
            onConfirm={handleDelete}
            onCancel={() => { setShowDeleteConfirm(false); setDeleteError(''); }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors related to `page.tsx` (pre-existing unrelated errors elsewhere, if any, are out of scope).

- [ ] **Step 8: Manual browser verification**

Start the dev stack (API + UI) per this repo's usual run process, log in, and walk through:
1. Open a starter's detail page (`/starters/<id>`) — Trash2 icon appears next to the starter name.
2. Click it — confirmation modal opens with the exact title/body text from Step 2, Cremeton-styled cancel button, red-toned delete button.
3. Click "Abbrechen" — modal closes, no network request fired, starter still on the page.
4. Click Trash2 again, click "Löschen" — button shows "Wird gelöscht…", then redirects to `/starters`.
5. Confirm the deleted starter no longer appears in the `/starters` list.
6. Confirm `GET /api/starters/:id` for the deleted starter now 404s (soft-deleted, filtered by `archived_at IS NULL`).

- [ ] **Step 9: Commit**

```bash
git add ui/src/app/starters/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(starters): add delete action on starter detail page

Wires a Trash2 button and confirmation modal to the existing
DELETE /api/starters/:id soft-delete endpoint; redirects to the
starter overview on success.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
