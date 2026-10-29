import { STEP_META, type Flow, type Step, type StepType } from "../../shared/types";
import { BUILTIN_VARS } from "../../shared/util";
import * as A from "../state";
import { state } from "../state";
import { h, timeAgo } from "../ui";

const TYPES = Object.keys(STEP_META) as StepType[];

export function editorView(flow: Flow): HTMLElement {
  const rec = state.recording?.flowId === flow.id ? state.recording : undefined;
  const otherRec = state.recording && !rec;
  const running = A.runner.running;
  const run = state.run?.flowId === flow.id ? state.run : undefined;

  const set = <K extends keyof Flow>(k: K, v: Flow[K]) => {
    flow[k] = v;
    A.saveSoon(flow);
  };

  return h(
    "div",
    { class: "view" },
    h(
      "header",
      { class: "top" },
      h("button", { class: "btn ghost sm", onclick: () => ((state.view = "library"), A.render()) }, "← Flujos"),
      h(
        "div",
        { class: "row" },
        h("button", { class: "icon", title: "Exportar JSON", onclick: () => A.exportFlows([flow]) }, "⇩"),
        h("button", { class: "icon", title: "Exportar a Puppeteer", onclick: () => A.exportPuppeteer(flow) }, "JS"),
        h("button", { class: "icon", title: "Exportar a DevTools Recorder", onclick: () => A.exportDevTools(flow) }, "DT"),
        h("button", { class: "icon", title: "Duplicar", onclick: () => A.duplicateFlow(flow) }, "⧉"),
        h("button", { class: "icon danger", title: "Borrar flujo", onclick: () => A.removeFlows([flow.id]) }, "🗑"),
      ),
    ),
    h(
      "main",
      { class: "scroll", "data-scroll": "editor" },
      h("input", {
        class: "title-input",
        value: flow.name,
        "data-k": "flow-name",
        placeholder: "Nombre del flujo",
        oninput: (e: Event) => set("name", (e.target as HTMLInputElement).value),
      }),
      h(
        "div",
        { class: "meta-grid" },
        h(
          "label",
          null,
          h("span", null, "Carpeta"),
          h("input", {
            class: "input sm",
            list: "folders",
            value: flow.folder ?? "",
            placeholder: "—",
            "data-k": "flow-folder",
            oninput: (e: Event) => set("folder", (e.target as HTMLInputElement).value.trim() || undefined),
          }),
          h("datalist", { id: "folders" }, A.allFolders().map((f) => h("option", { value: f }))),
        ),
        h("label", null, h("span", null, "Etiquetas"), tagEditor(flow)),
      ),
      h("textarea", {
        class: "input desc",
        rows: 1,
        placeholder: "Descripción / notas (opcional)",
        "data-k": "flow-desc",
        value: flow.description ?? "",
        oninput: (e: Event) => set("description", (e.target as HTMLTextAreaElement).value || undefined),
      }),

      // ── Barra de acciones ──
      h(
        "div",
        { class: "actions" },
        rec
          ? [
              h("button", { class: "btn rec on", onclick: () => A.stopRecording() }, "■ Terminar"),
              h("button", { class: "btn", onclick: () => A.pauseRecording(!rec.paused) }, rec.paused ? "▶ Reanudar" : "❚❚ Pausar"),
            ]
          : [
              h(
                "button",
                { class: "btn rec", disabled: running || otherRec, title: "Usa la página normalmente; todo lo que hagas se graba", onclick: () => A.startRecording(flow, "record") },
                "● Grabar",
              ),
              h(
                "button",
                {
                  class: "btn",
                  disabled: running || otherRec,
                  title: "Clica elementos para añadirlos sin que los botones hagan nada",
                  onclick: () => A.startRecording(flow, "point"),
                },
                "◎ Señalar",
              ),
            ],
        running
          ? h("button", { class: "btn danger", onclick: A.stopPlay }, "■ Parar")
          : h("button", { class: "btn primary", disabled: !flow.steps.length || !!rec, onclick: () => A.play(flow) }, "▶ Reproducir"),
      ),
      rec &&
        h(
          "div",
          { class: "banner " + (rec.paused ? "paused" : rec.mode) },
          rec.paused
            ? "Grabación en pausa."
            : rec.mode === "record"
              ? "Grabando en la pestaña activa. Botones → click, inputs → escribir su contenido."
              : "Modo señalar: clica elementos de la página. Los botones no se ejecutan. Esc para salir.",
        ),
      otherRec && h("div", { class: "banner paused" }, "Se está grabando otro flujo."),
      state.picking && h("div", { class: "banner point" }, "Clica un elemento en la página… ", h("button", { class: "btn sm", onclick: A.cancelPick }, "Cancelar")),
      !running && flow.lastRun && runSummary(flow),

      variablesEditor(flow),

      // ── Pasos ──
      h(
        "ol",
        {
          class: "steps",
          ondragover: (e: DragEvent) => e.preventDefault(),
          ondrop: (e: DragEvent) => {
            e.preventDefault();
            if (state.dragId) A.moveStep(flow, state.dragId, null);
          },
        },
        flow.steps.map((s, i) => stepRow(flow, s, i, run)),
      ),
      flow.steps.length === 0 && !rec && h("p", { class: "empty muted" }, "Sin pasos todavía. Pulsa ", h("b", null, "Grabar"), " o añade pasos a mano."),
      addStepMenu(flow),
    ),
  );
}

