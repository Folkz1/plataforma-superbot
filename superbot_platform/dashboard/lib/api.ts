import axios from 'axios';

// Runtime API URL resolution
// 1. Fetch from /api/config (server-side env var, works in Docker)
// 2. Fallback to NEXT_PUBLIC_API_URL (build-time)
// 3. Fallback to empty string (same-origin)
let _apiUrl: string | null = null;
let _initPromise: Promise<void> | null = null;

async function resolveApiUrl(): Promise<string> {
  if (_apiUrl !== null) return _apiUrl;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.apiUrl) {
      _apiUrl = data.apiUrl;
      return _apiUrl;
    }
  } catch {}
  _apiUrl = '';
  return _apiUrl;
}

function ensureInit(): Promise<void> {
  if (!_initPromise) {
    _initPromise = resolveApiUrl().then((url) => {
      api.defaults.baseURL = url;
    });
  }
  return _initPromise;
}

export const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor: resolve API URL + add JWT token before every request
api.interceptors.request.use(async (config) => {
  await ensureInit();
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor para tratar erros
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (username: string, password: string) =>
    api.post('/api/auth/login', { username, password }),

  logout: () => api.post('/api/auth/logout'),

  me: () => api.get('/api/auth/me'),
};

// Clients API
export const clientsAPI = {
  list: () => api.get('/api/clients'),
  get: (id: string) => api.get(`/api/clients/${id}`),
  create: (data: any) => api.post('/api/clients', data),
  update: (id: string, data: any) => api.patch(`/api/clients/${id}`, data),
  delete: (id: string) => api.delete(`/api/clients/${id}`),
};

// Conversations API
export const conversationsAPI = {
  list: (params?: any) => api.get('/api/conversations', { params }),
  get: (projectId: string, conversationId: string) =>
    api.get(`/api/conversations/${projectId}/${conversationId}`),
  stats: (params?: any) => api.get('/api/conversations/stats', { params }),
};

// Analytics API
export const analyticsAPI = {
  overview: (projectId: string, days?: number) =>
    api.get(`/api/analytics/overview/${projectId}`, { params: { days } }),
  timeline: (projectId: string, days?: number) =>
    api.get(`/api/analytics/timeline/${projectId}`, { params: { days } }),
  channels: (projectId: string) =>
    api.get(`/api/analytics/channels/${projectId}`),
  status: (projectId: string) =>
    api.get(`/api/analytics/status/${projectId}`),
  hourly: (projectId: string, days?: number) =>
    api.get(`/api/analytics/hourly/${projectId}`, { params: { days } }),
};
