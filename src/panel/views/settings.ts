import { saveSettings } from "../../shared/store";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/types";
import * as A from "../state";
import { state } from "../state";
import { h, toast } from "../ui";

export function settingsView(): HTMLElement {
  const s = state.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    s[k] = v;
    void saveSettings(s);
  };
  const num = (k: "timeout" | "stepDelay" | "keyDelay", label: string, hint: string) =>
    h(
      "label",
      { class: "field" },
      h("span", null, label),
      h("input", {
        class: "input sm",
        type: "number",
        min: 0,
        step: k === "keyDelay" ? 5 : 100,
        value: s[k],
        "data-k": "set-" + k,
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).valueAsNumber;
          if (Number.isFinite(v) && v >= 0) set(k, v);
        },
      }),
      h("small", { class: "muted" }, hint),
    );

  return h(
    "div",
    { class: "view" },
    h(
      "header",
      { class: "top" },
      h("button", { class: "btn ghost sm", onclick: () => ((state.view = "library"), A.render()) }, "← Flujos"),
      h("b", null, "Ajustes"),
    ),
    h(
      "main",
      { class: "scroll settings", "data-scroll": "settings" },
      h("h3", null, "Reproducción"),
      num("timeout", "Timeout por paso (ms)", "Cuánto esperar a que aparezca un elemento antes de fallar."),
      num("stepDelay", "Pausa entre pasos (ms)", "Útil para ver lo que pasa o para webs lentas."),
      h(
        "label",
        { class: "field" },
        h("span", null, "Forma de escribir"),
        h(
          "select",
          {
            class: "input sm",
            onchange: (e: Event) => {
              set("typeMode", (e.target as HTMLSelectElement).value as Settings["typeMode"]);
              A.render();
            },
          },
          h("option", { value: "instant", selected: s.typeMode === "instant" }, "De golpe (rápido)"),
          h("option", { value: "keys", selected: s.typeMode === "keys" }, "Tecla a tecla (realista)"),
        ),
        h("small", { class: "muted" }, "Tecla a tecla dispara keydown/keyup: útil para autocompletados y máscaras."),
      ),
      s.typeMode === "keys" && num("keyDelay", "Pausa entre teclas (ms)", ""),
      h(
        "label",
        { class: "toggle" },
        h("input", { type: "checkbox", checked: s.highlight, onchange: (e: Event) => set("highlight", (e.target as HTMLInputElement).checked) }),
        "Resaltar cada elemento antes de actuar",
      ),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn sm ghost",
            onclick: () => {
              state.settings = { ...DEFAULT_SETTINGS };
              void saveSettings(state.settings);
              A.render();
              toast("Ajustes restablecidos", "ok");
            },
          },
          "Restablecer",
        ),
      ),
      h("h3", null, "Selectores"),
      h(
        "p",
        { class: "muted small" },
        "Rastro genera varios selectores por elemento y prueba los alternativos si falla el principal. Orden de preferencia: ",
        h("code", null, "data-testid"),
        ", ",
        h("code", null, "#id"),
        " estable, ",
        h("code", null, "name"),
        ", ",
        h("code", null, "label=…"),
        ", ",
        h("code", null, "aria-label"),
        ", ",
        h("code", null, "placeholder"),
        ", ",
        h("code", null, "text=…"),
        " y por último ruta CSS. Ids y clases con pinta de autogeneradas se ignoran. Añadir ",
        h("code", null, "data-testid"),
        " a la app es lo que da los flujos más robustos.",
      ),
      h("h3", null, "Datos"),
      h("p", { class: "muted small" }, `${state.flows.length} flujo(s), ${state.flows.reduce((n, f) => n + f.steps.length, 0)} paso(s). Se guardan en el almacenamiento local de la extensión, en este navegador.`),
    ),
  );
}
