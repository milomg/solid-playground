import type * as vscodeNS from 'vscode';
import { encodeTabs } from '../../shared/shareCodec';
import { WORKSPACE_DIR } from '../../shared/workspace';

export function activateShare(vscode: typeof vscodeNS): void {
  const command = 'solid.share.copyLink';

  vscode.commands.registerCommand(command, async () => {
    try {
      const folder = vscode.Uri.file(WORKSPACE_DIR);
      const entries = await vscode.workspace.fs.readDirectory(folder);
      const decoder = new TextDecoder();
      const tabs = await Promise.all(
        entries
          .filter(([name, type]) => type === vscode.FileType.File && name !== 'import_map.json')
          .map(async ([name]) => {
            const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(`${WORKSPACE_DIR}/${name}`));
            return { name, source: decoder.decode(buf) };
          }),
      );
      const hash = encodeTabs(tabs);
      const url = `${window.location.origin}${window.location.pathname}#${hash}`;
      await navigator.clipboard.writeText(url);
      void vscode.window.showInformationMessage('Share link copied to clipboard');
    } catch (e: any) {
      void vscode.window.showErrorMessage(`Share failed: ${e.message ?? String(e)}`);
    }
  });

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(link) Share';
  item.tooltip = 'Copy a shareable link to this playground';
  item.command = command;
  item.show();
}
