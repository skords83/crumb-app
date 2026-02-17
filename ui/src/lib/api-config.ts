// lib/api-config.ts
// Dynamische API Konfiguration

export const getApiUrl = (): string => {
  // Client-side: Aus der aktuellen URL ableiten
  if (typeof window !== 'undefined') {
    // Wenn die Seite unter crumb.skords.de läuft, ist die API unter api.skords.de
    const currentHost = window.location.hostname;
    if (currentHost === 'crumb.skords.de') {
      return 'https://api.skords.de';
    }
    // Fallback für andere Hosts
    return (window as any).__ENV__?.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  }
  
  // Server-side: process.env nutzen
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
};
