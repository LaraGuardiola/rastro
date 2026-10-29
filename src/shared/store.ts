// Persistencia en chrome.storage.local. Cada flujo va en su propia clave (flow:<id>)
// para que las escrituras concurrentes del background (grabando) y del panel (editando)
// no se pisen entre flujos distintos.
import { DEFAULT_SETTINGS, type Flow, type RecordingState, type Settings, type Step } from "./types";
import { uid } from "./util";

const FLOW_PREFIX = "flow:";
const SETTINGS_KEY = "settings";
const RECORDING_KEY = "recording";

export async function listFlows(): Promise<Flow[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(FLOW_PREFIX))
    .map(([, v]) => v as Flow)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFlow(id: string): Promise<Flow | undefined> {
  const key = FLOW_PREFIX + id;
  return (await chrome.storage.local.get(key))[key] as Flow | undefined;
}

export async function saveFlow(flow: Flow, touch = true): Promise<Flow> {
  if (touch) flow.updatedAt = Date.now();
  await chrome.storage.local.set({ [FLOW_PREFIX + flow.id]: flow });
  return flow;
}

export async function deleteFlows(ids: string[]): Promise<void> {
  await chrome.storage.local.remove(ids.map((id) => FLOW_PREFIX + id));
}

/** Lee-modifica-escribe un flujo. */
export async function updateFlow(id: string, fn: (f: Flow) => void, touch = true): Promise<Flow | undefined> {
  const flow = await getFlow(id);
  if (!flow) return;
  fn(flow);
  return saveFlow(flow, touch);
}

export function newFlow(partial: Partial<Flow> = {}): Flow {
  const now = Date.now();
  return {
    id: uid(),
    name: "Nuevo flujo",
    tags: [],
    variables: {},
    steps: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newStep(partial: Partial<Step> & Pick<Step, "type">): Step {
  return { id: uid(), enabled: true, ...partial };
}

export async function getSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

export async function getRecording(): Promise<RecordingState | undefined> {
  return (await chrome.storage.session.get(RECORDING_KEY))[RECORDING_KEY] as RecordingState | undefined;
}

export async function setRecording(r: RecordingState | undefined): Promise<void> {
  if (r) await chrome.storage.session.set({ [RECORDING_KEY]: r });
  else await chrome.storage.session.remove(RECORDING_KEY);
}

export const isFlowKey = (k: string) => k.startsWith(FLOW_PREFIX);
export const RECORDING_STORAGE_KEY = RECORDING_KEY;
