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

  constructor(private readonly max = 3) {}

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
  }
}
