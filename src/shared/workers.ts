// Provide both `getWorker` and `getWorkerUrl` on MonacoEnvironment. The standalone web worker
// service uses `getWorker` first, but the extension-host path goes directly through
// `getWorkerUrl(descriptor)` (see extensions-service-override's webWorkerExtensionHost.js).
//
// Vite's `?worker&url` import yields a URL string for a worker chunk that's bundled with all its
// transitive dependencies — works in both dev and production.

import editorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker&url';
import extensionHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';
import textmateWorkerUrl from '@codingame/monaco-vscode-textmate-service-override/worker?worker&url';
import outputLinkWorkerUrl from '@codingame/monaco-vscode-output-service-override/worker?worker&url';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker?: (moduleId: string, label: string) => Worker | Promise<Worker>;
      getWorkerUrl?: (moduleId: string, label: string) => string | undefined;
      getWorkerOptions?: (moduleId: string, label: string) => WorkerOptions | undefined;
    };
  }
}

const urls: Record<string, string> = {
  editorWorkerService: editorWorkerUrl,
  extensionHostWorkerMain: extensionHostWorkerUrl,
  TextMateWorker: textmateWorkerUrl,
  OutputLinkDetectionWorker: outputLinkWorkerUrl,
};

const moduleOptions: WorkerOptions = { type: 'module' };

export function installMonacoEnvironment(extra: Record<string, string> = {}): void {
  const all = { ...urls, ...extra };
  window.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      const url = all[label];
      if (!url) {
        console.warn(`[workers] no URL registered for label: ${label}`);
        return new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })));
      }
      return new Worker(url, moduleOptions);
    },
    getWorkerUrl(_moduleId, label) {
      return all[label];
    },
    getWorkerOptions(_moduleId, _label) {
      return moduleOptions;
    },
  };
}
