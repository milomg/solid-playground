export const API_BASE = 'https://api.solidjs.com';

// Token reads still fall back to the legacy 'token' key so existing logged-in users carry over.
const TOKEN_KEY = 'solid-playground:token';
const LEGACY_TOKEN_KEY = 'token';

export interface User {
  display: string;
  avatar: string;
}

export interface ReplFile {
  name: string;
  content: string;
}

export interface APIRepl {
  id: string;
  title: string;
  labels: string[];
  files: ReplFile[];
  version: string;
  public: boolean;
  size: number;
  created_at: string;
  updated_at?: string;
}

export interface ReplsResponse {
  total: number;
  list: APIRepl[];
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(LEGACY_TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchProfile(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const r = await fetch(`${API_BASE}/profile`, { headers: authHeaders() });
    if (!r.ok) return null;
    const body = await r.json();
    return { display: body.display, avatar: body.avatar };
  } catch {
    return null;
  }
}

export async function listMyRepls(): Promise<ReplsResponse> {
  if (!getToken()) return { total: 0, list: [] };
  const r = await fetch(`${API_BASE}/repl?`, { headers: authHeaders() });
  if (!r.ok) return { total: 0, list: [] };
  return r.json();
}

export async function fetchRepl(replId: string): Promise<APIRepl | null> {
  try {
    const r = await fetch(`${API_BASE}/repl/${replId}`, { headers: authHeaders() });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function updateRepl(replId: string, body: Partial<APIRepl> & { files: ReplFile[] }): Promise<boolean> {
  const writeToken = localStorage.getItem(replId) ?? undefined;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() };
  const r = await fetch(`${API_BASE}/repl/${replId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(writeToken ? { ...body, write_token: writeToken } : body),
  });
  return r.ok;
}

export async function publishRepl(repl: { title: string; files: ReplFile[]; public: boolean }): Promise<APIRepl | null> {
  const r = await fetch(`${API_BASE}/repl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...repl, version: '1.0', labels: [] as string[] }),
  });
  if (!r.ok) return null;
  const created = (await r.json()) as APIRepl & { write_token?: string };
  if (created.write_token) {
    localStorage.setItem(created.id, created.write_token);
    const repls = JSON.parse(localStorage.getItem('repls') ?? '[]');
    if (!repls.includes(created.id)) {
      repls.push(created.id);
      localStorage.setItem('repls', JSON.stringify(repls));
    }
  }
  return created;
}

export function loginUrl(): string {
  return `${API_BASE}/auth/login?redirect=${encodeURIComponent(window.location.origin + '/login?auth=success')}`;
}

export interface ParsedRoute {
  kind: 'scratchpad' | 'repl' | 'user' | 'login';
  user?: string;
  replId?: string;
  query: URLSearchParams;
  hash: string;
}

export function parseRoute(): ParsedRoute {
  const url = new URL(window.location.href);
  const query = url.searchParams;
  const hash = url.hash.slice(1);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'login') {
    return { kind: 'login', query, hash };
  }
  if (segments.length === 0) {
    return { kind: 'scratchpad', query, hash };
  }
  if (segments.length === 1) {
    return { kind: 'user', user: segments[0], query, hash };
  }
  // {user}/{replId}
  return { kind: 'repl', user: segments[0], replId: segments[1], query, hash };
}
