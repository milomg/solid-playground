// Side-effect imports: each of these calls `registerExtension` at module-load time, putting the
// extension in the registry BEFORE initServices runs. The workbench reads the registry during
// startup, so .tsx tab restoration picks up the right language id and theme on the first frame.
// Reordering or moving any of these into the boot function regresses syntax highlighting.
//
// `solid-defaults` is our slim fork of stock typescript-basics + json + theme-defaults
// (~250 KB) — declares typescriptreact / typescript / javascript / json + Dark Modern with
// the upstream TextMate grammars. Tokenization runs through our hand-rolled tokenizer
// (extensions/solid-defaults/registerTokens.ts) on top of `oniguruma-to-es` rather than the
// workbench's TextMate engine.
import 'vscode/localExtensionHost';
import '../extensions/solid-defaults';
import '@codingame/monaco-vscode-typescript-language-features-default-extension';

import { initialize as initServices } from '@codingame/monaco-vscode-api';
import { StandaloneServices, IWorkbenchThemeService } from '@codingame/monaco-vscode-api/services';
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override';
import { commands } from 'vscode';

import { buildFullServices } from '../shared/services';
import { installMonacoEnvironment } from '../shared/workers';
import { seedWorkspace } from '../shared/seed';
import { bootstrapFileSystem, WORKSPACE_FILE, workspaceUri } from '../shared/workspace';
import { registerSolidExtensions } from '../extensions';

const LAYOUT_KEY_STORAGE = 'solid-playground:layout-key';

async function boot() {
  const seed = await seedWorkspace();
  installMonacoEnvironment();
  bootstrapFileSystem(seed.tabs);

  // Reset the workbench tab layout only when the workspace identity changes (different repl,
  // new share link, first ever load). Same workspace as last time → restore the saved layout
  // untouched, so closed panes stay closed.
  const previousKey = localStorage.getItem(LAYOUT_KEY_STORAGE);
  const resetLayout = previousKey !== seed.layoutKey;
  if (resetLayout) localStorage.setItem(LAYOUT_KEY_STORAGE, seed.layoutKey);

  const container = document.getElementById('app')!;
  container.style.height = '100vh';

  await initServices(
    {
      ...buildFullServices(),
      ...getFilesServiceOverride(),
      ...getWorkbenchServiceOverride(),
    },
    container,
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
        'editor.fontSize': 14,
        'editor.minimap.enabled': false,
      },
      productConfiguration: {
        nameShort: 'Solid Playground',
        nameLong: 'Solid Playground',
      },
      defaultLayout: {
        editors: [{ uri: workspaceUri('main.tsx'), viewColumn: 1 }],
        force: resetLayout,
      },
    },
  );

  await registerSolidExtensions('full', { persistLocally: seed.persistLocally, repl: seed.repl });

  // The `workbench.colorTheme` config in initServices' configurationDefaults races extension
  // registration — on first boot the theme is read before the contribution lands and the
  // workbench falls back to vs-dark (7-color palette, no real syntax colors). Re-apply it
  // explicitly here.
  void applyDarkModernTheme();

  // Output and preview can't go in defaultLayout.editors (custom-scheme document + webview); open
  // them post-init only when applying a fresh layout. Webview restoration on plain reload is
  // handled by a WebviewPanelSerializer in the compiler extension.
  if (resetLayout) {
    await commands.executeCommand('solid.compile.showOutput');
    await commands.executeCommand('solid.compile.preview');
  }
}

async function applyDarkModernTheme(): Promise<void> {
  try {
    const themeService = StandaloneServices.get(IWorkbenchThemeService);
    if (themeService.getColorTheme().settingsId === 'Default Dark Modern') return;
    const themes = await themeService.getColorThemes();
    const dark = themes.find((t) => t.settingsId === 'Default Dark Modern');
    if (dark) await themeService.setColorTheme(dark.id, 'auto');
  } catch (err) {
    console.warn('Theme apply failed', err);
  }
}

boot().catch((err) => {
  console.error('Workbench failed to boot', err);
  document.getElementById('app')!.innerHTML = `<pre style="color:#fff;padding:16px">Failed to boot: ${err?.message ?? err}</pre>`;
});
