import type { RecordingState, Settings, Step } from "./types";

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
  | { kind: "pick:cancel" }
  // Frames: el padre identifica el <iframe> de un frame hijo, o resuelve un selector a frameId.
  | { kind: "frame:announce"; token: string } // hijo: anúnciate a tu padre con este token
  | { kind: "frame:selectors"; token: string } // padre: selectores del <iframe> que se anunció con el token
  | { kind: "frame:resolve"; selectors: string[]; timeout: number }; // padre: localiza el iframe y mándale una sonda

// Content script → background
export type ToBackground =
  | { kind: "record:status" }
  | { kind: "record:step"; step: RecordedStep }
  | { kind: "record:stop" }
  /** Completa un paso con la ruta de frames del frame que lo envía. */
  | { kind: "frame:locate"; step: RecordedStep }
  /** Un frame recibió una sonda: así el background asocia token → frameId. */
  | { kind: "frame:probe"; token: string };

// Panel → background
export type PanelToBackground =
  | { kind: "record:start"; flowId: string; tabId: number; mode: RecordingState["mode"] }
  | { kind: "record:stop" }
  | { kind: "record:pause"; paused: boolean }
  | { kind: "frame:probed"; token: string };

export interface StepResult {
  ok: boolean;
  error?: string;
  /** El paso puede disparar una navegación (enlace, submit, Enter en un form). */
  mayNavigate?: boolean;
  /** Selector con el que se encontró el elemento (puede ser un fallback). */
  usedSelector?: string;
}
