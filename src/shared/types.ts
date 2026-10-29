export type StepType =
  | "navigate" // ir a una URL
  | "click" // click en botón/enlace/cualquier cosa
  | "fill" // escribir en input/textarea/contenteditable
  | "select" // elegir opción de un <select>
  | "check" // marcar/desmarcar checkbox o radio
  | "press" // pulsar una tecla (Enter, Tab…)
  | "wait" // esperar N ms
  | "waitFor" // esperar a que aparezca un elemento
  | "assertText"; // comprobar que un elemento contiene un texto

export interface Step {
  id: string;
  type: StepType;
  /** Selector principal (editable). Admite CSS, `text=…` y `xpath=…`. */
  selector?: string;
  /** Selectores alternativos que se prueban si falla el principal. */
  fallbacks?: string[];
  /** Descripción legible: «Email», «Enviar»… */
  label?: string;
  /** Texto a escribir, opción, URL, tecla, ms, texto esperado o "true"/"false" para check. */
  value?: string;
  /** Para <select>: texto visible de la opción (por si cambia el value). */
  optionText?: string;
  /** El valor es sensible (password): se enmascara en la UI. */
  secret?: boolean;
  enabled: boolean;
  /** Timeout propio en ms (si no, el global). */
  timeout?: number;
  note?: string;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  folder?: string;
  tags: string[];
  /** Variables usables como {{nombre}} en los valores de los pasos. */
  variables: Record<string, string>;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
  lastRun?: RunSummary;
}

export interface RunSummary {
  at: number;
  ok: boolean;
  ms: number;
  failedStepId?: string;
  error?: string;
}

export interface Settings {
  /** Tiempo máximo esperando a un elemento. */
  timeout: number;
  /** Pausa entre pasos durante la reproducción. */
  stepDelay: number;
  /** Escribir carácter a carácter (más realista) o de golpe. */
  typeMode: "instant" | "keys";
  /** Pausa entre teclas en modo "keys". */
  keyDelay: number;
  /** Resaltar el elemento antes de actuar. */
  highlight: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeout: 8000,
  stepDelay: 250,
  typeMode: "instant",
  keyDelay: 25,
  highlight: true,
};

/** Estado de grabación (vive en storage.session). */
export interface RecordingState {
  flowId: string;
  tabId: number;
  /** record: las interacciones ocurren de verdad. point: solo se señalan, los clicks no se ejecutan. */
  mode: "record" | "point";
  paused: boolean;
}

/** Formato del fichero de exportación. */
export interface ExportFile {
  format: "rastro";
  version: 1;
  exportedAt: string;
  flows: Flow[];
}

export const STEP_META: Record<StepType, { label: string; icon: string; needsTarget: boolean; valueHint?: string }> = {
  navigate: { label: "Ir a", icon: "↗", needsTarget: false, valueHint: "https://…" },
  click: { label: "Click", icon: "◉", needsTarget: true },
  fill: { label: "Escribir", icon: "⌨", needsTarget: true, valueHint: "texto o {{variable}}" },
  select: { label: "Seleccionar", icon: "☰", needsTarget: true, valueHint: "value de la opción" },
  check: { label: "Marcar", icon: "☑", needsTarget: true, valueHint: "true / false" },
  press: { label: "Tecla", icon: "⏎", needsTarget: false, valueHint: "Enter, Tab, Escape…" },
  wait: { label: "Esperar", icon: "⏱", needsTarget: false, valueHint: "milisegundos" },
  waitFor: { label: "Esperar a", icon: "⌛", needsTarget: true },
  assertText: { label: "Comprobar", icon: "✓", needsTarget: true, valueHint: "texto esperado" },
};
