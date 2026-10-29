// Capa visual dentro de la página, aislada en un shadow root para no heredar ni romper estilos.

const CSS = `
:host { all: initial; }
.box {
  position: fixed; pointer-events: none; z-index: 2147483646; display: none;
  border: 2px solid var(--c, #7c5cff); background: color-mix(in srgb, var(--c, #7c5cff) 12%, transparent);
  border-radius: 4px; transition: all 60ms ease-out; box-sizing: border-box;
}
.tag {
  position: fixed; pointer-events: none; z-index: 2147483647; display: none;
  font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif; color: #fff; background: var(--c, #7c5cff);
  padding: 4px 7px; border-radius: 5px; white-space: nowrap; max-width: 360px; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgb(0 0 0 / .25);
}
.pill {
  position: fixed; z-index: 2147483647; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: none; align-items: center; gap: 10px; padding: 7px 8px 7px 14px; border-radius: 999px;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; color: #f4f2ff; background: #1b1830ee;
  box-shadow: 0 6px 24px rgb(0 0 0 / .35); backdrop-filter: blur(6px); user-select: none;
}
.dot { width: 9px; height: 9px; border-radius: 50%; background: #ff4d6d; animation: pulse 1.2s infinite; }
.pill.point .dot { background: #7c5cff; }
@keyframes pulse { 50% { opacity: .35; } }
.pill button {
  all: unset; cursor: pointer; padding: 5px 10px; border-radius: 999px; background: #ffffff1f; color: #fff;
  font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
}
.pill button:hover { background: #ffffff38; }
.toasts { position: fixed; z-index: 2147483647; right: 16px; bottom: 64px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; pointer-events: none; }
.toast {
  font: 500 12px/1.3 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #1b1830ee; padding: 7px 11px;
  border-radius: 8px; border-left: 3px solid var(--c, #7c5cff); box-shadow: 0 4px 14px rgb(0 0 0 / .3);
  animation: in .18s ease-out; max-width: 340px;
}
.toast.warn { --c: #ffb020; }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
`;

export const COLORS = { click: "#7c5cff", fill: "#14b8a6", select: "#0ea5e9", check: "#22c55e", file: "#ffb020", run: "#f97316" } as const;

class Overlay {
  host!: HTMLElement;
  private box!: HTMLDivElement;
  private tag!: HTMLDivElement;
  private pill!: HTMLDivElement;
  private pillText!: HTMLSpanElement;
  private toasts!: HTMLDivElement;
  onStop: () => void = () => {};

  private ensure() {
    if (this.host?.isConnected) return;
    this.host = document.createElement("div");
    this.host.id = "__rastro_host";
    const root = this.host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><div class="box"></div><div class="tag"></div>
      <div class="pill"><span class="dot"></span><span class="txt"></span><button type="button">Terminar</button></div>
      <div class="toasts"></div>`;
    this.box = root.querySelector(".box")!;
    this.tag = root.querySelector(".tag")!;
    this.pill = root.querySelector(".pill")!;
    this.pillText = root.querySelector(".txt")!;
    this.toasts = root.querySelector(".toasts")!;
    root.querySelector("button")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onStop();
    });
    document.documentElement.appendChild(this.host);
  }

  owns(el: EventTarget | null): boolean {
    return !!this.host && el instanceof Node && (el === this.host || this.host.contains(el));
  }

  show(el: Element, text: string, color: string = COLORS.click) {
    this.ensure();
    const r = el.getBoundingClientRect();
    Object.assign(this.box.style, {
      display: "block", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`,
    });
    this.box.style.setProperty("--c", color);
    this.tag.style.setProperty("--c", color);
    this.tag.textContent = text;
    this.tag.style.display = "block";
    const above = r.top > 30;
    this.tag.style.left = `${Math.max(4, Math.min(r.left - 3, innerWidth - 370))}px`;
    this.tag.style.top = above ? `${r.top - 27}px` : `${r.bottom + 6}px`;
  }

  hide() {
    if (!this.box) return;
    this.box.style.display = "none";
    this.tag.style.display = "none";
  }

  /** Resalta brevemente (reproducción / "ver elemento"). */
  flash(el: Element, text: string, ms = 700, color: string = COLORS.run) {
    this.show(el, text, color);
    setTimeout(() => this.hide(), ms);
  }

  setPill(mode: "record" | "point" | null) {
    this.ensure();
    if (!mode) {
      this.pill.style.display = "none";
      return;
    }
    this.pill.className = "pill " + mode;
    this.pillText.textContent = mode === "record" ? "Rastro grabando" : "Rastro · modo señalar (Esc para salir)";
    this.pill.style.display = "flex";
  }

  toast(text: string, color?: string, warn = false) {
    this.ensure();
    const t = document.createElement("div");
    t.className = "toast" + (warn ? " warn" : "");
    if (color) t.style.setProperty("--c", color);
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2200);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild!.remove();
  }
}

export const overlay = new Overlay();
