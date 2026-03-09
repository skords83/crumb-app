"use client";

import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';

interface ImageSelectModalProps {
  images: string[];
  onSelect: (url: string) => void;
  onSkip: () => void;
}

export default function ImageSelectModal({ images, onSelect, onSkip }: ImageSelectModalProps) {
  const [selected, setSelected] = useState<string>(images[0] || '');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-[#2d2d2d] dark:text-gray-100">Titelbild auswählen</h2>
            <p className="text-sm text-gray-400 mt-0.5">{images.length} Bilder gefunden</p>
          </div>
          <button onClick={onSkip} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Image Grid */}
        <div className="overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(url)}
              className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                selected === url
                  ? 'border-[#8B7355] ring-2 ring-[#8B7355]/30'
                  : 'border-transparent hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <img src={url} alt={`Bild ${i + 1}`} className="w-full h-full object-cover" />
              {selected === url && (
                <div className="absolute top-2 right-2 bg-[#8B7355] rounded-full p-0.5">
                  <CheckCircle size={16} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onSkip}
            className="flex-1 py-3 rounded-xl font-bold border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Kein Bild
          </button>
          <button
            onClick={() => onSelect(selected)}
            disabled={!selected}
            className="flex-1 py-3 rounded-xl font-bold bg-[#8B7355] text-white hover:bg-[#766248] transition-colors disabled:opacity-50"
          >
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
