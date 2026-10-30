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
- `frame=2` → el tercer `<iframe>` del documento (solo en rutas de frame)

Preferencia al generar: `data-testid`/`data-cy`/`data-qa` → `#id` estable → `name` → `label=` → `aria-label` → `placeholder` → `text=` → ruta CSS. Los ids y clases con pinta de autogenerados se descartan: hashes, `:r1:` de React, css-modules, y ids `prefijo-aleatorio-contador` como los de Element Plus (`el-id-7440-1658`). El `<label for="el-id-…">` sigue sirviendo, porque `label=` busca por el texto de la etiqueta en el momento de reproducir. Al importar de DevTools Recorder también se quitan los selectores que dependen de esos ids.

Los inputs `readonly` (selects y datepickers de librerías como Element Plus o Vuetify) se graban como `Click`, porque abren un desplegable. La opción elegida se graba como `Click` en `text=…`.

Demo: http://localhost:4321/element.html imita el DOM de Element Plus, con ids nuevos en cada carga.

### Iframes

Se graba y se reproduce dentro de iframes, también **cross-origin** (pasarelas de pago, widgets embebidos…), **anidados** y `srcdoc`/`about:blank`. Cada paso guarda su ruta de iframes desde la página principal, por ejemplo `#pasarela >> iframe[name="cvc"]`. En la lista se marca con la etiqueta `IFRAME` y la ruta se puede editar en el paso.

Por debajo:
- **Al grabar**, el background pide al frame hijo que se anuncie a su padre por `postMessage`. El padre localiza su `<iframe>` comparando `contentWindow === event.source`, una comparación que el navegador permite entre orígenes distintos, y le genera selectores.
- **Al reproducir**, cada nivel resuelve su `<iframe>` y le manda una sonda. El content script del hijo se la reporta al background, que así sabe a qué `frameId` mandar el paso. Si el iframe aún está cargando, se reintenta hasta el timeout.

Demo: `bun run demo` → http://localhost:4321/checkout.html. Es un checkout con la pasarela en otro origen (`127.0.0.1`), el CVC en un iframe anidado y un iframe `srcdoc`.

### Variables

En cualquier valor puedes usar `{{nombre}}`, con las variables definidas en el flujo, o las integradas: `{{$randomEmail}}`, `{{$timestamp}}`, `{{$uuid}}`, `{{$randomInt}}` y `{{$today}}`. Las integradas se fijan una vez por ejecución: el mismo `{{$randomEmail}}` en «email» y «confirmar email» da el mismo valor.

### Organizar

Carpetas, etiquetas, búsqueda (nombre, #etiqueta, URL, campos) y orden por recientes, nombre o última ejecución. También selección múltiple para exportar, mover, etiquetar o borrar en bloque.

### Exportar / importar

- **JSON** (`format: "rastro"`): un flujo, una selección o todos. Para importar, usa ⇪ o arrastra el `.json` al panel. Si ya existe un flujo con el mismo id, eliges entre sobrescribir o crear una copia.
- **Puppeteer** (`.mjs`): script listo para Node/CI (`npm i puppeteer && node flujo.mjs`). Usa `Locator.race` con todos los selectores alternativos y baja por los iframes con `contentFrame()`.
- **Chrome DevTools Recorder** (panel *Recorder* de DevTools):
  - *Importar*: arrastra o importa el `.json` exportado desde el Recorder y se detecta solo. Los `aria/…` pasan a `label=`/`text=`, `xpath/…` a `xpath=`, y las rutas de frame por índice a `frame=N`. El click previo a cada `change` se elimina. Los pasos sin equivalente (`hover`, `scroll`…) se omiten y se avisa de ellos.
  - *Exportar*: genera un `.recorder.json` para importarlo en DevTools, por ejemplo para medir rendimiento con *Performance panel*. Los pasos dentro de iframes van sin ruta de frame, porque Recorder usa índices.

## Arquitectura

```
src/
  content/   selector.ts  generación y resolución de selectores (motor propio)
             recorder.ts  grabación / modo señalar / re-apuntar
             player.ts    ejecución de pasos con eventos realistas
             overlay.ts   resaltado, toasts y píldora (shadow DOM)
  background/             coordina la grabación entre navegaciones; único escritor de pasos grabados
  panel/                  side panel: biblioteca, editor y runner (TS + DOM, sin framework)
  shared/                 tipos, storage, exportadores (JSON, Puppeteer, DevTools Recorder), variables
```

- La reproducción la orquesta el panel. Envía cada paso al content script y, si un click o Enter puede navegar (enlace, submit, Enter en un form), espera a que la navegación empiece y termine (`webNavigation`). Si una navegación mata el content script a mitad de paso, reintenta en la página nueva.
- Al escribir se usa `execCommand('insertText')`, que genera eventos `input` nativos. Si no funciona, se cae al setter nativo de `value` más un `InputEvent`. Desde el isolated world del content script eso basta para que React, Vue o Angular detecten el cambio.
- Los datos viven en `chrome.storage.local`, con una clave por flujo.

## Limitaciones conocidas

- Los eventos sintéticos llevan `isTrusted: false`. Si alguna web lo comprueba, la vía sería un modo opcional con `chrome.debugger`.
- Aún no soporta inputs de tipo fichero.
- Shadow DOM: `text=` sí busca dentro de los shadow roots abiertos, pero los selectores CSS generados no.
