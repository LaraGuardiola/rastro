// Mini helpers de UI sin framework: h() para crear DOM, diálogos, toasts y descargas.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string | false | null; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "value" || k === "checked" || k === "selected" || k === "indeterminate") (el as any)[k] = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Re-renderiza conservando el foco y la selección del input activo (por data-k) y el scroll. */
export function morph(root: HTMLElement, next: Node) {
  const active = document.activeElement as HTMLInputElement | null;
  const key = active?.dataset?.k;
  const sel = key && "selectionStart" in active! ? [active!.selectionStart, active!.selectionEnd] : null;
  const scrollers = [...root.querySelectorAll<HTMLElement>("[data-scroll]")].map((e) => [e.dataset.scroll, e.scrollTop] as const);
  root.replaceChildren(next);
  for (const [k, top] of scrollers) {
    const e = root.querySelector<HTMLElement>(`[data-scroll="${k}"]`);
    if (e) e.scrollTop = top;
  }
  if (key) {
    const el = root.querySelector<HTMLInputElement>(`[data-k="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel) {
        try {
          el.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* tipos sin selección */
        }
      }
    }
  }
}

// ───────────────────────────── Diálogos ─────────────────────────────

interface AskOpts {
  title: string;
  message?: string;
  input?: string; // si se pasa, muestra un campo de texto con este valor inicial
  placeholder?: string;
  ok?: string;
  danger?: boolean;
  options?: string[]; // sugerencias para el input
  extra?: { label: string; value: string }; // botón alternativo
}

/** Diálogo modal. Devuelve el texto (o "ok"), el value del botón extra, o null si se cancela. */
export function ask(o: AskOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const listId = "dl-" + Math.random().toString(36).slice(2);
    const input =
      o.input != null ? h("input", { class: "input", value: o.input, placeholder: o.placeholder, list: o.options ? listId : null }) : null;
    const dlg = h(
      "dialog",
      { class: "dialog" },
      h(
        "form",
        { method: "dialog" },
        h("h3", null, o.title),
        o.message && h("p", { class: "muted" }, o.message),
        input,
        o.options && h("datalist", { id: listId }, o.options.map((x) => h("option", { value: x }))),
        h(
          "div",
          { class: "row end" },
          h("button", { class: "btn ghost", value: "__cancel", type: "submit" }, "Cancelar"),
          o.extra && h("button", { class: "btn", value: "__extra", type: "submit" }, o.extra.label),
          h("button", { class: "btn " + (o.danger ? "danger" : "primary"), value: "__ok", type: "submit" }, o.ok ?? "Aceptar"),
        ),
      ),
    );
    dlg.addEventListener("close", () => {
      const rv = dlg.returnValue;
      dlg.remove();
      if (rv === "__ok") resolve(input ? input.value : "ok");
      else if (rv === "__extra") resolve(o.extra!.value);
      else resolve(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (input) {
      // Enter = aceptar (si no, el envío implícito pulsaría el primer botón: «Cancelar»).
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          dlg.close("__ok");
        }
      });
      input.focus();
      input.select();
    }
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: "ok" | "error" | "info" = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast" });
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = "show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el!.className = ""), kind === "error" ? 5000 : 2500);
}

export function download(filename: string, content: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = ".json,application/json"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept });
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "ahora";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `hace ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(ts).toLocaleDateString();
}

export function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
