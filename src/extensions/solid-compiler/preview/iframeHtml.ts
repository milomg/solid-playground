// HTML loaded into the preview webview. Two parts:
//  - sandboxShim: replaces localStorage / window.parent so an opaque-origin iframe doesn't crash
//    when user code touches storage or location (legacy from the original playground).
//  - mainIframeScript: glue that listens for messages from the extension via `vscodeApi`,
//    then executes the compiled bundle by inlining solidrepl: imports as Blob URLs.
//
// The extension uses `panel.webview.postMessage` to send IMPORT_MAP and CODE_UPDATE; the
// webview's `acquireVsCodeApi()` posts back PREVIEW_READY once the listener is wired.

const sandboxShim = `
  (() => {
    const make = () => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        clear: () => { m.clear(); },
        key: (i) => Array.from(m.keys())[i] ?? null,
        get length() { return m.size; },
      };
    };
    try { Object.defineProperty(window, 'localStorage', { value: make(), configurable: true }); } catch {}
    try { Object.defineProperty(window, 'sessionStorage', { value: make(), configurable: true }); } catch {}
  })();
`;

const mainIframeScript = `
  (() => {
    const vscodeApi = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
    const send = (msg) => {
      if (vscodeApi) vscodeApi.postMessage(msg);
      else window.parent.postMessage(msg, '*');
    };

    let finisher = undefined;
    let cache = {};

    const buildModule = (name, source, sources) => {
      if (cache[name]) return cache[name];
      cache[name] = 'error:cyclic import';
      const out = source.replace(/(['"])solidrepl:([^'"]+)\\1/g, (_, q, rel) => {
        if (sources[rel] == null) return q + rel + q;
        return q + buildModule(rel, sources[rel], sources) + q;
      });
      const blob = new Blob([out], { type: 'text/javascript' });
      cache[name] = URL.createObjectURL(blob);
      return cache[name];
    };

    const handleCodeUpdate = (sources) => {
      if (!sources || typeof sources['./main'] !== 'string') return;

      window.dispose?.();
      window.dispose = undefined;

      const appEl = document.getElementById('app');
      if (appEl) appEl.innerHTML = '';

      console.clear();

      document.getElementById('appsrc')?.remove();

      for (const url of Object.values(cache)) {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      cache = {};

      const script = document.createElement('script');
      script.id = 'appsrc';
      script.type = 'module';
      finisher = () => {};
      script.onload = () => {
        if (finisher) finisher();
        finisher = undefined;
      };
      script.src = buildModule('./main', sources['./main'], sources);
      document.body.appendChild(script);

      document.getElementById('load')?.remove();
    };

    const handle = (data) => {
      try {
        const { event, value } = data || {};
        if (event === 'CODE_UPDATE') {
          const next = () => handleCodeUpdate(value);
          if (finisher !== undefined) finisher = next;
          else next();
        } else if (event === 'IMPORT_MAP') {
          document.getElementById('importmap')?.remove();
          const importMap = document.createElement('script');
          importMap.id = 'importmap';
          importMap.type = 'importmap';
          importMap.textContent = JSON.stringify({ imports: value });
          document.head.appendChild(importMap);
        } else if (event === 'DARK') {
          document.documentElement.classList.toggle('dark', value);
        }
      } catch (e) {
        console.error(e);
      }
    };

    window.addEventListener('message', (e) => handle(e.data));
    send({ event: 'PREVIEW_READY' });
  })();
`;

export const iframeHtml = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="https://ga.jspm.io/npm:modern-normalize@3.0.1/modern-normalize.css" rel="stylesheet" />
    <style>
      html, body { position: relative; width: 100%; height: 100%; }
      body {
        color: #333; margin: 0; padding: 8px; box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
        max-width: 100%;
        background: #fff;
      }
      .dark body { color: #e5e7eb; background: #1e1e1e; }
      .dark { color-scheme: dark; }
      input, button, select, textarea {
        padding: 0.4em; margin: 0 0 0.5em 0; box-sizing: border-box;
        border: 1px solid #ccc; border-radius: 2px;
      }
      button { color: #333; background-color: #f4f4f4; outline: none; }
      button:disabled { color: #999; }
      button:not(:disabled):active { background-color: #ddd; }
      button:focus { border-color: #666; }
    </style>
    <script>${sandboxShim}</script>
    <script>${mainIframeScript}</script>
  </head>
  <body>
    <div id="load" style="display: flex; height: 80vh; align-items: center; justify-content: center">
      <p style="font-size: 1.5rem">Compiling...</p>
    </div>
    <div id="app"></div>
  </body>
</html>`;
