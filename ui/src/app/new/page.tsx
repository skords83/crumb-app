"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Link as LinkIcon, Edit3 } from 'lucide-react';
import Link from 'next/link';
import RecipeForm from '@/components/RecipeForm';
import SaveButton from '@/components/SaveButton';

// Normalisiert alle Steps aus Import-Daten: fehlender/falscher type → 'Aktion'
const normalizeSections = (sections: any[]) =>
  sections.map((s: any) => ({
    name: s.name || 'Phase',
    is_parallel: s.is_parallel || false,
    ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
    steps: Array.isArray(s.steps)
      ? s.steps.map((st: any) => ({
          ...st,
          type: st.type === 'Warten' ? 'Warten' : st.type === 'Backen' ? 'Backen' : 'Aktion',
          duration: parseInt(st.duration) || 5,
        }))
      : [{ instruction: '', type: 'Aktion', duration: 5 }],
  }));

export default function NewRecipePage() {
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState<'import' | 'manual'>('import');
  const [showEditor, setShowEditor] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

  const applyImportData = (data: any) => {
    setTitle(data.title || "");
    setImageUrl(data.image_url || "");
    setDescription(data.description || "");

    const raw = Array.isArray(data.dough_sections) && data.dough_sections.length > 0
      ? data.dough_sections
      : [{ name: "Hauptteig", is_parallel: false, ingredients: data.ingredients || [], steps: data.steps || [] }];

    setDoughSections(normalizeSections(raw));
    setShowEditor(true);
    setActiveTab('manual');
  };

  // --- FILE UPLOAD ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.html') || file.name.endsWith('.htm'))) {
      setSelectedFile(file);
    } else {
      alert('Bitte wähle eine HTML-Datei (.html oder .htm)');
    }
  };

  const handleHtmlImport = async () => {
    if (!selectedFile) return;
    setIsImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const html = e.target?.result as string;
        if (!html) { alert('Fehler beim Lesen der Datei'); setIsImporting(false); return; }
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/import/html`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
            body: JSON.stringify({ html, filename: selectedFile.name })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          applyImportData(data);
          setSelectedFile(null);
        } catch (err) {
          alert("Fehler beim Import: " + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
          setIsImporting(false);
        }
      };
      reader.onerror = () => { alert('Fehler beim Lesen der Datei'); setIsImporting(false); };
      reader.readAsText(selectedFile);
    } catch (err) {
      alert("Fehler beim Import");
      setIsImporting(false);
    }
  };

  // --- URL IMPORT ---
  const handleAutoImport = async () => {
    if (!importUrl) return;
    setIsImporting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      applyImportData(data);
    } catch (err) {
      alert("Fehler beim Import: " + (err instanceof Error ? err.message : 'Unbekannter Fehler'));
    } finally {
      setIsImporting(false);
    }
  };

  // --- SPEICHERN ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { alert("Bitte gib deinem Brot einen Namen!"); return; }
    setIsSaving(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ title, image_url: imageUrl, description, dough_sections: doughSections, steps: [] }),
      });
      if (res.ok) { router.push('/'); router.refresh(); }
      else alert("Fehler beim Speichern");
    } catch (err) {
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

        {/* TABS */}
        <div className="bg-[#f1f1f1] dark:bg-gray-800 p-1.5 rounded-2xl inline-flex w-full mb-8 border border-gray-200 dark:border-gray-700">
          <button type="button" onClick={() => { setActiveTab('import'); setShowEditor(false); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${activeTab === 'import' && !showEditor ? 'bg-white dark:bg-gray-700 shadow-sm text-[#8B7355]' : 'text-gray-500 dark:text-gray-400'}`}>
            <LinkIcon size={18} /> Von URL importieren
          </button>
          <button type="button" onClick={() => { setShowEditor(true); setActiveTab('manual'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${showEditor && activeTab === 'manual' ? 'bg-white dark:bg-gray-700 shadow-sm text-[#8B7355]' : 'text-gray-500 dark:text-gray-400'}`}>
            <Edit3 size={18} /> Manuell erstellen
          </button>
        </div>

        {/* IMPORT BOX */}
        {!showEditor && activeTab === 'import' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 border border-gray-200 dark:border-gray-700 shadow-sm text-center animate-in fade-in zoom-in-95 duration-300">
            <h2 className="text-3xl font-bold text-[#8B7355] mb-2 text-center">Rezept importieren</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-8 font-medium">Link vom Plötzblog, Homebaking.at, Marcel Paa oder Jo Semola einfügen.</p>
            <div className="flex flex-col md:flex-row gap-3 max-w-2xl mx-auto">
              <input 
                type="text" placeholder="https://..." value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAutoImport()}
                className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl outline-none focus:border-[#8B7355] transition-all"
              />
              <button onClick={handleAutoImport} disabled={isImporting || !importUrl} className="bg-[#8B7355] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#766248] transition-colors disabled:opacity-50 shadow-md">
                {isImporting ? "Lädt..." : "Importieren"}
              </button>
            </div>

            <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4 font-medium">Oder HTML-Datei hochladen</p>
              <div className="flex flex-col md:flex-row gap-3 max-w-2xl mx-auto">
                <input type="file" accept=".html,.htm" onChange={handleFileChange} className="hidden" id="html-file-input" />
                <label htmlFor="html-file-input"
                  className="flex-1 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-left cursor-pointer hover:border-[#8B7355] transition-colors text-gray-500 dark:text-gray-400">
                  {selectedFile ? selectedFile.name : "HTML-Datei auswählen..."}
                </label>
                <button onClick={handleHtmlImport} disabled={!selectedFile || isImporting}
                  className="bg-[#8B7355] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#766248] transition-colors disabled:opacity-50 shadow-md">
                  {isImporting ? "Lädt..." : "Hochladen"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDITOR */}
        {showEditor && (
          <>
            <RecipeForm 
              id="main-recipe-form"
              title={title} setTitle={setTitle}
              imageUrl={imageUrl} setImageUrl={setImageUrl}
              description={description} setDescription={setDescription}
              doughSections={doughSections} setDoughSections={setDoughSections}
              onSubmit={handleSubmit}
              isSubmitting={isSaving}
            />
            <SaveButton isSaving={isSaving} type="create" />
          </>
        )}
      </div>
    </div>
  );
}