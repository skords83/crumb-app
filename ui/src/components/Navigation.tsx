"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, FileDown, Clock } from 'lucide-react';
import Image from 'next/image';

export default function Navigation() {
  const pathname = usePathname();
  const [hasActivePlan, setHasActivePlan] = useState(false);

  // Prüfen, ob ein Backplan aktiv ist
  useEffect(() => {
    const checkActivePlans = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/recipes`);
        const data = await res.json();
        // Prüfen, ob irgendein Rezept ein Datum in "planned_at" hat
        const active = data.some((r: any) => r.planned_at !== null);
        setHasActivePlan(active);
      } catch (err) {
        console.error("Nav-Check Fehler:", err);
      }
    };

    checkActivePlans();
    // Intervall, um alle 30 Sek. zu prüfen (optional, falls man im Hintergrund plant)
    const interval = setInterval(checkActivePlans, 30000);
    return () => clearInterval(interval);
  }, [pathname]); // Prüft bei jedem Seitenwechsel neu

  // Basis-Items
  const navItems = [
    { name: 'Rezepte', href: '/', icon: LayoutGrid },
    { name: 'Import', href: '/new', icon: FileDown },
  ];

  // Backplan-Item (wird nur hinzugefügt, wenn aktiv)
  const allNavItems = [...navItems];
  if (hasActivePlan) {
    allNavItems.push({ name: 'Backplan', href: '/backplan', icon: Clock });
  }

  return (
    <>
      {/* DESKTOP HEADER */}
      <header className="hidden md:block fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#8B7355] text-white px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
          {/* Container für das Logo */}
          <div className="w-14 h-14 border-2 border-white/30 rounded-full flex items-center justify-center bg-white/10 overflow-hidden relative">
            <img 
              src="/logo.png" 
              alt="Crumb Logo"
              className="w-11 h-11 object-contain" 
            />
          </div>
          
<div className="flex flex-col">
  <h1 className="text-2xl font-black tracking-[-0.05em] text-white leading-none uppercase">
    Crumb
  </h1>
  <div className="h-[2px] w-full bg-white/30 mt-1 rounded-full"></div>
  <p className="text-[10px] font-medium tracking-[0.3em] text-white/80 uppercase mt-1">
        Perfect Bread, Perfect Timing
  </p>
</div>

        </div>
          
          {/* Kleiner Indikator im Brand-Bereich, wenn ein Plan läuft */}
          {hasActivePlan && (
            <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest animate-pulse border border-white/20">
              <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
              Backvorgang läuft
            </div>
          )}
        </div>

        <nav className="bg-white border-b border-gray-200 px-8 flex">
  {allNavItems.map((item) => {
    const isActive = pathname === item.href;
    const isSpecial = item.href === '/backplan';
    
    return (
      <Link 
        key={item.href} 
        href={item.href}
        className={`flex items-center gap-3 px-6 py-4 text-sm font-medium transition-all relative group ${
          isActive 
          ? 'text-[#8B7355]' 
          : isSpecial ? 'text-orange-600 hover:text-orange-700 font-bold' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        <div className="relative">
          <item.icon 
            size={20} 
            strokeWidth={isActive ? 2.5 : 2} 
            className={isSpecial && !isActive ? 'drop-shadow-[0_0_8px_rgba(234,88,12,0.4)]' : ''} 
          />
          
          {/* Status-Dot Anzeige */}
          {isSpecial && !isActive && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-600 border border-white"></span>
            </span>
          )}
        </div>

        {item.name}

        {isActive && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#8B7355]" />
        )}
      </Link>
    );
  })}
</nav>
      </header>

      {/* MOBILE TAB BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-100 z-50 flex items-center justify-around pb-safe shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {allNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={`flex flex-col items-center gap-1 transition-colors ${
                isActive ? 'text-[#8B7355]' : (item.href === '/backplan' ? 'text-orange-500' : 'text-gray-400')
              }`}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}