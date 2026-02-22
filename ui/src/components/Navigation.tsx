// src/components/Navigation.tsx
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, FileDown, Clock, Sun, Moon, LogOut, User, ChevronDown, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function Navigation() {
  const pathname = usePathname();
  const isAuthPage = ['/login', '/register', '/forgot-password', '/reset-password'].includes(pathname);
  
  if (isAuthPage) return null;
  
  const { logout, user } = useAuth();
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains('dark');
    setDarkMode(isDark);
  }, []);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
  };

  useEffect(() => {
    const checkActivePlans = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/recipes`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('crumb_token')}`
          }
        });
    const data = await res.json();
    // Fix: prüfen ob data wirklich ein Array ist
    const active = Array.isArray(data) && data.some((r: any) => r.planned_at !== null);
    setHasActivePlan(active);
  } catch (err) {
    console.error("Nav-Check Fehler:", err);
  }
};

    checkActivePlans();
    const interval = setInterval(checkActivePlans, 30000);
    return () => clearInterval(interval);
  }, [pathname]);

  // Rest bleibt gleich...
  const navItems = [
    { name: 'Rezepte', href: '/', icon: LayoutGrid },
    { name: 'Import', href: '/new', icon: FileDown },
  ];

  const allNavItems = [...navItems];
  if (hasActivePlan) {
    allNavItems.push({ name: 'Backplan', href: '/backplan', icon: Clock });
  }

  return (
    <>
      <header className="hidden md:block fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#8B7355] text-white px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
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
          
          <div className="flex items-center gap-4">
            {hasActivePlan && (
              <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest animate-pulse border border-white/20">
                <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
                Backvorgang läuft
              </div>
            )}

            {/* User Menu Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                aria-label="Benutzermenü"
              >
                <User size={20} className="text-white" />
                <ChevronDown size={14} className="text-white" />
              </button>

              {showUserMenu && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {user?.email || 'Benutzer'}
                      </p>
                    </div>
                    <Link
                      href="/profile"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <KeyRound size={16} />
                      Passwort ändern
                    </Link>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <LogOut size={16} />
                      Abmelden
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={toggleTheme}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              aria-label="Dark Mode umschalten"
            >
              {mounted && darkMode ? (
                <Sun size={20} className="text-white" />
              ) : (
                <Moon size={20} className="text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Rest der Navigation bleibt gleich */}
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 flex">
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
                  : isSpecial ? 'text-orange-600 hover:text-orange-700 font-bold' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <div className="relative">
                  <item.icon 
                    size={20} 
                    strokeWidth={isActive ? 2.5 : 2} 
                    className={isSpecial && !isActive ? 'drop-shadow-[0_0_8px_rgba(234,88,12,0.4)]' : ''} 
                  />
                  
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

      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 z-50 flex items-center justify-around pb-safe shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        {allNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={`flex flex-col items-center gap-1 transition-colors ${
                isActive ? 'text-[#8B7355]' : (item.href === '/backplan' ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500')
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