# Pruebas

ARCANVEIL no usa ningún marco de pruebas: exigiría una dependencia de
desarrollo, y el proyecto se define por no tener ninguna. Las comprobaciones
automáticas son guiones de Node sin dependencias, y se pasan antes de cada
commit:

```bash
node tools/regresion-app.mjs            # la PWA en Chrome, a 390x844
node tools/regresion-app.mjs --desktop  # lo mismo a 1440x900
node tools/regresion-app.mjs --sin-ia   # sin servicio de imágenes: el respaldo
for f in tools/auditar-*.mjs; do node "$f" || echo "FALLA $f"; done
```

Las auditorías prueban piezas sueltas con casos que salieron de partidas
reales (persona gramatical, combate, creación, misiones, retratos…). La
regresión juega una partida entera en un Chrome sin ventana.

`tools/auditar-historia.mjs` juega partidas de verdad con el motor completo
en Node (`tools/motor-sin-ventana.mjs`), sin navegador y en segundos: es la
que comprueba que la historia la hace el jugador (ver el bloque 3). Para
probar a mano una idea en ese motor:

```js
import { crearMotor } from './tools/motor-sin-ventana.mjs';
const m = await crearMotor({ semilla: 7412 });
console.log(await m.empezar({ nombre: 'Iselda', raza: 'valdes', clase: 'rastreador', trasfondo: 'gente_campo', lore: '…' }));
console.log(await m.jugar('Ignoro al encapuchado; le pregunto al herrero por el paso del norte'));
m.guardarYCargar();
```

El narrador sin modelo se mide, no se opina: `tools/medir-narrador.mjs` juega
seis partidas comparables (tres personajes, estilo contemplativo e impulsivo,
veintidós turnos) y cuenta frases repetidas, coletillas, resultados genéricos
y preguntas contestadas con información. `--transcripciones carpeta/` deja
cada partida marcada (⟲ lo repetido, ✅/❌ si contesta a lo preguntado).
`tools/auditar-narrador.mjs` fija los fallos concretos que tenía.

```bash
node tools/medir-narrador.mjs --transcripciones /tmp/partidas
```

**El narrador con IA se prueba sin IA, y aparte del procedural:**

- `tools/auditar-interpretacion.mjs` congela los siete fallos de la partida
  de Ena (semilla 75313) más un conjunto aparte: paráfrasis, erratas, nombres
  parecidos, otra semilla, carro visto en otro lugar, canon y guardar/cargar.
  Una respuesta en boca de quien no era cuenta como fallo aunque hable del
  tema.
- `tools/auditar-narrador-ia.mjs` levanta el puente contra un Groq falso en
  127.0.0.1 y mete el proveedor en el motor con respuestas simuladas.
- `medir-narrador.mjs --ia-simulada` juega las seis partidas con un modelo
  falso que sabotea cinco de cada seis turnos: las fugas a la bitácora deben
  ser cero.
- `tools/auditar-canon.mjs`: el canon no se pierde (más de seis ediciones, más
  de ocho entidades, historia larga, revisión del mismo hecho, contradicción
  tras guardar y cargar, migración de partidas viejas).
- `tools/auditar-puente-uso.mjs`: la cuenta del puente (simultáneas, reinicio,
  fichero dañado o sin escritura, timeout incierto, red caída, caché fallida,
  sin `usage`, 429 sin Retry-After, 4xx).
- `tools/revision-manual.mjs --modo procedural|simulada|groq`: seis partidas
  nuevas para LEERLAS enteras, cada modo en su carpeta. Los números no
  sustituyen a leerlas: en la última revisión el procedural medía 26/27
  preguntas contestadas y, leyendo, contestaba «De Dalrok no sé nada».

Nada de esto valida la calidad del modelo de verdad. Eso son partidas reales
(`--groq --partida N`, ver GROQ_LOCAL.md) y el paquete ciego
(`tools/paquete-ciego.mjs`).

Lo que no se automatiza se comprueba a mano con este guion, en el orden que
encuentra los fallos antes.

