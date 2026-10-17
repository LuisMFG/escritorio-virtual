import * as vscode from 'vscode';
import { ActivityTracker, type Heartbeat } from './tracker.js';

const TOKEN_KEY = 'escritorio.token';
const TICK_MS = 15_000;

type Status = 'unconfigured' | 'ok' | 'paused' | 'error';

/**
 * Extensão "Escritório Virtual — Atividade": manda ao escritório quando a pessoa está
 * programando (linguagem e nome do projeto). O que aparece para os outros é decidido pela
 * privacidade escolhida no Perfil do escritório.
 */
export function activate(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(bar);
  let paused = context.globalState.get<boolean>('escritorio.paused', false);
  let token: string | undefined;

  const serverUrl = () =>
    vscode.workspace
      .getConfiguration('escritorio')
      .get<string>('serverUrl', '')
      .trim()
      .replace(/\/+$/, '');

  const setStatus = (status: Status, detail = '') => {
    const map: Record<Status, [string, string, string]> = {
      unconfigured: [
        '$(plug) Escritório',
        'Clique para conectar ao Escritório Virtual',
        'escritorio.connect',
      ],
      ok: [
        '$(broadcast) Escritório',
        'Conectado: o escritório vê quando você está programando. Clique para pausar.',
        'escritorio.togglePause',
      ],
      paused: [
        '$(debug-pause) Escritório',
        'Pausado: nada é enviado. Clique para retomar.',
        'escritorio.togglePause',
      ],
      error: [
        '$(warning) Escritório',
        `Não foi possível enviar: ${detail}. Clique para conectar de novo.`,
        'escritorio.connect',
      ],
    };
    const [text, tooltip, command] = map[status];
    bar.text = text;
    bar.tooltip = tooltip;
    bar.command = command;
    bar.show();
  };

  const send = async (hb: Heartbeat) => {
    const url = serverUrl();
    if (!url || !token) return;
    try {
      const res = await fetch(`${url}/api/activity/editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...hb, editor: 'vscode' }),
      });
      if (res.status === 401) {
        token = undefined;
        await context.secrets.delete(TOKEN_KEY);
        setStatus('error', 'token inválido ou revogado');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!paused) setStatus('ok');
    } catch (err) {
      setStatus('error', (err as Error).message);
    }
  };

  const tracker = new ActivityTracker((hb) => void send(hb));
  const project = () => vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name;
  const touch = () => {
    if (paused || !token || !vscode.window.state.focused) return;
    tracker.touch(vscode.window.activeTextEditor?.document.languageId, project());
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) touch();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => touch()),
    vscode.window.onDidChangeTextEditorSelection(() => touch()),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) touch();
    }),
  );
  const timer = setInterval(() => tracker.tick(), TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  /** Guarda endereço e token e começa a mandar sinal. */
  const saveConnection = async (url: string, value: string) => {
    await vscode.workspace
      .getConfiguration('escritorio')
      .update('serverUrl', url.trim().replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
    token = value.trim();
    await context.secrets.store(TOKEN_KEY, token);
    paused = false;
    await context.globalState.update('escritorio.paused', false);
    setStatus('ok');
    touch();
    void vscode.window.showInformationMessage(
      'Escritório Virtual conectado. Quando você programar, aparece no seu cartão.',
    );
  };

  // Link do Perfil do escritório: vscode://escritorio-virtual.escritorio-virtual-atividade/connect?server=…&token=…
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path !== '/connect') return;
        const params = new URLSearchParams(uri.query);
        const server = params.get('server') ?? '';
        const value = params.get('token') ?? '';
        if (!/^https?:\/\/\S+$/.test(server) || !value.startsWith('esc_')) {
          void vscode.window.showErrorMessage(
            'Link do Escritório Virtual inválido. Gere outro no Perfil.',
          );
          return;
        }
        await saveConnection(server, value);
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('escritorio.connect', async () => {
      const url = await vscode.window.showInputBox({
        title: 'Escritório Virtual: endereço',
        prompt: 'Endereço do escritório (o mesmo que você abre no navegador)',
        value: serverUrl() || 'http://localhost:2567',
        ignoreFocusOut: true,
        validateInput: (v) =>
          /^https?:\/\/\S+$/.test(v.trim()) ? undefined : 'Use http:// ou https://',
      });
      if (!url) return;
      const value = await vscode.window.showInputBox({
        title: 'Escritório Virtual: token pessoal',
        prompt: 'Gere o token no seu Perfil do escritório (seção VS Code) e cole aqui',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().startsWith('esc_') ? undefined : 'O token começa com esc_'),
      });
      if (!value) return;
      await saveConnection(url, value);
    }),
    vscode.commands.registerCommand('escritorio.disconnect', async () => {
      tracker.stop();
      token = undefined;
      await context.secrets.delete(TOKEN_KEY);
      setStatus('unconfigured');
    }),
    vscode.commands.registerCommand('escritorio.togglePause', async () => {
      paused = !paused;
      await context.globalState.update('escritorio.paused', paused);
      if (paused) {
        tracker.stop();
        setStatus('paused');
      } else {
        setStatus(token ? 'ok' : 'unconfigured');
        touch();
      }
    }),
  );
  // Ao fechar a janela: tira a atividade na hora (sem esperar os 3 minutos do servidor).
  context.subscriptions.push({ dispose: () => tracker.stop() });

  void context.secrets.get(TOKEN_KEY).then((saved) => {
    token = saved;
    if (!token || !serverUrl()) setStatus('unconfigured');
    else if (paused) setStatus('paused');
    else {
      setStatus('ok');
      touch();
    }
  });
}

export function deactivate(): void {
  // Os `dispose` registrados acima mandam o sinal de fechamento.
}