function runSummary(flow: Flow) {
  const r = flow.lastRun!;
  const idx = r.failedStepId ? flow.steps.findIndex((s) => s.id === r.failedStepId) + 1 : 0;
  return h(
    "div",
    { class: "summary " + (r.ok ? "ok" : "err") },
    r.ok ? `✓ OK en ${(r.ms / 1000).toFixed(1)}s` : `✗ Falló${idx ? ` en el paso ${idx}` : ""}: ${r.error}`,
    h("span", { class: "muted" }, " · " + timeAgo(r.at)),
  );
}

function tagEditor(flow: Flow) {
  return h(
    "div",
    { class: "tag-editor" },
    flow.tags.map((t) =>
      h(
        "span",
        { class: "chip" },
        "#" + t,
        h(
          "button",
          {
            class: "x",
            title: "Quitar",
            onclick: () => {
              flow.tags = flow.tags.filter((x) => x !== t);
              void A.saveNow(flow);
            },
          },
          "×",
        ),
      ),
    ),
    h("input", {
      class: "tag-input",
      placeholder: flow.tags.length ? "+" : "añadir…",
      list: "all-tags",
      "data-k": "tag-input",
      onkeydown: (e: KeyboardEvent) => {
        const input = e.target as HTMLInputElement;
        if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
          e.preventDefault();
          const t = input.value.trim().replace(/^#/, "").replace(/,$/, "");
          if (t && !flow.tags.includes(t)) flow.tags.push(t);
          input.value = "";
          void A.saveNow(flow);
        } else if (e.key === "Backspace" && !input.value && flow.tags.length) {
          flow.tags.pop();
          void A.saveNow(flow);
        }
      },
    }),
    h("datalist", { id: "all-tags" }, A.allTags().map((t) => h("option", { value: t }))),
  );
}

let varsOpen: boolean | undefined;

function variablesEditor(flow: Flow) {
  const entries = Object.entries(flow.variables ?? {});
  const write = (pairs: [string, string][]) => {
    flow.variables = Object.fromEntries(pairs.filter(([k]) => k.trim()));
  };
  return h(
    "details",
    {
      class: "vars",
      open: varsOpen ?? entries.length > 0,
      ontoggle: (e: Event) => (varsOpen = (e.target as HTMLDetailsElement).open),
    },
    h("summary", null, "Variables", entries.length > 0 && h("span", { class: "count" }, String(entries.length))),
    h(
      "p",
      { class: "muted small" },
      "Usa ",
      h("code", null, "{{nombre}}"),
      " en cualquier valor. Integradas: ",
      BUILTIN_VARS.map((b, i) => [i ? ", " : "", h("code", null, `{{${b}}}`)]),
    ),
    entries.map(([k, v], i) =>
      h(
        "div",
        { class: "var-row" },
        h("input", {
          class: "input sm mono",
          value: k,
          placeholder: "nombre",
          "data-k": `var-k-${i}`,
          onchange: (e: Event) => {
            const pairs = Object.entries(flow.variables);
            pairs[i] = [(e.target as HTMLInputElement).value.trim(), v];
            write(pairs);
            void A.saveNow(flow);
          },
        }),
        h("input", {
          class: "input sm",
          value: v,
          placeholder: "valor",
          "data-k": `var-v-${i}`,
          oninput: (e: Event) => {
            flow.variables[k] = (e.target as HTMLInputElement).value;
            A.saveSoon(flow);
          },
        }),
        h(
          "button",
          {
            class: "icon",
            title: "Quitar",
            onclick: () => {
              delete flow.variables[k];
              void A.saveNow(flow);
            },
          },
          "×",
        ),
      ),
    ),
    h(
      "button",
      {
        class: "btn sm ghost",
        onclick: () => {
          let n = 1;
          while (`var${n}` in flow.variables) n++;
          flow.variables[`var${n}`] = "";
          void A.saveNow(flow);
        },
      },
      "+ Variable",
    ),
  );
}

