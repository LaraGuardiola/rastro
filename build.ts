// Build de la extensión: bundlea cada entrypoint y copia los estáticos a dist/.
// Uso: bun build.ts [--watch]
import { cp, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";

const OUT = "dist";

const entries = [
  { entry: "src/background/index.ts", out: "background.js", format: "esm" as const },
  // Los content scripts no pueden ser módulos: IIFE.
  { entry: "src/content/index.ts", out: "content.js", format: "iife" as const },
  { entry: "src/panel/main.ts", out: "panel.js", format: "esm" as const },
];

async function build() {
  const t = performance.now();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const e of entries) {
    const res = await Bun.build({
      entrypoints: [e.entry],
      format: e.format,
      target: "browser",
      minify: false,
      sourcemap: "inline",
    });
    if (!res.success) {
      for (const log of res.logs) console.error(log);
      throw new Error(`Falló el build de ${e.entry}`);
    }
    await Bun.write(`${OUT}/${e.out}`, res.outputs[0]!);
  }

  await cp("public", OUT, { recursive: true });
  await cp("src/panel/panel.html", `${OUT}/panel.html`);
  await cp("src/panel/panel.css", `${OUT}/panel.css`);
  console.log(`✓ dist/ listo en ${Math.round(performance.now() - t)}ms`);
}

await build();

if (process.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const dir of ["src", "public"]) {
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => build().catch((e) => console.error(e.message)), 120);
    });
  }
  console.log("Vigilando cambios…");
}
