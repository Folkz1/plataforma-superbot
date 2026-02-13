import axios, { AxiosRequestConfig } from 'axios';

// Runtime API URL - fetched once from /api/config (Next.js server route)
let _apiUrl = '';
let _resolved = false;
let _fetchPromise: Promise<string> | null = null;

function getApiUrl(): Promise<string> {
  if (_resolved) return Promise.resolve(_apiUrl);
  if (!_fetchPromise) {
    _fetchPromise = fetch('/api/config')
      .then((r) => r.json())
      .then((d) => { _apiUrl = d.apiUrl || ''; _resolved = true; return _apiUrl; })
      .catch(() => { _apiUrl = ''; _resolved = true; return ''; });
  }
  return _fetchPromise;
}

// Create a proxy-like api object that resolves the URL before each call
function makeRequest(method: string) {
  return async (url: string, dataOrConfig?: any, config?: AxiosRequestConfig) => {
    const baseUrl = await getApiUrl();
    const fullUrl = `${baseUrl}${url}`;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    // axios.get/delete signature: (url, config)
    // axios.post/put/patch signature: (url, data, config)
    if (method === 'get' || method === 'delete') {
      return axios[method as 'get'](fullUrl, { headers, ...dataOrConfig });
    }
    return (axios as any)[method](fullUrl, dataOrConfig, { headers, ...config });
  };
}

export const api = {
  get: makeRequest('get'),
  post: makeRequest('post'),
  put: makeRequest('put'),
  patch: makeRequest('patch'),
  delete: makeRequest('delete'),
};

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
