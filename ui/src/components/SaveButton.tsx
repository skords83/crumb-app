"use client";

import React from 'react';
import { Save, Loader2, Plus } from 'lucide-react';

interface SaveButtonProps {
  isSaving: boolean;
  type?: 'save' | 'create';
  formId?: string;
}

export default function SaveButton({ 
  isSaving, 
  type = 'save', 
  formId = 'main-recipe-form' 
}: SaveButtonProps) {
  return (
    <button 
      type="submit"
      form={formId}
      disabled={isSaving}
      className="fixed bottom-10 right-10 z-50 flex items-center gap-3 pl-7 pr-8 py-4 bg-[#8B7355] text-white rounded-2xl shadow-[0_20px_50px_rgba(139,115,85,0.3)] transition-all duration-300 hover:bg-[#766248] hover:shadow-[0_10px_30px_rgba(139,115,85,0.4)] active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
    >
      <div className="flex items-center justify-center w-5 h-5">
        {isSaving ? (
          <Loader2 className="animate-spin" size={18} strokeWidth={3} />
        ) : (
          type === 'create' ? <Plus size={18} strokeWidth={2.5} /> : <Save size={18} strokeWidth={2.5} />
        )}
      </div>
      
      <span className="text-[9px] font-black uppercase tracking-[0.2em] leading-none mt-0.5">
        {isSaving 
          ? (type === 'create' ? "Erstelle Rezept..." : "Sichere Daten...") 
          : (type === 'create' ? "Rezept Erstellen" : "Rezept Sichern")}
      </span>
    </button>
  );
}