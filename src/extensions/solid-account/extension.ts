import type * as vscodeNS from 'vscode';
import { WORKSPACE_DIR } from '../../shared/workspace';
import {
  fetchProfile,
  getToken,
  listMyRepls,
  loginUrl,
  publishRepl,
  setToken,
  updateRepl,
  type APIRepl,
  type User,
} from '../../shared/api';

interface ActiveRepl {
  id: string;
  user?: string;
  data: APIRepl;
}

declare global {
  interface Window {
    __solidPlaygroundRepl?: APIRepl;
  }
}

export interface AccountApi {
  /** Currently active repl (if URL was /{user}/{replId}). */
  active(): ActiveRepl | undefined;
  /** Update the active repl reference (e.g. after publishing the scratchpad). */
  setActive(repl: ActiveRepl | undefined): void;
}

export function activateAccount(vscode: typeof vscodeNS): AccountApi {
  let user: User | null = null;
  const initialRepl = window.__solidPlaygroundRepl;
  let active: ActiveRepl | undefined = initialRepl ? { id: initialRepl.id, data: initialRepl } : undefined;

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  item.show();

  const renderStatus = () => {
    if (user) {
      item.text = `$(account) ${user.display}`;
      item.tooltip = 'Solid account: click for actions';
      item.command = 'solid.account.menu';
    } else {
      item.text = '$(sign-in) Login';
      item.tooltip = 'Sign in with GitHub';
      item.command = 'solid.account.login';
    }
  };
  renderStatus();

  void (async () => {
    if (!getToken()) return;
    user = await fetchProfile();
    renderStatus();
  })();

  vscode.commands.registerCommand('solid.account.login', () => {
    window.location.href = loginUrl();
  });

  vscode.commands.registerCommand('solid.account.signOut', async () => {
    setToken('');
    user = null;
    renderStatus();
    void vscode.window.showInformationMessage('Signed out of Solid');
  });

  vscode.commands.registerCommand('solid.account.menu', async () => {
    const items: (vscodeNS.QuickPickItem & { id: string })[] = [
      { id: 'my-repls', label: '$(repo) My repls', detail: 'Browse and open your saved repls' },
      { id: 'publish', label: '$(cloud-upload) Publish current workspace', detail: 'Save as a new repl' },
      { id: 'sign-out', label: '$(sign-out) Sign out', detail: user ? `Currently signed in as ${user.display}` : '' },
    ];
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Solid account' });
    if (!choice) return;
    if (choice.id === 'my-repls') void vscode.commands.executeCommand('solid.account.openMyRepls');
    else if (choice.id === 'publish') void vscode.commands.executeCommand('solid.account.publish');
    else if (choice.id === 'sign-out') void vscode.commands.executeCommand('solid.account.signOut');
  });

  vscode.commands.registerCommand('solid.account.openMyRepls', async () => {
    if (!getToken()) {
      void vscode.window.showInformationMessage('Sign in to view your repls.');
      return;
    }
    const { list } = await listMyRepls();
    if (list.length === 0) {
      void vscode.window.showInformationMessage('No repls yet. Use "Publish current workspace" to create one.');
      return;
    }
    const items = list.map<vscodeNS.QuickPickItem & { repl: APIRepl }>((r) => ({
      label: r.title || '(untitled)',
      description: r.public ? 'public' : 'private',
      detail: new Date(r.updated_at ?? r.created_at).toLocaleString(),
      repl: r,
    }));
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Open a repl' });
    if (!choice) return;
    const username = user?.display ?? 'me';
    window.location.href = `/${username}/${choice.repl.id}`;
  });

  vscode.commands.registerCommand('solid.account.publish', async () => {
    if (!getToken()) {
      void vscode.window.showInformationMessage('Sign in to publish a repl.');
      return;
    }
    const title = await vscode.window.showInputBox({ prompt: 'Repl title', value: active?.data.title ?? 'Untitled' });
    if (!title) return;
    const folder = vscode.Uri.file(WORKSPACE_DIR);
    const entries = await vscode.workspace.fs.readDirectory(folder);
    const decoder = new TextDecoder();
    const files = await Promise.all(
      entries
        .filter(([name, type]) => type === vscode.FileType.File && name !== 'import_map.json')
        .map(async ([name]) => {
          const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(`${WORKSPACE_DIR}/${name}`));
          return { name, content: decoder.decode(buf) };
        }),
    );
    const created = await publishRepl({ title, files, public: true });
    if (!created) {
      void vscode.window.showErrorMessage('Failed to publish repl.');
      return;
    }
    const username = user?.display ?? 'me';
    window.location.href = `/${username}/${created.id}`;
  });

  // Auto-save when the user has write access — either signed in as the owner, or carrying a
  // stored write_token (set by publish, anonymous edit flow).
  if (active) {
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const SAVE_DEBOUNCE_MS = 1000;

    const flushSave = async () => {
      saveTimer = null;
      const repl = active;
      if (!repl) return;
      const isOwner = !!user && repl.user === user.display;
      const hasWriteToken = localStorage.getItem(repl.id);
      if (!isOwner && !hasWriteToken) return;

      const folder = vscode.Uri.file(WORKSPACE_DIR);
      const entries = await vscode.workspace.fs.readDirectory(folder);
      const decoder = new TextDecoder();
      const files = await Promise.all(
        entries
          .filter(([name, type]) => type === vscode.FileType.File && name !== 'import_map.json')
          .map(async ([name]) => {
            const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(`${WORKSPACE_DIR}/${name}`));
            return { name, content: decoder.decode(buf) };
          }),
      );
      void updateRepl(repl.id, {
        title: repl.data.title,
        version: repl.data.version,
        public: repl.data.public,
        labels: repl.data.labels,
        files,
      });
    };

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') return;
      if (!e.document.uri.path.startsWith(WORKSPACE_DIR + '/')) return;
      if (e.document.uri.path.endsWith('/import_map.json')) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
    });
  }

  return {
    active: () => active,
    setActive: (r) => {
      active = r;
    },
  };
}
