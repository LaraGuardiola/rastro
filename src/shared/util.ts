export const uid = (): string => crypto.randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);

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
