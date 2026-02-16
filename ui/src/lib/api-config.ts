// lib/api-config.ts
// Dynamische API Konfiguration - funktioniert sowohl Server- als auch Client-seitig

export const getApiUrl = (): string => {
  // Server-side: process.env nutzen
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  }
  
  // Client-side: window.__ENV__ nutzen (wird von Coolify zur Laufzeit gesetzt)
  return (window as any).__ENV__?.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
};