Cada bloque tiene un **criterio de fallo**: qué significa que algo esté mal, no
solo qué hacer. Sin eso, un guion de pruebas se convierte en una lista de clics.

---

## Antes de empezar

```bash
node tools/servir.mjs
```

Abre `http://localhost:8080` y ten la consola del navegador visible. **Cualquier
error en rojo durante las pruebas es un fallo**, aunque el juego siga
funcionando.

La consola expone `window.ARCANVEIL` con los atajos que se usan más abajo.

---

## 1 · Arranque y portada

| Comprobar | Criterio de fallo |
|---|---|
| La portada es la marca ARCANVEIL y «Pulsa para jugar», sin cuadro ni menú a la vista | Se ve el menú, un marco o un medallón |
| La tinta del título cabe y está centrada a 320, 390, 430 px y en escritorio, con zoom al 200 % y letra grande | El trazo de la última ele se sale o el título queda torcido |
| «Pulsa para jugar» se activa con ratón, dedo, Intro y Espacio, y el foco entra en el menú | Hay que pulsar dos veces o el foco se pierde |
| El menú trae Continuar, Nueva partida, Cargar y Ajustes, y «Volver» o Escape lo recogen | Falta un botón o no se puede volver |
| Con partida guardada, pulsar abre el menú; no carga nada solo | Entra directamente en una partida |
| «Menú» desde la partida vuelve directo al menú | Hay que pasar otra vez por la portada |
| No hay errores en consola | Cualquier excepción no capturada |
| «Continuar» y «Cargar» quedan apagados si no hay partidas | Se pueden pulsar y fallan |
| «Continuar» retoma la última partida guardada | Abre otra o empieza de cero |
| «Cargar» lista las ranuras (hasta 8) con nombre, nivel y lugar | Ranuras vacías que parecen llenas |

```js
ARCANVEIL.ver('meta.fase')     // 'vacia' en la portada, sin partida cargada
ARCANVEIL.inspeccionar()       // todos los sistemas 'arrancado'
```

Si algún sistema aparece como `pendiente` o `fallido`, el orden de registro en
`main.js` está mal. `TurnResolver` debe ir último y `World` después de sus
subsistemas.

---

## 2 · Personajes

**Nueva partida sin personajes** abre directamente el generador. **Con
personajes creados** muestra la lista (cada uno a nivel 1) y debajo «Nuevo
personaje»; al elegir uno solo queda «Comenzar partida».

| Comprobar | Criterio de fallo |
|---|---|
| El dado «Aleatorio» cambia linaje y nombre en cada pulsación | Repite el mismo origen o no cambia el nombre |
| Nombre, Descripción e Historia se escriben libremente | Algún campo se borra al volver a tirar |
| Sin pedirlo no se pinta nada: se ve el marcador con la inicial y el nombre, y «Pintar retrato» | Aparece una cara o una imagen sin haberla pedido |
| «Pintar retrato» abre el estudio: la candidata se ve aparte, «Otra versión» pide otra, «Usar esta versión» la pone en la ficha | La candidata sale en la ficha sin elegirla, o «Otra versión» devuelve la misma |
| Sin generador en el equipo, el estudio dice qué arrancar y no deja pintar | Se queda cargando o da un error sin explicación |
| Pulsar el nombre o el linaje no abre la ilustración a pantalla completa | Salta la ilustración |
| «Crear personaje» enseña la ficha revelada con «Crear otro» y «Comenzar partida» | Entra en partida sin revelar |
| El lugar de partida corresponde al linaje | Un ferrano que empieza en el pantano |
| Se elige la intensidad (Pacífica, Equilibrada, Dura, Implacable) y sale en la ficha | Se queda siempre en la misma |
| El personaje empieza sin cargar de más: «Ligero», o «Cargado» como mucho con armadura pesada | «Sobrecargado» en el turno 1 con su propio equipo |

### La creación conversacional

La ficha revelada la resume el narrador y pregunta «¿Te gusta así o quieres
cambiar algo?». Se corrige escribiendo en la caja de debajo:

1. `mejor que sea hombre`
2. `que lleve una capa roja y que se llame Brun`
3. `vale, empezamos`

