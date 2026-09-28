# ARCANVEIL

Juego de rol narrativo para navegador web. Alta fantasía clásica, sin servidor y sin base de datos.

Se abre en el navegador, se juega escribiendo. Un director de juego narra, y el
motor resuelve las reglas.

## Qué es

- **100 % local.** No hay backend, ni Docker, ni base de datos. Los archivos se
  sirven estáticos y todo corre en el navegador.
- **HTML + CSS + JavaScript.** Módulos ES6, sin frameworks ni dependencias.
- **El mundo parece crearse mientras juegas.** Retratos personalizados, escenas corrientes, clima, luz, partículas y criaturas se dibujan de forma procedural a partir del personaje y del estado vivo. Las ilustraciones originales solo refuerzan hitos de campaña.
- **Cuatro narradores** a elegir: IA Groq (capa gratuita, con la clave en un
  puente local y nunca en el navegador), procedural sin IA que funciona sin red,
  puente manual para copiar y pegar en cualquier asistente y un modelo instalado
  en tu PC.
- **Se juega escribiendo.** No hay botones de acción fijos: escribes lo que
  haces o dices y el máster lo interpreta. Si te quedas en blanco unos segundos,
  aparecen tres sugerencias de la escena. Las hazañas se permiten; lo imposible
  para tu nivel se narra como un intento que no alcanza.
- **El motor tira los dados.** El director narra el resultado, nunca lo decide.
  Un modelo de lenguaje no puede hacer que aciertes cuando has fallado.

## Arrancar

Los módulos ES6 no funcionan abriendo el `index.html` a pelo: hacen falta unos
segundos de servidor estático.

```bash
node tools/servir.mjs
```

Y abrir `http://localhost:8080/app/index.html`.

Sirve cualquier servidor estático, pero este manda `Cache-Control: no-store`.
Los que cachean —`python -m http.server`, entre otros— hacen que después de
editar un módulo el navegador siga ejecutando el de antes, y eso cuesta horas
de buscar fallos que ya están arreglados.

## Archivo único

Los módulos ES6 no funcionan desde `file://`, así que durante el desarrollo hace
falta el servidor estático de arriba. Para jugar sin él:

```bash
node tools/bundle.mjs
```

Genera `dist/arcanveil.html`: un solo archivo que se abre con doble clic, sin
servidor y sin dependencias. Node solo hace falta para construirlo, no para
jugarlo.

Para empaquetar la app con interfaz gráfica:

```bash
node tools/bundle.mjs --entrada app/app.js --html app/index.html \
     --sin-estilos --salida dist/app.html
```

El arte viaja dentro: son unos kilobytes de código, no megas de imágenes.

## Pruebas

La regresión web automatizada no necesita dependencias: arranca Chrome, recorre la portada, tira el generador aleatorio, crea un personaje con descripción e historia, comprueba que sin pedirlo no se pinta nada y que el estudio pinta, ofrece otra versión y guarda la elegida (con un puente de imagen de verdad y un proveedor falso), que la elegida sigue sin red tras recargar y que la página no pide nada fuera del equipo, que el canon abre hilos de campaña, juega 20 turnos, vigila la gramática de acciones libres y verifica la recarga offline.

```bash
node tools/regresion-app.mjs --desktop --capturas
node tools/regresion-app.mjs --capturas   # móvil 390x844
```

El guion ampliado sigue en [TESTING.md](TESTING.md).

## Estructura

```
arcanveil/
├── app/                    LA WEB QUE SE JUEGA: index.html + app.js
├── index.html              Portada: redirige al juego
├── clasico.html            Shell de tres paneles (interfaz original)
├── assets/                 Vacía; puerta para meter imágenes (ver su README)
├── styles/                 CSS por capas (@layer)
├── tools/                  servir · bundle · lamina-arte · auditar-*
└── src/
    ├── config/             Configuración: balance, IA, interfaz
    ├── core/               Store, EventBus, RNG, dados, validación
    ├── utils/              Utilidades puras
    ├── data/               Contenido: razas, clases, objetos, lugares…
    ├── art/                Arte generado: paisaje, retrato, criatura
    ├── player/             Personaje: atributos, vitales, progresión
    ├── inventory/          Inventario, durabilidad, rarezas, botín
    ├── ai/                 Directores de juego y contexto
    ├── engine/             Reglas, turno, intenciones, consecuencias
    ├── combat/             Combate por turnos
    ├── world/              Mapa, viaje, clima, eventos
    ├── npc/                Personajes, facciones, diálogo
    ├── quests/             Misiones y objetivos
    ├── economy/            Precios y comercio
    └── ui/                 Componentes y pantallas
```

## El arte

Nada de esto son archivos de imagen: los dibuja `src/art/` en el navegador.

