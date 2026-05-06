import { compressToURL, decompressFromURL } from '@amoutonbrady/lz-string';
import type { Tab } from './types';

export function encodeTabs(tabs: Tab[]): string {
  return compressToURL(JSON.stringify(tabs));
}

export function decodeTabs(hash: string): Tab[] | null {
  try {
    const json = decompressFromURL(hash);
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((t) => typeof t?.name === 'string' && typeof t?.source === 'string');
  } catch {
    return null;
  }
}
