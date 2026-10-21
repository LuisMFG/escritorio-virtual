/** Imagem que tenta várias URLs em ordem e chama `onFail` se todas falharem. */
export function loadWithFallback(img: HTMLImageElement, urls: string[], onFail: () => void): void {
  const queue = [...urls];
  img.onerror = () => {
    const next = queue.shift();
    if (next) img.src = next;
    else {
      img.onerror = null;
      onFail();
    }
  };
  img.src = queue.shift()!;
}

/**
 * Miniaturas poucas de cada vez: o navegador abre só 6 conexões por servidor, e 60 miniaturas
 * novas de uma vez (o servidor ainda buscando no imager/CDN) atrasariam as outras chamadas da
 * página (salvar, trocar a cor…).
 */
export class ThumbQueue {
  private readonly waiting: (() => void)[] = [];
  private loading = 0;
  /** Muda a cada `clear()`: as que estavam carregando da lista anterior não contam mais. */
  private generation = 0;
  private observer: IntersectionObserver | null = null;
  private readonly visible = new Map<Element, () => void>();

  constructor(
    private readonly max = 3,
    /** Uma miniatura que não responde em tanto tempo libera a vez (ms). */
    private readonly slowMs = 10_000,
  ) {}

  /**
   * Chama `fn` quando o elemento aparecer na tela (ou chegar perto). Assim só entram na fila as
   * miniaturas que alguém está vendo: as de baixo não ocupam a vez das que estão à vista.
   */
  whenVisible(target: Element, fn: () => void): void {
    if (typeof IntersectionObserver === 'undefined') return fn();
    this.observer ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const run = this.visible.get(e.target);
          this.visible.delete(e.target);
          this.observer?.unobserve(e.target);
          run?.();
        }
      },
      { rootMargin: '200px' },
    );
    this.visible.set(target, fn);
    this.observer.observe(target);
  }

  load(img: HTMLImageElement, urls: string[], onFail: () => void): void {
    const start = () => {
      this.loading++;
      const generation = this.generation;
      let finished = false;
      const done = () => {
        if (finished || generation !== this.generation) return;
        finished = true;
        this.loading--;
        this.waiting.shift()?.();
      };
      img.addEventListener('load', done, { once: true });
      // Servidor demorando: libera a vez (a imagem ainda pode chegar depois).
      setTimeout(done, this.slowMs);
      loadWithFallback(img, urls, () => {
        done();
        onFail();
      });
    };
    if (this.loading < this.max) start();
    else this.waiting.push(start);
  }

  /**
   * A lista mudou: as que ainda não começaram não interessam mais, e as que estavam carregando
   * liberam a vez (fora da tela, uma imagem `loading=lazy` nunca termina e travaria a fila).
   */
  clear(): void {
    this.waiting.length = 0;
    this.loading = 0;
    this.generation++;
    for (const el of this.visible.keys()) this.observer?.unobserve(el);
    this.visible.clear();
  }
}
