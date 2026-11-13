// Corre en el «main world» de la página (no en el mundo aislado del content script) para poder
// ver sus fetch/XHR. Publica cuántas peticiones hay en vuelo con un evento en document;
// el content script (wait.ts) lo escucha. Solo se envían números: cruzan bien entre mundos.

declare global {
  interface Window {
    __rastroNet?: boolean;
  }
}

const EVT = "__rastro_net";
// Long-polling, streams, peticiones colgadas…: pasado este tiempo una petición deja de contar.
const STALE = 10000;

if (!window.__rastroNet) {
  window.__rastroNet = true;
  const inflight = new Set<number>();
  let seq = 0;

  const publish = () => document.dispatchEvent(new CustomEvent(EVT, { detail: inflight.size }));
  const end = (id: number) => {
    if (inflight.delete(id)) publish();
  };
  const begin = () => {
    const id = ++seq;
    inflight.add(id);
    setTimeout(() => end(id), STALE);
    publish();
    return id;
  };

  const origFetch = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const id = begin();
    try {
      const p = origFetch.apply(this, args);
      p.then(
        () => end(id),
        () => end(id),
      );
      return p;
    } catch (e) {
      end(id);
      throw e;
    }
  } as typeof fetch;

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
    const id = begin();
    this.addEventListener("loadend", () => end(id), { once: true });
    try {
      return origSend.apply(this, args);
    } catch (e) {
      end(id);
      throw e;
    }
  };

  // El content script puede llegar tarde (document_idle): pregunta el estado actual.
  document.addEventListener(EVT + "?", publish);
}

export {};