| Comprobar | Criterio de fallo |
|---|---|
| Cada corrección responde qué ha cambiado («Ahora es un hombre.», «Añadido: una capa roja.») | «No te he entendido» ante una de estas frases |
| El nombre, el retrato y la historia se conservan salvo lo que se pidió cambiar | Se pierde el nombre o sale otro personaje en el plantel |
| El retrato elegido se conserva; si ya no se parece, se pinta otro desde el estudio | La corrección borra el retrato elegido o pinta uno sin pedirlo |
| Si la descripción nombra una especie («enana») distinta del linaje, lo avisa y ofrece cambiarlo | Mezcla rasgos de los dos (cuernos en una enana) |
| «vale, empezamos» arranca la partida sin buscar el botón | Hay que pulsar «Comenzar partida» |
| En móvil, el ejemplo de la caja se lee entero y en letra normal | Sale en versalitas grandes y cortado |

```js
ARCANVEIL.ver('player')        // nombre, raza, clase, lore, retrato, genero
ARCANVEIL.ver('world.ubicacion')
```

---

## 3 · Turno libre

**La historia la hace el jugador, no la biografía.** La historia personal
del personaje es canon: no se contradice, pero no dicta la campaña. La
apertura dice dónde y cuándo, y pone delante algo que está pasando en el
mundo (un carro atascado, una niña asomada a un pozo, alguien vigilando
desde un tejado) con gente con nombre. No hay misión impuesta: los encargos
nacen de lo que ofrece alguien y el jugador acepta, o de lo que él mismo se
propone.

| Comprobar | Criterio de fallo |
|---|---|
| La apertura nombra lugar y momento, y presenta algo que pasa, con gente con nombre | Vuelca el pasado del personaje («Tu hermano desapareció…») |
| Empieza sin misiones en el panel de encargos | Hay una «principal» sacada de la historia |
| Dos personajes con la misma historia empiezan igual de libres | Los dos arrancan «tras la pista de» lo mismo |
| Cada turno del narrador acaba con una pregunta en su propia línea | Termina en una descripción y no se sabe si el turno ha acabado |
| La pregunta solo nombra a alguien si le has hablado en ese turno | «Ulket te mira, esperando» cuando hablaste con otra persona |

**Lo que se ignora sigue ahí, a su ritmo.** Escribe, con la situación de
la apertura delante:

1. `Ignoro al encapuchado; le pregunto al herrero por el paso del norte`
2. `si el herrero me sigue mirando, me voy al puente`
3. `Le digo al herrero: «No voy a venderte el anillo». Luego espero`
4. Cuatro o cinco turnos de otra cosa (`miro el río`)
5. `le pregunto al mercader qué le ha pasado`
6. Guarda, recarga y `vuelvo con el herrero y le pregunto otra vez por el paso`

| Comprobar | Criterio de fallo |
|---|---|
| Ignorar algo no lo resuelve ni lo narra de cerca; el herrero contesta a la pregunta | Sale el detalle del encapuchado, o nadie contesta |
| La condición no se ejecuta: el personaje sigue donde estaba y se le devuelve «si el herrero te sigue mirando» | «Te vas al puente» y cambia la gente de alrededor |
| La negativa se narra con sus palabras exactas, sin entregar nada | «No vas a venderte el anillo», o el anillo cambia de manos |
| Al cumplirse el plazo, lo ignorado pasa sin el jugador y sin reproches (el robo) | No pasa nunca, o se le culpa |
| Quien lo vivió lo cuenta si se le pregunta; quien se fue ya no está | El mercader contesta lo de siempre; el vigía sigue «presente» |
| Al volver, el herrero recuerda la negativa con sus palabras, también tras recargar | Te saluda como si nada |

La partida no tiene botones de acción fijos: solo la caja de texto. Tras 5-10
segundos sin escribir aparece una ventana con tres sugerencias que nombran lo
que hay en escena (la persona presente, un rincón del lugar, el hilo de tu
historia). Se cierra al escribir o al elegir una.

Escribe estas acciones seguidas y observa:

