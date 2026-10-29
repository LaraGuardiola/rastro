// Reproductor: ejecuta un paso sobre la página simulando a un usuario real
// (secuencia completa de eventos de puntero/teclado, compatible con React/Vue/Angular).

import type { StepResult } from "../shared/messages";
import type { Settings, Step } from "../shared/types";
import { sleep } from "../shared/util";
import { COLORS, overlay } from "./overlay";
import { checkedOf, isVisible, kindOf, resolve, textOf, valueOf } from "./selector";

class StepError extends Error {}

/** Espera a que el elemento exista (y preferiblemente sea visible). */
async function find(step: Step, timeout: number, requireVisible: boolean): Promise<{ el: Element; selector: string }> {
  const selectors = [step.selector, ...(step.fallbacks ?? [])].filter(Boolean) as string[];
  if (!selectors.length) throw new StepError("El paso no tiene selector");
  const start = performance.now();
  let hiddenSince = 0;
  while (true) {
    const r = resolve(selectors);
    if (r) {
      if (isVisible(r.el)) return r;
      // Controles ocultos (checkbox custom, inputs con label estilizado…): se aceptan tras 1s.
      if (!requireVisible) {
        hiddenSince ||= performance.now();
        if (performance.now() - hiddenSince > 1000) return r;
      }
    }
    if (performance.now() - start > timeout) {
      if (r) throw new StepError(`El elemento «${step.label ?? selectors[0]}» existe pero no es visible`);
      throw new StepError(`No se encontró «${step.label ?? selectors[0]}» (${selectors[0]})`);
    }
    await sleep(100);
  }
}

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function scrollTo(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
    await sleep(50);
  }
}

function mouse(target: Element, type: string, x: number, y: number) {
  const init: PointerEventInit = {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: x, clientY: y, screenX: x + screenX, screenY: y + screenY,
    button: 0, buttons: type.endsWith("down") ? 1 : 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
  };
  const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  return target.dispatchEvent(new Ctor(type, init));
}

async function realClick(el: Element) {
  await scrollTo(el);
  const { x, y } = center(el);
  // Si hay algo encima pero es un hijo (icono dentro del botón), disparamos sobre él como haría el navegador.
  const top = document.elementFromPoint(x, y);
  const target = top && el.contains(top) ? top : el;
  mouse(target, "pointerover", x, y);
  mouse(target, "mouseover", x, y);
  mouse(target, "pointermove", x, y);
  mouse(target, "mousemove", x, y);
  const down = mouse(target, "pointerdown", x, y) && mouse(target, "mousedown", x, y);
  if (down && el instanceof HTMLElement && el.tabIndex >= -1) el.focus({ preventScroll: true });
  mouse(target, "pointerup", x, y);
  mouse(target, "mouseup", x, y);
  // click sintético: el navegador ejecuta la acción por defecto (seguir enlace, enviar form…).
  mouse(target, "click", x, y);
}

const NO_TYPING = new Set(["date", "datetime-local", "month", "week", "time", "color", "range"]);

function setNative(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  // Estamos en el «isolated world» del content script: este setter es el nativo,
  // así que el value tracker de React detecta el cambio al recibir el evento input.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
}

function fireInput(el: Element, data: string | null, inputType = "insertText") {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data, inputType }));
}

function key(el: Element, type: "keydown" | "keypress" | "keyup", k: string) {
  return el.dispatchEvent(
    new KeyboardEvent(type, { key: k, code: codeFor(k), bubbles: true, cancelable: true, composed: true }),
  );
}

function codeFor(k: string): string {
  if (k.length === 1) {
    if (/[a-z]/i.test(k)) return "Key" + k.toUpperCase();
    if (/\d/.test(k)) return "Digit" + k;
    if (k === " ") return "Space";
    return "";
  }
  return k;
}

function selectAll(el: HTMLInputElement | HTMLTextAreaElement) {
  try {
    el.select();
  } catch {
    /* number/email no soportan selección en algunos navegadores */
  }
}

