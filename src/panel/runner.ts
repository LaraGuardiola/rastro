// Orquestador de la reproducción. Vive en el side panel: manda cada paso al content
// script de la pestaña y gestiona navegaciones entre páginas (que matan al content script).
import type { StepResult, ToContent } from "../shared/messages";
import type { FrameRef, Flow, RunSummary, Settings, Step } from "../shared/types";
import { BUILTIN_VARS, interpolate, sleep } from "../shared/util";

export type StepStatus = "pending" | "running" | "ok" | "error" | "skipped";

export interface RunHooks {
  onStatus(stepId: string, status: StepStatus, info?: string): void;
}

const PORT_CLOSED = /message port closed|Receiving end does not exist|back\/forward cache|context invalidated/i;

/** panel.html?tab=<id> fija el panel a una pestaña concreta (útil abierto como pestaña o en tests). */
const pinnedTab = Number(new URLSearchParams(location.search).get("tab")) || undefined;

export async function activeTab(): Promise<chrome.tabs.Tab> {
  if (pinnedTab) return chrome.tabs.get(pinnedTab);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No hay pestaña activa");
  return tab;
}

async function waitForLoad(tabId: number, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(120);
  }
  throw new Error("La página tardó demasiado en cargar");
}

/** Observa navegaciones de página completa en la pestaña (inicio y fin). */
function watchNavigations(tabId: number, frameId = 0) {
  let started = false;
  let pending = 0;
  const mine = (d: { tabId: number; frameId: number }) => d.tabId === tabId && (d.frameId === 0 || d.frameId === frameId);
  const onStart = (d: chrome.webNavigation.WebNavigationParentedCallbackDetails) => {
    if (mine(d)) (started = true), pending++;
  };
  const onEnd = (d: { tabId: number; frameId: number }) => {
    if (mine(d)) pending = Math.max(0, pending - 1);
  };
  const nav = chrome.webNavigation;
  nav.onBeforeNavigate.addListener(onStart);
  nav.onCompleted.addListener(onEnd);
  nav.onErrorOccurred.addListener(onEnd);
  return {
    /** ¿Empezó alguna navegación en los próximos `within` ms? */
    async started(within: number) {
      const end = Date.now() + within;
      while (!started && Date.now() < end) await sleep(50);
      return started;
    },
    /** Espera a que terminen las navegaciones en curso. */
    async settled(timeout = 30000) {
      const end = Date.now() + timeout;
      while (pending > 0) {
        if (Date.now() > end) throw new Error("La página tardó demasiado en cargar");
        await sleep(80);
      }
      await waitForLoad(tabId, timeout);
    },
    dispose() {
      nav.onBeforeNavigate.removeListener(onStart);
      nav.onCompleted.removeListener(onEnd);
      nav.onErrorOccurred.removeListener(onEnd);
    },
  };
}

/** Garantiza que el content script responde en el frame (lo inyecta si hace falta). */
export async function ensureContent(tabId: number, frameId = 0): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { kind: "ping" } satisfies ToContent, { frameId });
      if (r?.ok) return;
    } catch {
      /* aún no está */
    }
    if (i === 3) {
      try {
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
      } catch (e) {
        throw new Error("No se puede actuar en esta página (" + (e as Error).message + ")");
      }
    }
    await sleep(150);
  }
  throw new Error(frameId ? "El iframe no responde" : "El content script no responde en la pestaña");
}

/** Envía a un frame concreto (0 = página principal). Nunca a todos: cada frame ejecutaría el paso. */
export async function sendToTab<T = unknown>(tabId: number, msg: ToContent, frameId = 0): Promise<T> {
  await ensureContent(tabId, frameId);
  return chrome.tabs.sendMessage(tabId, msg, { frameId });
}

/** Recorre la ruta de iframes del paso y devuelve el frameId del documento destino. */
export async function frameIdFor(tabId: number, frame: FrameRef[] | undefined, timeout: number): Promise<number> {
  let fid = 0;
  for (const [i, ref] of (frame ?? []).entries()) {
    const end = Date.now() + timeout;
    let next: number | undefined;
    // El padre localiza el <iframe> y le manda una sonda; el content script del hijo la reporta
    // al background con su frameId. Si el iframe aún carga, la sonda se pierde: se reintenta.
    while (next == null) {
      const r = await sendToTab<{ token?: string; error?: string }>(
        tabId,
        { kind: "frame:resolve", selectors: [ref.selector, ...(ref.fallbacks ?? [])], timeout: Math.max(0, end - Date.now()) },
        fid,
      );
      if (!r?.token) throw new Error(`${r?.error ?? "No se encontró el iframe"} (nivel ${i + 1})`);
      for (let k = 0; k < 8 && next == null; k++) {
        await sleep(60);
        next = (await chrome.runtime.sendMessage({ kind: "frame:probed", token: r.token }))?.frameId;
      }
      if (next == null && Date.now() > end) throw new Error(`El iframe «${ref.selector}» no responde (nivel ${i + 1})`);
    }
    fid = next;
  }
  return fid;
}

