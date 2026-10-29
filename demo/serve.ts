// Servidor estático para la demo: bun demo/serve.ts → http://localhost:4321
const dir = import.meta.dir;
const port = Number(process.env.PORT ?? 4321);

Bun.serve({
  port,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/form.html";
    const file = Bun.file(dir + path.replace(/\.\.+/g, ""));
    return (await file.exists()) ? new Response(file) : new Response("404", { status: 404 });
  },
});
console.log(`Demo en http://localhost:${port}`);
