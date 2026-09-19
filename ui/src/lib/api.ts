// Utility to make authenticated API requests
export async function apiFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('crumb_token');
  
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

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
