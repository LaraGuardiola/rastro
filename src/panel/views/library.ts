import type { Flow } from "../../shared/types";
import * as A from "../state";
import { state } from "../state";
import { h, hostOf, pickFile, timeAgo } from "../ui";

export function libraryView(): HTMLElement {
  const flows = A.filteredFlows();
  const folders = A.allFolders();
  const tags = A.allTags();
  const sel = [...state.selected].filter((id) => state.flows.some((f) => f.id === id));

  const groups = new Map<string, Flow[]>();
  for (const f of flows) {
    const k = f.folder ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  return h(
    "div",
    { class: "view" },
    h(
      "header",
      { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "logo" }), "Rastro"),
      h(
        "div",
        { class: "row" },
        h("button", { class: "icon", title: "Importar", onclick: importFile }, "⇪"),
        h("button", { class: "icon", title: "Exportar todo", onclick: () => A.exportFlows(state.flows) }, "⇩"),
        h("button", { class: "icon", title: "Ajustes", onclick: () => ((state.view = "settings"), A.render()) }, "⚙"),
      ),
    ),
    h(
      "div",
      { class: "toolbar" },
      h("input", {
        class: "input search",
        type: "search",
        placeholder: "Buscar por nombre, #etiqueta, URL, campo…",
        value: state.filter.q,
        "data-k": "search",
        oninput: (e: Event) => {
          state.filter.q = (e.target as HTMLInputElement).value;
          A.render();
        },
      }),
      h("button", { class: "btn primary", onclick: A.createFlow }, "+ Nuevo"),
    ),
    (folders.length > 0 || tags.length > 0) &&
      h(
        "div",
        { class: "filters" },
        h(
          "select",
          {
            class: "input sm",
            onchange: (e: Event) => {
              state.filter.folder = (e.target as HTMLSelectElement).value;
              A.render();
            },
          },
          h("option", { value: "", selected: state.filter.folder === "" }, "Todas las carpetas"),
          h("option", { value: "__none", selected: state.filter.folder === "__none" }, "Sin carpeta"),
          folders.map((f) => h("option", { value: f, selected: state.filter.folder === f }, "📁 " + f)),
        ),
        h(
          "select",
          {
            class: "input sm",
            onchange: (e: Event) => {
              state.filter.sort = (e.target as HTMLSelectElement).value as typeof state.filter.sort;
              A.render();
            },
          },
          h("option", { value: "updated", selected: state.filter.sort === "updated" }, "Recientes"),
          h("option", { value: "name", selected: state.filter.sort === "name" }, "Nombre"),
          h("option", { value: "lastRun", selected: state.filter.sort === "lastRun" }, "Última ejecución"),
        ),
        tags.length > 0 &&
          h(
            "div",
            { class: "chips" },
            tags.map((t) =>
              h(
                "button",
                {
                  class: "chip" + (state.filter.tags.has(t) ? " on" : ""),
                  onclick: () => {
                    state.filter.tags.has(t) ? state.filter.tags.delete(t) : state.filter.tags.add(t);
                    A.render();
                  },
                },
                "#" + t,
              ),
            ),
          ),
      ),
    sel.length > 0 &&
      h(
        "div",
        { class: "bulk" },
        h("span", null, `${sel.length} seleccionado(s)`),
        h("button", { class: "btn sm", onclick: () => A.exportFlows(state.flows.filter((f) => sel.includes(f.id))) }, "Exportar"),
        h("button", { class: "btn sm", onclick: () => A.bulkMove(sel) }, "Mover"),
        h("button", { class: "btn sm", onclick: () => A.bulkTag(sel) }, "Etiquetar"),
        h("button", { class: "btn sm danger", onclick: () => A.removeFlows(sel) }, "Borrar"),
        h("button", { class: "icon", title: "Quitar selección", onclick: () => (state.selected.clear(), A.render()) }, "✕"),
      ),
    h(
      "main",
      { class: "scroll", "data-scroll": "library" },
      state.flows.length === 0
        ? emptyState()
        : flows.length === 0
          ? h("p", { class: "empty muted" }, "Ningún flujo coincide con el filtro.")
          : groupKeys.map((k) => folderGroup(k, groups.get(k)!, groupKeys.length > 1 || k !== "")),
    ),
  );
}

