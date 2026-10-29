import type { RecordingState, Settings, Step } from "./types";

/** Lo que el content script captura de un elemento. */
export interface CapturedTarget {
  selector: string;
  fallbacks: string[];
  label: string;
}

/** Paso capturado por el content script (sin id ni enabled; los pone el background). */
export type RecordedStep = Omit<Step, "id" | "enabled">;

// Panel/background → content script
export type ToContent =
  | { kind: "ping" }
  | { kind: "record:on"; mode: RecordingState["mode"] }
  | { kind: "record:off" }
  | { kind: "run-step"; step: Step; settings: Settings }
  | { kind: "highlight"; selector: string; fallbacks?: string[] }
  | { kind: "pick" }
  | { kind: "pick:cancel" };

// Content script → background
export type ToBackground =
  | { kind: "record:status" }
  | { kind: "record:step"; step: RecordedStep }
  | { kind: "record:stop" }
  | { kind: "picked"; target: CapturedTarget | null };

// Panel → background
export type PanelToBackground =
  | { kind: "record:start"; flowId: string; tabId: number; mode: RecordingState["mode"] }
  | { kind: "record:stop" }
  | { kind: "record:pause"; paused: boolean };

export interface StepResult {
  ok: boolean;
  error?: string;
  /** El paso puede disparar una navegación (enlace, submit, Enter en un form). */
  mayNavigate?: boolean;
  /** Selector con el que se encontró el elemento (puede ser un fallback). */
  usedSelector?: string;
}
