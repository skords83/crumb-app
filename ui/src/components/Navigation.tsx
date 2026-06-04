// src/components/Navigation.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, FileDown, Clock, Sun, Moon, LogOut, ChevronDown, Download, Search, Settings, Flame } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { calculateBackplan, parseLocalDate } from '@/lib/backplan-utils';

type PlanPhase = 'idle' | 'planned' | 'upcoming' | 'active' | 'baking';
interface SmartStatus { phase: PlanPhase; label: string; sublabel?: string; recipeName?: string; pulse: boolean; }

function formatSmartTime(date: Date): string { return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`; }
function formatCountdownShort(ms: number): string { const t=Math.max(0,Math.floor(ms/60000)); if(t<60)return`${t} min`; const h=Math.floor(t/60),m=t%60; return m>0?`${h}h ${m}min`:`${h}h`; }
function formatSmartDay(date: Date): string { const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),target=new Date(date.getFullYear(),date.getMonth(),date.getDate()),diff=Math.round((target.getTime()-today.getTime())/86400000); if(diff===0)return'heute'; if(diff===1)return'morgen'; return['So','Mo','Di','Mi','Do','Fr','Sa'][date.getDay()]; }
function stepTypeLabel(type: string): string { return type==='Backen'?'Backen':type==='Kneten'?'Kneten':type==='Aktion'?'Nächste Aktion':type==='Warten'?'Ruhezeit':type; }
function shortInstruction(instruction: string, maxLen=28): string { if(!instruction)return'Aktion'; const t=instruction.trim(); return t.length<=maxLen?t:t.slice(0,maxLen).trimEnd()+'…'; }

function computeSmartStatus(plannedRecipes: any[], now: Date): SmartStatus {
  if(!plannedRecipes||plannedRecipes.length===0)return{phase:'idle',label:'',pulse:false};
  let best: SmartStatus={phase:'planned',label:'',pulse:false};
  let closestMs=Infinity;
  for(const recipe of plannedRecipes){
    if(!recipe.planned_at||!recipe.dough_sections?.length)continue;
    const tl=calculateBackplan(parseLocalDate(recipe.planned_at),recipe.dough_sections);
    if(tl.length===0)continue;
    const nowMs=now.getTime();
    const active=tl.find(s=>nowMs>=s.start.getTime()&&nowMs<s.end.getTime());
    const next=tl.find(s=>s.start.getTime()>nowMs&&(s.type==='Aktion'||s.type==='Backen'||s.type==='Kneten'));
    if(active&&active.type==='Backen')return{phase:'baking',label:recipe.title,sublabel:`Backen · noch ${formatCountdownShort(active.end.getTime()-nowMs)}`,recipeName:recipe.title,pulse:true};
    if(active&&(active.type==='Aktion'||active.type==='Kneten'))return{phase:'active',label:recipe.title,sublabel:`Jetzt: ${shortInstruction(active.instruction)}`,recipeName:recipe.title,pulse:true};
    if(next){const ms=next.start.getTime()-nowMs;if(ms<2*3600000&&ms<closestMs){closestMs=ms;best={phase:'upcoming',label:recipe.title,sublabel:`${stepTypeLabel(next.type)} in ${formatCountdownShort(ms)}`,recipeName:recipe.title,pulse:false};}}
    if(best.phase!=='upcoming'&&next){const ms=next.start.getTime()-nowMs;if(ms>=2*3600000&&ms<12*3600000&&best.phase==='planned'&&!best.label)best={phase:'planned',label:recipe.title,sublabel:`${formatSmartDay(next.start)} ${formatSmartTime(next.start)} · ${stepTypeLabel(next.type)}`,pulse:false};}
  }
  if(best.phase==='planned'&&!best.label)return{phase:'idle',label:'',pulse:false};
  return best;
}

function getStatusStyle(phase: PlanPhase){
  switch(phase){
    case'baking': return{bg:'bg-red-100 border-red-200 dark:bg-red-500/30 dark:border-red-400/40',dot:'bg-red-500',text:'text-red-700 dark:text-white'};
    case'active': return{bg:'bg-orange-100 border-orange-200 dark:bg-orange-500/30 dark:border-orange-400/40',dot:'bg-orange-500 dark:bg-orange-400',text:'text-orange-700 dark:text-white'};
    case'upcoming':return{bg:'bg-amber-50 border-amber-200 dark:bg-amber-500/20 dark:border-amber-400/30',dot:'bg-amber-500 dark:bg-amber-400',text:'text-amber-700 dark:text-white'};
    default:return{bg:'bg-[#8B7355]/10 border-[#8B7355]/20 dark:bg-white/10 dark:border-white/15',dot:'bg-[#8B7355]/50 dark:bg-white/50',text:'text-[#5C3D1E] dark:text-white/80'};
  }
}

export default function Navigation() {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  const { canInstall, install } = usePWAInstall();
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [plannedRecipes, setPlannedRecipes] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [darkMode, setDarkMode] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isAuthPage = ['/login','/register','/forgot-password','/reset-password'].includes(pathname);

  useEffect(() => {
    setMounted(true);
    setDarkMode(document.documentElement.classList.contains('dark'));
    const saved = localStorage.getItem('theme');
    if(saved==='dark') { setDarkMode(true); document.documentElement.classList.add('dark'); }
    else if(saved==='light') { setDarkMode(false); document.documentElement.classList.remove('dark'); }
  }, []);

  const toggleTheme = () => { setDarkMode(!darkMode); document.documentElement.classList.toggle('dark'); localStorage.setItem('theme',!darkMode?'dark':'light'); };

  useEffect(() => {
    if(isAuthPage)return;
    const check=async()=>{try{const res=await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bake-sessions/active`,{headers:{'Authorization':`Bearer ${localStorage.getItem('crumb_token')}`}});const data=await res.json();setHasActivePlan(Array.isArray(data)&&data.length>0);}catch{}};
    check(); const i=setInterval(check,30000); return()=>clearInterval(i);
  },[pathname,isAuthPage]);

  useEffect(()=>{if(!hasActivePlan)return;const t=setInterval(()=>setCurrentTime(new Date()),30000);return()=>clearInterval(t);},[hasActivePlan]);

  const smartStatus=useMemo(()=>computeSmartStatus(plannedRecipes,currentTime),[plannedRecipes,Math.floor(currentTime.getTime()/30000)]);

  if(isAuthPage)return null;

  const navItems=[{name:'Rezepte',href:'/',icon:LayoutGrid},{name:'Suche',href:'/search',icon:Search},{name:'Import',href:'/new',icon:FileDown}];
  const allNavItems=[...navItems];
  if(hasActivePlan)allNavItems.push({name:'Backplan',href:'/backplan',icon:Clock});

  const ss=getStatusStyle(smartStatus.phase);
  const StatusBadge=hasActivePlan&&smartStatus.phase!=='idle'&&smartStatus.label?(
    <Link href="/backplan" className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full border transition-all hover:scale-[1.02] active:scale-[0.98] ${ss.bg} ${smartStatus.pulse?'animate-pulse':''}`}>
      {smartStatus.phase==='baking'?<Flame size={14} className="text-red-500 dark:text-red-300 flex-shrink-0"/>:<div className={`w-2 h-2 rounded-full flex-shrink-0 ${ss.dot}`}/>}
      <div className="flex flex-col leading-tight">
        <span className={`text-[12px] font-extrabold truncate max-w-[160px] ${ss.text}`}>{smartStatus.label}</span>
        {smartStatus.sublabel&&<span className={`text-[10px] opacity-60 font-medium ${ss.text}`}>{smartStatus.sublabel}</span>}
      </div>
    </Link>
  ):null;

  const isSettingsPage = pathname.startsWith('/settings') || pathname.startsWith('/profile');

  return (
    <>
      {/* ── DESKTOP HEADER ── */}
      <header className="hidden md:block fixed top-0 left-0 right-0 z-50 bg-[#F5F0E8] dark:bg-[#0F172A] border-b border-[#D6C9B4] dark:border-white/[0.07]">
        <div className="px-8 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="py-5 text-[1.65rem] leading-none tracking-tight text-[#2C1A0E] dark:text-[#F5EDD8] flex items-end" style={{fontFamily:'var(--font-dm-serif),serif'}}>
              crumb<span className="inline-block w-[5px] h-[5px] rounded-full bg-[#8B7355] dark:bg-[#C4A484] ml-[3px] mb-[5px]"/>
            </h1>
            <nav className="flex">
              {allNavItems.map((item)=>{
                const isActive=pathname===item.href;
                const isSpecial=item.href==='/backplan';
                return(
                  <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 px-5 py-5 text-sm font-medium transition-all relative ${isActive?'text-[#8B7355] dark:text-[#C4A484]':isSpecial?'text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 font-bold':'text-[#A68B6A] hover:text-[#5C3D1E] dark:text-white/40 dark:hover:text-white/75'}`}>
                    <div className="relative">
                      <item.icon size={16} strokeWidth={isActive?2.5:2} className={isSpecial&&!isActive?'drop-shadow-[0_0_6px_rgba(234,88,12,0.4)]':''}/>
                      {isSpecial&&!isActive&&<span className="absolute -top-1 -right-1 flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"/><span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"/></span>}
                    </div>
                    {item.name}
                    {isActive&&<div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B7355] dark:bg-[#C4A484]"/>}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {StatusBadge}
            {canInstall&&<button onClick={install} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#8B7355]/10 dark:bg-white/10 hover:bg-[#8B7355]/20 dark:hover:bg-white/15 transition-colors text-[#5C3D1E] dark:text-white/60 text-xs font-bold border border-[#D6C9B4] dark:border-transparent"><Download size={14}/>Installieren</button>}
            <button onClick={toggleTheme} className="p-2 rounded-full bg-[#8B7355]/10 dark:bg-white/10 hover:bg-[#8B7355]/15 dark:hover:bg-white/15 transition-colors border border-[#D6C9B4] dark:border-transparent">
              {mounted&&darkMode?<Sun size={18} className="text-[#8B7355] dark:text-white/60"/>:<Moon size={18} className="text-[#8B7355] dark:text-white/60"/>}
            </button>

            {/* ── USER MENU ── */}
            <div className="relative">
              <button onClick={()=>setShowUserMenu(!showUserMenu)} className="flex items-center gap-2 p-2 rounded-full bg-[#8B7355]/10 dark:bg-white/10 hover:bg-[#8B7355]/15 dark:hover:bg-white/15 transition-colors border border-[#D6C9B4] dark:border-transparent">
                <div className="w-6 h-6 rounded-full bg-[#8B7355] flex items-center justify-center text-white text-xs font-bold">{user?.username?user.username.slice(0,2).toUpperCase():'?'}</div>
                <ChevronDown size={14} className="text-[#8B7355] dark:text-white/40"/>
              </button>
              {showUserMenu&&(
                <>
                  <div className="fixed inset-0 z-40" onClick={()=>setShowUserMenu(false)}/>
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-[#D6C9B4] dark:border-white/10 py-1.5 z-50">
                    {/* Header */}
                    <div className="px-4 py-2.5 border-b border-[#EDE5D6] dark:border-white/10">
                      <p className="text-sm font-bold text-[#2C1A0E] dark:text-white/90">{user?.username||'Benutzer'}</p>
                      <p className="text-xs text-[#A68B6A] dark:text-white/40">{user?.email}</p>
                    </div>

                    {/* Nav-Links */}
                    <div className="py-1">
                      <Link
                        href="/settings"
                        onClick={()=>setShowUserMenu(false)}
                        className={`flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-[#F5F0E8] dark:hover:bg-white/5 border-b border-[#EDE5D6] dark:border-white/10 ${isSettingsPage?'text-[#8B7355] dark:text-[#C4A484]':'text-[#5C3D1E] dark:text-white/70'}`}
                      >
                        <div className="flex items-center gap-3">
                          <Settings size={15} className={isSettingsPage?'text-[#8B7355]':'text-[#C4A484] dark:text-white/30'}/>
                          Einstellungen
                        </div>
                        <ChevronDown size={12} className="-rotate-90 text-[#C4A484] dark:text-white/20"/>
                      </Link>
                    </div>

                    {/* Abmelden */}
                    <div className="py-1">
                      <button
                        onClick={()=>{setShowUserMenu(false);logout();}}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut size={15}/>
                        Abmelden
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#F5F0E8] dark:bg-[#0F172A] border-t border-[#D6C9B4] dark:border-white/[0.07]">
        <div className="flex items-center justify-around h-16 pb-safe">
          {allNavItems.map((item)=>{
            const isActive=pathname===item.href;
            return(
              <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 transition-colors px-4 ${isActive?'text-[#8B7355] dark:text-[#C4A484]':item.href==='/backplan'?'text-orange-500 dark:text-orange-400':'text-[#C4A484] dark:text-white/35'}`}>
                <div className="relative">
                  <item.icon size={22} strokeWidth={isActive?2.5:2}/>
                  {item.href==='/backplan'&&!isActive&&<span className="absolute -top-1 -right-1 flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"/><span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"/></span>}
                </div>
                <span className="text-[10px] font-medium">{item.name}</span>
              </Link>
            );
          })}
          {/* Settings-Link in mobile nav */}
          <Link href="/settings" className={`flex flex-col items-center gap-1 transition-colors px-4 ${pathname.startsWith('/settings')||pathname.startsWith('/profile')?'text-[#8B7355] dark:text-[#C4A484]':'text-[#C4A484] dark:text-white/35'}`}>
            <Settings size={22} strokeWidth={2}/>
            <span className="text-[10px] font-medium">Profil</span>
          </Link>
          {canInstall&&<button onClick={install} className="flex flex-col items-center gap-1 text-[#8B7355] dark:text-[#C4A484] px-4"><Download size={22} strokeWidth={2}/><span className="text-[10px] font-medium">Installieren</span></button>}
        </div>
      </nav>
    </>
  );
}