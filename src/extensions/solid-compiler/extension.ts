import type * as vscodeNS from 'vscode';
import { WORKSPACE_DIR } from '../../shared/workspace';
import { iframeHtml } from './preview/iframeHtml';
import CompileWorker from './compileWorker?worker';
import type { HostMode } from '../index';

export interface CompileResult {
  code: Record<string, string>;
  importMap: Record<string, string>;
}

export interface CompilerExports {
  onDidCompile(listener: (result: CompileResult) => void): { dispose(): void };
  latest(): CompileResult | undefined;
  triggerNow(): void;
  /** Resolves with the first successful compile result. Lets boot pause the editor open
   *  until there's something for the preview/output to render. */
  firstCompile: Promise<CompileResult>;
  iframeHtml: string;
}

const COMPILE_DEBOUNCE_MS = 250;
const OUTPUT_SCHEME = 'solid-output';

export function activateCompiler(vscode: typeof vscodeNS, mode: HostMode): CompilerExports {
  const worker = new CompileWorker();

  let nextId = 0;
  let lastResult: CompileResult | undefined;
  const listeners = new Set<(r: CompileResult) => void>();

  let resolveFirstCompile!: (r: CompileResult) => void;
  const firstCompile = new Promise<CompileResult>((res) => {
    resolveFirstCompile = res;
  });

  const fire = (r: CompileResult) => {
    const wasFirst = lastResult === undefined;
    lastResult = r;
    if (wasFirst) resolveFirstCompile(r);
    for (const l of listeners) {
      try {
        l(r);
      } catch (err) {
        console.error('compile listener error', err);
      }
    }
  };

  let cachedImportMap: Record<string, string> = {};

  worker.addEventListener('error', (e: ErrorEvent) => {
    console.error('[solid-compiler] worker error', e.message, e.error ?? '', `${e.filename}:${e.lineno}:${e.colno}`);
  });
  worker.addEventListener('messageerror', (e) => console.error('[solid-compiler] message error', e));
  worker.addEventListener('message', ({ data }: MessageEvent<any>) => {
    if (data.event === 'ROLLUP') {
      const importMap: Record<string, string> = { ...cachedImportMap };
      for (const k in importMap) {
        if (!(k in data.externals)) delete importMap[k];
      }
      for (const k in data.externals) {
        if (!(k in importMap)) importMap[k] = data.externals[k];
      }
      void writeImportMap(importMap);
      fire({ code: data.compiled, importMap });
      outputProvider.refreshAll();
    } else if (data.event === 'ERROR') {
      void vscode.window.showErrorMessage(`Compile failed: ${data.error?.message ?? 'unknown'}`);
    }
  });

  async function loadImportMap() {
    try {
      const uri = vscode.Uri.file(`${WORKSPACE_DIR}/import_map.json`);
      const buf = await vscode.workspace.fs.readFile(uri);
      cachedImportMap = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      cachedImportMap = {};
    }
  }

  async function writeImportMap(map: Record<string, string>) {
    cachedImportMap = map;
    try {
      const uri = vscode.Uri.file(`${WORKSPACE_DIR}/import_map.json`);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(map, null, 2)));
    } catch (err) {
      console.warn('[solid-compiler] could not write import_map.json', err);
    }
  }

  const COMPILABLE = /\.(tsx?|jsx?|css)$/;

  async function gatherTabs(): Promise<{ name: string; source: string }[]> {
    const folder = vscode.Uri.file(WORKSPACE_DIR);
    const entries = await vscode.workspace.fs.readDirectory(folder);
    const decoder = new TextDecoder();
    return Promise.all(
      entries
        .filter(([name, type]) => type === vscode.FileType.File && COMPILABLE.test(name))
        .map(async ([name]) => {
          const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(`${WORKSPACE_DIR}/${name}`));
          return { name, source: decoder.decode(buf) };
        }),
    );
  }

  let pending: ReturnType<typeof setTimeout> | null = null;
  const triggerCompile = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      pending = null;
      const tabs = await gatherTabs();
      if (tabs.length === 0) {
        console.warn('[solid-compiler] no tabs to compile');
        return;
      }
      worker.postMessage({ event: 'ROLLUP', tabs, id: ++nextId });
    }, COMPILE_DEBOUNCE_MS);
  };

  const outputProvider: vscodeNS.TextDocumentContentProvider & { refreshAll(): void } = {
    onDidChangeEmitter: new vscode.EventEmitter<vscodeNS.Uri>(),
    get onDidChange() {
      return this.onDidChangeEmitter.event;
    },
    provideTextDocumentContent(uri) {
      // uri.path is like '/main.js'; map back to './main' key
      const baseName = uri.path.replace(/^\//, '').replace(/\.js$/, '');
      const key = `./${baseName}`;
      return lastResult?.code?.[key] ?? '// (waiting for first compile)';
    },
    refreshAll() {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === OUTPUT_SCHEME) {
          this.onDidChangeEmitter.fire(doc.uri);
        }
      }
    },
  } as any;
  vscode.workspace.registerTextDocumentContentProvider(OUTPUT_SCHEME, outputProvider);

  vscode.commands.registerCommand('solid.compile.showOutput', async () => {
    const active = vscode.window.activeTextEditor?.document;
    const sourceName = active?.uri.path.startsWith(WORKSPACE_DIR + '/')
      ? active.uri.path.slice(WORKSPACE_DIR.length + 1).replace(/\.(tsx|jsx|ts|js)$/, '')
      : 'main';
    const uri = vscode.Uri.parse(`${OUTPUT_SCHEME}:/${sourceName}.js`);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });

  void loadImportMap().then(triggerCompile);

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme !== 'file') return;
    if (!e.document.uri.path.startsWith(WORKSPACE_DIR + '/')) return;
    if (e.document.uri.path.endsWith('/import_map.json')) return;
    triggerCompile();
  });

  // Webview preview is full-mode only; embed renders its own iframe directly.
  let previewPanel: vscodeNS.WebviewPanel | undefined;
  let previewReady = false;

  const pushToPreview = (r: CompileResult) => {
    if (!previewPanel || !previewReady) return;
    void previewPanel.webview.postMessage({ event: 'IMPORT_MAP', value: r.importMap });
    void previewPanel.webview.postMessage({ event: 'CODE_UPDATE', value: r.code });
  };

  if (mode === 'full') {
    const wirePanel = (panel: vscodeNS.WebviewPanel) => {
      previewPanel = panel;
      panel.webview.html = iframeHtml;
      previewReady = false;
      const sub = panel.webview.onDidReceiveMessage((msg) => {
        if (msg?.event === 'PREVIEW_READY') {
          previewReady = true;
          if (lastResult) pushToPreview(lastResult);
        }
      });
      panel.onDidDispose(() => {
        sub.dispose();
        previewPanel = undefined;
        previewReady = false;
      });
    };

    const openPreview = async () => {
      if (previewPanel) {
        previewPanel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      wirePanel(
        vscode.window.createWebviewPanel(
          'solidPreview',
          'Solid Preview',
          { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
          { enableScripts: true, retainContextWhenHidden: true },
        ),
      );
    };
    vscode.commands.registerCommand('solid.compile.preview', openPreview);

    // Without a serializer, plain reloads restore an empty <iframe> — webview.html doesn't
    // survive serialization, so we have to rewire on deserialize.
    vscode.window.registerWebviewPanelSerializer('solidPreview', {
      async deserializeWebviewPanel(panel) {
        wirePanel(panel);
      },
    });

    listeners.add(pushToPreview);
  }

  return {
    onDidCompile(listener) {
      listeners.add(listener);
      if (lastResult) {
        try {
          listener(lastResult);
        } catch {}
      }
      return { dispose: () => listeners.delete(listener) };
    },
    latest: () => lastResult,
    triggerNow: triggerCompile,
    firstCompile,
    iframeHtml,
  };
}
