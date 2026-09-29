# Arreglo integral del playtest: informe

Rama `feat/arreglo-playtest`, sacada de `feat/narrador-ia` (18b0cfa). `main` (8c02138) sin tocar. Subida a GitHub el 29-sep-2026 hasta 2a8e2e9; los cinco commits de la revisión posterior (19384a0 … 9579120) están **en local, sin subir**. No se ha llamado a Groq, Gemini, Cloudflare ni a ningún servicio real: las pruebas usan dobles en 127.0.0.1.

**Esto no está «todo solucionado».** Quedan por validar con el mundo real: activar Groq (cuenta, plan y permiso tuyos), generar imágenes con ComfyUI en tu equipo, revisar el estilo con tu imagen de referencia (no ha llegado) y medir la portada en un móvil de verdad. Ver [Pendiente](#pendiente-y-decisiones-tuyas).

## Cómo comprobarlo

```bash
node tools/auditar-todo.mjs                         # 28 auditorías, sin red, por código de salida
node tools/regresion-app.mjs --capturas             # Chrome móvil (390×844)
node tools/regresion-app.mjs --capturas --desktop   # Chrome escritorio (1440×900)
node tools/regresion-app.mjs --sin-ia               # sin generador de imágenes
node tools/medir-portada.mjs                        # coste de la portada quieta
node tools/buscar-secretos.mjs                      # claves en árbol e historia
node tools/auditar-playtest.mjs --salida carpeta    # y lee las dos partidas
```

**Corrección.** Este informe decía «28/28 auditorías en verde» para 2a8e2e9, y no era cierto: `auditar-servidores.mjs` se caía con código 1 (ENOENT, leía `src/art/retrato-local.js`, borrado en la rama). El bucle con que se comprobó miraba las últimas líneas de salida, no el código de salida. Desde 19384a0, `tools/auditar-todo.mjs` las cuenta por código.

Estado en 9579120, 29-sep-2026 (Node 24.17.0, Windows 11, Chrome sin ventana):

| Auditoría | Código | Duración |
|---|---|---|
| auditar-arte | 0 | 0,1 s |
| auditar-borrados | 0 | 0,8 s |
| auditar-cadencia | 0 | 0 s |
| auditar-canon | 0 | 0,6 s |
| auditar-coherencia | 0 | 0,1 s |
| auditar-combate-libre | 0 | 13,4 s |
| auditar-combate | 0 | 0,1 s |
| auditar-config | 0 | 0,1 s |
| auditar-creacion | 0 | 0,1 s |
| auditar-cronica | 0 | 0,1 s |
| auditar-economia | 0 | 0,7 s |
| auditar-encargos | 0 | 0 s |
| auditar-groq-diagnostico | 0 | 0,3 s |
| auditar-guardados | 0 | 1 s |
| auditar-historia | 0 | 22,7 s |
| auditar-imports | 0 | 0,1 s |
| auditar-interpretacion | 0 | 10,8 s |
| auditar-mision | 0 | 0,1 s |
| auditar-narrador-ia | 0 | 4,4 s |
| auditar-narrador | 0 | 13,8 s |
| auditar-persona | 0 | 0,1 s |
| auditar-playtest | 0 | 27,7 s |
| auditar-puente-uso | 0 | 1 s |
| auditar-retrato | 0 | 0,6 s |
| auditar-servidores | 0 | 4,4 s |
| auditar-sujeto | 0 | 0 s |
| auditar-sw | 0 | 0,1 s |
| auditar-xss | 0 | 0,1 s |

28/28 terminadas con código 0. Regresión en Chrome: móvil y escritorio con estudio completo (pintar, otra, usar, cerrar sin elegir, nube con permiso) y borrado de datos con recarga; `--sin-ia` con marcador. Las tres con 20 turnos, 0 fallos, 0 excepciones y 0 peticiones fuera del equipo. `generar-sw.mjs --revisar`: al día. `buscar-secretos.mjs`: ninguna clave en el árbol ni en los 262 commits de todas las ramas (este checkout sí tiene historia). La imagen de las regresiones es un PNG verde de 1×1 del doble: no dice nada de la calidad de FLUX ni de ComfyUI. Capturas en `dist/regresion/`.

## Por commit

| Commit | Evidencia inicial | Raíz | Cambio | Prueba | Riesgo restante |
|---|---|---|---|---|---|
| 5814edb servidor | `servir.mjs` escuchaba en todas las interfaces y `/.gitignore` daba 200 | Servía cualquier archivo bajo la raíz | 127.0.0.1 (red local con `--lan`), lista de lo público, Host esperados, solo lectura | `auditar-servidores`: caja negra con rutas codificadas y secretos falsos | Con `--lan`, lo público queda a la vista de la red local (se avisa) |
| 663e9e8 puente de imagen | Compartía el 11436 con Groq; `ACAO: *` y POST de cualquier web | Sin identidad ni origen; puerto repetido | 11437, identidad, origen exacto, topes, cancelación, ComfyUI y Cloudflare preparado sin activar | `auditar-servidores` | Cloudflare sin probar contra el servicio real (a propósito) |
| 0356afa economía | `validarCompra` aceptaba −1: total −5 y el cargo se volvía abono | Sin validar en dominio ni reductores | Enteros finitos y positivos, transacción que se deshace si un paso falla | `auditar-economia` 45/45 (12/45 antes) | — |
| 35767d4 + c88251d narrador | Semilla 5: «Le dices: «Fijarte…»», «Hablar con Cordor» sin conversación, salto de 100 m narrado como hecho, «me enfrento a un ciudadano» vacío, «dejame en paz» sin destino, «¿Qué haces?» apilado | Infinitivos tomados por habla; sin acto «abrir charla», «encararse» ni «alejar»; la situación reaccionaba a imposibles; sugerencias sin memoria | Infinitivo a primera persona, actos nuevos, aclaraciones sin gastar turno, eco de intento, sugerencias por escena y charla que caducan (también tras cargar), un solo cierre, «otro toma la palabra» | `auditar-playtest` 19: textos visibles y dos partidas de 15 turnos (semillas 5 y 24) | Voz y variedad las juzga un humano; el procedural sigue siendo de plantilla |
| 36a7a86 defenderse | «se le pasa el efecto de protegido» antes del primer ataque; 8 de daño | La ronda se descuenta al acabar el turno propio | Protegido dura hasta el final de tu próximo turno | `auditar-combate-libre` | La orden «cubrir» de un compañero depende del orden de iniciativa (sin tocar) |
| 901fbbe estado | «Te tomas poción de curación» y la poción seguía; 20 pociones bebidas: carga 21 → 31 | El almacén funde parches: `delete` en una copia no borra | Marcador `BORRAR`; inventario, misiones y recarga de rasgos; migración 7 → 8 limpia guardados | `auditar-borrados` 15 (9 fallan antes) | Otros `delete` futuros en reductores (hay que usar `BORRAR`) |
| a9b81a2 magia libre | «alzo mi hechizo de dios immortal…»: «Atacas… 5 de daño contundente», enemigos responden | Sin magia de combate; la jugada caía en «atacar» | Se lee como magia: se dice, no se concede, no gasta vida, maná, ronda ni turno | `auditar-combate-libre` 22 (14 fallan antes): vida, maná, ronda y turno antes y después | Magia de combate de verdad sin diseñar |
| e2128ca guardados | `__proto__` cambiaba el prototipo; 20.000 niveles: RangeError; versión «7; drop» aceptada | Se parseaba y fundía sin mirar | Tamaño, anidamiento (sobre el texto), claves prohibidas, versión entera; `size` antes de leer | `auditar-guardados` 13 | — |
| fae2564 PWA | `GET /estado` del puente de Groq servido desde caché; un script roto recibía HTML | Caché de cualquier GET de cualquier origen; respaldo para todo | Solo lo propio pasa por caché; respaldo solo al navegar; manifiesto «fantasía oscura» | `auditar-sw` 7 (4 fallan antes) ejecuta el `sw.js` real | La caché vieja se sustituye al actualizar (sin prueba en móvil) |
| aac43ac XSS | `crudo` y `el({html})` sin usar; SVG con nombres de fuera | Puertas a HTML literal abiertas | Quitadas; fuzz de generadores; cable trampa; prueba en Chrome con control | `auditar-xss` 8, `regresion-app` | — |
| a5d6bc0 Gemini | Sin Host ni Origen: un POST `text/plain` de otra web gastaba la clave | Puente sin defensas | Host y origen exactos, JSON, modelos permitidos, topes | `auditar-servidores` 66 (Gemini falso) | — |
| 55745f8 secretos | — | — | Buscador en árbol e historia con autocontrol | `buscar-secretos` | Formas de clave nuevas: añadirlas a `PATRONES` |
| d870b42 Groq | Juego en `127.0.0.1:8080` con puente para `localhost:8080`: «No se encuentra el puente»; puerto ocupado: EADDRINUSE tras pegar la clave | Origen exacto; fallo de red sin distinguir; sin mirar puertos | Dos nombres de bucle local; causas distintas con petición opaca; puertos antes de pedir la clave | `auditar-groq-diagnostico` 12 (9 fallan antes) | **Groq real sin probar** |
| 5b0becd regresión | La regresión fallaba 2 de cada 40 veces | El saqueador esquiva: no hay tirada con +1 | Se repite el combate si se esquiva | Reproducido con el motor sin ventana | — |
| f7de334 + 19acbac imágenes | Retratos y escenas pedidos solos a Pollinations (anime), puestos sin aprobar, URL que muere sin red; cara vectorial genérica | Generación automática y anónima | Estudio: candidata privada, «Otra versión», «Usar esta versión»; galería en IndexedDB con claves estables; marcador con el nombre; sin Pollinations | `auditar-retrato` 26, `auditar-sujeto`, regresión con puente real y proveedor falso: sobrevive sin red, 0 peticiones fuera | **ComfyUI real sin probar**; estilo sin tu referencia; pintar enemigos fuera de combate sin sitio en la interfaz |
| be9da80 portada | 200 pintados y 100 maquetaciones por segundo con la portada quieta | `text-shadow` animado en la marca; polvo que gira; vetas con corte seco; `blur` animado | transform y opacity; polvo que solo deriva; vetas en rampa; sin `blur` al entrar | `medir-portada`: pintado y maqueta 0; tareas −25 % | Estilo +9 ms/s; **sin medir en un móvil** |

### Revisión del 29-sep (fallos encontrados en 2a8e2e9)

| Commit | Evidencia inicial | Raíz | Cambio | Prueba | Riesgo restante |
|---|---|---|---|---|---|
| 19384a0 auditorías | `auditar-servidores.mjs` terminaba con código 1 (ENOENT, línea 272) y el informe decía 28/28 | Leía `retrato-local.js`, borrado; el bucle de comprobación no miraba el código de salida | La sección de puertos importa los contratos vivos y cruza los dos puentes de verdad; `auditar-todo.mjs` cuenta por código | 68/68 entonces; 28/28 terminadas con 0 | Una auditoría nueva que no ponga `process.exitCode` en fallo |
| bc7e6d5 enlaces | Con `assets/linked` → carpeta de fuera, `GET /assets/linked/private.png` daba 200 y los bytes | `stat`/`readFile` siguen enlaces; la lista se comprobaba sobre la cadena | La ruta canónica tiene que ser la pedida bajo la raíz canónica; se lee la canónica; ningún enlace | `auditar-servidores` 73: fuera, codificadas, interno, GET/HEAD normales, `--lan` (con lo anterior fallan 3) | Enlace de archivo no probado en este Windows (EPERM al crearlo); ventana comprobar-leer con acceso de escritura local |
| 9a614d0 candidatas | El estudio decía «no se guarda ni se envía» y el puente escribía cada candidata en disco antes de aprobar; ComfyUI en `output/` | Caché sin ciclo de vida; texto sin relación con el proveedor | Nota según proveedor; permiso con la nube; caché con dueño, olvido al cerrar, 24 h, tope 40, `--limpiar`; ComfyUI a temporal | `auditar-retrato` y Chrome: archivos e IndexedDB en cada paso, cerrar sin elegir, nube | Sin ComfyUI real: qué deja él fuera de su temporal está sin comprobar |
| 3c1ab31 borrar datos | Tras «Borrar partidas y personajes» y recargar, los retratos elegidos volvían | IndexedDB y el puente fuera del borrado | Espera a vaciar la galería (transacción confirmada) y pide al puente olvidar todo; dice qué no pudo; `borrarPersonaje` olvida su retrato | Chrome: galería y caché vacías tras recargar; lo ajeno intacto | Si el puente no está en marcha, sus candidatas esperan a caducar o a `--limpiar` (se avisa) |
| 9579120 repetición | Mismo trío 9 y 10 de 20 turnos; una sugerencia 9 turnos seguidos; «¿Qué haces?» 15 y 16 de 20; «Preguntar a Cordan por Cordan» | Solo contaba como usado lo idéntico; lo ignorado no caducaba; la huella cambiaba con cada pulso | Usado por raíces; ignorado dos turnos descansa tres; huella sin pulsos; variante de cierre con la trama; aviso del mundo antes del cierre | `auditar-playtest` 25: trío 2 y 3/20, racha 3, «¿Qué haces?» 11/20 (con lo anterior fallan 6) | Sin trama ni interlocutor, «¿Qué haces?» sigue siendo el cierre; el procedural no escribe como un modelo |

## Arquitectura, en corto

- **Turno**: `IntentParser` → `Interpretacion` (segmentos y acto de habla) → encuentro → situación → router → ambición y dados → proveedor → cierre y sugerencias. En combate, la caja de texto va a `CombatManager.jugadaLibre` (`Jugada.js`).
- **Narradores** (`src/ai/providers/`): `ProceduralProvider`, `GroqProvider`, `LocalLLMProvider`, `BridgeProvider`. Comparten `comprobar()` (¿se puede usar?), `probar()` (¿quién contesta?, con `causa`) y `generar/dirigir`. Si uno falla, narra el procedural y se avisa.
- **Imágenes**: en el navegador, `candidata.js` (pedir al puente, sin guardar) y `galeria.js` (lo elegido, en IndexedDB); en el puente, un proveedor es `{ id, salud(), generar({ texto, semilla }) }` (ComfyUI y Cloudflare hoy). Un proveedor nuevo solo añade ese objeto.
- **Estado**: el almacén funde parches. Para quitar una clave, `BORRAR`; `null` deja la clave a null.
- **Puentes locales**: Groq 11436, Gemini 11435, imagen 11437. Los tres con Host de loopback, origen de la app (sus dos nombres), rechazos sin CORS y topes. Las claves solo en el proceso del puente.

## Dependencias

Sigue sin dependencias. Se miró y no hizo falta: `idb-keyval` (IndexedDB son 80 líneas en `galeria.js`), DOMPurify (ya no hay sumideros de HTML que alimentar), Playwright (la regresión habla CDP con Chrome directamente).

## Pendiente y decisiones tuyas

1. **Groq real**: cuenta en plan Free, Zero Data Retention y tu permiso. Nada se ha llamado.
2. **Imágenes con ComfyUI** en tu equipo y **tu imagen de referencia** para ajustar `ESTILO`/`NEGATIVO`.
3. **Cloudflare**: preparado, no activado. Necesita cuenta y token; tú decides.
4. **`tools/generar-arte.mjs`** pide a Pollinations anónimo con `nologo: 'true'` (sin la marca de agua). Las 14 imágenes de `assets/` pueden venir de ahí (el commit 6846e8b no lo dice). Revisar su licencia antes de publicar; no las he tocado.
5. **`.claude/agents/director-arte.md`** sigue con el ancla «cel shading anime», contraria a la dirección nueva. Es tu documento; no lo he cambiado.
6. Pintar **enemigos** fuera del combate: la galería y el puente ya lo admiten; falta decidir dónde en la interfaz (¿un bestiario?).
7. **Portada en un móvil de verdad**: sin ventana no se ve el tirón; `medir-portada` da los números de Chrome.
8. Dos animaciones pequeñas siguen con `blur` (veredicto del dado y el rótulo de momento).
9. **Push de la revisión**: los cinco commits desde 19384a0 están en local; se suben cuando digas.
10. **Candidatas del puente**: ahora caducan a las 24 h con un tope de 40. Si prefieres que no se guarden nunca en disco (y «Otra versión» repinte siempre), es un cambio pequeño; es tu decisión.
