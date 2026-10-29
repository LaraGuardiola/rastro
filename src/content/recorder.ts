// Grabador. Dos modos:
//   record → las interacciones ocurren de verdad y se van anotando.
//   point  → «señalar»: los clicks en botones/enlaces NO se ejecutan, solo se anotan.
//            Inputs, selects y checkboxes funcionan normal, así que se graba su estado.
//
// Regla clave: clicar un input no genera un «click»; genera un «fill» con su contenido,
// que se va actualizando mientras escribes (el background fusiona pasos del mismo campo).

import type { RecordedStep } from "../shared/messages";
import { COLORS, overlay } from "./overlay";
import { actionable, buildSelectors, checkedOf, describe, kindOf, valueOf, type ActionKind } from "./selector";

type Mode = "record" | "point";

let mode: Mode | null = null;
let send: (s: RecordedStep) => void = () => {};
const pendingFill = new Map<Element, ReturnType<typeof setTimeout>>();

const VERB: Record<ActionKind, string> = { click: "Click", fill: "Escribir", select: "Seleccionar", check: "Marcar", file: "Fichero" };

/** Convierte un elemento en el paso que le corresponde, con su estado actual. */
export function capture(el: Element): RecordedStep | null {
  const kind = kindOf(el);
  if (kind === "file") return null;
  const [selector, ...fallbacks] = buildSelectors(el);
  const base = { selector, fallbacks, label: describe(el) };
  switch (kind) {
    case "fill":
      return { ...base, type: "fill", value: valueOf(el), secret: (el as HTMLInputElement).type === "password" || undefined };
    case "select": {
      const s = el as HTMLSelectElement;
      return { ...base, type: "select", value: s.value, optionText: s.selectedOptions[0]?.text.trim() };
    }
    case "check":
      return { ...base, type: "check", value: String(checkedOf(el)) };
    default:
      return { ...base, type: "click" };
  }
}

function emit(el: Element, step: RecordedStep | null) {
  if (!step) return;
  send(step);
  const what = step.type === "fill" ? (step.secret ? "••••" : `«${(step.value ?? "").slice(0, 30)}»`) : "";
  overlay.toast(`✓ ${VERB[step.type as ActionKind] ?? step.type}: ${step.label} ${what}`.trim(), COLORS[kindOf(el)]);
}

function flushFills() {
  for (const [el, t] of pendingFill) {
    clearTimeout(t);
    send(capture(el)!);
  }
  pendingFill.clear();
}

function scheduleFill(el: Element) {
  clearTimeout(pendingFill.get(el));
  pendingFill.set(
    el,
    setTimeout(() => {
      pendingFill.delete(el);
      const s = capture(el);
      if (s) send(s);
    }, 350),
  );
}

const targetOf = (e: Event): Element | null => {
  const t = e.composedPath()[0];
  return t instanceof Element ? t : null;
};

// ───────────────────────────── Listeners ─────────────────────────────

function onMove(e: MouseEvent) {
  const t = targetOf(e);
  if (!t || overlay.owns(t)) return;
  const el = actionable(t);
  const k = kindOf(el);
  const hint = k === "file" ? "Fichero (no automatizable)" : `${VERB[k]} · ${describe(el)}`;
  overlay.show(el, hint, COLORS[k]);
}

/** En modo señalar, bloquea botones/enlaces para que no hagan nada (el resto funciona normal). */
function blockInPoint(e: Event) {
  if (mode !== "point" || !e.isTrusted) return;
  const t = targetOf(e);
  if (!t || overlay.owns(t)) return;
  if (kindOf(actionable(t)) === "click") {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

function onClick(e: MouseEvent) {
  if (!e.isTrusted) return;
  const t = targetOf(e);
  if (!t || overlay.owns(t)) return;
  blockInPoint(e);
  const el = actionable(t);
  const k = kindOf(el);
  if (k === "file") return overlay.toast("Los inputs de fichero no se pueden automatizar", undefined, true);
  if (k === "check" || k === "select") return; // se graban en "change" con el estado final
  flushFills();
  if (k === "fill") {
    // Clicar un input con contenido = rellenarlo con ese contenido.
    // Si está vacío, el paso se crea en cuanto escribas.
    if (valueOf(el)) emit(el, capture(el));
    return;
  }
  emit(el, capture(el));
}

function onInput(e: Event) {
  const t = targetOf(e);
  if (!t) return;
  const el = actionable(t);
  if (kindOf(el) === "fill") scheduleFill(el);
}

function onChange(e: Event) {
  if (!e.isTrusted) return;
  const t = targetOf(e);
  if (!t) return;
  const el = actionable(t);
  const k = kindOf(el);
  if (k === "fill") {
    clearTimeout(pendingFill.get(el));
    pendingFill.delete(el);
    send(capture(el)!);
  } else if (k === "select" || k === "check") {
    flushFills();
    emit(el, capture(el));
  }
}

function onKey(e: KeyboardEvent) {
  if (!e.isTrusted) return;
  if (mode === "point" && e.key === "Escape") {
    e.preventDefault();
    stopHandler();
    return;
  }
  const t = targetOf(e);
  if (!t) return;
  if (e.key === "Enter" && t instanceof HTMLInputElement && kindOf(t) === "fill") {
    flushFills();
    send({ type: "press", value: "Enter", selector: buildSelectors(t)[0], label: describe(t) });
    overlay.toast(`✓ Tecla: Enter en ${describe(t)}`);
  }
}

function onLeave() {
  flushFills();
}

const onScroll = () => overlay.hide();

let stopHandler: () => void = () => {};

const listeners: [string, EventListener][] = [
  ["mousemove", onMove as EventListener],
  ["pointerdown", blockInPoint],
  ["mousedown", blockInPoint],
  ["pointerup", blockInPoint],
  ["mouseup", blockInPoint],
  ["click", onClick as EventListener],
  ["input", onInput],
  ["change", onChange],
  ["keydown", onKey as EventListener],
];

export function startRecording(m: Mode, sink: (s: RecordedStep) => void, onStop: () => void) {
  if (mode) stopRecording();
  mode = m;
  send = sink;
  stopHandler = onStop;
  overlay.onStop = onStop;
  for (const [ev, fn] of listeners) window.addEventListener(ev, fn, true);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("scroll", onScroll, true);
  // La píldora solo en la página principal, no en cada iframe.
  if (window === window.top) overlay.setPill(m);
}

export function stopRecording() {
  flushFills();
  for (const [ev, fn] of listeners) window.removeEventListener(ev, fn, true);
  window.removeEventListener("pagehide", onLeave);
  window.removeEventListener("scroll", onScroll, true);
  mode = null;
  overlay.hide();
  overlay.setPill(null);
}

/** Selección de un único elemento (para re-apuntar un paso). Clicks bloqueados. */
export function pickOnce(): Promise<RecordedStep | null> {
  return new Promise((resolve) => {
    const block = (e: Event) => {
      if (overlay.owns(targetOf(e))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const done = (r: RecordedStep | null) => {
      window.removeEventListener("mousemove", onMove as EventListener, true);
      for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) window.removeEventListener(ev, block, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      overlay.hide();
      cancelPick = () => {};
      resolve(r);
    };
    const click = (e: MouseEvent) => {
      block(e);
      const t = targetOf(e);
      if (!t || overlay.owns(t)) return;
      done(capture(actionable(t)) ?? null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    window.addEventListener("mousemove", onMove as EventListener, true);
    for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) window.addEventListener(ev, block, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    cancelPick = () => done(null);
    if (window === window.top) overlay.toast("Clica el elemento (Esc para cancelar)");
  });
}

export let cancelPick: () => void = () => {};
