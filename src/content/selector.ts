// Motor de selectores propio.
//
// Sintaxis soportada:
//   css            → cualquier selector CSS (por defecto)
//   frame=2        → el tercer <iframe> del documento (para rutas de frames importadas)
//   text=Enviar    → elemento cuyo texto visible es exactamente «Enviar» (o, si no hay, que lo contiene)
//   label=Email    → control de formulario asociado a la etiqueta/aria-label «Email»
//   xpath=//div[1] → XPath
//
// Al generar, se producen varios candidatos ordenados por robustez. El reproductor
// prueba el principal y, si falla, los alternativos.

import { looksGenerated } from "../shared/util";

const TEST_ATTRS = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa", "data-e2e", "data-automation-id"];

const CLICKABLE =
  'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], ' +
  '[role="checkbox"], [role="radio"], [role="switch"], input[type="submit"], input[type="button"], ' +
  'input[type="reset"], input[type="image"], summary, label, [onclick]';

export const CONTROL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const STATE_CLASSES = /^(is-|has-)?(active|focus(ed)?|hover(ed)?|selected|open(ed)?|disabled|checked|visible|hidden|show|in|ng-.*)$/i;

function stableClasses(el: Element): string[] {
  return [...el.classList].filter((c) => !looksGenerated(c) && !STATE_CLASSES.test(c) && !c.includes(":") && c.length < 32);
}

const q = (v: string) => JSON.stringify(v); // comillas + escapes válidos en CSS

// ───────────────────────────── Resolución ─────────────────────────────

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.getClientRects().length === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.opacity !== "0";
}

/** Texto «visible» de un elemento, como lo vería el usuario. */
export function textOf(el: Element): string {
  if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type)) return norm(el.value);
  return norm((el as HTMLElement).innerText ?? el.textContent);
}

function* allElements(root: Document | ShadowRoot = document): Generator<Element> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    yield n as Element;
    const sr = (n as Element).shadowRoot;
    if (sr) yield* allElements(sr);
    n = walker.nextNode();
  }
}

function byText(text: string): Element[] {
  const target = norm(text);
  const exact: Element[] = [];
  const partial: Element[] = [];
  const lower = target.toLowerCase();
  for (const el of allElements()) {
    if (el.closest("script, style, noscript, template, #__rastro_host")) continue;
    const limit = target.length * 3 + 20;
    // textContent es barato; innerText fuerza layout, así que solo para candidatos cortos.
    if (!(el instanceof HTMLInputElement) && norm(el.textContent).length > limit) continue;
    const t = textOf(el);
    if (!t || t.length > limit) continue;
    if (t === target) exact.push(el);
    else if (t.toLowerCase().includes(lower)) partial.push(el);
  }
  const pick = exact.length ? exact : partial;
  // Quedarse con el más profundo y subir a su ancestro clicable si lo hay.
  const deepest = pick.filter((el) => !pick.some((o) => o !== el && el.contains(o)));
  return dedupe(deepest.map((el) => el.closest(CLICKABLE) ?? el));
}

function byLabel(text: string): Element[] {
  const target = norm(text).toLowerCase();
  const out: Element[] = [];
  for (const label of document.querySelectorAll("label")) {
    if (norm(label.innerText).toLowerCase().replace(/\s*\*$/, "") === target && label.control) out.push(label.control);
  }
  for (const el of document.querySelectorAll(CONTROL + ", [aria-label], [aria-labelledby]")) {
    if (norm(el.getAttribute("aria-label")).toLowerCase() === target) out.push(el);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText ?? "")
        .join(" ");
      if (norm(t).toLowerCase() === target) out.push(el);
    }
  }
  if (!out.length) {
    for (const el of document.querySelectorAll("[placeholder]")) {
      if (norm(el.getAttribute("placeholder")).toLowerCase() === target) out.push(el);
    }
  }
  return dedupe(out);
}

