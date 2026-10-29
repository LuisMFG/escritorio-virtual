import { beforeEach, describe, expect, it, vi } from 'vitest';

// Simula ambiente de navegador no Node para o Vitest
const matchMediaMock = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() });
vi.stubGlobal('matchMedia', matchMediaMock);
vi.stubGlobal('window', {
  matchMedia: matchMediaMock,
  document: {
    documentElement: { dataset: {} },
    body: { style: {}, classList: { add: vi.fn(), remove: vi.fn() }, querySelectorAll: () => [] },
    querySelectorAll: () => [],
  },
});
vi.stubGlobal('document', {
  documentElement: { dataset: {} },
  body: {
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() },
    append: vi.fn(),
    contains: vi.fn(),
  },
  implementation: {
    createHTMLDocument: (title: string) => {
      const doc = {
        title,
        documentElement: { dataset: {} },
        head: { appendChild: vi.fn() },
        body: {
          style: {},
          classList: { add: vi.fn(), remove: vi.fn() },
          append: vi.fn(),
          contains: vi.fn().mockReturnValue(true),
        },
        createElement: (tag: string) => makeMockElement(tag),
        querySelector: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      return doc;
    },
  },
  createElement: (tag: string) => makeMockElement(tag),
  querySelectorAll: () => [],
});

function makeMockElement(tag: string) {
  const el: Record<string, unknown> = {
    tagName: tag,
    style: {},
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    append: vi.fn(),
    appendChild: vi.fn(),
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelector: vi.fn(),
    remove: vi.fn(),
    content: {
      firstElementChild: {
        cloneNode: () => makeMockElement('svg'),
        setAttribute: vi.fn(),
      },
    },
  };
  return el;
}

const {
  closePip,
  isPipActive,
  isPipSupported,
  openPip,
  removePipIncomingCall,
  showPipIncomingCall,
  updatePipRoomName,
} = await import('./pip.js');

describe('Document Picture-in-Picture (Janela Flutuante)', () => {
  beforeEach(() => {
    closePip();
    vi.restoreAllMocks();
  });

  it('detecta suporte a Document Picture-in-Picture no navegador', () => {
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    expect(isPipSupported()).toBe(false);

    (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn(),
      window: null,
    };
    expect(isPipSupported()).toBe(true);
  });

  it('não está ativo inicialmente', () => {
    expect(isPipActive()).toBe(false);
  });

  it('abre a janela flutuante e move o canvas para dentro dela', async () => {
    const mockPipDoc = document.implementation.createHTMLDocument('PiP');
    const listeners: Record<string, Function> = {};
    const mockPipWin = {
      document: mockPipDoc,
      closed: false,
      focus: vi.fn(),
      close: vi.fn(function () {
        (mockPipWin as { closed: boolean }).closed = true;
        listeners['pagehide']?.(new Event('pagehide'));
      }),
      addEventListener: vi.fn((ev, fn) => {
        listeners[ev] = fn;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn().mockResolvedValue(mockPipWin),
      window: mockPipWin,
    };

    const container = document.createElement('div') as unknown as HTMLElement;
    const canvas = document.createElement('canvas') as unknown as HTMLCanvasElement;

    const onCenterSelf = vi.fn();
    const onFit = vi.fn();
    const onClose = vi.fn();

    const win = await openPip({
      canvas,
      container,
      getRoomName: () => 'Sala de Reunião',
      onCenterSelf,
      onFit,
      onClose,
    });

    expect(win).toBe(mockPipWin);
    expect(isPipActive()).toBe(true);
    expect(mockPipDoc.title).toContain('Sala de Reunião');

    updatePipRoomName('Cafeteria');

    closePip();
    expect(isPipActive()).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('exibe e remove notificação de chamada recebida na janela flutuante', async () => {
    const mockPipDoc = document.implementation.createHTMLDocument('PiP');
    const mockPipWin = {
      document: mockPipDoc,
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn().mockReturnValue(123),
      clearInterval: vi.fn(),
    } as unknown as Window;

    (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture = {
      requestWindow: vi.fn().mockResolvedValue(mockPipWin),
      window: mockPipWin,
    };

    const container = document.createElement('div') as unknown as HTMLElement;
    const canvas = document.createElement('canvas') as unknown as HTMLCanvasElement;

    await openPip({
      canvas,
      container,
      getRoomName: () => 'Sala de Reunião',
    });

    const onAnswer = vi.fn();
    const fakeInvite = {
      id: 'inv-1',
      callId: 'call-1',
      fromUserId: 'user-ana',
      fromName: 'Ana',
      reason: 'Dúvida rápida',
      members: ['Ana'],
      expiresAt: Date.now() + 30000,
      quiet: false,
    };

    showPipIncomingCall(fakeInvite, onAnswer);
    removePipIncomingCall('inv-1');
  });
});
