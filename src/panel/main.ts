import * as store from "../shared/store";
import { current, importText, render, setRender, state } from "./state";
import { morph } from "./ui";
import { editorView } from "./views/editor";
import { libraryView } from "./views/library";
import { settingsView } from "./views/settings";

const app = document.getElementById("app")!;

let scheduled = false;
setRender(() => {
  // Agrupa renders del mismo tick (p. ej. varios cambios de storage seguidos).
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const flow = current();
    if (state.view === "editor" && !flow) state.view = "library";
    const view = state.view === "editor" ? editorView(flow!) : state.view === "settings" ? settingsView() : libraryView();
    morph(app, view);
  });
});

async function boot() {
  [state.flows, state.settings, state.recording] = await Promise.all([store.listFlows(), store.getSettings(), store.getRecording()]);
  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    let dirty = false;
    let appended = false;
    if (area === "local") {
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (store.isFlowKey(k)) {
          const id = k.slice(5);
          const i = state.flows.findIndex((f) => f.id === id);
          if (!newValue) {
            if (i >= 0) state.flows.splice(i, 1);
          } else if (i >= 0) {
            appended ||= newValue.steps.length > state.flows[i]!.steps.length;
            state.flows[i] = newValue;
          } else state.flows.unshift(newValue);
          dirty = true;
        } else if (k === "settings") {
          state.settings = { ...state.settings, ...newValue };
        }
      }
    }
    if (area === "session" && store.RECORDING_STORAGE_KEY in changes) {
      state.recording = changes[store.RECORDING_STORAGE_KEY]!.newValue;
      dirty = true;
    }
    if (!dirty) return;
    render();
    // Mientras se graba, seguir el último paso.
    if (appended && state.recording?.flowId === state.currentId) {
      setTimeout(() => {
        const el = document.querySelector("[data-scroll]");
        el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 30);
    }
  });
}

// Cerrar menús desplegables al clicar fuera.
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) {
    if (!d.contains(e.target as Node)) d.open = false;
  }
});

// Importar arrastrando un .json al panel.
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    e.preventDefault();
    document.body.classList.add("dropping");
  }
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.classList.remove("dropping");
});
document.addEventListener("drop", async (e) => {
  const file = e.dataTransfer?.files?.[0];
  document.body.classList.remove("dropping");
  if (!file) return;
  e.preventDefault();
  await importText(await file.text());
});

void boot();
