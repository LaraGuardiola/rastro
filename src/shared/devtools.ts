// Conversión desde/hacia el formato JSON del panel «Recorder» de Chrome DevTools.
// Formato: https://github.com/puppeteer/replay (title + steps[] con selectors: string[][]).
import { newFlow, newStep } from "./store";
import type { Flow, FrameRef, Step } from "./types";

interface DTStep {
  type: string;
  target?: string;
  frame?: number[];
  selectors?: (string | string[])[];
  url?: string;
  value?: string;
  key?: string;
  timeout?: number;
  [k: string]: unknown;
}

interface DTRecording {
  title?: string;
  timeout?: number;
  steps: DTStep[];
}

export function isDevToolsRecording(data: unknown): data is DTRecording {
  if (!data || typeof data !== "object" || !Array.isArray((data as DTRecording).steps)) return false;
  const steps = (data as DTRecording).steps;
  return "title" in data && steps.some((s) => s && (s.type === "setViewport" || Array.isArray(s.selectors) || s.type === "navigate" && "url" in s));
}

// ───────────────────────────── Importar ─────────────────────────────

/**
 * Traduce los selectores de Recorder a los de Rastro. Cada entrada es una cadena
 * (varias partes = atravesar shadow roots; nos quedamos con las de una sola parte).
 */
function mapSelectors(raw: (string | string[])[] | undefined, isInput: boolean): { selectors: string[]; name?: string } {
  const stable: string[] = []; // #id, [atributo]
  const named: string[] = []; // text= / label=
  const positional: string[] = []; // rutas CSS con nth-of-type…
  const xpath: string[] = [];
  let name: string | undefined;
  for (const entry of raw ?? []) {
    const parts = Array.isArray(entry) ? entry : [entry];
    if (parts.length !== 1) continue;
    const s = parts[0]!;
    if (s.startsWith("aria/")) {
      const n = s.slice(5).replace(/\[role="[^"]*"\]$/, "");
      name ??= n.replace(/\s*\*$/, "");
      if (isInput) named.push(`label=${n.replace(/\s*\*$/, "")}`);
      else named.push(`text=${n}`, `[aria-label=${JSON.stringify(n)}]`);
    } else if (s.startsWith("text/")) {
      name ??= s.slice(5);
      named.push(`text=${s.slice(5)}`);
    } else if (s.startsWith("xpath/")) xpath.push(`xpath=${s.slice(6)}`);
    else {
      const css = s.startsWith("pierce/") ? s.slice(7) : s;
      (/^#[\w-]+$|^[\w-]*\[[^\]]+\]$/.test(css) ? stable : positional).push(css);
    }
  }
  return { selectors: [...new Set([...stable, ...named, ...positional, ...xpath])].slice(0, 6), name };
}

function mapFrame(frame: number[] | undefined): FrameRef[] | undefined {
  return frame?.length ? frame.map((i) => ({ selector: `frame=${i}` })) : undefined;
}

export function fromDevTools(rec: DTRecording): { flow: Flow; skipped: string[] } {
  const steps: Step[] = [];
  const skipped: string[] = [];
  for (const s of rec.steps) {
    if (s.target && s.target !== "main") {
      skipped.push(`${s.type} (en otra ventana)`);
      continue;
    }
    const isInput = s.type === "change";
    const mapped = mapSelectors(s.selectors, isInput);
    const [selector, ...fallbacks] = mapped.selectors;
    const target = { selector, fallbacks, frame: mapFrame(s.frame), timeout: s.timeout };
    const label = mapped.name ?? selector;
    switch (s.type) {
      case "setViewport":
      case "keyUp":
        break; // sin equivalente / redundante
      case "navigate":
        steps.push(newStep({ type: "navigate", value: s.url }));
        break;
      case "click":
      case "doubleClick":
        if (!selector) skipped.push(s.type + " sin selector usable");
        else steps.push(newStep({ type: "click", ...target, label, note: s.type === "doubleClick" ? "doble click en DevTools" : undefined }));
        break;
      case "change": {
        if (!selector) {
          skipped.push("change sin selector usable");
          break;
        }
        // Recorder graba «click en el campo» + «change»: el click sobra.
        const prev = steps.at(-1);
        if (prev?.type === "click" && prev.selector === selector && JSON.stringify(prev.frame) === JSON.stringify(target.frame)) steps.pop();
        steps.push(newStep({ type: "fill", ...target, label, value: s.value ?? "" }));
        break;
      }
      case "keyDown":
        steps.push(newStep({ type: "press", value: s.key ?? "Enter" }));
        break;
      case "waitForElement":
        if (selector) steps.push(newStep({ type: "waitFor", ...target, label }));
        break;
      default:
        skipped.push(s.type);
    }
  }
  const flow = newFlow({ name: rec.title || "Grabación de DevTools", tags: ["devtools"], steps });
  return { flow, skipped };
}

// ───────────────────────────── Exportar ─────────────────────────────

function toDTSelector(sel: string): string {
  if (sel.startsWith("text=")) return `text/${sel.slice(5)}`;
  if (sel.startsWith("label=")) return `aria/${sel.slice(6)}`;
  if (sel.startsWith("xpath=")) return `xpath/${sel.slice(6)}`;
  return sel;
}

/** Exporta al formato de DevTools Recorder. Los pasos dentro de iframes pierden la ruta (Recorder usa índices). */
export function toDevTools(flow: Flow): { json: DTRecording; warnings: number } {
  const steps: DTStep[] = [
    { type: "setViewport", width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: false },
  ];
  let warnings = 0;
  for (const s of flow.steps) {
    if (!s.enabled) continue;
    if (s.frame?.length) warnings++;
    const selectors = [s.selector, ...(s.fallbacks ?? [])].filter(Boolean).map((x) => [toDTSelector(x!)]);
    const base = { target: "main", selectors, ...(s.timeout ? { timeout: s.timeout } : {}) };
    switch (s.type) {
      case "navigate":
        steps.push({ type: "navigate", url: s.value ?? "" });
        break;
      case "click":
      case "check":
        steps.push({ type: "click", ...base, offsetX: 1, offsetY: 1 });
        break;
      case "fill":
      case "select":
        steps.push({ type: "change", ...base, value: s.value ?? "" });
        break;
      case "press":
        steps.push({ type: "keyDown", target: "main", key: s.value || "Enter" }, { type: "keyUp", target: "main", key: s.value || "Enter" });
        break;
      case "waitFor":
        steps.push({ type: "waitForElement", ...base });
        break;
      case "assertText":
        steps.push({
          type: "waitForExpression",
          target: "main",
          expression: `(() => { const e = document.querySelector(${JSON.stringify(s.selector ?? "")}); return !!e && (e.value ?? e.innerText).includes(${JSON.stringify(s.value ?? "")}); })()`,
        });
        break;
      case "wait":
        steps.push({ type: "waitForExpression", target: "main", expression: `new Promise((r) => setTimeout(() => r(true), ${Number(s.value) || 1000}))` });
        break;
    }
  }
  return { json: { title: flow.name, steps }, warnings };
}
