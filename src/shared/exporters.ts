import { newFlow } from "./store";
import type { ExportFile, Flow, Step, StepType } from "./types";
import { uid } from "./util";

export function toExportFile(flows: Flow[]): ExportFile {
  return { format: "rastro", version: 1, exportedAt: new Date().toISOString(), flows: flows.map((f) => ({ ...f, lastRun: undefined })) };
}

const STEP_TYPES: StepType[] = ["navigate", "click", "fill", "select", "check", "press", "wait", "waitFor", "assertText"];

/** Acepta un ExportFile, un Flow suelto o un array de Flow. Valida y normaliza. */
export function parseImport(text: string): Flow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El fichero no es JSON válido");
  }
  const raw: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "flows" in data && Array.isArray((data as ExportFile).flows)
      ? (data as ExportFile).flows
      : data && typeof data === "object" && "steps" in data
        ? [data]
        : [];
  if (!raw.length) throw new Error("No se encontraron flujos en el fichero");

  return raw.map((r, i) => {
    const f = r as Partial<Flow>;
    if (!Array.isArray(f.steps)) throw new Error(`El flujo #${i + 1} no tiene pasos`);
    const steps: Step[] = f.steps.map((s, j) => {
      if (!s || !STEP_TYPES.includes(s.type)) throw new Error(`Paso ${j + 1} de «${f.name ?? i + 1}»: tipo desconocido`);
      return { ...s, id: typeof s.id === "string" ? s.id : uid(), enabled: s.enabled !== false };
    });
    return newFlow({
      id: typeof f.id === "string" ? f.id : uid(),
      name: String(f.name ?? `Importado ${i + 1}`),
      description: f.description,
      folder: f.folder,
      tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      variables: f.variables && typeof f.variables === "object" ? f.variables : {},
      steps,
      createdAt: typeof f.createdAt === "number" ? f.createdAt : Date.now(),
    });
  });
}

// ───────────────────────────── Puppeteer ─────────────────────────────

/** Traduce un selector de Rastro a la sintaxis de Puppeteer. */
function ppSelector(sel: string): string {
  if (sel.startsWith("text=")) return `::-p-text(${JSON.stringify(sel.slice(5))})`;
  if (sel.startsWith("label=")) return `::-p-aria(${JSON.stringify(sel.slice(6))})`;
  if (sel.startsWith("xpath=")) return `::-p-xpath(${sel.slice(6)})`;
  return sel;
}

const js = (s: string) => JSON.stringify(s);

/** Valor con {{variables}} → expresión JS. */
function jsValue(v: string): string {
  if (!/\{\{/.test(v)) return js(v);
  return "v(" + js(v) + ")";
}

function locator(step: Step): string {
  const sels = [step.selector!, ...(step.fallbacks ?? [])].map(ppSelector);
  if (sels.length === 1) return `page.locator(${js(sels[0]!)})`;
  return `Locator.race([${sels.map((x) => `page.locator(${js(x)})`).join(", ")}])`;
}

export function toPuppeteer(flow: Flow): string {
  const out: string[] = [];
  out.push(`// ${flow.name} — exportado desde Rastro el ${new Date().toLocaleString()}`);
  out.push(`// Requiere: npm i puppeteer   ·   Ejecutar: node ${slug(flow.name)}.mjs  (o bun)`);
  out.push(`import puppeteer, { Locator } from "puppeteer";`);
  out.push("");
  out.push(`const T = 8000;`);
  out.push(`const vars = ${JSON.stringify(flow.variables ?? {}, null, 2)};`);
  out.push(`const builtins = {`);
  out.push(`  $timestamp: String(Date.now()),`);
  out.push(`  $uuid: crypto.randomUUID(),`);
  out.push(`  $randomInt: String(Math.floor(Math.random() * 1e6)),`);
  out.push(`  $randomEmail: \`test+\${Date.now().toString(36)}@example.com\`,`);
  out.push(`  $today: new Date().toISOString().slice(0, 10),`);
  out.push(`};`);
  out.push(`const v = (s) => s.replace(/\\{\\{\\s*([$\\w.-]+)\\s*\\}\\}/g, (m, k) => vars[k] != null ? v(vars[k]) : builtins[k] ?? m);`);
  out.push("");
  out.push(`const browser = await puppeteer.launch({ headless: process.env.HEADLESS !== "0" ? "new" : false });`);
  out.push(`const page = await browser.newPage();`);
  out.push(`page.setDefaultTimeout(T);`);
  out.push(`try {`);

  flow.steps.forEach((s, i) => {
    const comment = `  // ${i + 1}. ${s.type}${s.label ? ` · ${s.label}` : ""}`;
    if (!s.enabled) {
      out.push(comment + " (desactivado)");
      return;
    }
    out.push(comment);
    const val = s.value ?? "";
    switch (s.type) {
      case "navigate":
        out.push(`  await page.goto(${jsValue(val)}, { waitUntil: "networkidle2" });`);
        break;
      case "click":
        out.push(`  await Promise.all([`);
        out.push(`    page.waitForNavigation({ timeout: 1500 }).catch(() => {}),`);
        out.push(`    ${locator(s)}.click(),`);
        out.push(`  ]);`);
        break;
      case "fill":
        out.push(`  await ${locator(s)}.fill(${jsValue(val)});`);
        break;
      case "select":
        out.push(`  await page.select(${js(ppSelector(s.selector!))}, ${jsValue(val)});`);
        break;
      case "check":
        out.push(`  {`);
        out.push(`    const el = await ${locator(s)}.waitHandle();`);
        out.push(`    if ((await el.evaluate((e) => e.checked ?? e.getAttribute("aria-checked") === "true")) !== ${val !== "false"}) await el.click();`);
        out.push(`  }`);
        break;
      case "press":
        if (s.selector) out.push(`  await ${locator(s)}.click();`);
        out.push(`  await Promise.all([`);
        out.push(`    page.waitForNavigation({ timeout: 1500 }).catch(() => {}),`);
        out.push(`    page.keyboard.press(${js(val || "Enter")}),`);
        out.push(`  ]);`);
        break;
      case "wait":
        out.push(`  await new Promise((r) => setTimeout(r, ${Number(val) || 1000}));`);
        break;
      case "waitFor":
        out.push(`  await ${locator(s)}.wait();`);
        break;
      case "assertText":
        out.push(`  {`);
        out.push(`    const el = await ${locator(s)}.waitHandle();`);
        out.push(`    const txt = await el.evaluate((e) => e.value ?? e.innerText);`);
        out.push(`    if (!txt.includes(${jsValue(val)})) throw new Error(\`Paso ${i + 1}: se esperaba ${val.replace(/[`$\\]/g, "")} y hay \${txt}\`);`);
        out.push(`  }`);
        break;
    }
  });

  out.push(`  console.log("✓ ${flow.name.replace(/"/g, "'")}: OK");`);
  out.push(`} catch (e) {`);
  out.push(`  console.error("✗", e.message);`);
  out.push(`  await page.screenshot({ path: "rastro-error.png" });`);
  out.push(`  process.exitCode = 1;`);
  out.push(`} finally {`);
  out.push(`  await browser.close();`);
  out.push(`}`);
  return out.join("\n") + "\n";
}

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "flujo";
