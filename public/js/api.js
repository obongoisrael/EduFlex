/** Tiny fetch wrapper for the EduFlex API. Throws Error(message) on non-2xx. */
const API = {
  async request(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (body instanceof FormData) {
        opts.body = body; // browser sets the multipart boundary
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.replace('/login.html');
      throw new Error('Not authenticated');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
  get: (url) => API.request('GET', url),
  post: (url, body) => API.request('POST', url, body),
  put: (url, body) => API.request('PUT', url, body),
  patch: (url, body) => API.request('PATCH', url, body),
  del: (url) => API.request('DELETE', url),
};
