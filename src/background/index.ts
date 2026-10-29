// Service worker: coordina la grabación (sobrevive a navegaciones entre páginas)
// y es el único que escribe los pasos grabados, en cola, para no perder ninguno.
import type { PanelToBackground, RecordedStep, ToBackground, ToContent } from "../shared/messages";
import { getRecording, newStep, setRecording, updateFlow } from "../shared/store";
import type { Step } from "../shared/types";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

/** Pasos que representan el estado de un campo: si se repiten seguidos, se fusionan. */
const STATEFUL = new Set(["fill", "select", "check"]);

function appendStep(flowId: string, rec: RecordedStep) {
  return enqueue(() =>
    updateFlow(flowId, (flow) => {
      const last = flow.steps.at(-1);
      if (last && STATEFUL.has(rec.type) && last.type === rec.type && last.selector === rec.selector) {
        Object.assign(last, rec);
        return;
      }
      // Un click justo después de rellenar el mismo campo no aporta nada.
      if (last && rec.type === "click" && last.selector === rec.selector && last.type === "fill") return;
      // Evitar navegaciones duplicadas consecutivas.
      if (last && rec.type === "navigate" && last.type === "navigate" && last.value === rec.value) return;
      flow.steps.push(newStep(rec) as Step);
    }),
  );
}

async function sendToTab(tabId: number, msg: ToContent) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Pestaña abierta antes de instalar la extensión: inyectamos el content script.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return undefined;
    }
  }
}

async function startRecording(flowId: string, tabId: number, mode: "record" | "point") {
  const prev = await getRecording();
  if (prev) await sendToTab(prev.tabId, { kind: "record:off" });
  const tab = await chrome.tabs.get(tabId);
  await updateFlow(flowId, (flow) => {
    if (!flow.steps.length && tab.url && /^https?:|^file:/.test(tab.url)) {
      flow.steps.push(newStep({ type: "navigate", value: tab.url, label: tab.title }));
    }
  });
  await setRecording({ flowId, tabId, mode, paused: false });
  const ok = await sendToTab(tabId, { kind: "record:on", mode });
  return { ok: !!ok, error: ok ? undefined : "No se puede grabar en esta página (chrome://, Web Store…)" };
}

async function stopRecording() {
  const rec = await getRecording();
  await setRecording(undefined);
  if (rec) await sendToTab(rec.tabId, { kind: "record:off" });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg: ToBackground | PanelToBackground, sender, reply) => {
  const handle = async () => {
    switch (msg.kind) {
      case "record:status": {
        const rec = await getRecording();
        if (rec && !rec.paused && sender.tab?.id === rec.tabId) return { mode: rec.mode };
        return {};
      }
      case "record:step": {
        const rec = await getRecording();
        if (!rec || rec.paused || sender.tab?.id !== rec.tabId) return { ok: false };
        await appendStep(rec.flowId, msg.step);
        return { ok: true };
      }
      case "record:start":
        return startRecording(msg.flowId, msg.tabId, msg.mode);
      case "record:stop":
        return stopRecording();
      case "record:pause": {
        const rec = await getRecording();
        if (!rec) return { ok: false };
        await setRecording({ ...rec, paused: msg.paused });
        await sendToTab(rec.tabId, msg.paused ? { kind: "record:off" } : { kind: "record:on", mode: rec.mode });
        return { ok: true };
      }
    }
    return undefined;
  };
  handle().then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;
});

// Si el usuario escribe una URL en la barra durante la grabación, se graba como «Ir a».
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const rec = await getRecording();
  if (!rec || rec.paused || d.tabId !== rec.tabId) return;
  if (["typed", "auto_bookmark", "generated", "keyword"].includes(d.transitionType) && !d.transitionQualifiers.includes("forward_back")) {
    await appendStep(rec.flowId, { type: "navigate", value: d.url });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getRecording();
  if (rec?.tabId === tabId) await setRecording(undefined);
});