1. `Me acerco al barquero y le enseño el medallón de mi hermana`
2. `Le pregunto si alguien cruzó el río con uno igual`
3. `Intento partir el puente de un puñetazo` (nivel 1)
4. `Me escondo detrás del carro y espero a que pase la guardia`
5. `anoto lo descubierto`

| Comprobar | Criterio de fallo |
|---|---|
| La narración devuelve la acción en segunda persona («Te acercas…», «anotas lo descubierto») | La cita en primera persona o frases como «intentas anoto» |
| Cada respuesta tiene al menos dos o tres párrafos | Una sola línea |
| El texto se escribe letra a letra; pulsar la bitácora lo completa | Aparece de golpe o no se puede saltar |
| Una hazaña imposible para el nivel se narra como intento que no alcanza | El puente se parte a nivel 1 |
| Una acción detallada (cómo y con qué) recibe ventaja en la tirada | Da igual lo que escribas |
| Las tiradas aparecen antes de la narración | La narración contradice la tirada |
| Las sugerencias no aparecen mientras escribes ni mientras se escribe el texto | Tapan la caja de texto |

**La prueba crítica de este bloque** es que la narración nunca contradiga el
dado. Si la tirada dice fracaso y el texto dice que lo consigues, la promesa
central del motor está rota. Comprueba varias veces con:

```js
ARCANVEIL.jugar('intento forzar la puerta')
ARCANVEIL.interfaz.estado()    // escribiendo, cola, sugerencias
```

---

## 4 · Inventario

```js
ARCANVEIL.dar('pocion_curacion', 3)
ARCANVEIL.dar('espada_corta')
ARCANVEIL.dar('cota_ligera')
ARCANVEIL.botin('jefe')
```

| Comprobar | Criterio de fallo |
|---|---|
| Las pociones se apilan en una entrada | Aparecen tres entradas |
| Al equipar la cota, la barra de carga cambia de color | No reacciona |
| Alt+clic abre el menú contextual | No aparece |
| El tooltip muestra daño, peso y valor | Faltan datos |
| Tirar un objeto de misión se rechaza | Se puede tirar |

**Prueba de durabilidad:**

```js
// Provoca combates hasta que el arma se desgaste
ARCANVEIL.pelear('rata_gigante', 1)
```

Repite hasta ver el aro de durabilidad amarillo. Debe avisar al cruzar cada
umbral, no en cada golpe.

---

## 5 · Combate

```js
ARCANVEIL.pelear('lobo_ceniciento', 3)
```

| Comprobar | Criterio de fallo |
|---|---|
| Los lobos coordinan: van al mismo objetivo | Cada uno ataca a su aire |
| Los turnos enemigos se encadenan solos | Hay que pulsar entre cada uno |
| El panel se sacude al recibir daño | No hay señal visual |
| Al bajar del 25 %, algún lobo huye | Pelean hasta morir todos |
| Al ganar, llega experiencia y botín | No llega nada |

**Un enfrentamiento no es un combate automático.** Con una patrulla
delante (en el camino o forzada):

```js
import('/src/world/EncounterTables.js').then((T) => ARCANVEIL.sistema('exploration')._presentar(T.obtenerEncuentro('patrulla_hostil')))
```

| Comprobar | Criterio de fallo |
|---|---|
| `les hablo con calma: solo estoy de paso` con buena tirada la resuelve sin pelea | Hablar cuenta como ignorarlos |
| Un mal intento de hablar tensa la cosa; el segundo acaba en pelea | Pelea al primer fallo, o nunca |
| Ignorarlos dos veces acaba en pelea; a una criatura que no persigue se la puede dejar atrás | Nada cambia, o todo acaba en combate |
| Atacar primero da la iniciativa al jugador | Atacan ellos primero |
| En la pelea, `bajad las armas, os ofrezco una tregua` tira trato social: si sale, se acaba sin más muertos | No existe hablar en combate |
| Si no convence, la pelea sigue y el turno se ha ido hablando | Se ignora la frase o se toma como ataque |
| Con lobos, «no hay con quién hablar» | Los lobos aceptan una tregua |

