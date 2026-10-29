import { toDevTools } from "../shared/devtools";
import { parseImport, slug, toExportFile, toPuppeteer } from "../shared/exporters";
import type { PanelToBackground, RecordedStep } from "../shared/messages";
import * as store from "../shared/store";
import { DEFAULT_SETTINGS, type Flow, type RecordingState, type Settings, type Step, type StepType } from "../shared/types";
import { uid } from "../shared/util";
import { activeTab, frameIdFor, Runner, sendToTab, type StepStatus } from "./runner";
import { ask, debounce, download, toast } from "./ui";

export type View = "library" | "editor" | "settings";

export const state = {
  view: "library" as View,
  flows: [] as Flow[],
  currentId: undefined as string | undefined,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  recording: undefined as RecordingState | undefined,
  expanded: new Set<string>(),
  selected: new Set<string>(),
  filter: { q: "", folder: "", tags: new Set<string>(), sort: "updated" as "updated" | "name" | "lastRun" },
  collapsedFolders: new Set<string>(),
  run: undefined as undefined | { flowId: string; status: Record<string, StepStatus>; info: Record<string, string> },
  picking: undefined as string | undefined, // id del paso que se está re-apuntando
  dragId: undefined as string | undefined,
};

let renderFn: () => void = () => {};
export const setRender = (fn: () => void) => (renderFn = fn);
export const render = () => renderFn();

export const runner = new Runner();

export const current = () => state.flows.find((f) => f.id === state.currentId);

// ───────────────────────────── Persistencia ─────────────────────────────

const pendingSaves = new Map<string, () => void>();

/** Guarda un flujo con debounce (para inputs de texto). */
export function saveSoon(flow: Flow) {
  let fn = pendingSaves.get(flow.id);
  if (!fn) {
    fn = debounce(() => {
      const f = state.flows.find((x) => x.id === flow.id);
      if (f) void store.saveFlow(f);
    }, 300);
    pendingSaves.set(flow.id, fn);
  }
  fn();
}

export async function saveNow(flow: Flow) {
  await store.saveFlow(flow);
  render();
}

export async function reload() {
  state.flows = await store.listFlows();
  render();
}

// ───────────────────────────── Flujos ─────────────────────────────

export async function createFlow() {
  const name = await ask({ title: "Nuevo flujo", input: "", placeholder: "p. ej. Alta de cliente", ok: "Crear" });
  if (name == null) return;
  const folder = state.filter.folder && state.filter.folder !== "__none" ? state.filter.folder : undefined;
  const flow = store.newFlow({ name: name.trim() || "Nuevo flujo", folder });
  await store.saveFlow(flow);
  // El listener de storage puede haberlo añadido ya.
  if (!state.flows.some((f) => f.id === flow.id)) state.flows.unshift(flow);
  openFlow(flow.id);
}

export function openFlow(id: string) {
  state.currentId = id;
  state.view = "editor";
  state.expanded.clear();
  if (state.run?.flowId !== id) state.run = undefined;
  render();
  document.querySelector("[data-scroll]")?.scrollTo(0, 0);
}

export async function duplicateFlow(flow: Flow) {
  const copy = structuredClone(flow);
  copy.id = uid();
  copy.name = flow.name + " (copia)";
  copy.createdAt = Date.now();
  copy.lastRun = undefined;
  copy.steps.forEach((s) => (s.id = uid()));
  await store.saveFlow(copy);
  await reload();
  toast("Flujo duplicado", "ok");
}

export async function removeFlows(ids: string[]) {
  const names = state.flows.filter((f) => ids.includes(f.id)).map((f) => f.name);
  const ok = await ask({
    title: ids.length === 1 ? `¿Borrar «${names[0]}»?` : `¿Borrar ${ids.length} flujos?`,
    message: "No se puede deshacer. Exporta antes si quieres conservarlos.",
    ok: "Borrar",
    danger: true,
  });
  if (!ok) return;
  await store.deleteFlows(ids);
  ids.forEach((id) => state.selected.delete(id));
  if (state.currentId && ids.includes(state.currentId)) state.view = "library";
  await reload();
}

