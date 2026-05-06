import { decodeTabs } from './shareCodec';
import { defaultTabs } from './defaults';
import { fetchRepl, parseRoute, setToken, type APIRepl } from './api';
import type { Tab } from './types';

declare global {
  interface Window {
    __solidPlaygroundSeed?: Tab[];
    __solidPlaygroundRepl?: APIRepl;
  }
}

const SCRATCHPAD_KEY = 'solid-playground:scratchpad';

function readScratchpad(): Tab[] | null {
  try {
    const raw = localStorage.getItem(SCRATCHPAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.files)) return null;
    return parsed.files
      .filter((f: any) => typeof f?.name === 'string' && typeof f?.content === 'string')
      .map((f: any) => ({ name: f.name, source: f.content }));
  } catch {
    return null;
  }
}

export function persistScratchpad(tabs: Tab[]): void {
  try {
    localStorage.setItem(
      SCRATCHPAD_KEY,
      JSON.stringify({ files: tabs.map((t) => ({ name: t.name, content: t.source })) }),
    );
  } catch {}
}

export interface SeedResult {
  tabs: Tab[];
  repl?: APIRepl;
  /** True when these tabs are intended to be persisted to scratchpad localStorage. */
  persistLocally: boolean;
  /**
   * Stable identifier for the workspace this seed represents. The boot code stashes the most
   * recently used key in localStorage and resets the workbench's tab layout whenever it changes,
   * so old tabs from a different workspace don't restore on top of new files.
   *  - `repl:<id>`   — a remote repl from `/{user}/{replId}`
   *  - `share:<n>`   — a share-link hash; the suffix is content-derived so reload of the same
   *                    link doesn't reset, but a new link does
   *  - `local`       — scratchpad / built-in defaults
   */
  layoutKey: string;
}

/**
 * Resolve the workspace's initial files from URL + storage.
 * - `/login?token=...` — store the token, redirect to `/`, fall through.
 * - `/{user}/{replId}` — fetch the repl from the API.
 * - Any path with `#<lz-string>` — share-link payload, persist to scratchpad.
 * - Otherwise — scratchpad localStorage or built-in defaults.
 */
export async function seedWorkspace(): Promise<SeedResult> {
  const route = parseRoute();

  if (route.kind === 'login') {
    const token = route.query.get('token');
    if (token) setToken(token);
    window.history.replaceState(null, '', '/');
  }

  // Share-link hash takes precedence over everything else (matches the original UX).
  const hash = window.location.hash.slice(1);
  if (hash) {
    const decoded = decodeTabs(hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (decoded && decoded.length) {
      persistScratchpad(decoded);
      window.__solidPlaygroundSeed = decoded;
      return { tabs: decoded, persistLocally: true, layoutKey: `share:${shortHash(hash)}` };
    }
  }

  if (route.kind === 'repl' && route.replId) {
    const repl = await fetchRepl(route.replId);
    if (repl?.files?.length) {
      const tabs: Tab[] = repl.files.map((f) => ({ name: f.name, source: f.content }));
      window.__solidPlaygroundSeed = tabs;
      window.__solidPlaygroundRepl = repl;
      // Don't blow away the user's scratchpad with a remote repl's contents.
      return { tabs, repl, persistLocally: false, layoutKey: `repl:${repl.id}` };
    }
  }

  const stored = readScratchpad();
  const tabs = stored ?? defaultTabs;
  window.__solidPlaygroundSeed = tabs;
  return { tabs, persistLocally: true, layoutKey: 'local' };
}

// Tiny djb2 hash — share-link payloads are big but identical reloads should produce the same
// layoutKey, so we don't reset on the same link.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