**Combate contra jefe:**

```js
ARCANVEIL.pelear('guardian_de_la_puerta')
```

| Comprobar | Criterio de fallo |
|---|---|
| La barra grande muestra las marcas de fase | No aparecen |
| Al 60 % cambia de comportamiento y lo anuncia | Pasa sin avisar |
| Se sacude los aturdimientos a veces | Se puede encadenar indefinidamente |
| Usa acciones legendarias fuera de su turno | Nunca actúa entre turnos |

**Prueba de estados:**

```js
ARCANVEIL.pelear('tejedora_de_umbral')
```

El veneno debe hacer daño **al inicio** de tu turno, antes de que actúes. Si
hace daño al final, el orden está invertido.

**La jugada escrita cuenta.** En combate la caja de abajo es la de combate
(«Describe tu jugada…») y no hay otra. Escribe:

1. `le lanzo arena a los ojos y le golpeo`
2. `salto sobre la roca y descargo el hacha sobre su cabeza` (sin llevar hacha)
3. `vendo la herida`

| Comprobar | Criterio de fallo |
|---|---|
| La arena da +1 en el parte («d20 N, +1 por la jugada: T contra U») y deja al rival cegado | Un «Atacar» normal, sin bono ni estado |
| Nombrar un arma que no llevas lo dice y resta («No llevas hacha: atacas con tu hoz», −2) | Ataca con un hacha inexistente |
| Curarse con palabras usa la poción si la hay, o tira primeros auxilios | No hace nada |
| Atacar primero con «ataco al primer bandido que vea» te da la iniciativa y un solo grupo asequible | El enemigo pega antes, o salen tres |
| El enemigo enseña su ficha: retrato, dos o tres habilidades y vida en números | Solo un nombre y una barra |
| Al ganar, el botín se cuenta en la historia («Entre sus cosas encuentras…») | Solo aparece en el inventario |

**Caer.** Fuerza una caída con
`ARCANVEIL.store.dispatch('player/danar', { cantidad: 999 })`:

| Comprobar | Criterio de fallo |
|---|---|
| Sale «Has caído» con «Volver en ti» (salvo en Implacable), «Cargar partida» y «Nueva crónica» | La partida sigue con 0 de vida |
| La caja queda bloqueada y Escape no cierra la pantalla | Se puede escribir o salir sin elegir |
| «Volver en ti» deja 1 de vida, cobra oro y avanza el reloj | Revive gratis |
| **Una segunda caída** en la misma sesión vuelve a sacar la pantalla | La segunda vez no pasa nada |

---

## 5b · Compañeros

Habla con alguien presente y pídele que venga: `Fenwena, ¿vienes conmigo?`,
o `te pago para que me acompañes`.

| Comprobar | Criterio de fallo |
|---|---|
| Hay tirada social visible y con alguien neutral se consigue a menudo | Solo con un 20 natural |
| Quien no puede ir a veces ofrece a otro («pregúntale a mi mozo»), y ese sí se deja convencer fácil | El recomendado es igual de imposible |
| El compañero sale bajo el personaje (en móvil, en la pestaña Grupo) con vida, ataque y rasgo | No se ve en ningún sitio |
| Viaja contigo («Emprendes el camino hacia… con Ulmir») y «vamos hacia Saucedo» te mueve | Se queda atrás, o el plural no se entiende |
| En combate pelea en tu bando, sale con su cara y no se le puede apuntar | El botón dice «Atacar a Ulmir» |
| Si cae, queda herido y se recupera descansando (en Implacable, muere) | Muere en cualquier intensidad |
| `vete a casa, Ulmir` lo despide y vuelve a su sitio | Sigue en el grupo |

---

## 5c · Escenas ilustradas

