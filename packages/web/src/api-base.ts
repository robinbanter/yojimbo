/// <reference types="vite/client" />
// Hosted frontend (Vercel): VITE_API_BASE points the app at the backend on the VPS, e.g.
// https://<app>.201-18-198-162.sslip.io/api. Every fetch and EventSource the app opens on /api/... then goes to that
// base instead. Unset (local dev with the Vite proxy, or the VPS copy on the same origin), nothing changes.
const base = import.meta.env.VITE_API_BASE?.replace(/\/+$/, '');
if (base) {
  const map = (url: string) => (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? base + url.slice(4) : url);
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => nativeFetch(typeof input === 'string' ? map(input) : input, init);
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(typeof url === 'string' ? map(url) : url, init);
    }
  };
}
export {};