| Qué | De dónde salen las diferencias |
|---|---|
| Retratos personalizados | linaje, semilla y descripción libre (pelo, ojos, cicatriz, parche, barba y capucha) |
| 13 criaturas | `tipo` y `tamano` de `enemies.data.js` |
| 19 paisajes | `terreno` y `tipo` de `locations.data.js` |

El paisaje además responde a la franja horaria y al clima: 56 variantes por
lugar. Una paleta única y un solo ángulo de luz, en `src/art/paleta.js`, hacen
que las 40 piezas parezcan del mismo juego.

Para verlas todas juntas:

```bash
node tools/lamina-arte.mjs --franja ocaso --clima lluvia --horas
```

Si prefieres imágenes de verdad, `assets/README.md` explica cómo sustituir
cualquier pieza por un `.webp` sin tocar código.

## Directores de juego

| Modo | Necesita | Qué sale del equipo |
|---|---|---|
| IA Groq (`openai/gpt-oss-120b`, capa Free) | `node tools/iniciar-groq.mjs`, tu cuenta en Free, internet | el contexto narrativo de cada turno, a Groq |
| Procedural sin IA | nada | nada |
| Puente manual | copiar y pegar en tu chat | lo que tú pegues |
| Modelo instalado en este PC | Ollama, LM Studio o llama.cpp | nada |

El procedural es el suelo: siempre está disponible y narra cuando la IA falla
o se agota la cuota, avisándolo. **La partida nunca se queda colgada.**

Lo que narra un modelo **no es autoridad**. El motor tira los dados, resuelve a
quién hablas y qué existe, y entrega una instantánea del mundo. El modelo narra
eso y propone efectos. Una capa verifica la narración contra el estado y quita
lo que contradice. De los efectos solo entra lo narrativo con tope; el oro, la
vida, los objetos y las misiones son siempre de su sistema. Detalles y cuota en
[GROQ_LOCAL.md](GROQ_LOCAL.md).

### Sobre las credenciales

Ninguna clave entra en el navegador. La de Groq se pide sin eco en la
terminal, vive solo en el proceso del puente local y muere con él. No toca
`localStorage`, la partida, la URL ni el historial de la terminal. La antigua
«API remota» con la clave dentro de la página se retiró.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Núcleo | ✅ |
| 2 | Interfaz base | ✅ |
| 3 | Personaje | ✅ |
| 4 | Inventario | ✅ |
| 5 | Director procedural | ✅ |
| 6 | Motor de IA | ✅ |
| 7 | Combate | ✅ |
| 8a | Mundo y exploración | ✅ |
| 8b | Gente, misiones y economía | ✅ |
| 9 | Progresión y guardado | ✅ |
| 10 | Pulido | ✅ |

## Depuración

La consola expone `window.ARCANVEIL`:

```js
ARCANVEIL.mundo()              // dónde estás, qué hora, qué tiempo
ARCANVEIL.jugar('exploro')     // fuerza un turno
ARCANVEIL.ir('forja_alta')     // viaja
ARCANVEIL.pelear('lobo_ceniciento', 3)
ARCANVEIL.dar('pocion_curacion', 3)
ARCANVEIL.evento('feria')      // fuerza un evento del mundo
ARCANVEIL.dias(90)             // cambia la estación
```

## Contenido

El contenido original —razas, clases, lugares, criaturas— es propio.
El paquete opcional del SRD se rige por su propia licencia: ver
[ATTRIBUTION.md](ATTRIBUTION.md).

## Autoría

ARCANVEIL es un proyecto de **[petetes93](https://github.com/petetes93)**:
el diseño del juego, su ambientación y el código, los textos y el arte
originales que no proceden de terceros. Ver [AUTHORS](AUTHORS).

No es obra suya, y conserva sus propias licencias y obligaciones:

- el material derivado del SRD 5.1 y 5.2 de Wizards of the Coast
  (CC BY 4.0) y los paquetes opcionales de datos, según
  [ATTRIBUTION.md](ATTRIBUTION.md);
- las tipografías de `assets/fonts/`, bajo SIL Open Font License 1.1 (ver
  [assets/fonts/README.md](assets/fonts/README.md));
- las imágenes que el juego pide en ejecución a un servicio externo de
  generación, que no forman parte del repositorio.

Este aviso deja constancia de quién es el autor en el repositorio. No es un
registro de propiedad intelectual, y el nombre de usuario por sí solo no
acredita la titularidad legal. El juego no muestra firma ni autoría en
pantalla, a propósito.

**Licencia: pendiente de decidir.** El repositorio todavía no declara una
licencia para el código ni para el contenido original. Mientras no la haya,
nadie tiene permiso explícito para reutilizarlos más allá de lo que permitan
las licencias de terceros citadas arriba.
