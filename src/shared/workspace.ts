import * as monaco from 'monaco-editor';
import {
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
  registerFileSystemOverlay,
  type IStoredWorkspace,
} from '@codingame/monaco-vscode-files-service-override';
import type { Tab } from './types';

export const WORKSPACE_FILE = monaco.Uri.file('/workspace.code-workspace');
export const WORKSPACE_DIR = '/workspace';

// Vendored type declarations for solid-js / csstype, glob-imported as raw text. We write them
// under `/workspace/node_modules/...` so the TS LSP's first module-resolution probe from
// /workspace/main.tsx hits them. Paths are relative to this file because vite's `root` option
// points at `src/full` (or `src/embed`) — absolute paths in import.meta.glob would resolve
// against that root and miss the real project's node_modules.
const solidTypings = import.meta.glob('../../node_modules/solid-js/**/*.{d.ts,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const csstypeTypings = import.meta.glob('../../node_modules/csstype/**/*.{d.ts,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function workspaceUri(name: string): monaco.Uri {
  return monaco.Uri.file(`${WORKSPACE_DIR}/${name}`);
}

export function bootstrapFileSystem(seedTabs: Tab[]): RegisteredFileSystemProvider {
  const fileSystemProvider = new RegisteredFileSystemProvider(false);

  for (const tab of seedTabs) {
    fileSystemProvider.registerFile(new RegisteredMemoryFile(workspaceUri(tab.name), tab.source));
  }

  fileSystemProvider.registerFile(
    new RegisteredMemoryFile(
      WORKSPACE_FILE,
      JSON.stringify(<IStoredWorkspace>{ folders: [{ path: WORKSPACE_DIR }] }, null, 2),
    ),
  );

  for (const [key, content] of Object.entries({ ...solidTypings, ...csstypeTypings })) {
    // Strip the `../../` prefix and rebase under /workspace/node_modules/.
    const tail = key.replace(/^(?:\.\.\/)+/, '/');
    fileSystemProvider.registerFile(new RegisteredMemoryFile(monaco.Uri.file(WORKSPACE_DIR + tail), content));
  }

  registerFileSystemOverlay(1, fileSystemProvider);
  return fileSystemProvider;
}