| Comprobar | Criterio de fallo |
|---|---|
| Llegar a un sitio, entrar en un interior, empezar o acabar un combate trae ilustración nueva | Cambia en cada turno, o nunca |
| La ilustración de la cabecera enseña horizonte y suelo, sin marco de papel ni nada moderno | Solo cielo; una carretera asfaltada |
| Cada ilustración queda en la bitácora como miniatura y se abre en grande al pulsarla | Desaparece al cambiar de escena |
| El botón ▴ pliega la cabecera a una franja y la preferencia se recuerda | Hay que plegarla en cada turno |
| Sin red, se queda el paisaje de siempre y la consola no se llena de errores | Hueco vacío o decenas de peticiones fallidas |

---

## 6 · Mundo y viaje

```js
ARCANVEIL.mundo()
ARCANVEIL.ir('camino_norte')
```

| Comprobar | Criterio de fallo |
|---|---|
| El viaje avisa del coste antes de emprenderlo | Sale sin decir nada |
| Se consumen raciones y odres de verdad | El inventario no cambia |
| Un encuentro interrumpe el viaje y se puede continuar | Hay que empezar de cero |
| Al llegar, el mapa se actualiza | El nodo no se marca |

**Prueba de clima:**

```js
ARCANVEIL.clima('niebla')
ARCANVEIL.prueba('percepcion')   // debe mostrar -4 por niebla
ARCANVEIL.prueba('sigilo')       // debe mostrar +3
```

**Prueba de estaciones:**

```js
ARCANVEIL.dias(90)
```

Al entrar el invierno, las rutas de montaña con peligro alto deben cerrarse.
Intenta `ARCANVEIL.ir('forja_alta')` desde el paso: debe negarse.

**Prueba de eventos:**

```js
ARCANVEIL.evento('feria')
```

Los precios deben bajar. Comprueba con un mercader antes y después.

---

## 7 · Gente

Habla con alguien presente y observa:

```js
ARCANVEIL.ver('npcs.presentes')
```

| Comprobar | Criterio de fallo |
|---|---|
| El PNJ tiene nombre, oficio y rasgo coherentes | Un herrero en el pantano |
| Al volver al mismo lugar, es el mismo PNJ | Se genera otro |
| Su actitud se muestra en palabras, no en cifras | Aparece «-30» |
| Pedirle algo que odia se rechaza sin tirada | Deja tirar y a veces cede |

**Prueba de propagación.** En un asentamiento pequeño, intimida a alguien y
comprueba que los demás presentes bajan de actitud. En una ciudad grande,
apenas debería notarse.

**Prueba de conocimiento.** Pregunta por la zona. Si el PNJ revela un lugar,
**ese lugar debe aparecer en el mapa de verdad**. Si solo lo menciona en el
texto, el enlace entre diálogo y mundo está roto.

---

## 8 · Comercio

```js
ARCANVEIL.ver('npcs.presentes')   // busca un mercader
```

| Comprobar | Criterio de fallo |
|---|---|
| Comprar y vender lo mismo siempre pierde dinero | Se puede hacer bucle de oro |
| Un herrero rechaza pociones | Compra de todo |
| El mercader se queda sin oro al venderle mucho | Paga infinitamente |
| El agua cuesta el triple en el desierto | Precio igual en todas partes |

**Prueba de reputación en precios.** Sube la reputación con una facción y
comprueba que sus mercaderes cobran menos:

```js
ARCANVEIL.inspeccionar('reputation')
```

---

## 9 · Misiones

Habla con gente hasta que te ofrezcan algo, o fuerza:

```js
ARCANVEIL.inspeccionar('quests')
```

| Comprobar | Criterio de fallo |
|---|---|
| La misión la propone un PNJ, no una notificación | Aparece sola en el registro |
| Ofrecida no es aceptada: sale como oferta, con botón de rechazar | Entra directa como misión activa |
| `acepto el encargo` o `no me interesa` escritos valen igual que los botones | Solo funcionan los botones |
| Quien ofreció recuerda el rechazo, sin castigo | Se enfada sin motivo, o lo vuelve a ofrecer en bucle |
| `me propongo averiguar quién quemó la forja de mi padre` apunta un objetivo propio, sin pago, que el jugador da por cumplido | No existe, o sale en primera persona («tu mi padre») |
| Un objetivo de matar avanza al matar | Hay que marcarlo a mano |
| Un objetivo de recoger baja si vendes lo recogido | Se queda cumplido |
| Al cumplir todo, avisa de que se puede cobrar | Silencio |
| Fallar el plazo hace fracasar la misión | Se queda activa indefinidamente |

