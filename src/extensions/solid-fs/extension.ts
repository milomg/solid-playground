import type * as vscodeNS from 'vscode';
import { persistScratchpad } from '../../shared/seed';
import { WORKSPACE_DIR } from '../../shared/workspace';

export function activateFs(vscode: typeof vscodeNS, persistLocally: boolean): void {
  let pending: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    pending = null;
    // Don't shadow the user's scratchpad with a remote repl's contents.
    if (!persistLocally) return;
    try {
      const folder = vscode.Uri.file(WORKSPACE_DIR);
      const entries = await vscode.workspace.fs.readDirectory(folder);
      const decoder = new TextDecoder();
      const tabs = await Promise.all(
        entries
          .filter(([, type]) => type === vscode.FileType.File)
          .map(async ([name]) => {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(`${WORKSPACE_DIR}/${name}`));
            return { name, source: decoder.decode(content) };
          }),
      );
      persistScratchpad(tabs);
    } catch (err) {
      console.warn('[solid-fs] scratchpad flush failed', err);
    }
  };

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme !== 'file') return;
    if (!e.document.uri.path.startsWith(WORKSPACE_DIR + '/')) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(flush, 500);
  });
}
