// See full/main.ts for the side-effect import contract. Embed skips
// typescript-language-features (~6 MB tsserver) — no diagnostics needed.
import 'vscode/localExtensionHost';
import '../extensions/solid-defaults';

import * as monaco from 'monaco-editor';
import { initialize as initServices } from '@codingame/monaco-vscode-api';
import getEditorServiceOverride from '@codingame/monaco-vscode-editor-service-override';
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override';
import getHostServiceOverride from '@codingame/monaco-vscode-host-service-override';

import { buildEmbedServices } from '../shared/services';
import { installMonacoEnvironment } from '../shared/workers';
import { seedWorkspace } from '../shared/seed';
import { bootstrapFileSystem, WORKSPACE_FILE, workspaceUri } from '../shared/workspace';
import { registerSolidExtensions } from '../extensions';
import { iframeHtml } from '../extensions/solid-compiler/preview/iframeHtml';

async function boot() {
  const seed = await seedWorkspace();
  installMonacoEnvironment();
  bootstrapFileSystem(seed.tabs);

  await initServices(
    {
      ...buildEmbedServices(),
      ...getFilesServiceOverride(),
      ...getEditorServiceOverride(async () => undefined as any),
      ...getHostServiceOverride(),
    },
    document.body,
    {
      workspaceProvider: {
        trusted: true,
        workspace: { workspaceUri: WORKSPACE_FILE },
        async open() {
          window.open(window.location.href);
          return true;
        },
      },
      configurationDefaults: {
        'workbench.colorTheme': 'Default Dark Modern',
        'editor.formatOnSave': true,
        'editor.fontSize': 13,
        'editor.minimap.enabled': false,
        'editor.lineNumbers': 'off',
      },
      productConfiguration: {
        nameShort: 'Solid Playground',
        nameLong: 'Solid Playground',
      },
    },
  );

  const mainUri = workspaceUri('main.tsx');
  const modelRef = await monaco.editor.createModelReference(mainUri);
  monaco.editor.create(document.getElementById('editor')!, {
    model: modelRef.object.textEditorModel,
    automaticLayout: true,
    theme: 'Default Dark Modern',
  });

  const { compiler } = await registerSolidExtensions('embed', { persistLocally: seed.persistLocally });

  const previewHost = document.getElementById('preview-host')!;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-pointer-lock');
  iframe.setAttribute('title', 'Solid Preview');
  iframe.srcdoc = iframeHtml;
  previewHost.appendChild(iframe);

  let iframeReady = false;
  const sendToIframe = (msg: any) => {
    if (iframeReady) iframe.contentWindow!.postMessage(msg, '*');
  };

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.event === 'PREVIEW_READY') {
      iframeReady = true;
      const latest = compiler.latest();
      if (latest) {
        sendToIframe({ event: 'IMPORT_MAP', value: latest.importMap });
        sendToIframe({ event: 'CODE_UPDATE', value: latest.code });
      }
    }
  });

  compiler.onDidCompile((r) => {
    sendToIframe({ event: 'IMPORT_MAP', value: r.importMap });
    sendToIframe({ event: 'CODE_UPDATE', value: r.code });
  });
}

boot().catch((err) => {
  console.error('Embed failed to boot', err);
  document.getElementById('root')!.innerHTML = `<pre style="color:#fff;padding:16px">Failed to boot: ${err?.message ?? err}</pre>`;
});
