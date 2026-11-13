// Servidor estático para la demo: bun demo/serve.ts → http://localhost:4321
const dir = import.meta.dir;
const port = Number(process.env.PORT ?? 4321);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    // API lenta para probar la espera automática: /api/slow?ms=1500
    if (url.pathname === "/api/slow") {
      await Bun.sleep(Math.min(Number(url.searchParams.get("ms")) || 1000, 10000));
      return Response.json({ ok: true });
    }
    let path = url.pathname;
    if (path === "/") path = "/form.html";
    const file = Bun.file(dir + path.replace(/\.\.+/g, ""));
    return (await file.exists()) ? new Response(file) : new Response("404", { status: 404 });
  },
});
console.log(`Demo en http://localhost:${port}`);
