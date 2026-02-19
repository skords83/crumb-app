"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Save, X } from 'lucide-react';
import Link from 'next/link';
import RecipeForm from '@/components/RecipeForm';
import SaveButton from '@/components/SaveButton'

export default function EditRecipePage() {
  const router = useRouter();
  const params = useParams();
  const recipeId = params?.id; // Sicherer Zugriff auf die ID

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // States für die Formulardaten
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [doughSections, setDoughSections] = useState<any[]>([]);

  // 1. Rezept laden und normalisieren
  useEffect(() => {
    const fetchRecipe = async () => {
      if (!recipeId) return;
      try {
        setLoading(true);
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`);
        if (!res.ok) throw new Error("Fehler beim Laden");
        const data = await res.json();
        
        setTitle(data.title || "");
        setImageUrl(data.image_url || "");
        setDescription(data.description || "");

        let sections = (data.dough_sections || []).map((s: any) => ({
          ...s,
          is_parallel: s.is_parallel || false,
          ingredients: s.ingredients || [],
          steps: s.steps || [{ instruction: "", type: "Aktion", duration: 5 }]
        }));

        // Fallback für alte Datenstrukturen
        if (sections.length === 0) {
          if (data.ingredients?.length > 0) {
            sections = [{ 
              name: "Hauptteig", 
              is_parallel: false, 
              ingredients: data.ingredients,
              steps: data.steps || [{ instruction: "", type: "Aktion", duration: 5 }]
            }];
          } else {
            sections = [{ 
              name: "Hauptteig", 
              is_parallel: false, 
              ingredients: [{ name: "", amount: "", unit: "g" }],
              steps: [{ instruction: "", type: "Aktion", duration: 5 }]
            }];
          }
        }
        setDoughSections(sections);
      } catch (err) {
        console.error("Fehler beim Laden:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRecipe();
  }, [recipeId]);

  // 2. Speicher-Logik
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes/${recipeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title, 
          image_url: imageUrl, 
          description, 
          dough_sections: doughSections,
          steps: [] 
        }),
      });
      if (res.ok) {
        router.push(`/recipes/${recipeId}`);
        router.refresh();
      } else {
        throw new Error("Server-Fehler beim Speichern");
      }
    } catch (err) {
      alert("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
      <Loader2 className="animate-spin text-[#8B4513]" size={40} />
    </div>
  );

return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-gray-900 p-4 md:p-8 pb-32 transition-colors duration-200"> {/* pb-32 für Platz am Ende */}
      <div className="max-w-5xl mx-auto">
        
        {/* Schlichter Zurück-Link ohne Sticky-Balken */}
        <Link href={`/recipes/${recipeId}`} className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-500 hover:text-[#8B4513] dark:hover:text-[#A08060] mb-8 text-sm font-medium transition-colors group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> 
          Abbrechen & Zurück
        </Link>

        {/* Das Formular */}
        <RecipeForm 
          id="main-recipe-form"
          title={title} setTitle={setTitle}
          imageUrl={imageUrl} setImageUrl={setImageUrl}
          doughSections={doughSections} setDoughSections={setDoughSections}
          onSubmit={handleSubmit}
          isSubmitting={isSaving}
        />
      </div>

      {/* EINZIGER SPEICHER-BUTTON: Schwebend, elegant, immer erreichbar */}
{/* EINZIGER SPEICHER-BUTTON: Design wie auf der Homepage */}
<SaveButton isSaving={isSaving} type="save" />
    </div>
  );
}