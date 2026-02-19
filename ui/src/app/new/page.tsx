"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Link as LinkIcon, Edit3 } from 'lucide-react';
import Link from 'next/link';
import RecipeForm from '@/components/RecipeForm';
import SaveButton from '@/components/SaveButton';

export default function NewRecipePage() {
  const router = useRouter();
  
  // UI States
  const [activeTab, setActiveTab] = useState<'import' | 'manual'>('import');
  const [showEditor, setShowEditor] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // NEU: State für den Speicherprozess
  const [importUrl, setImportUrl] = useState("");

  // Rezept States
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  
  const [doughSections, setDoughSections] = useState<any[]>([
    { 
      name: "Hauptteig", 
      is_parallel: false, 
      ingredients: [{ name: "", amount: "", unit: "g" }],
      steps: [{ instruction: "", type: "Aktion", duration: 5 }]
    }
  ]); 

  // --- AUTO IMPORT LOGIK ---
  const handleAutoImport = async () => {
    if (!importUrl) return;
    setIsImporting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setTitle(data.title || "");
    
      // HIER DIE KORREKTUR:
      setImageUrl(data.image_url || ""); // Nutze image_url statt imageUrl
    
      setDescription(data.description || "");
      
      setDoughSections(data.dough_sections?.map((s: any) => ({ 
        ...s, 
        is_parallel: s.is_parallel || false,
        steps: s.steps || [{ instruction: "", type: "Aktion", duration: 5 }]
      })) || [{ name: "Hauptteig", is_parallel: false, ingredients: [], steps: [] }]);
      
      setShowEditor(true);
      setActiveTab('manual');
    } catch (err) {
      alert("Fehler beim Import");
    } finally {
      setIsImporting(false);
    }
  };

  // --- SPEICHER LOGIK ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      alert("Bitte gib deinem Brot einen Namen!");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
        method: 'POST',
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
        router.push('/');
        router.refresh();
      } else {
        alert("Fehler beim Speichern");
      }
    } catch (err) {
      console.error(err);
      alert("Server nicht erreichbar");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-gray-900 p-4 md:p-8 text-[#2d2d2d] dark:text-gray-100 font-sans pb-32 transition-colors duration-200">
      <div className="max-w-5xl mx-auto">
        
        <Link href="/" className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white mb-6 font-medium text-sm transition-colors">
          <ArrowLeft size={18} /> Zurück zur Bibliothek
        </Link>

        {/* --- TABS --- */}
        <div className="bg-[#f1f1f1] dark:bg-gray-800 p-1.5 rounded-2xl inline-flex w-full mb-8 border border-gray-200 dark:border-gray-700">
          <button 
            type="button"
            onClick={() => { setActiveTab('import'); setShowEditor(false); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${activeTab === 'import' && !showEditor ? 'bg-white dark:bg-gray-700 shadow-sm text-[#8B7355]' : 'text-gray-500 dark:text-gray-400'}`}
          >
            <LinkIcon size={18} /> Von URL importieren
          </button>
          <button 
            type="button"
            onClick={() => { setShowEditor(true); setActiveTab('manual'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${showEditor && activeTab === 'manual' ? 'bg-white dark:bg-gray-700 shadow-sm text-[#8B7355]' : 'text-gray-500 dark:text-gray-400'}`}
          >
            <Edit3 size={18} /> Manuell erstellen
          </button>
        </div>

        {/* --- IMPORT BOX --- */}
        {!showEditor && activeTab === 'import' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 border border-gray-200 dark:border-gray-700 shadow-sm text-center animate-in fade-in zoom-in-95 duration-300">
            <h2 className="text-3xl font-bold text-[#8B7355] mb-2 text-center">Rezept importieren</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-8 font-medium">Link vom Plötzblog, Homebaking.at oder Ketex einfügen.</p>
            <div className="flex flex-col md:flex-row gap-3 max-w-2xl mx-auto">
              <input 
                type="text" placeholder="https://www.ploetzblog.de/..." value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl outline-none focus:border-[#8B7355] transition-all"
              />
              <button onClick={handleAutoImport} disabled={isImporting} className="bg-[#8B7355] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#766248] transition-colors disabled:opacity-50 shadow-md">
                {isImporting ? "Lädt..." : "Importieren"}
              </button>
            </div>
          </div>
        )}

        {/* --- EDITOR --- */}
        {showEditor && (
          <>
            <RecipeForm 
              id="main-recipe-form" // Wichtig für die Verknüpfung mit dem SaveButton
              title={title} setTitle={setTitle}
              imageUrl={imageUrl} setImageUrl={setImageUrl}
              description={description} setDescription={setDescription}
              doughSections={doughSections} setDoughSections={setDoughSections}
              onSubmit={handleSubmit}
              isSubmitting={isSaving}
            />
            {/* Der schwebende SaveButton erscheint nur im Editor-Modus */}
            <SaveButton isSaving={isSaving} type="create" />
          </>
        )}
      </div>
    </div>
  );
}
