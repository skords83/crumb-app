"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, XCircle } from 'lucide-react';
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

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const initialData = useRef<string>("");

  // Änderungen tracken
  useEffect(() => {
    if (!loading && initialData.current) {
      const current = JSON.stringify({ title, imageUrl, description, doughSections });
      setIsDirty(current !== initialData.current);
    }
  }, [title, imageUrl, description, doughSections, loading]);

  // Browser-Warning bei ungespeicherten Änderungen
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [doughSections, setDoughSections] = useState<any[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [originalSourceUrl, setOriginalSourceUrl] = useState("");

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
      if (res.ok) { setIsDirty(false); router.push(`/recipes/${recipeId}`); router.refresh(); }
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