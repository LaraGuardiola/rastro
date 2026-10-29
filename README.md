# Rastro

Extensión de Chrome para **grabar, editar y reproducir flujos web**, sobre todo formularios, clicando directamente en la página. El motor es propio, sin Puppeteer ni CDP: selectores, búsqueda de elementos y simulación de eventos.

## Instalar (sin compilar)

1. `chrome://extensions` → activa **Modo desarrollador**.
2. **Cargar descomprimida** → elige la carpeta `dist/`, o descomprime `rastro.zip`.
3. Pulsa el icono de Rastro: se abre el panel lateral.

## Desarrollo

```bash
bun install
bun run build      # → dist/
bun run watch      # recompila al guardar (luego ⟳ en chrome://extensions)
bun run typecheck
bun run demo       # formulario de prueba en http://localhost:4321
bun run zip        # → rastro.zip para compartir
```

Bun solo hace falta para compilar. Quien use Node puede cargar `dist/` tal cual, o compilar con `npx bun build.ts`.

## Cómo se usa

| Acción | Qué hace |
| --- | --- |
| **● Grabar** | Usas la web con normalidad y se graba todo. |
| **◎ Señalar** | Clicas elementos para añadirlos como pasos, pero botones y enlaces **no** se ejecutan. Inputs, selects y checkboxes sí funcionan. Esc para salir. |
| **▶ Reproducir** | Ejecuta el flujo en la pestaña activa. También hay «Solo este» y «Desde aquí» en cada paso. |

Qué se graba al clicar o usar cada tipo de elemento:

- **Botón, enlace o cualquier cosa clicable** → `Click`
- **Input, textarea o contenteditable** → `Escribir` con su contenido. Si ya tenía texto, se captura al clicar; si no, al escribir. Varias ediciones seguidas del mismo campo se fusionan en un solo paso.
- **Select** → `Seleccionar`. Guarda el value y el texto visible.
- **Checkbox o radio** → `Marcar` (true/false).
- **Enter en un input** → `Tecla Enter`
- **URL escrita en la barra de direcciones** → `Ir a`
- **Password** → se marca como secreto 🔒 y se enmascara en la UI.

Tipos de paso que se pueden añadir a mano: `Esperar` (ms), `Esperar a` (que aparezca un elemento) y `Comprobar` (que un elemento contiene un texto).

### Selectores

Cada elemento guarda un selector principal y hasta 4 alternativos. Al reproducir se prueban en orden. Sintaxis:

- `#id`, `[data-testid="x"]`, … → CSS normal
- `text=Enviar` → por texto visible
- `label=Email` → control asociado a un `<label>`, `aria-label` o placeholder
- `xpath=//form/button`

Preferencia al generar: `data-testid`/`data-cy`/`data-qa` → `#id` estable → `name` → `label=` → `aria-label` → `placeholder` → `text=` → ruta CSS. Los ids y clases con pinta de autogenerados (hashes, `:r1:`, css-modules…) se descartan.

### Variables

En cualquier valor puedes usar `{{nombre}}`, con las variables definidas en el flujo, o las integradas: `{{$randomEmail}}`, `{{$timestamp}}`, `{{$uuid}}`, `{{$randomInt}}` y `{{$today}}`. Las integradas se fijan una vez por ejecución: el mismo `{{$randomEmail}}` en «email» y «confirmar email» da el mismo valor.

### Organizar

Carpetas, etiquetas, búsqueda (nombre, #etiqueta, URL, campos) y orden por recientes, nombre o última ejecución. También selección múltiple para exportar, mover, etiquetar o borrar en bloque.

### Exportar / importar

- **JSON** (`format: "rastro"`): un flujo, una selección o todos. Para importar, usa ⇪ o arrastra el `.json` al panel. Si ya existe un flujo con el mismo id, eliges entre sobrescribir o crear una copia.
- **Puppeteer** (`.mjs`): script listo para Node/CI (`npm i puppeteer && node flujo.mjs`). Usa `Locator.race` con todos los selectores alternativos.

## Arquitectura

```
src/
  content/   selector.ts  generación y resolución de selectores (motor propio)
             recorder.ts  grabación / modo señalar / re-apuntar
             player.ts    ejecución de pasos con eventos realistas
             overlay.ts   resaltado, toasts y píldora (shadow DOM)
  background/             coordina la grabación entre navegaciones; único escritor de pasos grabados
  panel/                  side panel: biblioteca, editor y runner (TS + DOM, sin framework)
  shared/                 tipos, storage, exportadores, variables
```

- La reproducción la orquesta el panel. Envía cada paso al content script y, si un click o Enter puede navegar (enlace, submit, Enter en un form), espera a que la navegación empiece y termine (`webNavigation`). Si una navegación mata el content script a mitad de paso, reintenta en la página nueva.
- Al escribir se usa `execCommand('insertText')`, que genera eventos `input` nativos. Si no funciona, se cae al setter nativo de `value` más un `InputEvent`. Desde el isolated world del content script eso basta para que React, Vue o Angular detecten el cambio.
- Los datos viven en `chrome.storage.local`, con una clave por flujo.

## Limitaciones conocidas

- Los eventos sintéticos llevan `isTrusted: false`. Si alguna web lo comprueba, la vía sería un modo opcional con `chrome.debugger`.
- Aún no soporta iframes ni inputs de tipo fichero.
- Shadow DOM: `text=` sí busca dentro de los shadow roots abiertos, pero los selectores CSS generados no.