async function typeInto(el: Element, value: string, s: Settings) {
  await scrollTo(el);
  (el as HTMLElement).focus({ preventScroll: true });

  if ((el as HTMLElement).isContentEditable) {
    document.execCommand("selectAll");
    if (value) document.execCommand("insertText", false, value);
    else document.execCommand("delete");
    if (textOf(el) !== value.replace(/\s+/g, " ").trim()) {
      el.textContent = value;
      fireInput(el, value);
    }
    return;
  }

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new StepError("El elemento no es editable");
  if (el.disabled) throw new StepError(`«${el.name || el.id}» está deshabilitado`);

  const typeable = !(el instanceof HTMLInputElement && NO_TYPING.has(el.type));

  if (!typeable || s.typeMode === "instant") {
    selectAll(el);
    const ok = typeable && (value ? document.execCommand("insertText", false, value) : document.execCommand("delete"));
    if (!ok || el.value !== value) {
      setNative(el, value);
      fireInput(el, value);
    }
  } else {
    // Carácter a carácter: más lento, pero dispara keydown/keyup para validaciones y autocompletados.
    selectAll(el);
    if (!document.execCommand("delete") || el.value !== "") {
      setNative(el, "");
      fireInput(el, null, "deleteContentBackward");
    }
    for (const ch of value) {
      const allowed = key(el, "keydown", ch);
      key(el, "keypress", ch);
      if (allowed) {
        const before = el.value;
        if (!document.execCommand("insertText", false, ch) || el.value === before) {
          setNative(el, before + ch);
          fireInput(el, ch);
        }
      }
      key(el, "keyup", ch);
      if (s.keyDelay) await sleep(s.keyDelay);
    }
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectOption(el: Element, value: string, optionText?: string) {
  if (!(el instanceof HTMLSelectElement)) throw new StepError("El elemento no es un <select>");
  const opts = [...el.options];
  const opt =
    opts.find((o) => o.value === value) ??
    (optionText ? opts.find((o) => o.text.trim() === optionText) : undefined) ??
    opts.find((o) => o.text.trim() === value) ??
    opts.find((o) => o.text.trim().toLowerCase().includes(value.toLowerCase()));
  if (!opt) throw new StepError(`El select no tiene la opción «${optionText ?? value}»`);
  el.focus();
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setChecked(el: Element, want: boolean) {
  if (checkedOf(el) === want) return;
  if (el instanceof HTMLInputElement && el.type === "radio" && !want) {
    throw new StepError("Un radio no se puede desmarcar; marca otra opción del grupo");
  }
  if (isVisible(el)) await realClick(el);
  else if (el instanceof HTMLInputElement && el.labels?.[0] && isVisible(el.labels[0])) await realClick(el.labels[0]);
  else (el as HTMLElement).click();
  if (checkedOf(el) !== want && el instanceof HTMLInputElement) {
    el.checked = want;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';

async function press(el: Element, k: string) {
  const down = key(el, "keydown", k);
  if (k === "Enter") key(el, "keypress", k);
  if (down) {
    if (k === "Enter") {
      if (el instanceof HTMLInputElement && el.form) {
        // Envío implícito: el navegador clica el botón de submit por defecto.
        const btn = el.form.querySelector<HTMLElement>('button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]');
        if (btn) await realClick(btn);
        else el.form.requestSubmit();
      } else if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) {
        (el as HTMLElement).click();
      }
    } else if (k === "Tab") {
      const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => isVisible(e) && !(e as HTMLInputElement).disabled);
      const i = all.indexOf(el as HTMLElement);
      all[(i + 1) % all.length]?.focus();
    }
  }
  key(el, "keyup", k);
}

/** ¿Activar este elemento puede cambiar de página? */
function mayNavigate(el: Element): boolean {
  if (el.closest("a[href]")) return true;
  const btn = el.closest("button, input");
  if (btn instanceof HTMLButtonElement) return !!btn.form && btn.type === "submit";
  if (btn instanceof HTMLInputElement) return !!btn.form && (["submit", "image"].includes(btn.type) || kindOf(btn) === "fill");
  return false;
}

export async function runStep(step: Step, s: Settings): Promise<StepResult> {
  const timeout = step.timeout ?? s.timeout;
  let nav = false;
  try {
    let used: string | undefined;
    const target = async (visible = true) => {
      const r = await find(step, timeout, visible);
      used = r.selector;
      if (s.highlight) overlay.flash(r.el, step.label ?? step.type, Math.max(400, s.stepDelay + 200), COLORS.run);
      return r.el;
    };

    switch (step.type) {
      case "click": {
        const el = await target();
        nav = mayNavigate(el);
        await realClick(el);
        break;
      }
      case "fill": {
        // Tolerante: un «fill» sobre un select o checkbox (p. ej. importado de DevTools) hace lo lógico.
        const el = await target(false);
        if (el instanceof HTMLSelectElement) selectOption(el, step.value ?? "");
        else if (kindOf(el) === "check") await setChecked(el, !["", "false", "off", "0"].includes(step.value ?? ""));
        else await typeInto(el, step.value ?? "", s);
        break;
      }
      case "select":
        selectOption(await target(false), step.value ?? "", step.optionText);
        break;
      case "check":
        await setChecked(await target(false), step.value !== "false");
        break;
      case "press": {
        const el = step.selector ? await target(false) : (document.activeElement ?? document.body);
        nav = (step.value || "Enter") === "Enter" && mayNavigate(el);
        await press(el, step.value || "Enter");
        break;
      }
      case "waitFor":
        await target();
        break;
      case "assertText": {
        const el = await target(false);
        const want = (step.value ?? "").trim();
        // Reintenta hasta el timeout: el texto puede tardar en aparecer (respuesta del servidor).
        const start = performance.now();
        let have = "";
        while (true) {
          have = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? valueOf(el) : textOf(el);
          if (have.includes(want)) break;
          if (performance.now() - start > timeout) throw new StepError(`Se esperaba «${want}» y hay «${have.slice(0, 80)}»`);
          await sleep(150);
        }
        break;
      }
      default:
        throw new StepError(`Tipo de paso «${step.type}» no se ejecuta en la página`);
    }
    return { ok: true, usedSelector: used, mayNavigate: nav };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function highlight(selectors: string[]): Promise<boolean> {
  const r = resolve(selectors);
  if (!r) return false;
  await scrollTo(r.el);
  overlay.flash(r.el, r.selector, 1500, COLORS.click);
  return true;
}
