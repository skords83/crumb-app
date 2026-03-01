"use client";

import React, { useMemo } from 'react';
import { 
  Save, 
  Trash2, 
  Plus, 
  Clock, 
  List, 
  Edit3, 
  Type, 
  Thermometer as TempIcon 
} from 'lucide-react';

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

export default function RecipeForm({
  title,
  setTitle,
  imageUrl,
  setImageUrl,
  description,
  setDescription,
  doughSections,
  setDoughSections,
  onSubmit,
  isSubmitting
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
    const newS = [...doughSections];
    newS[sIdx].ingredients.push({ name: "", amount: "", unit: "g", temperature: "", note: "" });
    setDoughSections(newS);
  };

  const updateIngredient = (sIdx: number, iIdx: number, field: string, value: string) => {
    const newS = [...doughSections];
    newS[sIdx].ingredients[iIdx][field] = value;
    setDoughSections(newS);
  };

  const addStepToSection = (sIdx: number, type: 'Aktion' | 'Warten') => {
    const newS = [...doughSections];
    if (!newS[sIdx].steps) newS[sIdx].steps = [];
    newS[sIdx].steps.push({ 
      instruction: "", 
      type: type, 
      duration: type === 'Aktion' ? 5 : 60 
    });
    setDoughSections(newS);
  };

  const updateStepInSection = (sIdx: number, stIdx: number, field: string, value: any) => {
    const newS = [...doughSections];
    newS[sIdx].steps[stIdx][field] = value;
    setDoughSections(newS);
  };

  const removeStepFromSection = (sIdx: number, stIdx: number) => {
    const newS = [...doughSections];
    newS[sIdx].steps = newS[sIdx].steps.filter((_: any, i: number) => i !== stIdx);
    setDoughSections(newS);
  };

  const [isUploading, setIsUploading] = React.useState(false);

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
          totals[key].amount += amount;
        } else {
          totals[key] = { name: ing.name, amount, unit };
        }
      });
    });
    return Object.values(totals);
  }, [doughSections]);

  return (
    <form id="main-recipe-form" onSubmit={onSubmit} className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="bg-white dark:bg-gray-800 rounded-[2.5rem] border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden text-[#2d2d2d] dark:text-gray-100 transition-colors duration-200">
        
        {/* HEADER: BILD & TITEL */}
        <div className="bg-gray-50/50 dark:bg-gray-700/50 p-8 border-b border-gray-100 dark:border-gray-600 flex flex-col md:flex-row gap-8 items-start">
          <div className="group relative w-full md:w-32 h-32 bg-white dark:bg-gray-700 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-600 flex items-center justify-center overflow-hidden shrink-0 shadow-inner hover:border-[#8B7355] transition-all">
            {isUploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#8B7355] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[8px] font-black uppercase text-gray-400">Lädt...</span>
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
              <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                <Plus className="text-gray-300 dark:text-gray-500 mb-1" size={24} />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">Upload</span>
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

          <div className="flex-1 w-full space-y-4">
            <input 
              className="text-4xl font-black w-full bg-transparent dark:bg-transparent outline-none border-b-2 border-transparent focus:border-[#8B7355] pb-2 transition-all tracking-tight placeholder-gray-300 dark:placeholder-gray-600"
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name deines Brotes..."
            />
            <textarea 
              className="w-full bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-xl px-4 py-2 text-sm outline-none focus:border-[#8B7355] shadow-sm resize-none dark:text-gray-100"
              value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beschreibung..."
              rows={2}
            />
            <input 
              className="w-full bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded-xl px-4 py-2 text-xs outline-none focus:border-[#8B7355] shadow-sm text-gray-400 dark:text-gray-300"
              value={imageUrl || ""}
              onChange={(e) => setImageUrl(e.target.value)} 
              placeholder="Bild URL..."
            />
          </div>
        </div>

        <div className="p-8 md:p-12 space-y-12">
          {/* GESAMT-ZUTATENLISTE */}
          {totalIngredients.length > 0 && (
            <div className="bg-[#8B7355]/5 dark:bg-[#8B7355]/10 rounded-3xl p-6 border border-[#8B7355]/10">
              <div className="flex items-center gap-2 mb-4 text-[#8B7355]">
                <List size={18} />
                <h4 className="font-black text-xs uppercase tracking-widest">Gesamtzutaten</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {totalIngredients.map((ing, idx) => (
                  <div key={`total-${idx}`} className="flex flex-col bg-white/60 dark:bg-gray-700/60 px-4 py-2 rounded-2xl border border-white dark:border-gray-600 shadow-sm">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{ing.name}</span>
                    <span className="text-sm font-black text-[#8B7355]">{ing.amount} {ing.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <h3 className="font-black text-2xl flex items-center gap-3">
              <Type className="text-[#8B7355]" size={24} /> Phasen & Ablauf
            </h3>
          </div>

          {/* PHASEN-LOOP */}
          <div className="space-y-6">
            {doughSections.map((section: any, sIdx: number) => (
              <div key={`section-${sIdx}`} className="bg-[#fcfcfc] dark:bg-gray-800/50 rounded-2xl p-6 md:p-8 border border-gray-100 dark:border-gray-700 shadow-sm relative transition-all hover:border-[#8B7355]/20 group">
                
                {/* PHASEN HEADER */}
                <div className="flex flex-col md:flex-row justify-between gap-4 mb-8 pb-4 border-b border-gray-100/50 dark:border-gray-600/50">
                  <div className="flex-1 space-y-2">
                    <select 
                      className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1 text-[10px] font-black uppercase text-[#8B7355] outline-none shadow-sm cursor-pointer"
                      value={PHASE_TYPES.find(t => t.label === section.name) ? section.name : "Custom"}
                      onChange={(e) => {
                        const selected = PHASE_TYPES.find(t => t.label === e.target.value);
                        const newS = [...doughSections];
                        newS[sIdx].name = e.target.value;
                        if (selected) newS[sIdx].is_parallel = selected.isParallel;
                        setDoughSections(newS);
                      }}
                    >
                      <option value="Custom">Eigenen Typ wählen</option>
                      {PHASE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
                    </select>
                    <input 
                      className="text-2xl font-black text-gray-800 dark:text-gray-100 bg-transparent outline-none w-full tracking-tight"
                      value={section.name} 
                      onChange={(e) => {
                        const newS = [...doughSections];
                        newS[sIdx].name = e.target.value;
                        setDoughSections(newS);
                      }}
                    />
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input type="checkbox" className="sr-only peer" checked={section.is_parallel} onChange={(e) => {
                        const newS = [...doughSections];
                        newS[sIdx].is_parallel = e.target.checked;
                        setDoughSections(newS);
                      }} />
                      <div className={`w-7 h-3.5 rounded-full transition-colors relative ${section.is_parallel ? "bg-[#8B7355]" : "bg-gray-200 dark:bg-gray-600"}`}>
                        <div className={`absolute left-0.5 top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${section.is_parallel ? "translate-x-3.5" : ""}`} />
                      </div>
                      <span className="text-[9px] font-black uppercase text-gray-400">Parallel ablaufend</span>
                    </label>
                  </div>
                  <button type="button" onClick={() => removeSection(sIdx)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 self-start pt-2"><Trash2 size={20} /></button>
                </div>

                {/* GRID */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  
                  {/* ZUTATEN */}
                  <div className="lg:col-span-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#8B7355]">Zutaten</p>
                    <div className="space-y-2">
                      {section.ingredients.map((ing: any, iIdx: number) => (
                        <div key={`ing-${sIdx}-${iIdx}`} className="bg-white dark:bg-gray-700 p-3 rounded-xl border border-gray-50 dark:border-gray-600 shadow-sm space-y-2 group/ing relative">
                          <div className="flex gap-2">
                            <input
                              placeholder="Zutat"
                              className="flex-1 text-sm font-bold bg-transparent dark:bg-transparent outline-none dark:text-gray-100"
                              value={ing.name || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'name', e.target.value)}
                            />
                            <input
                              placeholder="Menge"
                              className="w-16 text-sm font-black text-center bg-gray-50 dark:bg-gray-600 rounded-lg py-1 dark:text-gray-100"
                              value={ing.amount || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'amount', e.target.value)}
                            />
                            <button type="button" onClick={() => {
                              const newS = [...doughSections];
                              newS[sIdx].ingredients.splice(iIdx, 1);
                              setDoughSections(newS);
                            }} className="text-gray-300 dark:text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                          </div>
                          <div className="flex gap-2">
                            {/* FIX: text-[9px] → text-xs */}
                            <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-md border border-blue-100/30 dark:border-blue-800/30">
                              <TempIcon size={11} />
                              <input
                                placeholder="°C"
                                className="text-xs font-bold bg-transparent w-8 outline-none dark:text-gray-100"
                                value={ing.temperature || ""}
                                onChange={(e) => updateIngredient(sIdx, iIdx, 'temperature', e.target.value)}
                              />
                            </div>
                            {/* FIX: text-[9px] → text-xs */}
                            <input
                              placeholder="Notiz..."
                              className="text-xs bg-gray-50 dark:bg-gray-600 text-gray-500 dark:text-gray-300 px-2 py-1 rounded-md flex-1 outline-none border border-gray-100 dark:border-gray-500"
                              value={ing.note || ""}
                              onChange={(e) => updateIngredient(sIdx, iIdx, 'note', e.target.value)}
                            />
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={() => addIngredient(sIdx)} className="w-full py-2 border border-dashed border-gray-200 dark:border-gray-600 rounded-xl text-[9px] font-black text-gray-400 hover:text-[#8B7355] uppercase tracking-widest">+ Zutat</button>
                    </div>
                  </div>

                  {/* SCHRITTE */}
                  <div className="lg:col-span-7 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#8B7355]">Ablauf</p>
                    <div className="space-y-3">
                      {section.steps?.map((step: any, stIdx: number) => {
                        // Normalisieren: scraper liefert manchmal undefined/null → default 'Aktion'
                        const stepType: 'Aktion' | 'Warten' | 'Backen' =
                          step.type === 'Warten' ? 'Warten'
                          : step.type === 'Backen' ? 'Backen'
                          : 'Aktion';
                        return (
                        <div key={`step-${sIdx}-${stIdx}`} className="flex gap-3 p-4 bg-white dark:bg-gray-700 rounded-2xl border border-gray-50 dark:border-gray-600 shadow-sm relative group/step">
                          <div className="flex-1 space-y-2">
                            <textarea 
                              className="w-full bg-transparent dark:bg-transparent text-sm font-semibold outline-none resize-none leading-snug dark:text-gray-100"
                              rows={1}
                              placeholder="Schritt..."
                              value={step.instruction}
                              onChange={(e) => updateStepInSection(sIdx, stIdx, 'instruction', e.target.value)}
                            />
                            <div className="flex gap-2">
                              <select 
                                className={`text-xs font-black uppercase px-2 py-1 rounded-md border outline-none ${
                                  stepType === 'Backen'
                                    ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800'
                                    : stepType === 'Aktion'
                                    ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-800'
                                    : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800'
                                }`}
                                value={stepType}
                                onChange={(e) => updateStepInSection(sIdx, stIdx, 'type', e.target.value)}
                              >
                                <option value="Aktion">Aktion</option>
                                <option value="Warten">Warten</option>
                                <option value="Backen">Backen</option>
                              </select>
                              <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-600 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-500 text-xs font-black text-gray-400 dark:text-gray-300">
                                <Clock size={11} />
                                <input
                                  className="bg-transparent dark:bg-transparent w-10 text-center outline-none text-gray-700 dark:text-gray-200 text-xs"
                                  type="number"
                                  value={step.duration}
                                  onChange={(e) => updateStepInSection(sIdx, stIdx, 'duration', parseInt(e.target.value) || 0)}
                                /> Min.
                              </div>
                            </div>
                          </div>
                          <button type="button" onClick={() => removeStepFromSection(sIdx, stIdx)} className="text-gray-300 dark:text-gray-500 hover:text-red-400 self-start"><Trash2 size={14} /></button>
                        </div>
                        );
                      })}
                      {/* FIX: text-[9px] → text-xs */}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => addStepToSection(sIdx, 'Aktion')} className="flex-1 py-2 bg-gray-50 dark:bg-gray-600 rounded-xl text-xs font-black uppercase text-gray-400 dark:text-gray-300 hover:text-[#8B7355] border border-transparent dark:border-gray-500 hover:border-[#8B7355]/20">+ Aktion</button>
                        <button type="button" onClick={() => addStepToSection(sIdx, 'Warten')} className="flex-1 py-2 bg-gray-50 dark:bg-gray-600 rounded-xl text-xs font-black uppercase text-gray-400 dark:text-gray-300 hover:text-[#8B7355] border border-transparent dark:border-gray-500 hover:border-[#8B7355]/20">+ Warten</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button 
              type="button" 
              onClick={addSection} 
              className="w-full py-4 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl flex items-center justify-center gap-3 group hover:border-[#8B7355] hover:bg-[#8B7355]/5 dark:hover:bg-[#8B7355]/10 transition-all mt-4"
            >
              <Plus size={18} className="text-gray-300 dark:text-gray-500 group-hover:text-[#8B7355]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 group-hover:text-[#8B7355]">Nächste Phase hinzufügen</span>
            </button>
          </div>

          <div className="pt-10 border-t border-gray-100 flex justify-end">
            {/* Gespeicherter Button extern via SaveButton */}
          </div>
        </div>
      </div>
    </form>
  );
}