function summaryValue(s: Step): string {
  if (s.value == null || s.value === "") return "";
  if (s.secret) return "••••••";
  if (s.type === "check") return s.value === "false" ? "desmarcar" : "marcar";
  if (s.type === "select") return s.optionText || s.value;
  if (s.type === "wait") return `${s.value} ms`;
  return s.value;
}

function stepRow(flow: Flow, s: Step, i: number, run: typeof state.run) {
  const meta = STEP_META[s.type];
  const open = state.expanded.has(s.id);
  const status = run?.status[s.id];
  const info = run?.info[s.id];
  const title =
    s.type === "navigate" ? s.label || s.value || "URL" : s.type === "press" ? s.value || "Enter" : s.type === "wait" ? "" : s.label || s.selector || "sin elemento";
  const val = s.type === "navigate" || s.type === "press" ? "" : summaryValue(s);

  const toggle = () => {
    open ? state.expanded.delete(s.id) : state.expanded.add(s.id);
    A.render();
  };

  const li = h(
    "li",
    {
      class: `step t-${s.type}${open ? " open" : ""}${s.enabled ? "" : " disabled"}${status ? " st-" + status : ""}${state.dragId === s.id ? " dragging" : ""}`,
      "data-step": s.id,
      ondragstart: (e: DragEvent) => {
        state.dragId = s.id;
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", s.id);
      },
      ondragend: () => {
        state.dragId = undefined;
        li.draggable = false;
        A.render();
      },
      ondragover: (e: DragEvent) => {
        if (!state.dragId || state.dragId === s.id) return;
        e.preventDefault();
        const r = li.getBoundingClientRect();
        li.classList.toggle("drop-before", e.clientY < r.top + r.height / 2);
        li.classList.toggle("drop-after", e.clientY >= r.top + r.height / 2);
      },
      ondragleave: () => li.classList.remove("drop-before", "drop-after"),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.dragId || state.dragId === s.id) return;
        const after = li.classList.contains("drop-after");
        const next = after ? flow.steps[i + 1]?.id ?? null : s.id;
        A.moveStep(flow, state.dragId, next === state.dragId ? s.id : next);
      },
    },
    h(
      "div",
      { class: "step-h" },
      h(
        "span",
        {
          class: "grip",
          title: "Arrastrar para reordenar",
          onmousedown: () => (li.draggable = true),
          onmouseup: () => (li.draggable = false),
        },
        "⋮⋮",
      ),
      h("span", { class: "num" }, String(i + 1)),
      h("span", { class: "badge", title: meta.label }, meta.icon),
      h(
        "button",
        { class: "step-title", onclick: toggle },
        h("b", null, meta.label),
        title && h("span", { class: "lbl" }, title),
        !!s.frame?.length && h("span", { class: "frame-tag", title: "Dentro de iframe: " + s.frame.map((f) => f.selector).join(" » ") }, s.frame.length > 1 ? `iframe ×${s.frame.length}` : "iframe"),
        val && h("span", { class: "val" }, val),
      ),
      h("span", { class: "status", title: info ?? status ?? "" }, statusIcon(status)),
    ),
    status === "error" && info && h("div", { class: "step-err" }, info),
    open && stepDetails(flow, s, i),
  );
  return li;
}

function statusIcon(st?: string) {
  switch (st) {
    case "running":
      return h("span", { class: "spin" });
    case "ok":
      return "✓";
    case "error":
      return "✗";
    case "skipped":
      return "–";
    default:
      return "";
  }
}