**La prueba más importante de este bloque:** acepta una misión de recogida,
consigue los objetos, véndelos y comprueba que el progreso **baja**. Si se
queda cumplido, se puede completar la misión y quedarse con el pago y la
mercancía.

---

## 10 · Guardado

Activa el guardado en Ajustes primero.

| Comprobar | Criterio de fallo |
|---|---|
| Guardar y cargar devuelve el estado exacto | Algo se pierde |
| El autoguardado no pisa las ranuras manuales | Sobrescribe la activa |
| Exportar descarga un `.json` legible | Falla o sale ilegible |
| Importar ese archivo restaura la partida | No carga |
| Borrar pide confirmación | Borra directo |

**Prueba de credenciales.** Esta es obligatoria y no negociable:

```js
// Introduce una clave de API en Ajustes, guarda, y luego:
localStorage.getItem('arcanveil:save:1')
```

Busca la clave en el texto. **Si aparece, es un fallo grave.** No debería estar
en ninguna parte del guardado.

```js
// Comprobación adicional
ARCANVEIL.inspeccionar('saves')   // credencialPersistida debe ser false
```

**Prueba de migración.** Edita a mano un guardado exportado y cambia
`"version": 5` por `"version": 1`. Al importarlo debe migrar y avisar de las
conversiones aplicadas, no fallar.

---

## 11 · Directores de juego

Prueba los cuatro modos en Ajustes.

### Procedural

| Comprobar | Criterio de fallo |
|---|---|
| Funciona sin red y sin claves | Pide algo |
| Al elegir narrador, dice su techo: lee por partes y resuelve con dados, situaciones y memoria, pero la prosa sale de plantillas | Promete lo mismo que una IA |
| No repite frases en veinte turnos | Se repite antes |
| Describe el entorno al cambiar de terreno | No lo menciona nunca |

Lo que no se le puede pedir: inventar respuestas nuevas. A una pregunta
sobre algo que el mundo no tiene escrito contesta con frases de catálogo
(«Ni idea. Aquí cada uno se ocupa de lo suyo»), y a dos preguntas seguidas
puede contestar con la misma forma. Lo que sí tiene que cumplir: lo que
el motor resuelve (tiradas, situaciones, recuerdos, negativas, testimonios)
se cuenta tal cual.

### Puente manual

| Comprobar | Criterio de fallo |
|---|---|
| El prompt se copia solo al abrirse | Hay que pulsar |
| Pegar un JSON válido lo aplica al vuelo | Hay que pulsar «Aplicar» |
| Pegar algo mal formado explica qué falla | Dice «error» sin más |
| Un JSON malo no cancela el turno | Se pierde el turno |
| El primer prompt lleva instrucciones; el segundo es corto | Ambos igual de largos |

### IA Groq y modelo instalado en este PC

| Comprobar | Criterio de fallo |
|---|---|
| Sin marcar la casilla, Groq no recibe nada | Se envía algo antes de aceptar |
| «Probar conexión» no genera ni envía la partida | Gasta una generación |
| El botón del narrador dice quién narra y «respaldo» si la IA falla | No se sabe quién narra |
| Con el puente cerrado, narra el procedural y lo avisa | La partida se cuelga o calla |
| Al volver el puente, se avisa y narra con el estado de ahora | Arrastra historial viejo |
| Abierta en 127.0.0.1 en vez de localhost, el error lo dice | Falla sin explicación |

**Prueba de degradación.** Con Groq activo, cierra el puente y juega tres turnos.
El juego debe seguir con el procedural, avisarlo y mostrar «Narrador: respaldo».

---

## 12 · Blindaje contra el director

Estas pruebas usan el puente manual y pegar JSON a mano. Lo que manda un
modelo (el puente, Groq o uno local) pasa por `ai/narrador/FiltroModelo.js`:
los efectos mecánicos **no se recortan, se rechazan**. La automática es
`tools/auditar-narrador-ia.mjs`.

