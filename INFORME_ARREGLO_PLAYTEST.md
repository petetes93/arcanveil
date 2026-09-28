# Arreglo integral del playtest: informe

Rama `feat/arreglo-playtest`, sacada de `feat/narrador-ia` (18b0cfa). `main` (8c02138) sin tocar. Todo local: **no se ha hecho push** ni se ha llamado a Groq, Gemini, Cloudflare ni a ningún servicio real. Las pruebas usan dobles en 127.0.0.1.

**Esto no está «todo solucionado».** Quedan por validar con el mundo real: activar Groq (cuenta, plan y permiso tuyos), generar imágenes con ComfyUI en tu equipo, revisar el estilo con tu imagen de referencia (no ha llegado) y medir la portada en un móvil de verdad. Ver [Pendiente](#pendiente-y-decisiones-tuyas).

## Cómo comprobarlo

```bash
for f in tools/auditar-*.mjs; do node "$f"; done   # 28 auditorías, sin red
node tools/regresion-app.mjs --capturas             # Chrome móvil (390×844)
node tools/regresion-app.mjs --capturas --desktop   # Chrome escritorio (1440×900)
node tools/regresion-app.mjs --sin-ia               # sin generador de imágenes
node tools/medir-portada.mjs                        # coste de la portada quieta
node tools/buscar-secretos.mjs                      # claves en árbol e historia
node tools/auditar-playtest.mjs --salida carpeta    # y lee las dos partidas
```

Estado al cerrar: 28/28 auditorías en verde; regresión en Chrome móvil, escritorio y sin generador con 0 fallos, 0 excepciones y 0 peticiones fuera del equipo; ninguna clave en 306 archivos ni en los 248 commits de todas las ramas. Capturas en `dist/regresion/` (01 portada … 06 retrato sin red).

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
9. **Push**: cuando digas; la rama está lista en local.
