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

// Vendored type declarations for solid-js / csstype, glob-imported as raw text. The keys come
// out as `/node_modules/<pkg>/<rest>`; we write them under `/workspace/node_modules/...` so the
// TS LSP's first module-resolution probe from /workspace/main.tsx hits them.
const solidTypings = import.meta.glob('/node_modules/solid-js/**/*.{d.ts,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const csstypeTypings = import.meta.glob('/node_modules/csstype/**/*.{d.ts,json}', {
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
    const target = monaco.Uri.file(WORKSPACE_DIR + key); // /node_modules/... -> /workspace/node_modules/...
    fileSystemProvider.registerFile(new RegisteredMemoryFile(target, content));
  }

  registerFileSystemOverlay(1, fileSystemProvider);
  return fileSystemProvider;
}
