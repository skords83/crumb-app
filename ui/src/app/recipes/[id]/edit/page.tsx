"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, XCircle, RotateCcw } from 'lucide-react';
import RecipeForm from '@/components/RecipeForm';
import SaveButton from '@/components/SaveButton';

// Identisch mit new-recipe-page – type normalisieren
const normalizeSections = (sections: any[]) =>
  sections.map((s: any) => ({
    ...s,
    is_parallel: s.is_parallel || false,
    ingredients: s.ingredients || [],
    steps: Array.isArray(s.steps)
      ? s.steps.map((st: any) => ({
          ...st,
          type: st.type === 'Warten' ? 'Warten' : st.type === 'Backen' ? 'Backen' : 'Aktion',
          duration: parseInt(st.duration) || 5,
        }))
      : [{ instruction: '', type: 'Aktion', duration: 5 }],
  }));

export default function EditRecipePage() {
  const router = useRouter();
  const params = useParams();
  const recipeId = params?.id;

  // ── STATE ────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [draftBanner, setDraftBanner] = useState(false);
  const initialData = useRef<string>("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [doughSections, setDoughSections] = useState<any[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [originalSourceUrl, setOriginalSourceUrl] = useState("");

  // Draft-Key pro Rezept
  const draftKey = recipeId ? `crumb_draft_${recipeId}` : null;

  // Änderungen tracken + debounced Autosave
  useEffect(() => {
    if (!loading && initialData.current) {
      const current = JSON.stringify({ title, imageUrl, description, doughSections });
      const dirty = current !== initialData.current;
      setIsDirty(dirty);

      if (dirty && draftKey) {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => {
          try {
            localStorage.setItem(draftKey, JSON.stringify({
              title, imageUrl, description, doughSections, savedAt: Date.now()
            }));
          } catch { /* ignore */ }
        }, 1500);
      }
    }
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [title, imageUrl, description, doughSections, loading, draftKey]);

  // Browser-Warning bei ungespeicherten Änderungen
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    const fetchRecipe = async () => {
      if (!recipeId) return;
      try {
        setLoading(true);
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` }
        });
        if (!res.ok) throw new Error("Fehler beim Laden");
        const data = await res.json();

        setTitle(data.title || "");
        setImageUrl(data.image_url || "");
        setDescription(data.description || "");
        setSourceUrl(data.source_url || "");
        setOriginalSourceUrl(data.original_source_url || "");

        let sections = Array.isArray(data.dough_sections) && data.dough_sections.length > 0
          ? data.dough_sections
          : data.ingredients?.length > 0
            ? [{ name: "Hauptteig", is_parallel: false, ingredients: data.ingredients, steps: data.steps || [] }]
            : [{ name: "Hauptteig", is_parallel: false, ingredients: [{ name: "", amount: "", unit: "g" }], steps: [] }];

        setDoughSections(normalizeSections(sections));
        // Snapshot für dirty-tracking
        initialData.current = JSON.stringify({
          title: data.title || "",
          imageUrl: data.image_url || "",
          description: data.description || "",
          doughSections: normalizeSections(sections),
        });

        // Draft prüfen
        if (draftKey) {
          try {
            const raw = localStorage.getItem(draftKey);
            if (raw) {
              const draft = JSON.parse(raw);
              // Draft anzeigen wenn er neuer als 0 Sekunden ist (immer, wenn vorhanden)
              setDraftBanner(true);
            }
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error("Fehler beim Laden:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRecipe();
  }, [recipeId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveError(null);

    // Validierung
    if (!title.trim()) { setSaveError("Bitte einen Rezepttitel eingeben."); return; }
    const hasIngredient = doughSections.some(s => s.ingredients?.some((i: any) => i.name?.trim()));
    const hasStep = doughSections.some(s => s.steps?.some((st: any) => st.instruction?.trim()));
    if (!hasIngredient || !hasStep) { setSaveError("Mindestens eine Zutat und ein Schritt werden benötigt."); return; }

    setIsSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ title, image_url: imageUrl, description, dough_sections: doughSections, steps: [], source_url: sourceUrl, original_source_url: originalSourceUrl }),
      });
      if (res.ok) {
        setIsDirty(false);
        if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
        router.push(`/recipes/${recipeId}`); router.refresh();
      }
      else throw new Error("Server-Fehler beim Speichern");
    } catch (err) {
      setSaveError("Speichern fehlgeschlagen. Bitte nochmal versuchen.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-gray-900">
      <Loader2 className="animate-spin text-[#8B4513]" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-gray-900 p-4 md:p-8 pb-32 transition-colors duration-200">
      <div className="max-w-5xl mx-auto">
        {isSaving ? (
          <span className="inline-flex items-center gap-2 text-gray-300 dark:text-gray-600 mb-8 text-sm font-medium cursor-not-allowed">
            <ArrowLeft size={18} />
            Abbrechen & Zurück
          </span>
        ) : (
          <button
            onClick={() => {
              if (isDirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
              router.push(`/recipes/${recipeId}`);
            }}
            className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-500 hover:text-[#8B4513] dark:hover:text-[#A08060] mb-8 text-sm font-medium transition-colors group"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
            Abbrechen & Zurück
          </button>
        )}

        {draftBanner && draftKey && (
          <div className="mb-6 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-5 py-4">
            <RotateCcw size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium flex-1">
              Es gibt einen lokalen Entwurf. Änderungen wiederherstellen?
            </p>
            <button
              onClick={() => {
                try {
                  const draft = JSON.parse(localStorage.getItem(draftKey) || '');
                  setTitle(draft.title ?? title);
                  setImageUrl(draft.imageUrl ?? imageUrl);
                  setDescription(draft.description ?? description);
                  setDoughSections(draft.doughSections ?? doughSections);
                } catch { /* ignore */ }
                setDraftBanner(false);
              }}
              className="text-xs font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-800/40 hover:bg-amber-200 dark:hover:bg-amber-700/40 px-3 py-1.5 rounded-xl transition-colors"
            >
              Wiederherstellen
            </button>
            <button
              onClick={() => {
                try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
                setDraftBanner(false);
              }}
              className="text-xs font-bold text-amber-500 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 px-2 py-1.5 transition-colors"
            >
              Verwerfen
            </button>
          </div>
        )}

        {saveError && (
          <div className="mb-6 flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-5 py-4">
            <XCircle size={18} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300 font-medium">{saveError}</p>
            <button onClick={() => setSaveError(null)} className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-200 transition-colors">
              <XCircle size={16} />
            </button>
          </div>
        )}

        <RecipeForm
          id="main-recipe-form"
          title={title} setTitle={setTitle}
          imageUrl={imageUrl} setImageUrl={setImageUrl}
          description={description} setDescription={setDescription}
          doughSections={doughSections} setDoughSections={setDoughSections}
          onSubmit={handleSubmit}
          isSubmitting={isSaving}
        />
      </div>
      <SaveButton isSaving={isSaving} type="save" />
    </div>
  );
}