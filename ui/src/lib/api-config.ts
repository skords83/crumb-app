// lib/api-config.ts
// Dynamische API Konfiguration

export const getApiUrl = (): string => {
  // Client-side
  if (typeof window !== 'undefined') {
    return (window as any).__ENV__?.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  }
  
  // Server-side
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
};
