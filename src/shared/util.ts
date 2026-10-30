export const uid = (): string => crypto.randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);

/** ¿Parece un id/clase autogenerado (hashes, contadores, ids de React/Element Plus…)? */
export function looksGenerated(s: string): boolean {
  return (
    s.length > 40 ||
    /\d{4,}/.test(s) ||
    /[-_:]\d+[-_:]\d+$/.test(s) || // prefijo-aleatorio-contador: el-id-744-165, input-12-3
    /^[a-f0-9-]{10,}$/i.test(s) ||
    /^:r[0-9a-z]+:?$/.test(s) || // React useId
    /^(ember|ext-gen|react-|mui-|radix-|headlessui-|downshift-|rc-|el-id-|v-\d|input-\d)/i.test(s) ||
    (/[_-][a-zA-Z0-9]{5,}$/.test(s) && /\d.*\d/.test(s.slice(-6))) || // css-modules: btn_x3F9a
    /^(css|sc|jsx|emotion|svelte)-[a-z0-9]+$/i.test(s)
  );
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Variables integradas: {{$timestamp}}, {{$uuid}}, {{$randomEmail}}, {{$randomInt}}, {{$today}} */
function builtin(name: string): string | undefined {
  switch (name) {
    case "$timestamp":
      return String(Date.now());
    case "$uuid":
      return crypto.randomUUID();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1_000_000));
    case "$randomEmail":
      return `test+${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}@example.com`;
    case "$today":
      return new Date().toISOString().slice(0, 10);
  }
  return undefined;
}

/** Sustituye {{variable}} por su valor. Las desconocidas se dejan tal cual. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (m, name: string) => vars[name] ?? builtin(name) ?? m);
}

export const BUILTIN_VARS = ["$timestamp", "$uuid", "$randomEmail", "$randomInt", "$today"];
