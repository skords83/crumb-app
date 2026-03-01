"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
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
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [doughSections, setDoughSections] = useState<any[]>([]);

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

        let sections = Array.isArray(data.dough_sections) && data.dough_sections.length > 0
          ? data.dough_sections
          : data.ingredients?.length > 0
            ? [{ name: "Hauptteig", is_parallel: false, ingredients: data.ingredients, steps: data.steps || [] }]
            : [{ name: "Hauptteig", is_parallel: false, ingredients: [{ name: "", amount: "", unit: "g" }], steps: [] }];

        setDoughSections(normalizeSections(sections));
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
    setIsSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ title, image_url: imageUrl, description, dough_sections: doughSections, steps: [] }),
      });
      if (res.ok) { router.push(`/recipes/${recipeId}`); router.refresh(); }
      else throw new Error("Server-Fehler beim Speichern");
    } catch (err) {
      alert("Fehler beim Speichern");
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
        <Link href={`/recipes/${recipeId}`} className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-500 hover:text-[#8B4513] dark:hover:text-[#A08060] mb-8 text-sm font-medium transition-colors group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
          Abbrechen & Zurück
        </Link>
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