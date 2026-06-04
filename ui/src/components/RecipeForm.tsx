"use client";

import React, { useMemo, useRef, useState } from 'react';
import { 
  Trash2, 
  Plus, 
  Clock, 
  List, 
  Type, 
  Thermometer as TempIcon,
  Images,
  GripVertical,
  ExternalLink,
} from 'lucide-react';
import ImageSelectModal from '@/components/ImageSelectModal';

export const PHASE_TYPES = [
  { label: "Sauerteig", isParallel: true },
  { label: "Vorteig / Poolish", isParallel: true },
  { label: "Quellstück / Kochstück", isParallel: true },
  { label: "Autolyse", isParallel: false },
  { label: "Hauptteig", isParallel: false },
  { label: "Stockgare", isParallel: false },
  { label: "Stückgare", isParallel: false },
  { label: "Backen", isParallel: false },
];

export const RECIPE_CATEGORIES = [
  { value: '',          label: 'Automatisch erkennen' },
  { value: 'brot',      label: 'Brot' },
  { value: 'broetchen', label: 'Brötchen' },
  { value: 'pizza',     label: 'Pizza & Fladen' },
  { value: 'suesses',   label: 'Süßes Gebäck' },
  { value: 'cracker',   label: 'Knäcke & Cracker' },
];

