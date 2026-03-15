"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Link as LinkIcon, Edit3, X, AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import RecipeForm from '@/components/RecipeForm';
import SaveButton from '@/components/SaveButton';
import ImageSelectModal from '@/components/ImageSelectModal';

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

// --- INLINE ERROR BANNER ---
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 mt-3 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="shrink-0 hover:opacity-70 transition-opacity">
        <X size={16} />
      </button>
    </div>
  );
}

// --- IMPORT LOADING OVERLAY ---
const IMPORT_MESSAGES = [
  "Seite wird geladen…",
  "Rezept wird geparst…",
  "Zutaten werden erkannt…",
  "Schritte werden analysiert…",
  "Fast fertig…",
];

function ImportLoadingOverlay() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i < IMPORT_MESSAGES.length - 1 ? i + 1 : i));
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-4">
      <Loader2 size={36} className="text-[#8B7355] animate-spin" />
      <p className="text-sm font-semibold text-[#8B7355] animate-in fade-in duration-300 key-[msgIndex]">
        {IMPORT_MESSAGES[msgIndex]}
      </p>
      <div className="flex gap-1.5 mt-1">
        {IMPORT_MESSAGES.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= msgIndex ? 'bg-[#8B7355] w-4' : 'bg-gray-200 dark:bg-gray-600 w-1.5'}`} />
        ))}
      </div>
    </div>
  );
}

export default function NewRecipePage() {
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState<'import' | 'manual'>('import');
  const [showEditor, setShowEditor] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fehler-States
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Image Modal
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingData, setPendingData] = useState<any>(null);

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [originalSourceUrl, setOriginalSourceUrl] = useState("");
  const [doughSections, setDoughSections] = useState<any[]>([
    { 
      name: "Hauptteig", 
      is_parallel: false, 
      ingredients: [{ name: "", amount: "", unit: "g" }],
      steps: [{ instruction: "", type: "Aktion", duration: 5 }]
    }
  ]); 

  const applyImportData = (data: any, chosenImageUrl?: string) => {
    setTitle(data.title || "");
    setImageUrl(chosenImageUrl ?? data.image_url ?? "");
    setDescription(data.description || "");
    setSourceUrl(data.source_url || "");
    setOriginalSourceUrl(data.original_source_url || "");

    const raw = Array.isArray(data.dough_sections) && data.dough_sections.length > 0
      ? data.dough_sections
      : [{ name: "Hauptteig", is_parallel: false, ingredients: data.ingredients || [], steps: data.steps || [] }];

    setDoughSections(normalizeSections(raw));
    setShowEditor(true);
    setActiveTab('manual');
    setPendingData(null);
    setPendingImages([]);
  };

  // Prüft ob Bilder vorhanden → Modal oder direkt übernehmen
  const handleImportResult = (data: any) => {
    const images: string[] = Array.isArray(data.images) ? data.images : [];

    if (images.length > 1) {
      // Mehrere Bilder → Modal anzeigen
      setPendingData(data);
      setPendingImages(images);
    } else {
      // Kein oder ein Bild → direkt übernehmen
      applyImportData(data, images[0]);
    }
  };

  // --- FILE UPLOAD ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith('.html') || file.name.endsWith('.htm'))) {
      setSelectedFile(file);
    } else {
      setFileError('Bitte wähle eine HTML-Datei (.html oder .htm)');
    }
  };

  const handleHtmlImport = async () => {
    if (!selectedFile) return;
    setFileError(null);
    setIsImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const html = e.target?.result as string;
        if (!html) {
          setFileError('Fehler beim Lesen der Datei');
          setIsImporting(false);
          return;
        }
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/import/html`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
            body: JSON.stringify({ html, filename: selectedFile.name })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          handleImportResult(data);
          setSelectedFile(null);
        } catch (err) {
          setFileError("Import fehlgeschlagen: " + (err instanceof Error ? err.message : 'Unbekannter Fehler'));
        } finally {
          setIsImporting(false);
        }
      };
      reader.onerror = () => {
        setFileError('Fehler beim Lesen der Datei');
        setIsImporting(false);
      };
      reader.readAsText(selectedFile);
    } catch (err) {
      setFileError("Import fehlgeschlagen");
      setIsImporting(false);
    }
  };

  // --- URL IMPORT ---
  const handleAutoImport = async () => {
    if (!importUrl) return;
    setUrlError(null);
    const normalizedUrl = importUrl.replace(/^https?:\/\//i, '').replace(/^/, 'https://');
    setIsImporting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      handleImportResult(data);
    } catch (err) {
      setUrlError("Import fehlgeschlagen: " + (err instanceof Error ? err.message : 'Unbekannter Fehler'));
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
        body: JSON.stringify({
          title,
          image_url: imageUrl,
          description,
          source_url: sourceUrl,
          original_source_url: originalSourceUrl,
          dough_sections: doughSections,
          steps: []
        }),
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
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-10 border border-gray-200 dark:border-gray-700 shadow-sm text-center animate-in fade-in zoom-in-95 duration-300">
            {isImporting && <ImportLoadingOverlay />}
            <h2 className="text-3xl font-bold text-[#8B7355] mb-2 text-center">Rezept importieren</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-8 font-medium">Link vom Plötzblog, Homebaking.at, Marcel Paa oder Jo Semola einfügen.</p>
            
            {/* URL Import */}
            <div className="flex flex-col md:flex-row gap-3 max-w-2xl mx-auto">
              <input 
                type="text" placeholder="https://..." value={importUrl} onChange={(e) => { setImportUrl(e.target.value); setUrlError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAutoImport()}
                className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-xl outline-none focus:border-[#8B7355] transition-all"
              />
              <button onClick={handleAutoImport} disabled={isImporting || !importUrl} className="bg-[#8B7355] text-white px-8 py-3 rounded-xl font-bold hover:bg-[#766248] transition-colors disabled:opacity-50 shadow-md">
                {isImporting ? "Lädt..." : "Importieren"}
              </button>
            </div>
            {urlError && (
              <div className="max-w-2xl mx-auto text-left">
                <ErrorBanner message={urlError} onDismiss={() => setUrlError(null)} />
              </div>
            )}

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
              {fileError && (
                <div className="max-w-2xl mx-auto text-left">
                  <ErrorBanner message={fileError} onDismiss={() => setFileError(null)} />
                </div>
              )}
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
              availableImages={pendingImages}
            />
            <SaveButton isSaving={isSaving} type="create" />
          </>
        )}
      </div>

      {/* IMAGE SELECTION MODAL */}
      {pendingImages.length > 1 && pendingData && (
        <ImageSelectModal
          images={pendingImages}
          onSelect={(url) => applyImportData(pendingData, url)}
          onSkip={() => applyImportData(pendingData, undefined)}
        />
      )}
    </div>
  );
}