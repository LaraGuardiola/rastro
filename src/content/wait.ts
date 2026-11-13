// Espera automática antes de cada acción: que la página esté «tranquila» (sin peticiones en vuelo,
// sin cambios en el DOM, sin loaders visibles) y que el elemento esté listo para recibir la acción
// (habilitado, quieto y sin nada encima). Evita clicks que «no hacen nada» porque aún hay un loader.

import { sleep } from "../shared/util";
import { isVisible } from "./selector";

/** Margen sin peticiones antes de dar la red por tranquila (cubre cadenas de peticiones encadenadas). */
const NET_QUIET = 300;
/** Margen sin mutaciones del DOM. */
const DOM_QUIET = 150;
/** Webs con relojes, carruseles…: el DOM nunca para; no esperamos más de esto por él. */
const DOM_CAP = 1500;

// Loaders de librerías habituales. Solo indicadores de carga, no modales (su fondo también tapa, pero es intencionado).
const LOADERS = [
  '[aria-busy="true"]',
  ".el-loading-mask", // Element Plus / Element UI
  ".ant-spin-spinning", // Ant Design
  ".v-progress-circular--indeterminate", ".v-progress-linear--active", // Vuetify
  ".MuiCircularProgress-root", ".MuiLinearProgress-root", // MUI
  ".p-progress-spinner", ".p-blockui", // PrimeVue / PrimeNG
  ".q-loading", ".q-spinner", // Quasar
  ".spinner-border", ".spinner-grow", // Bootstrap
  ".blockUI", ".loading-overlay", ".loading-mask", ".loader", ".spinner",
].join(", ");

// ───────────────────────────── Red ─────────────────────────────

let pending = 0;
let netChanged = performance.now();

document.addEventListener("__rastro_net", (e) => {
  const n = (e as CustomEvent).detail;
  if (typeof n !== "number") return;
  pending = n;
  netChanged = performance.now();
});
document.dispatchEvent(new Event("__rastro_net?"));

// ───────────────────────────── DOM ─────────────────────────────

let domChanged = performance.now();
let domObserver: MutationObserver | null = null;

function watchDom() {
  if (domObserver) return;
  domObserver = new MutationObserver((records) => {
    if (records.some((r) => !(r.target as Element).closest?.("#__rastro_host"))) domChanged = performance.now();
  });
  domObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
}

/** Selector de loaders: los integrados + el personalizado de ajustes (si es un selector válido). */
function loaderSelector(extra?: string): string {
  const x = extra?.trim();
  if (!x) return LOADERS;
  try {
    document.querySelector(x);
    return `${LOADERS}, ${x}`;
  } catch {
    return LOADERS;
  }
}

export function visibleLoader(extra?: string): Element | undefined {
  for (const el of document.querySelectorAll(loaderSelector(extra))) {
    if (el.closest("#__rastro_host") || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
}

/**
 * Espera a que la página esté tranquila. Nunca falla: pasado `maxMs` sigue adelante
 * (polling, animaciones infinitas…) y que el paso decida si encuentra su elemento.
 */
export async function settle(maxMs: number, extraLoader?: string): Promise<void> {
  watchDom();
  const start = performance.now();
  while (true) {
    const now = performance.now();
    const netQuiet = pending === 0 && now - netChanged >= NET_QUIET;
    const domQuiet = now - domChanged >= DOM_QUIET || now - start > DOM_CAP;
    if (netQuiet && domQuiet && !visibleLoader(extraLoader)) return;
    if (now - start > maxMs) return;
    await sleep(50);
  }
}

// ───────────────────────────── Elemento ─────────────────────────────

function isDisabled(el: Element, visible: boolean): boolean {
  if (el.matches(":disabled")) return true; // incluye <fieldset disabled>
  if (el.closest('[aria-disabled="true"]')) return true;
  // Controles ocultos de librerías (checkbox custom…) a veces llevan pointer-events: none a propósito.
  return visible && getComputedStyle(el).pointerEvents === "none";
}

function ancestor(el: Element, levels: number): Element {
  let cur = el;
  for (let i = 0; i < levels && cur.parentElement; i++) cur = cur.parentElement;
  return cur;
}

/** ¿Qué hay encima del centro del elemento, si no es el propio elemento (o algo de su entorno inmediato)? */
function coveredBy(el: Element, extraLoader?: string): Element | null {
  if (el.getRootNode() !== document) return null; // shadow DOM: elementFromPoint devuelve el host, no podemos saberlo
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
  const top = document.elementFromPoint(x, y);
  if (!top || el.contains(top) || top.closest("#__rastro_host")) return null;
  if ((el as HTMLInputElement).labels && [...(el as HTMLInputElement).labels!].some((l) => l.contains(top))) return null;
  // Placeholders, iconos o wrappers hermanos (selects de librerías): reciben el click y lo propagan igual.
  if (!top.closest(loaderSelector(extraLoader)) && ancestor(el, 3).contains(top)) return null;
  return top;
}

function describeEl(el: Element): string {
  const cls = [...el.classList].slice(0, 2).join(".");
  return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
}

/**
 * Espera a que el elemento acepte la acción: habilitado, sin moverse (animaciones de entrada)
 * y, si `checkHit`, sin nada encima. Devuelve un motivo si se agota el tiempo.
 */
export async function untilActionable(el: Element, timeout: number, checkHit: boolean, extraLoader?: string): Promise<string | null> {
  const start = performance.now();
  let lastRect = "";
  let why: string | null = null;
  while (true) {
    const r = el.getBoundingClientRect();
    const rect = `${r.x},${r.y},${r.width},${r.height}`;
    const stable = rect === lastRect;
    lastRect = rect;
    const cover = checkHit ? coveredBy(el, extraLoader) : null;
    if (isDisabled(el, checkHit)) why = "está deshabilitado";
    else if (cover) why = `está tapado por ${describeEl(cover)}`;
    else if (!stable) why = "se está moviendo";
    else return null;
    if (performance.now() - start > timeout) return why;
    await sleep(50);
  }
}