export default function RecipeForm({
  title,
  setTitle,
  imageUrl,
  setImageUrl,
  description,
  setDescription,
  category,
  setCategory,
  doughSections,
  setDoughSections,
  onSubmit,
  isSubmitting,
  availableImages = [],
  sourceUrl,
  setSourceUrl,
}: any) {

  const addSection = () => {
    setDoughSections([...doughSections, { 
      name: "Neue Phase", 
      is_parallel: false, 
      ingredients: [{ name: "", amount: "", unit: "g", temperature: "", note: "" }],
      steps: [{ instruction: "", type: "Aktion", duration: 5 }] 
    }]);
  };

  const removeSection = (idx: number) => {
    if (doughSections.length <= 1) return;
    setDoughSections((prev: any[]) => prev.filter((_, i) => i !== idx));
  };

  const addIngredient = (sIdx: number) => {
    setDoughSections((prev: any[]) => prev.map((s, i) =>
      i !== sIdx ? s : { ...s, ingredients: [...s.ingredients, { name: "", amount: "", unit: "g", temperature: "", note: "" }] }
    ));
  };

  const updateIngredient = (sIdx: number, iIdx: number, field: string, value: string) => {
    setDoughSections((prev: any[]) => prev.map((s, i) =>
      i !== sIdx ? s : {
        ...s,
        ingredients: s.ingredients.map((ing: any, j: number) =>
          j !== iIdx ? ing : { ...ing, [field]: value }
        )
      }
    ));
  };

  const addStepToSection = (sIdx: number, type: 'Aktion' | 'Warten') => {
    setDoughSections((prev: any[]) => prev.map((s, i) =>
      i !== sIdx ? s : {
        ...s,
        steps: [...(s.steps || []), { instruction: "", type, duration: type === 'Aktion' ? 5 : 60 }]
      }
    ));
  };

  const updateStepInSection = (sIdx: number, stIdx: number, field: string, value: any) => {
    setDoughSections((prev: any[]) => prev.map((s, i) =>
      i !== sIdx ? s : {
        ...s,
        steps: s.steps.map((st: any, j: number) =>
          j !== stIdx ? st : { ...st, [field]: value }
        )
      }
    ));
  };

  const removeStepFromSection = (sIdx: number, stIdx: number) => {
    setDoughSections((prev: any[]) => prev.map((s, i) =>
      i !== sIdx ? s : { ...s, steps: s.steps.filter((_: any, j: number) => j !== stIdx) }
    ));
  };

  const reorderStep = (sIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setDoughSections((prev: any[]) => prev.map((s, i) => {
      if (i !== sIdx) return s;
      const steps = [...s.steps];
      const [moved] = steps.splice(fromIdx, 1);
      steps.splice(toIdx, 0, moved);
      return { ...s, steps };
    }));
  };

  const [isUploading, setIsUploading] = React.useState(false);
  const [showImageModal, setShowImageModal] = React.useState(false);

  const totalIngredients = useMemo(() => {
    if (!Array.isArray(doughSections)) return [];
    const totals: { [key: string]: { name: string; amount: number; unit: string } } = {};
    doughSections.forEach((section: any) => {
      section.ingredients?.forEach((ing: any) => {
        if (!ing.name || !ing.amount) return;
        const key = ing.name.trim().toLowerCase();
        const amount = parseFloat(ing.amount.toString().replace(',', '.')) || 0;
        const unit = ing.unit || "g";
        if (totals[key]) {
          totals[key].amount = Math.round((totals[key].amount + amount) * 100) / 100;
        } else {
          totals[key] = { name: ing.name, amount, unit };
        }
      });
    });
    return Object.values(totals);
  }, [doughSections]);

  return (
    <form id="main-recipe-form" onSubmit={onSubmit} className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* ── HEADER CARD ── */}
      <div className="bg-white dark:bg-gray-800/60 rounded-2xl border border-[#D6C9B4] dark:border-white/[0.07] shadow-sm overflow-hidden transition-colors duration-200">

        {/* Bild & Metadaten */}
        <div className="bg-[#FAF7F2] dark:bg-white/[0.03] p-8 border-b border-[#EDE5D6] dark:border-white/[0.07] flex flex-col md:flex-row gap-8 items-start">
          {/* Bild-Upload */}
          <div className="group relative w-full md:w-32 h-32 bg-white dark:bg-white/[0.05] rounded-2xl border-2 border-dashed border-[#D6C9B4] dark:border-white/[0.12] flex items-center justify-center overflow-hidden shrink-0 hover:border-[#8B7355] dark:hover:border-[#C4A484]/50 transition-all">
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#8B7355] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[8px] font-black uppercase text-[#A68B6A]">Lädt...</span>
              </div>
            ) : imageUrl ? (
              <>
                <img src={imageUrl} className="w-full h-full object-cover" alt="Vorschau" />
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-black uppercase tracking-widest"
                >
                  Löschen
                </button>
              </>
            ) : (
              <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full hover:bg-[#F5F0E8] dark:hover:bg-white/[0.05] transition-colors">
                <Plus className="text-[#C4A484] dark:text-white/25 mb-1" size={24} />
                <span className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/30">Upload</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIsUploading(true);
                    const formData = new FormData();
                    formData.append('file', file);
                    try {
                      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('crumb_token')}` },
                        body: formData,
                      });
                      if (response.ok) {
                        const data = await response.json();
                        setImageUrl(data.url);
                      } else {
                        alert("Upload fehlgeschlagen");
                      }
                    } catch (error) {
                      console.error("Fehler beim Upload:", error);
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                />
              </label>
            )}
          </div>

          {/* Felder */}
          <div className="flex-1 w-full space-y-4">
            <input
              className="text-4xl font-black w-full bg-transparent outline-none border-b-2 border-transparent focus:border-[#8B7355] pb-2 transition-all tracking-tight text-[#2C1A0E] dark:text-white placeholder-[#C4A484] dark:placeholder-white/20"
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name deines Brotes..."
            />
            <textarea
              className="w-full bg-[#F5F0E8] dark:bg-white/[0.05] border border-[#D6C9B4] dark:border-white/[0.08] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#8B7355]/50 dark:focus:border-[#C4A484]/40 resize-none text-[#2C1A0E] dark:text-white/80 placeholder:text-[#C4A484] dark:placeholder:text-white/25 transition-colors"
              value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beschreibung..."
              rows={2}
            />
            <div className="flex items-center gap-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/30 whitespace-nowrap">
                Kategorie
              </label>
              <select
                className="bg-[#F5F0E8] dark:bg-white/[0.05] border border-[#D6C9B4] dark:border-white/[0.08] rounded-xl px-3 py-2 text-xs font-bold text-[#5C3D1E] dark:text-white/70 outline-none focus:border-[#8B7355]/50 cursor-pointer transition-colors"
                value={category || ''}
                onChange={(e) => setCategory(e.target.value || null)}
              >
                {RECIPE_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {setSourceUrl && (
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/30 whitespace-nowrap">
                  <ExternalLink size={12} className="inline -mt-0.5 mr-1" />Quelle
                </label>
                <input
                  className="flex-1 bg-[#F5F0E8] dark:bg-white/[0.05] border border-[#D6C9B4] dark:border-white/[0.08] rounded-xl px-3 py-2 text-xs outline-none focus:border-[#8B7355]/50 dark:focus:border-[#C4A484]/40 text-[#5C3D1E] dark:text-white/70 placeholder:text-[#C4A484] dark:placeholder:text-white/25 transition-colors"
                  value={sourceUrl || ""}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}
            <input
              className="w-full bg-[#F5F0E8] dark:bg-white/[0.05] border border-[#D6C9B4] dark:border-white/[0.08] rounded-xl px-4 py-2.5 text-xs outline-none focus:border-[#8B7355]/50 dark:focus:border-[#C4A484]/40 text-[#A68B6A] dark:text-white/40 placeholder:text-[#C4A484] dark:placeholder:text-white/25 transition-colors"
              value={imageUrl || ""}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Bild URL..."
            />
            {availableImages.length > 1 && (
              <button
                type="button"
                onClick={() => setShowImageModal(true)}
                className="flex items-center gap-2 text-xs font-bold text-[#8B7355] hover:text-[#766248] bg-[#8B7355]/5 hover:bg-[#8B7355]/10 border border-[#8B7355]/20 px-3 py-2 rounded-xl transition-all"
              >
                <Images size={14} />
                Aus {availableImages.length} Bildern wählen
              </button>
            )}
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="p-8 md:p-10 space-y-10">

          {/* Gesamtzutaten */}
          {totalIngredients.length > 0 && (
            <div className="bg-[#8B7355]/5 dark:bg-[#8B7355]/10 rounded-2xl p-6 border border-[#8B7355]/10 dark:border-[#8B7355]/20">
              <div className="flex items-center gap-2 mb-4 text-[#8B7355]">
                <List size={16} />
                <h4 className="font-black text-xs uppercase tracking-widest">Gesamtzutaten</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {totalIngredients.map((ing, idx) => (
                  <div key={`total-${idx}`} className="flex flex-col bg-white dark:bg-white/[0.05] px-4 py-2 rounded-xl border border-[#EDE5D6] dark:border-white/[0.07]">
                    <span className="text-[10px] font-bold text-[#A68B6A] dark:text-white/40 uppercase tracking-tighter">{ing.name}</span>
                    <span className="text-sm font-black text-[#8B7355]">{ing.amount} {ing.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phasen-Header */}
          <div className="flex justify-between items-center">
            <h3 className="font-black text-xl flex items-center gap-3 text-[#2C1A0E] dark:text-white">
              <Type className="text-[#8B7355]" size={20} /> Phasen & Ablauf
            </h3>
          </div>

          {/* Phasen-Loop */}
          <div className="space-y-5">
            {doughSections.map((section: any, sIdx: number) => (
              <div key={`section-${sIdx}`} className="bg-[#FAF7F2] dark:bg-white/[0.03] rounded-2xl p-6 md:p-8 border border-[#EDE5D6] dark:border-white/[0.07] relative transition-all hover:border-[#D6C9B4] dark:hover:border-white/[0.12]">

                {/* Phasen-Header */}
                <div className="flex flex-col md:flex-row justify-between gap-4 mb-8 pb-4 border-b border-[#EDE5D6] dark:border-white/[0.07]">
                  <div className="flex-1 space-y-2">
                    <select
                      className="bg-white dark:bg-white/[0.05] border border-[#D6C9B4] dark:border-white/[0.08] rounded-lg px-3 py-1 text-[10px] font-black uppercase text-[#8B7355] outline-none cursor-pointer transition-colors"
                      value={PHASE_TYPES.find(t => t.label === section.name) ? section.name : "Custom"}
                      onChange={(e) => {
                        const selected = PHASE_TYPES.find(t => t.label === e.target.value);
                        setDoughSections((prev: any[]) => prev.map((s, i) =>
                          i !== sIdx ? s : { ...s, name: e.target.value, ...(selected ? { is_parallel: selected.isParallel } : {}) }
                        ));
                      }}
                    >
                      <option value="Custom">Eigenen Typ wählen</option>
                      {PHASE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
                    </select>
                    <input
                      className="text-2xl font-black text-[#2C1A0E] dark:text-white bg-transparent outline-none w-full tracking-tight"
                      value={section.name}
                      onChange={(e) => {
                        setDoughSections((prev: any[]) => prev.map((s, i) =>
                          i !== sIdx ? s : { ...s, name: e.target.value }
                        ));
                      }}
                    />
                  </div>
                  <button type="button" onClick={() => removeSection(sIdx)} className="text-[#C4A484] dark:text-white/20 hover:text-red-500 dark:hover:text-red-400 self-start pt-2 transition-colors">
                    <Trash2 size={18} />
                  </button>
                </div>

                {/* Grid: Zutaten + Schritte */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                  {/* Zutaten */}
                  <div className="lg:col-span-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#8B7355]">Zutaten</p>
                    <div className="space-y-2">
                      {section.ingredients.map((ing: any, iIdx: number) => (
                        <div key={`ing-${sIdx}-${iIdx}`} className="bg-white dark:bg-white/[0.05] p-3 rounded-xl border border-[#EDE5D6] dark:border-white/[0.07] space-y-2">
                          <div className="flex gap-2">
                            <input
                              placeholder="Zutat"
                              className="flex-1 text-sm font-bold bg-transparent outline-none text-[#2C1A0E] dark:text-white/80 placeholder:text-[#C4A484] dark:placeholder:text-white/25"
                              value={ing.name || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'name', e.target.value)}
                            />
                            <input
                              placeholder="Menge"
                              className="w-16 text-sm font-black text-center bg-[#F5F0E8] dark:bg-white/[0.07] rounded-lg py-1 text-[#2C1A0E] dark:text-white/80 outline-none"
                              value={ing.amount || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'amount', e.target.value)}
                            />
                            <button type="button" onClick={() => {
                              setDoughSections((prev: any[]) => prev.map((s, i) =>
                                i !== sIdx ? s : { ...s, ingredients: s.ingredients.filter((_: any, j: number) => j !== iIdx) }
                              ));
                            }} className="text-[#C4A484] dark:text-white/25 hover:text-red-400 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400 px-2 py-1 rounded-md border border-blue-100/50 dark:border-blue-800/30">
                              <TempIcon size={11} />
                              <input
                                placeholder="°C"
                                className="text-xs font-bold bg-transparent w-8 outline-none dark:text-blue-300"
                                value={ing.temperature || ""}
                                onChange={(e) => updateIngredient(sIdx, iIdx, 'temperature', e.target.value)}
                              />
                            </div>
                            <input
                              placeholder="Notiz..."
                              className="text-xs bg-[#F5F0E8] dark:bg-white/[0.05] text-[#A68B6A] dark:text-white/40 px-2 py-1 rounded-md flex-1 outline-none border border-[#EDE5D6] dark:border-white/[0.07] placeholder:text-[#C4A484] dark:placeholder:text-white/20"
                              value={ing.note || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'note', e.target.value)}
                            />
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={() => addIngredient(sIdx)} className="w-full py-2 border border-dashed border-[#D6C9B4] dark:border-white/[0.10] rounded-xl text-[9px] font-black text-[#A68B6A] dark:text-white/30 hover:text-[#8B7355] dark:hover:text-[#C4A484] hover:border-[#8B7355] dark:hover:border-[#C4A484]/40 uppercase tracking-widest transition-colors">+ Zutat</button>
                    </div>
                  </div>

                  {/* Schritte */}
                  <div className="lg:col-span-7 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#8B7355]">Ablauf</p>
                    <StepList
                      sIdx={sIdx}
                      steps={section.steps || []}
                      updateStepInSection={updateStepInSection}
                      removeStepFromSection={removeStepFromSection}
                      reorderStep={reorderStep}
                    />
                    <button type="button" onClick={() => addStepToSection(sIdx, 'Aktion')} className="w-full py-2 bg-[#F5F0E8] dark:bg-white/[0.04] rounded-xl text-xs font-black uppercase text-[#A68B6A] dark:text-white/30 hover:text-[#8B7355] dark:hover:text-[#C4A484] border border-transparent hover:border-[#D6C9B4] dark:hover:border-white/[0.10] transition-colors">+ Schritt</button>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addSection}
              className="w-full py-4 border-2 border-dashed border-[#D6C9B4] dark:border-white/[0.10] rounded-2xl flex items-center justify-center gap-3 group hover:border-[#8B7355] dark:hover:border-[#C4A484]/40 hover:bg-[#8B7355]/5 dark:hover:bg-[#8B7355]/10 transition-all"
            >
              <Plus size={18} className="text-[#C4A484] dark:text-white/25 group-hover:text-[#8B7355] transition-colors" />
              <span className="text-[10px] font-black uppercase tracking-widest text-[#A68B6A] dark:text-white/30 group-hover:text-[#8B7355] transition-colors">Nächste Phase hinzufügen</span>
            </button>
          </div>

          <div className="pt-8 border-t border-[#EDE5D6] dark:border-white/[0.07]">
            {/* SaveButton extern via SaveButton-Komponente */}
          </div>
        </div>
      </div>

      {showImageModal && availableImages.length > 1 && (
        <ImageSelectModal
          images={availableImages}
          onSelect={(url) => { setImageUrl(url); setShowImageModal(false); }}
          onSkip={() => setShowImageModal(false)}
        />
      )}
    </form>
  );
}

// ─── StepList: verwaltet Drag & Drop State isoliert pro Phase ───────────────

function StepList({ sIdx, steps, updateStepInSection, removeStepFromSection, reorderStep }: {
  sIdx: number;
  steps: any[];
  updateStepInSection: (sIdx: number, stIdx: number, field: string, value: any) => void;
  removeStepFromSection: (sIdx: number, stIdx: number) => void;
  reorderStep: (sIdx: number, from: number, to: number) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {steps.map((step: any, stIdx: number) => {
        const stepType: 'Aktion' | 'Warten' | 'Backen' =
          step.type === 'Warten' ? 'Warten'
          : step.type === 'Backen' ? 'Backen'
          : 'Aktion';

        const isDragOver = dragOverIndex === stIdx;

        return (
          <div
            key={`step-${sIdx}-${stIdx}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(stIdx); }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== stIdx) {
                reorderStep(sIdx, dragIndex.current, stIdx);
              }
              setDragOverIndex(null);
            }}
            className={`flex gap-3 p-4 bg-white dark:bg-white/[0.05] rounded-2xl border shadow-sm relative transition-all ${
              isDragOver
                ? 'border-[#8B7355] bg-[#8B7355]/5 dark:bg-[#8B7355]/10 scale-[1.01]'
                : 'border-[#EDE5D6] dark:border-white/[0.07]'
            }`}
          >
            {/* Drag Handle */}
            <div
              draggable
              onDragStart={() => { dragIndex.current = stIdx; }}
              onDragEnd={() => { dragIndex.current = null; setDragOverIndex(null); }}
              className="flex items-start pt-1 cursor-grab active:cursor-grabbing text-[#C4A484] dark:text-white/20 hover:text-[#8B7355] dark:hover:text-white/40 transition-colors flex-shrink-0"
              title="Ziehen zum Umsortieren"
            >
              <GripVertical size={16} />
            </div>

            <div className="flex-1 space-y-2">
              <textarea
                className="w-full bg-transparent text-sm font-semibold outline-none resize-none leading-snug text-[#2C1A0E] dark:text-white/80 overflow-hidden placeholder:text-[#C4A484] dark:placeholder:text-white/25"
                rows={1}
                placeholder="Schritt..."
                value={step.instruction}
                onChange={(e) => updateStepInSection(sIdx, stIdx, 'instruction', e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }
                }}
              />
              <div className="flex gap-2">
                <select
                  className={`text-xs font-black uppercase px-2 py-1 rounded-md border outline-none ${
                    stepType === 'Backen'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800/40'
                      : stepType === 'Aktion'
                      ? 'bg-[#8B7355]/10 dark:bg-[#8B7355]/20 text-[#8B7355] dark:text-[#C4A484] border-[#8B7355]/20 dark:border-[#8B7355]/30'
                      : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800/40'
                  }`}
                  value={stepType}
                  onChange={(e) => updateStepInSection(sIdx, stIdx, 'type', e.target.value)}
                >
                  <option value="Aktion">Aktion</option>
                  <option value="Warten">Warten</option>
                  <option value="Backen">Backen</option>
                </select>
                {(() => {
                  const THRESHOLD = 120;
                  const toDisplay = (mins: number) => mins >= THRESHOLD
                    ? { value: parseFloat((mins / 60).toFixed(1)), unit: 'Std' as const }
                    : { value: mins, unit: 'Min' as const };
                  const toMins = (val: number, unit: 'Min' | 'Std') =>
                    unit === 'Std' ? Math.round(val * 60) : val;
                  const isRange = step.duration_min !== undefined && step.duration_max !== undefined;
                  const dispMin = isRange ? toDisplay(step.duration_min) : toDisplay(step.duration);
                  const dispMax = isRange ? toDisplay(step.duration_max) : null;
                  const unit = (isRange ? dispMin.unit === 'Std' || dispMax!.unit === 'Std' : dispMin.unit === 'Std') ? 'Std' : 'Min';
                  const toggleUnit = () => {
                    if (!isRange) {
                      updateStepInSection(sIdx, stIdx, 'duration',
                        unit === 'Std' ? Math.max(step.duration, 120) : Math.min(step.duration, 119));
                    }
                  };

                  return (
                    <div className="flex items-center gap-1.5 bg-[#F5F0E8] dark:bg-white/[0.06] px-2 py-1 rounded-md border border-[#EDE5D6] dark:border-white/[0.08] text-xs font-black text-[#A68B6A] dark:text-white/40">
                      <Clock size={11} />
                      {isRange ? (
                        <>
                          <input
                            className="bg-transparent w-10 text-center outline-none text-[#2C1A0E] dark:text-white/70 text-xs"
                            type="number"
                            step={unit === 'Std' ? 0.5 : 5}
                            value={unit === 'Std' ? parseFloat((step.duration_min / 60).toFixed(1)) : step.duration_min || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const mins = toMins(parseFloat(e.target.value) || 0, unit);
                              updateStepInSection(sIdx, stIdx, 'duration_min', mins);
                              updateStepInSection(sIdx, stIdx, 'duration', Math.round((mins + step.duration_max) / 2));
                            }}
                          />
                          <span className="text-[#C4A484] dark:text-white/20">–</span>
                          <input
                            className="bg-transparent w-10 text-center outline-none text-[#2C1A0E] dark:text-white/70 text-xs"
                            type="number"
                            step={unit === 'Std' ? 0.5 : 5}
                            value={unit === 'Std' ? parseFloat((step.duration_max / 60).toFixed(1)) : step.duration_max || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const mins = toMins(parseFloat(e.target.value) || 0, unit);
                              updateStepInSection(sIdx, stIdx, 'duration_max', mins);
                              updateStepInSection(sIdx, stIdx, 'duration', Math.round((step.duration_min + mins) / 2));
                            }}
                          />
                          <button
                            type="button"
                            onClick={toggleUnit}
                            className="text-[10px] font-black text-[#A68B6A] dark:text-white/35 hover:text-[#8B7355] transition-colors px-1 rounded"
                            title={`Zu ${unit === 'Std' ? 'Minuten' : 'Stunden'} wechseln`}
                          >{unit}</button>
                          <button
                            type="button"
                            title="Zurück zu fester Dauer"
                            onClick={() => {
                              const avg = Math.round(((step.duration_min ?? 0) + (step.duration_max ?? 0)) / 2);
                              updateStepInSection(sIdx, stIdx, 'duration', avg || step.duration);
                              updateStepInSection(sIdx, stIdx, 'duration_min', undefined);
                              updateStepInSection(sIdx, stIdx, 'duration_max', undefined);
                            }}
                            className="text-[10px] font-black text-[#C4A484] dark:text-white/20 hover:text-red-400 transition-colors leading-none"
                          >✕</button>
                        </>
                      ) : (
                        <>
                          <input
                            className="bg-transparent w-10 text-center outline-none text-[#2C1A0E] dark:text-white/70 text-xs"
                            type="number"
                            step={unit === 'Std' ? 0.5 : 5}
                            value={unit === 'Std' ? parseFloat((step.duration / 60).toFixed(1)) : step.duration || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const mins = toMins(parseFloat(e.target.value) || 0, unit);
                              updateStepInSection(sIdx, stIdx, 'duration', mins);
                            }}
                          />
                          <button
                            type="button"
                            onClick={toggleUnit}
                            className="text-[10px] font-black text-[#A68B6A] dark:text-white/35 hover:text-[#8B7355] transition-colors px-1 rounded"
                            title={`Zu ${unit === 'Std' ? 'Minuten' : 'Stunden'} wechseln`}
                          >{unit}</button>
                          <button
                            type="button"
                            title="Zeitfenster festlegen"
                            onClick={() => {
                              updateStepInSection(sIdx, stIdx, 'duration_min', step.duration);
                              updateStepInSection(sIdx, stIdx, 'duration_max', step.duration);
                            }}
                            className="text-[10px] font-black text-[#C4A484] dark:text-white/20 hover:text-[#8B7355] transition-colors leading-none"
                          >±</button>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeStepFromSection(sIdx, stIdx)}
              className="text-[#C4A484] dark:text-white/20 hover:text-red-400 dark:hover:text-red-400 self-start transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}