function stepDetails(flow: Flow, s: Step, i: number) {
  const meta = STEP_META[s.type];
  const save = () => A.saveSoon(flow);
  const field = (label: string, ...control: (Node | false | undefined | null)[]) => h("label", { class: "field" }, h("span", null, label), ...control);
  const targetable = meta.needsTarget || s.type === "press";

  return h(
    "div",
    { class: "step-body" },
    field(
      "Tipo",
      h(
        "select",
        {
          class: "input sm",
          onchange: (e: Event) => {
            s.type = (e.target as HTMLSelectElement).value as StepType;
            void A.saveNow(flow);
          },
        },
        TYPES.map((t) => h("option", { value: t, selected: t === s.type }, `${STEP_META[t].icon}  ${STEP_META[t].label}`)),
      ),
    ),
    targetable &&
      field(
        s.type === "press" ? "Elemento (opcional)" : "Elemento",
        h(
          "div",
          { class: "row tight" },
          h("input", {
            class: "input sm mono grow",
            value: s.selector ?? "",
            placeholder: "css, text=…, label=…, xpath=…",
            "data-k": `sel-${s.id}`,
            oninput: (e: Event) => {
              s.selector = (e.target as HTMLInputElement).value || undefined;
              save();
            },
          }),
          h("button", { class: "icon", title: "Apuntar en la página", disabled: !!state.picking, onclick: () => A.pickFor(flow, s) }, "🎯"),
          h("button", { class: "icon", title: "Resaltar en la página", disabled: !s.selector, onclick: () => A.highlightStep(s) }, "👁"),
        ),
      ),
    targetable && frameField(flow, s, field),
    targetable &&
      !!s.fallbacks?.length &&
      h(
        "details",
        { class: "fallbacks" },
        h("summary", null, `${s.fallbacks.length} selector(es) alternativo(s)`),
        h("textarea", {
          class: "input sm mono",
          rows: Math.min(5, s.fallbacks.length),
          "data-k": `fb-${s.id}`,
          value: s.fallbacks.join("\n"),
          oninput: (e: Event) => {
            s.fallbacks = (e.target as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean);
            save();
          },
        }),
      ),
    targetable &&
      field(
        "Nombre",
        h("input", {
          class: "input sm",
          value: s.label ?? "",
          placeholder: "Descripción legible",
          "data-k": `lbl-${s.id}`,
          oninput: (e: Event) => {
            s.label = (e.target as HTMLInputElement).value || undefined;
            save();
          },
        }),
      ),
    s.type !== "click" && s.type !== "waitFor" && valueField(flow, s, field),
    h(
      "div",
      { class: "row two" },
      s.type !== "navigate" &&
        s.type !== "wait" &&
        field(
          "Timeout (ms)",
          h("input", {
            class: "input sm",
            type: "number",
            min: 0,
            step: 500,
            placeholder: String(state.settings.timeout),
            value: s.timeout ?? "",
            "data-k": `to-${s.id}`,
            oninput: (e: Event) => {
              const v = (e.target as HTMLInputElement).valueAsNumber;
              s.timeout = Number.isFinite(v) ? v : undefined;
              save();
            },
          }),
        ),
      field(
        "Nota",
        h("input", {
          class: "input sm",
          value: s.note ?? "",
          "data-k": `note-${s.id}`,
          oninput: (e: Event) => {
            s.note = (e.target as HTMLInputElement).value || undefined;
            save();
          },
        }),
      ),
    ),
    h(
      "div",
      { class: "row step-foot" },
      h(
        "label",
        { class: "toggle" },
        h("input", {
          type: "checkbox",
          checked: s.enabled,
          onchange: (e: Event) => {
            s.enabled = (e.target as HTMLInputElement).checked;
            void A.saveNow(flow);
          },
        }),
        "Activo",
      ),
      h("span", { class: "grow" }),
      h("button", { class: "btn sm ghost", title: "Ejecutar solo este paso", disabled: A.runner.running, onclick: () => A.play(flow, i, i) }, "▶ Solo este"),
      h("button", { class: "btn sm ghost", title: "Reproducir desde este paso", disabled: A.runner.running, onclick: () => A.play(flow, i) }, "▶ Desde aquí"),
      h("button", { class: "icon", title: "Duplicar paso", onclick: () => A.duplicateStep(flow, s) }, "⧉"),
      h("button", { class: "icon danger", title: "Borrar paso", onclick: () => A.deleteStep(flow, s) }, "🗑"),
    ),
  );
}