**Daño, oro u objetos:**

```json
{ "story": "Te caes por la escalera.", "playerUpdates": { "hp": { "delta": -9999 }, "gold": { "delta": 500 } }, "newItems": [{ "nombre": "Espada divina" }] }
```

La narración entra; la vida, el oro y el objeto no cambian.

**Alguien que no está habla:**

```json
{ "story": "El fuego cruje.\nBrenwen: «Te esperaba.»\nLa lluvia arrecia fuera." }
```

Si Brenwen no está en escena (o está muerta), su línea se quita y queda el resto.

**Resucitar a un muerto:**

```json
{ "story": "Aparece Brenwen.", "npcs": [{ "refId": "npc_brenwen", "nombre": "Brenwen" }] }
```

Si Brenwen está muerta, debe rechazarse.

**Respuesta en prosa:**

> *Te adentras en el bosque y la luz se filtra entre las hojas...*

Sin JSON, debe **rescatar la narración** e inferir opciones, no descartarla.

---

## 13 · Accesibilidad

| Comprobar | Criterio de fallo |
|---|---|
| Todo es alcanzable con Tab | Hay controles inaccesibles |
| El anillo de foco es visible siempre | Desaparece en algún sitio |
| Con `prefers-reduced-motion`, nada se mueve | Sigue animando |
| Con letra al 130 %, nada se solapa | Se rompe el diseño |
| En móvil, los botones son pulsables sin fallar | Hay que apuntar |

**Prueba de movimiento reducido.** En las herramientas de desarrollo del
navegador, fuerza `prefers-reduced-motion: reduce` y recarga. Las animaciones
deben desaparecer; las transiciones de opacidad pueden quedarse.

**Prueba de teclado en combate.** Las teclas 1 a 4 deben ejecutar las acciones
y Tab debe cambiar de objetivo.

---

## 14 · Archivo único

```bash
node tools/bundle.mjs
```

| Comprobar | Criterio de fallo |
|---|---|
| Genera `dist/arcanveil.html` sin avisos | Reporta módulos ausentes |
| Se abre con doble clic, sin servidor | Pantalla en blanco |
| Funciona igual que la versión servida | Falta algo |
| Pesa menos de un megabyte | Excede |

Si el empaquetado avisa de módulos ausentes, faltan archivos del proyecto.
Consulta `PENDIENTE.md`.

---

## 15 · Sesión larga

La última prueba y la que más encuentra: **juega cuarenta turnos seguidos** sin
usar la consola. Sin forzar nada.

Presta atención a:

- **Repetición.** ¿Empieza a sonar igual?
- **Ritmo.** ¿Hay tramos muertos de diez turnos sin nada?
- **Coherencia.** ¿El director recuerda lo que prometiste?
- **Rendimiento.** ¿Se ralentiza?
- **Memoria.** ¿Crece el consumo sin parar?

```js
// Al terminar
ARCANVEIL.inspeccionar('turns')      // memoria: hechos, hilos, resúmenes
ARCANVEIL.inspeccionar('pacing')     // ritmo y directriz actual
performance.memory                 // en Chromium
```

**Criterio de fallo del bloque:** si a los cuarenta turnos el juego se siente
repetitivo o el director ha olvidado algo importante que dijiste, el problema no
es un error de código. Es de diseño, y está en `MemoryStore` o en
`DifficultyDirector`.

---

## Qué hacer con un fallo

1. **Anota la reproducción exacta.** Los fallos que dependen del azar son los
   peores; la semilla ayuda: `ARCANVEIL.ver('meta.semilla')`.
2. **Mira el canal correcto del registro.** `ARCANVEIL.log.volcar('combate')`
   filtra por sistema.
3. **Comprueba si es de blindaje.** Si el director propuso algo raro,
   `ARCANVEIL.inspeccionar('effects')` muestra los ajustes recortados.
4. **Si el estado quedó inconsistente**, es lo más grave. Las transacciones del
   store deberían impedirlo: revisa si algún sistema despacha fuera de una.
