// Content script: puente entre la página y la extensión.
import type { RecordedStep, ToBackground, ToContent } from "../shared/messages";
import { highlight, runStep } from "./player";
import { cancelPick, pickOnce, startRecording, stopRecording } from "./recorder";

declare global {
  interface Window {
    __rastro?: boolean;
  }
}

function toBg(msg: ToBackground) {
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

if (!window.__rastro) {
  window.__rastro = true;

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
        pickOnce().then(reply);
        return true;
      case "pick:cancel":
        cancelPick();
        reply({ ok: true });
        return;
    }
  });

  // Al cargar una página nueva, ¿seguimos grabando en esta pestaña?
  toBg({ kind: "record:status" }).then((r: { mode?: "record" | "point" } | undefined) => {
    if (r?.mode) startRecording(r.mode, sink, onStop);
  });
}
