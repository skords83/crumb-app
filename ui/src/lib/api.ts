// Utility to make authenticated API requests
export async function apiFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('crumb_token');
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {})
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    // Token expired or invalid, redirect to login
    localStorage.removeItem('crumb_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  
  return response;
}
