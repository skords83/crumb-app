// lib/api-config.ts
const getBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    return (window as any).__NEXT_DATA__?.props?.pageProps?.env?.NEXT_PUBLIC_API_URL || 
           process.env.NEXT_PUBLIC_API_URL || 
           'http://localhost:5000';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
};

export const getApiUrl = (): string => {
  const base = getBaseUrl();
  // Wenn base bereits /api enthält, nicht nochmal hinzufügen
  return base.endsWith('/api') ? base : `${base}/api`;
};