function byXPath(xp: string): Element[] {
  const res = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const out: Element[] = [];
  for (let i = 0; i < res.snapshotLength; i++) {
    const n = res.snapshotItem(i);
    if (n instanceof Element) out.push(n);
  }
  return out;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Devuelve todos los elementos que casan con un selector de Rastro. */
export function resolveAll(selector: string): Element[] {
  try {
    if (selector.startsWith("text=")) return byText(unquote(selector.slice(5)));
    if (selector.startsWith("label=")) return byLabel(unquote(selector.slice(6)));
    if (selector.startsWith("xpath=")) return byXPath(selector.slice(6));
    if (selector.startsWith("frame=")) {
      // N-ésimo iframe del documento (formato de DevTools Recorder).
      const f = document.querySelectorAll("iframe, frame")[Number(selector.slice(6))];
      return f ? [f] : [];
    }
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Encuentra el primer selector que resuelve a exactamente un elemento (o al primero visible). */
export function resolve(selectors: string[]): { el: Element; selector: string } | null {
  for (const sel of selectors) {
    const found = resolveAll(sel);
    if (found.length === 1) return { el: found[0]!, selector: sel };
    const vis = found.filter(isVisible);
    if (vis.length >= 1) return { el: vis[0]!, selector: sel };
    if (found.length) return { el: found[0]!, selector: sel };
  }
  return null;
}

// ───────────────────────────── Generación ─────────────────────────────

function isUnique(sel: string, el: Element): boolean {
  const r = resolveAll(sel);
  return r.length === 1 && r[0] === el;
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    if (cur !== el && cur.id && !looksGenerated(cur.id)) {
      parts.unshift("#" + CSS.escape(cur.id));
      const s = parts.join(" > ");
      if (isUnique(s, el)) return s;
      parts.shift();
    }
    let seg = tag;
    const cls = stableClasses(cur).slice(0, 2);
    if (cls.length) seg += "." + cls.map((c) => CSS.escape(c)).join(".");

    const withoutNth = [seg, ...parts].join(" > ");
    if (isUnique(withoutNth, el)) return withoutNth;

    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(seg);
    const s = parts.join(" > ");
    if (isUnique(s, el)) return s;
    cur = parent;
  }
  return parts.join(" > ");
}

/** Genera selectores candidatos ordenados de más a menos robusto. Todos únicos. */
export function buildSelectors(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const c: string[] = [];

  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) c.push(`[${a}=${q(v)}]`);
  }
  if (el.id && !looksGenerated(el.id)) c.push("#" + CSS.escape(el.id));

  const name = el.getAttribute("name");
  if (name) {
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox") && el.value && el.value !== "on") {
      c.push(`${tag}[name=${q(name)}][value=${q(el.value)}]`);
    } else c.push(`${tag}[name=${q(name)}]`);
  }

  const isControl = el.matches(CONTROL);
  if (isControl) {
    const lbl = labelText(el);
    if (lbl && lbl.length <= 60) c.push(`label=${lbl}`);
  }

  const aria = el.getAttribute("aria-label");
  if (aria) c.push(`${tag}[aria-label=${q(aria)}]`);
  const ph = el.getAttribute("placeholder");
  if (ph) c.push(`${tag}[placeholder=${q(ph)}]`);

  if (!isControl) {
    const t = textOf(el);
    if (t && t.length <= 50 && !el.querySelector(CONTROL)) c.push(`text=${t}`);
  }

  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute("href");
    if (href && href.length < 80 && !href.startsWith("javascript:") && href !== "#") c.push(`a[href=${q(href)}]`);
  }
  if (el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement) {
    const src = el.getAttribute("src");
    if (src && !src.startsWith("data:") && !src.startsWith("javascript:")) {
      // Sin query string: suele llevar tokens que cambian en cada carga.
      const base = src.split(/[?#]/)[0]!;
      c.push(base === src ? `${tag}[src=${q(src)}]` : `${tag}[src^=${q(base)}]`);
    }
  }
  const title = el.getAttribute("title");
  if (title) c.push(`${tag}[title=${q(title)}]`);

  // text= apunta al nodo más profundo con ese texto (p. ej. el <span> de un <li> de desplegable): clicarlo equivale.
  const sameTarget = (s: string) => {
    const r = resolveAll(s);
    return r.length === 1 && (r[0] === el || (s.startsWith("text=") && el.contains(r[0]!) && textOf(r[0]!) === textOf(el)));
  };
  const unique = dedupe(c).filter(sameTarget);
  unique.push(cssPath(el));
  return dedupe(unique).slice(0, 5);
}

// ───────────────────────────── Descripción ─────────────────────────────

export function labelText(el: Element): string {
  if ((el as HTMLInputElement).labels?.length) {
    const t = norm((el as HTMLInputElement).labels![0]!.innerText).replace(/\s*\*$/, "");
    if (t) return t;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return norm(aria);
  const lb = el.getAttribute("aria-labelledby");
  if (lb) {
    const t = norm(lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" "));
    if (t) return t;
  }
  return "";
}

/** Nombre legible para mostrar en la lista de pasos. */
export function describe(el: Element): string {
  if (el.matches(CONTROL)) {
    return (
      labelText(el) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.id ||
      el.getAttribute("title") ||
      el.tagName.toLowerCase()
    ).slice(0, 60);
  }
  const t = textOf(el);
  if (t) return t.length > 50 ? t.slice(0, 47) + "…" : t;
  return (
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    el.querySelector("img")?.getAttribute("alt") ||
    el.getAttribute("name") ||
    el.tagName.toLowerCase()
  ).slice(0, 60);
}

/** Elemento sobre el que actúa el usuario: el control o el ancestro clicable. */
export function actionable(target: Element): Element {
  const ctrl = target.closest(CONTROL);
  if (ctrl) return ctrl;
  const clickable = target.closest(CLICKABLE);
  if (clickable instanceof HTMLLabelElement && clickable.control) return clickable.control;
  return clickable ?? target;
}

const TEXTLIKE = new Set([
  "", "text", "email", "password", "search", "tel", "url", "number",
  "date", "datetime-local", "month", "week", "time", "color", "range",
]);

export type ActionKind = "click" | "fill" | "select" | "check" | "file";

export function kindOf(el: Element): ActionKind {
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return el.readOnly ? "click" : "fill";
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return "check";
    if (el.type === "file") return "file";
    // Readonly = selects/datepickers de librerías (Element Plus, Vuetify…): abren un desplegable, no se escribe.
    if (TEXTLIKE.has(el.type)) return el.readOnly ? "click" : "fill";
    return "click";
  }
  if ((el as HTMLElement).isContentEditable) return "fill";
  const role = el.getAttribute("role");
  if (role === "checkbox" || role === "switch") return "check";
  return "click";
}

export function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  return norm((el as HTMLElement).innerText);
}

export function checkedOf(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.getAttribute("aria-checked") === "true";
}