export function allFolders(): string[] {
  return [...new Set(state.flows.map((f) => f.folder).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
}

export function allTags(): string[] {
  return [...new Set(state.flows.flatMap((f) => f.tags))].sort((a, b) => a.localeCompare(b));
}

export function filteredFlows(): Flow[] {
  const { q, folder, tags, sort } = state.filter;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = state.flows.filter((f) => {
    if (folder === "__none" ? f.folder : folder && f.folder !== folder) return false;
    for (const t of tags) if (!f.tags.includes(t)) return false;
    if (!tokens.length) return true;
    const hay = [f.name, f.description, f.folder, ...f.tags.map((t) => "#" + t), ...f.steps.map((s) => `${s.label ?? ""} ${s.type === "navigate" ? s.value : ""}`)]
      .join(" ")
      .toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "lastRun") list.sort((a, b) => (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0));
  else list.sort((a, b) => b.updatedAt - a.updatedAt);
  return list;
}

export async function bulkMove(ids: string[]) {
  const folder = await ask({ title: "Mover a carpeta", input: "", placeholder: "Nombre de carpeta (vacío = sin carpeta)", options: allFolders(), ok: "Mover" });
  if (folder == null) return;
  for (const f of state.flows.filter((x) => ids.includes(x.id))) {
    f.folder = folder.trim() || undefined;
    await store.saveFlow(f);
  }
  await reload();
}

export async function bulkTag(ids: string[]) {
  const tag = await ask({ title: "Añadir etiqueta", input: "", placeholder: "etiqueta", options: allTags(), ok: "Añadir" });
  const t = tag?.trim().replace(/^#/, "");
  if (!t) return;
  for (const f of state.flows.filter((x) => ids.includes(x.id))) {
    if (!f.tags.includes(t)) f.tags.push(t);
    await store.saveFlow(f);
  }
  await reload();
}

// ───────────────────────────── Import / export ─────────────────────────────

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportFlows(flows: Flow[]) {
  if (!flows.length) return toast("No hay flujos que exportar", "error");
  const name = flows.length === 1 ? `rastro-${slug(flows[0]!.name)}-${stamp()}.json` : `rastro-${flows.length}-flujos-${stamp()}.json`;
  download(name, JSON.stringify(toExportFile(flows), null, 2));
  toast(`${flows.length} flujo(s) exportado(s)`, "ok");
}

export function exportPuppeteer(flow: Flow) {
  download(`${slug(flow.name)}.mjs`, toPuppeteer(flow), "text/javascript");
  toast("Script de Puppeteer descargado", "ok");
}

export async function importText(text: string) {
  let flows: Flow[];
  let result: ReturnType<typeof parseImport>;
  try {
    result = parseImport(text);
    flows = result.flows;
  } catch (e) {
    return toast((e as Error).message, "error");
  }
  const existing = new Set(state.flows.map((f) => f.id));
  const clashes = flows.filter((f) => existing.has(f.id));
  let mode: "overwrite" | "copy" = "copy";
  if (clashes.length) {
    const r = await ask({
      title: `${clashes.length} flujo(s) ya existen`,
      message: clashes.map((f) => f.name).join(", "),
      ok: "Sobrescribir",
      extra: { label: "Importar como copia", value: "copy" },
    });
    if (r == null) return;
    mode = r === "copy" ? "copy" : "overwrite";
  }
  for (const f of flows) {
    if (existing.has(f.id) && mode === "copy") {
      f.id = uid();
      f.name += " (importado)";
    }
    await store.saveFlow(f);
  }
  await reload();
  if (result.source === "devtools") {
    const n = result.skipped.length;
    toast(`Grabación de DevTools importada${n ? ` (${n} paso(s) sin equivalente: ${[...new Set(result.skipped)].join(", ")})` : ""}`, n ? "info" : "ok");
    openFlow(flows[0]!.id);
  } else toast(`${flows.length} flujo(s) importado(s)`, "ok");
}

export function exportDevTools(flow: Flow) {
  const { json, warnings } = toDevTools(flow);
  download(`${slug(flow.name)}.recorder.json`, JSON.stringify(json, null, 2));
  toast(
    warnings ? `Exportado. ${warnings} paso(s) en iframes van sin ruta de frame: revísalos en DevTools` : "Exportado: impórtalo en DevTools › Recorder",
    warnings ? "info" : "ok",
  );
}

// ───────────────────────────── Pasos ─────────────────────────────

export function addStep(flow: Flow, type: StepType, after?: string) {
  const step = store.newStep({ type, value: type === "press" ? "Enter" : type === "wait" ? "1000" : type === "check" ? "true" : undefined });
  const i = after ? flow.steps.findIndex((s) => s.id === after) : -1;
  if (i >= 0) flow.steps.splice(i + 1, 0, step);
  else flow.steps.push(step);
  state.expanded.add(step.id);
  void saveNow(flow);
  return step;
}

export function moveStep(flow: Flow, id: string, beforeId: string | null) {
  const from = flow.steps.findIndex((s) => s.id === id);
  if (from < 0) return;
  const [s] = flow.steps.splice(from, 1);
  const to = beforeId ? flow.steps.findIndex((x) => x.id === beforeId) : flow.steps.length;
  flow.steps.splice(to < 0 ? flow.steps.length : to, 0, s!);
  void saveNow(flow);
}

export function duplicateStep(flow: Flow, step: Step) {
  const i = flow.steps.indexOf(step);
  const copy = { ...structuredClone(step), id: uid() };
  flow.steps.splice(i + 1, 0, copy);
  void saveNow(flow);
}

export function deleteStep(flow: Flow, step: Step) {
  flow.steps = flow.steps.filter((s) => s !== step);
  state.expanded.delete(step.id);
  void saveNow(flow);
}

/** Re-apunta el selector de un paso clicando en la página. */
export async function pickFor(flow: Flow, step: Step) {
  try {
    const tab = await activeTab();
    state.picking = step.id;
    render();
    await sendToTab(tab.id!, { kind: "ping" });
    // Sin frameId: se difunde a todos los frames y responde aquel donde clique el usuario.
    const r: RecordedStep | null = await chrome.tabs.sendMessage(tab.id!, { kind: "pick" });
    void chrome.tabs.sendMessage(tab.id!, { kind: "pick:cancel" }).catch(() => {});
    if (r) {
      step.selector = r.selector;
      step.fallbacks = r.fallbacks;
      step.label = r.label;
      step.frame = r.frame;
      if (step.type === "click" && r.type !== "click") {
        // Si apuntas a un input desde un paso vacío, adopta su tipo y valor actual.
        Object.assign(step, { type: r.type, value: r.value, optionText: r.optionText, secret: r.secret });
      }
      await saveNow(flow);
      toast("Elemento actualizado", "ok");
    }
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    state.picking = undefined;
    render();
  }
}

export async function cancelPick() {
  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id!, { kind: "pick:cancel" });
  } catch {
    /* nada */
  }
  state.picking = undefined;
  render();
}

export async function highlightStep(step: Step) {
  if (!step.selector) return;
  try {
    const tab = await activeTab();
    const fid = await frameIdFor(tab.id!, step.frame, 3000);
    const r = await sendToTab<{ ok: boolean }>(tab.id!, { kind: "highlight", selector: step.selector, fallbacks: step.fallbacks }, fid);
    if (!r?.ok) toast("No se encuentra en esta página", "error");
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

// ───────────────────────────── Grabación ─────────────────────────────

const bg = <T = { ok: boolean; error?: string }>(msg: PanelToBackground): Promise<T> => chrome.runtime.sendMessage(msg);

export async function startRecording(flow: Flow, mode: "record" | "point") {
  try {
    const tab = await activeTab();
    if (!tab.url || !/^(https?|file):/.test(tab.url)) {
      return toast("Abre una página web en la pestaña activa para grabar", "error");
    }
    const r = await bg({ kind: "record:start", flowId: flow.id, tabId: tab.id!, mode });
    if (!r.ok) toast(r.error ?? "No se pudo empezar a grabar", "error");
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export const stopRecording = () => bg({ kind: "record:stop" });
export const pauseRecording = (paused: boolean) => bg({ kind: "record:pause", paused });

// ───────────────────────────── Reproducción ─────────────────────────────

export async function play(flow: Flow, from = 0, only?: number) {
  if (runner.running) return;
  if (state.recording) await stopRecording();
  state.run = { flowId: flow.id, status: {}, info: {} };
  render();
  const summary = await runner.run(flow, state.settings, {
    onStatus(id, status, info) {
      if (!state.run) return;
      state.run.status[id] = status;
      if (info) state.run.info[id] = info;
      render();
      if (status === "running") document.querySelector(`[data-step="${id}"]`)?.scrollIntoView({ block: "nearest" });
    },
  }, from, only);
  if (only == null) {
    flow.lastRun = summary;
    await store.saveFlow(flow, false);
  }
  render();
  if (summary.ok) toast(`✓ Completado en ${(summary.ms / 1000).toFixed(1)}s`, "ok");
  else toast(`✗ ${summary.error}`, "error");
}

export function stopPlay() {
  runner.stop();
}
