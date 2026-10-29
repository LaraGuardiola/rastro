// Service worker: coordina la grabación (sobrevive a navegaciones entre páginas)
// y es el único que escribe los pasos grabados, en cola, para no perder ninguno.
import type { PanelToBackground, RecordedStep, ToBackground, ToContent } from "../shared/messages";
import { getRecording, newStep, setRecording, updateFlow } from "../shared/store";
import type { FrameRef, Step } from "../shared/types";

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
      const sameFrame = JSON.stringify(last?.frame ?? []) === JSON.stringify(rec.frame ?? []);
      if (last && sameFrame && STATEFUL.has(rec.type) && last.type === rec.type && last.selector === rec.selector) {
        Object.assign(last, rec);
        return;
      }
      // Un click justo después de rellenar el mismo campo no aporta nada.
      if (last && sameFrame && rec.type === "click" && last.selector === rec.selector && last.type === "fill") return;
      // Evitar navegaciones duplicadas consecutivas.
      if (last && rec.type === "navigate" && last.type === "navigate" && last.value === rec.value) return;
      flow.steps.push(newStep(rec) as Step);
    }),
  );
}

// ───────────────────────────── Frames ─────────────────────────────

const frameCache = new Map<string, FrameRef[]>();
/** Sondas de reproducción: token → frameId del frame que la recibió. */
const probes = new Map<string, number>();

/**
 * Ruta de iframes desde la página principal hasta `frameId`: en cada nivel identifica en el
 * frame padre el elemento <iframe> que carga al hijo y le genera selectores.
 */
async function framePath(tabId: number, frameId: number | undefined): Promise<FrameRef[] | undefined> {
  if (!frameId) return undefined;
  const key = `${tabId}:${frameId}`;
  const cached = frameCache.get(key);
  if (cached) return cached;
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  const path: FrameRef[] = [];
  let cur = frameId;
  while (cur > 0) {
    const f = frames.find((x) => x.frameId === cur);
    if (!f) return undefined;
    // El hijo se anuncia al padre por postMessage y el padre identifica qué <iframe> es.
    const token = crypto.randomUUID();
    await chrome.tabs.sendMessage(tabId, { kind: "frame:announce", token } satisfies ToContent, { frameId: cur }).catch(() => null);
    const sels: string[] | null = await chrome.tabs
      .sendMessage(tabId, { kind: "frame:selectors", token } satisfies ToContent, { frameId: f.parentFrameId })
      .catch(() => null);
    if (!sels?.length) return undefined;
    path.unshift({ selector: sels[0]!, fallbacks: sels.slice(1) });
    cur = f.parentFrameId;
  }
  frameCache.set(key, path);
  return path;
}

async function withFrame(step: RecordedStep, sender: chrome.runtime.MessageSender): Promise<RecordedStep> {
  const frame = sender.tab?.id != null ? await framePath(sender.tab.id, sender.frameId) : undefined;
  return frame?.length ? { ...step, frame } : step;
}

chrome.webNavigation.onCommitted.addListener((d) => {
  for (const k of frameCache.keys()) if (k.startsWith(`${d.tabId}:`)) frameCache.delete(k);
});

async function sendToTab(tabId: number, msg: ToContent) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Pestaña abierta antes de instalar la extensión: inyectamos el content script.
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
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
        await appendStep(rec.flowId, await withFrame(msg.step, sender));
        return { ok: true };
      }
      case "frame:locate":
        return withFrame(msg.step, sender);
      case "frame:probe":
        if (sender.frameId != null) probes.set(msg.token, sender.frameId);
        setTimeout(() => probes.delete(msg.token), 30000);
        return { ok: true };
      case "frame:probed":
        return { frameId: probes.get(msg.token) };
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