function folderGroup(name: string, flows: Flow[], showHeader: boolean) {
  const key = name || "__none";
  const collapsed = state.collapsedFolders.has(key);
  return h(
    "section",
    { class: "group" },
    showHeader &&
      h(
        "button",
        {
          class: "group-h",
          onclick: () => {
            collapsed ? state.collapsedFolders.delete(key) : state.collapsedFolders.add(key);
            A.render();
          },
        },
        h("span", { class: "caret" + (collapsed ? "" : " open") }, "▸"),
        name ? "📁 " + name : "Sin carpeta",
        h("span", { class: "count" }, String(flows.length)),
      ),
    !collapsed && flows.map(flowCard),
  );
}

function flowCard(f: Flow) {
  const host = hostOf(f.steps.find((s) => s.type === "navigate")?.value);
  const running = A.runner.running && state.run?.flowId === f.id;
  return h(
    "article",
    { class: "card" + (state.selected.has(f.id) ? " selected" : "") },
    h("input", {
      type: "checkbox",
      class: "check",
      checked: state.selected.has(f.id),
      title: "Seleccionar",
      onchange: (e: Event) => {
        (e.target as HTMLInputElement).checked ? state.selected.add(f.id) : state.selected.delete(f.id);
        A.render();
      },
    }),
    h(
      "div",
      { class: "card-body", onclick: () => A.openFlow(f.id) },
      h("div", { class: "card-title" }, f.lastRun && h("span", { class: "dot " + (f.lastRun.ok ? "ok" : "err"), title: lastRunText(f) }), f.name),
      h(
        "div",
        { class: "meta" },
        `${f.steps.length} paso${f.steps.length === 1 ? "" : "s"}`,
        host && ` · ${host}`,
        ` · ${timeAgo(f.updatedAt)}`,
      ),
      f.tags.length > 0 && h("div", { class: "chips" }, f.tags.map((t) => h("span", { class: "chip static" }, "#" + t))),
    ),
    h(
      "div",
      { class: "card-actions" },
      h(
        "button",
        { class: "icon play", title: "Reproducir en la pestaña activa", disabled: A.runner.running, onclick: () => A.play(f) },
        running ? "…" : "▶",
      ),
      h(
        "details",
        { class: "menu" },
        h("summary", { class: "icon", title: "Más" }, "⋯"),
        h(
          "div",
          { class: "menu-list" },
          h("button", { onclick: () => A.duplicateFlow(f) }, "⧉ Duplicar"),
          h("button", { onclick: () => A.exportFlows([f]) }, "⇩ Exportar JSON"),
          h("button", { onclick: () => A.exportPuppeteer(f) }, "⇩ Exportar a Puppeteer"),
          h("button", { class: "danger", onclick: () => A.removeFlows([f.id]) }, "🗑 Borrar"),
        ),
      ),
    ),
  );
}

function lastRunText(f: Flow) {
  const r = f.lastRun!;
  return r.ok ? `OK ${timeAgo(r.at)} (${(r.ms / 1000).toFixed(1)}s)` : `Falló ${timeAgo(r.at)}: ${r.error}`;
}

function emptyState() {
  return h(
    "div",
    { class: "empty" },
    h("div", { class: "empty-art" }, "◉ → ⌨ → ⏎"),
    h("h2", null, "Graba tu primer flujo"),
    h(
      "ol",
      { class: "muted" },
      h("li", null, "Crea un flujo y abre la web que quieras automatizar."),
      h("li", null, "Pulsa ", h("b", null, "Grabar"), " y usa la página con normalidad: los botones se graban como click y los inputs como «escribir» con su contenido."),
      h("li", null, "Edita, reordena y dale a ", h("b", null, "Reproducir"), "."),
    ),
    h("div", { class: "row center" }, h("button", { class: "btn primary", onclick: A.createFlow }, "+ Nuevo flujo"), h("button", { class: "btn", onclick: importFile }, "Importar")),
  );
}

async function importFile() {
  const file = await pickFile();
  if (file) await A.importText(await file.text());
}
