// Content script: puente entre la página y la extensión. Se inyecta en todos los frames.
import type { RecordedStep, ToBackground, ToContent } from "../shared/messages";
import { sleep } from "../shared/util";
import { highlight, runStep } from "./player";
import { cancelPick, pickOnce, startRecording, stopRecording } from "./recorder";
import { buildSelectors, resolve } from "./selector";

declare global {
  interface Window {
    __rastro?: boolean;
  }
}

function toBg<T = any>(msg: ToBackground): Promise<T | undefined> {
  try {
    return chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    // La extensión se recargó y este script quedó huérfano.
    stopRecording();
    return Promise.resolve(undefined);
  }
}

const sink = (step: RecordedStep) => void toBg({ kind: "record:step", step });
const onStop = () => void toBg({ kind: "record:stop" });

// ───────────── Frames: handshake por postMessage (funciona también cross-origin) ─────────────

const MSG = "__rastro_frame";
/** token → <iframe> hijo que se anunció con él. */
const announced = new Map<string, Element>();

function frameElementFor(source: MessageEventSource | null): Element | undefined {
  if (!source) return;
  return [...document.querySelectorAll("iframe, frame")].find((f) => (f as HTMLIFrameElement).contentWindow === source);
}

function onFrameMessage(e: MessageEvent) {
  const d = e.data;
  if (!d || typeof d !== "object" || d[MSG] == null || typeof d.token !== "string") return;
  if (d[MSG] === "announce") {
    const el = frameElementFor(e.source);
    if (el) announced.set(d.token, el);
  } else if (d[MSG] === "probe" && e.source === window.parent && window !== window.top) {
    void toBg({ kind: "frame:probe", token: d.token });
  }
}

async function selectorsForAnnounced(token: string): Promise<string[] | null> {
  for (let i = 0; i < 20 && !announced.has(token); i++) await sleep(50);
  const el = announced.get(token);
  announced.delete(token);
  return el ? buildSelectors(el) : null;
}

async function resolveFrame(selectors: string[], timeout: number): Promise<{ token?: string; error?: string }> {
  const end = performance.now() + timeout;
  while (true) {
    const r = resolve(selectors);
    const win = r && (r.el as HTMLIFrameElement).contentWindow;
    if (win) {
      const token = crypto.randomUUID();
      win.postMessage({ [MSG]: "probe", token }, "*");
      return { token };
    }
    if (performance.now() > end) return { error: `No se encontró el iframe «${selectors[0]}»` };
    await sleep(100);
  }
}

if (!window.__rastro) {
  window.__rastro = true;
  window.addEventListener("message", onFrameMessage);

  chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
    switch (msg.kind) {
      case "ping":
        reply({ ok: true });
        return;
      case "record:on":
        startRecording(msg.mode, sink, onStop);
        reply({ ok: true });
        return;
      case "record:off":
        stopRecording();
        reply({ ok: true });
        return;
      case "run-step":
        runStep(msg.step, msg.settings).then(reply);
        return true; // respuesta asíncrona
      case "highlight":
        highlight([msg.selector, ...(msg.fallbacks ?? [])]).then((found) => reply({ ok: found }));
        return true;
      case "pick":
        // Se difunde a todos los frames; responde el frame donde clique el usuario,
        // tras pedir al background que añada la ruta de iframes.
        pickOnce().then(async (step) => reply(step ? ((await toBg<RecordedStep>({ kind: "frame:locate", step })) ?? step) : null));
        return true;
      case "pick:cancel":
        cancelPick();
        reply({ ok: true });
        return;
      case "frame:announce":
        window.parent.postMessage({ [MSG]: "announce", token: msg.token }, "*");
        reply({ ok: true });
        return;
      case "frame:selectors":
        selectorsForAnnounced(msg.token).then(reply);
        return true;
      case "frame:resolve":
        resolveFrame(msg.selectors, msg.timeout).then(reply);
        return true;
    }
  });

  // Al cargar una página nueva, ¿seguimos grabando en esta pestaña?
  toBg<{ mode?: "record" | "point" }>({ kind: "record:status" }).then((r) => {
    if (r?.mode) startRecording(r.mode, sink, onStop);
  });
}