/** Valores de variables para una ejecución: integradas fijadas una vez + las del flujo. */
export function runVariables(flow: Flow): Record<string, string> {
  const base: Record<string, string> = {};
  for (const b of BUILTIN_VARS) base[b] = interpolate(`{{${b}}}`, {});
  const vars = { ...base };
  for (const [k, v] of Object.entries(flow.variables ?? {})) vars[k] = interpolate(v, base);
  return vars;
}

function resolveStep(step: Step, vars: Record<string, string>): Step {
  return { ...step, value: step.value != null ? interpolate(step.value, vars) : undefined };
}

export class Runner {
  private stopped = false;
  running = false;

  stop() {
    this.stopped = true;
  }

  async run(flow: Flow, settings: Settings, hooks: RunHooks, from = 0, only?: number): Promise<RunSummary> {
    this.stopped = false;
    this.running = true;
    const t0 = Date.now();
    const vars = runVariables(flow);
    const steps = flow.steps;
    const end = only != null ? only + 1 : steps.length;
    for (let i = 0; i < steps.length; i++) if (i >= from && i < end) hooks.onStatus(steps[i]!.id, "pending");

    try {
      const tab = await activeTab();
      const tabId = tab.id!;
      for (let i = from; i < end; i++) {
        if (this.stopped) throw new Error("Detenido por el usuario");
        const step = steps[i]!;
        if (!step.enabled) {
          hooks.onStatus(step.id, "skipped");
          continue;
        }
        hooks.onStatus(step.id, "running");
        try {
          await this.exec(tabId, resolveStep(step, vars), settings);
          hooks.onStatus(step.id, "ok");
        } catch (e) {
          const msg = (e as Error).message;
          hooks.onStatus(step.id, "error", msg);
          return { at: t0, ok: false, ms: Date.now() - t0, failedStepId: step.id, error: msg };
        }
        if (i < end - 1 && settings.stepDelay) await sleep(settings.stepDelay);
      }
      return { at: t0, ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { at: t0, ok: false, ms: Date.now() - t0, error: (e as Error).message };
    } finally {
      this.running = false;
    }
  }

  private async exec(tabId: number, step: Step, settings: Settings) {
    switch (step.type) {
      case "navigate": {
        if (!step.value) throw new Error("Falta la URL");
        const navs = watchNavigations(tabId);
        try {
          await chrome.tabs.update(tabId, { url: step.value });
          await navs.started(3000);
          await navs.settled();
        } finally {
          navs.dispose();
        }
        return;
      }
      case "wait":
        await sleep(Number(step.value) || 1000);
        return;
    }

    const acts = step.type === "click" || step.type === "press";
    const timeout = step.timeout ?? settings.timeout;
    let res: StepResult | undefined;
    let fid = await frameIdFor(tabId, step.frame, timeout);
    const navs = watchNavigations(tabId, fid);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          res = await sendToTab<StepResult>(tabId, { kind: "run-step", step, settings }, fid);
        } catch (e) {
          if (!PORT_CLOSED.test((e as Error).message)) throw e;
          // La página (o el iframe) navegó mientras se ejecutaba el paso.
          await navs.settled();
          if (acts) return; // el click/tecla ya provocó la navegación
          if (attempt >= 2) throw new Error("La página no paró de navegar durante el paso");
          fid = await frameIdFor(tabId, step.frame, timeout);
          continue; // reintentar en la página nueva
        }
        if (!res) throw new Error("Sin respuesta de la página");
        if (!res.ok) throw new Error(res.error);
        break;
      }
      // Un click en enlace/submit puede navegar con retraso (validación, petición al servidor…):
      // damos un margen para que empiece y, si empieza, esperamos a que cargue.
      if (acts && (await navs.started(res.mayNavigate ? 1500 : 150))) await navs.settled();
    } finally {
      navs.dispose();
    }
  }
}