const FRAME_SEP = " >> ";

function frameField(flow: Flow, s: Step, field: (l: string, ...c: (Node | false | undefined | null)[]) => HTMLElement) {
  return field(
    "Iframe",
    h("input", {
      class: "input sm mono",
      value: (s.frame ?? []).map((f) => f.selector).join(FRAME_SEP),
      placeholder: "— página principal —   (iframe#pago >> iframe[name=cvc])",
      "data-k": `frame-${s.id}`,
      oninput: (e: Event) => {
        const parts = (e.target as HTMLInputElement).value.split(">>").map((x) => x.trim()).filter(Boolean);
        // Conserva los alternativos de los niveles que no cambian.
        s.frame = parts.length ? parts.map((sel, i) => (s.frame?.[i]?.selector === sel ? s.frame[i]! : { selector: sel })) : undefined;
        A.saveSoon(flow);
      },
    }),
    !!s.frame?.length && h("small", { class: "muted" }, "Ruta de iframes desde la página principal, separada por >>"),
  );
}

function valueField(flow: Flow, s: Step, field: (l: string, ...c: (Node | false | undefined | null)[]) => HTMLElement) {
  const meta = STEP_META[s.type];
  const onVal = (e: Event) => {
    s.value = (e.target as HTMLInputElement).value;
    A.saveSoon(flow);
  };
  if (s.type === "check") {
    return field(
      "Estado",
      h(
        "select",
        {
          class: "input sm",
          onchange: (e: Event) => {
            s.value = (e.target as HTMLSelectElement).value;
            void A.saveNow(flow);
          },
        },
        h("option", { value: "true", selected: s.value !== "false" }, "☑ Marcado"),
        h("option", { value: "false", selected: s.value === "false" }, "☐ Desmarcado"),
      ),
    );
  }
  const labels: Partial<Record<StepType, string>> = { navigate: "URL", fill: "Texto", select: "Opción (value)", press: "Tecla", wait: "Milisegundos", assertText: "Texto esperado" };
  const input = h("input", {
    class: "input sm" + (s.type === "navigate" ? " mono" : ""),
    type: s.secret ? "password" : s.type === "wait" ? "number" : "text",
    value: s.value ?? "",
    placeholder: meta.valueHint ?? "",
    list: s.type === "press" ? "keys" : null,
    "data-k": `val-${s.id}`,
    oninput: onVal,
  });
  return field(
    labels[s.type] ?? "Valor",
    h(
      "div",
      { class: "row tight" },
      s.type === "fill" ? h("textarea", { class: "input sm grow", rows: 1, value: s.value ?? "", "data-k": `val-${s.id}`, placeholder: meta.valueHint, oninput: onVal, style: s.secret ? "-webkit-text-security: disc" : undefined }) : input,
      s.type === "fill" &&
        h(
          "button",
          {
            class: "icon",
            title: s.secret ? "Mostrar (deja de ser secreto)" : "Marcar como secreto",
            onclick: () => {
              s.secret = !s.secret || undefined;
              void A.saveNow(flow);
            },
          },
          s.secret ? "🔒" : "🔓",
        ),
    ),
    s.type === "select" && !!s.optionText && h("small", { class: "muted" }, `Texto visible: «${s.optionText}»`),
    s.type === "press" && h("datalist", { id: "keys" }, ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Backspace", " "].map((k) => h("option", { value: k }))),
  );
}

function addStepMenu(flow: Flow) {
  return h(
    "details",
    { class: "menu add-step" },
    h("summary", { class: "btn ghost sm" }, "+ Añadir paso"),
    h(
      "div",
      { class: "menu-list" },
      TYPES.map((t) =>
        h(
          "button",
          {
            onclick: (e: Event) => {
              (e.target as HTMLElement).closest("details")!.open = false;
              const step = A.addStep(flow, t);
              setTimeout(() => document.querySelector(`[data-step="${step.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
            },
          },
          `${STEP_META[t].icon}  ${STEP_META[t].label}`,
        ),
      ),
    ),
  );
}
