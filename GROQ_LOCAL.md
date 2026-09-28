# Narrar con IA Groq, gratis y con la clave fuera del navegador

ARCANVEIL puede narrar con **openai/gpt-oss-120b** en la capa gratuita (Free) de Groq. El juego corre en tu equipo; Groq corre en su nube. Entre los dos hay un **puente local** (`tools/groq-proxy.mjs`): solo él tiene la clave y habla con Groq.

> **Estado a 25/09/2026:** toda la mecánica está probada sin clave y sin red (puente contra un Groq falso, proveedor dentro del motor, navegador de extremo a extremo). **La calidad narrativa con el modelo de verdad está sin validar.** Hace falta tu cuenta, tu comprobación del plan y tu permiso. No es ChatGPT: es otro modelo, y no se promete que narre igual.
>
> Tres cosas distintas que no hay que mezclar al leer resultados: el **procedural** (sin IA), el **adversario simulado** (un Groq falso que mete errores a propósito; su prosa es de plantilla y sirve para ver el filtro, no para juzgar voz) y **Groq real** (aún sin jugar).

## Antes de empezar: compruébalo tú en tu cuenta

Este programa **no puede** ver la facturación de tu cuenta: la API de Groq no la expone. Comprueba en [console.groq.com](https://console.groq.com):

1. **Plan Free**, sin método de pago. No pases a *Developer*: para eso te piden tarjeta y ya no es gratis por diseño.
2. En **Settings › Limits**, que `openai/gpt-oss-120b` aparece con sus límites. A 25/09/2026 la tabla pública dice 30 peticiones/min, 1.000/día, 8.000 tokens/min y 200.000 tokens/día. Si tu panel dice menos, manda tu panel.
3. En **Settings › Data Controls**, activa **Zero Data Retention**. Sin ella, Groq puede guardar entradas y salidas hasta 30 días por fiabilidad o abuso. No entrena con ellas.
4. Crea la clave en **API Keys**. No la pegues en ningún chat, fichero del proyecto, URL ni captura.

## Arrancar

Desde la carpeta de ARCANVEIL, en PowerShell o en cualquier terminal:

```powershell
node tools/iniciar-groq.mjs
```

1. Te explica qué se envía y te pide confirmar que la cuenta está en Free. Escribe `si`.
2. Te pide la clave **sin eco**: no se ve al pegarla ni al teclearla, no queda en el historial de la terminal y no se escribe en disco. Si la entrada no es una terminal (una tubería, un fichero), se niega.
3. Arranca el puente en `http://127.0.0.1:11436` y la app en `http://localhost:8080`. La app corre en un proceso aparte que **no** hereda la clave.

Abre **`http://localhost:8080/app/index.html`** (o `http://127.0.0.1:8080/app/index.html`: el puente acepta los dos nombres de tu equipo con ese puerto, y nada más). Si «Probar conexión» falla, dice por qué: no hay puente, contesta otro programa, el puente se arrancó para otra dirección, Groq no acepta la clave, cuota o ritmo, o el modelo no está en la cuenta. Con el puerto ocupado, `iniciar-groq` lo dice antes de pedir la clave.

En el juego: **Narrador › IA Groq**. Pulsa **Probar conexión**: pide la lista de modelos, no genera nada ni envía la partida, y comprueba que quien contesta es de verdad el puente de ARCANVEIL (a otra dirección no se le envía nada). Luego lee qué se envía, marca la casilla y pulsa **Usar IA Groq**. Desmarcar la casilla corta el envío en el acto.

**El permiso dura la sesión.** No se guarda: al recargar o cargar partida vuelve a narrar el procedural y no sale nada hacia Groq hasta que lo eliges otra vez. (Si prefieres que se recuerde entre sesiones, es una decisión tuya pendiente.)

`Ctrl+C` en la terminal cierra el puente y la app; la clave muere con el proceso.

## Qué sale de tu equipo

En cada turno: la política del narrador (siempre la misma) y una **instantánea** del mundo ya resuelto por el motor. Lleva el lugar y la hora, quién está, lo que ha pasado, lo que escribes, lo que el motor decidió (tiradas, desenlaces), la memoria resumida y tu canon.

No sale: la clave (nunca pasa por el navegador), tus partidas guardadas, datos de tu equipo ni los **secretos** de los personajes. De un secreto solo va la marca de que alguien guarda algo.

Lo que escribas en la historia **sí** sale. No escribas nada personal que no quieras enviar a Groq.

## Cuánto da de sí la cuota gratuita

Medido con el simulador (`node tools/medir-narrador.mjs --ia-simulada`, seis partidas de 22 turnos):

| | Tokens aprox. |
|---|---|
| Política del narrador (idéntica cada turno) | ~2.500 |
| Instantánea del turno, de media | ~1.300 (máx. ~1.700) |
| Respuesta, con razonamiento bajo | hasta 800 |

Groq cachea el prefijo repetido, y **lo cacheado no cuenta para los límites**. Así que:

- **Con la política en caché:** unos 1.500–2.300 tokens por turno → **del orden de 90 a 130 turnos al día**.
- **Sin caché:** unos 4.000–4.800 por turno → **unos 40 a 45 turnos al día**.

Son estimaciones, no promesas. Las trazas del puente dicen los tokens reales y cuántos venían de caché.

**Cómo cuenta el puente** (para no pasarse sin querer):

- Antes de llamar **reserva el peor caso**: todo lo enviado más la salida máxima, sin suponer caché. Solo cuando Groq responde se ajusta con lo que dice que ha contado (`cached_tokens` incluidos). Por eso, en la práctica, caben **uno o dos turnos por minuto**.
- La reserva se escribe en disco **antes** de llamar. Si el fichero de uso está dañado, el puente no arranca; si no se puede escribir, no llama.
- Un timeout o una conexión cortada es un **resultado incierto**: se cuenta como gastado y ese turno no se reenvía. Solo una respuesta que el puente ya vio se reutiliza sin coste si el mismo turno se pide otra vez. Un reintento **puede** costar.
- Un 429 sin `Retry-After` (o con uno ilegible) se espera 60 s, y mientras tanto nadie llama.

## Cuando algo falla

- **Groq pide esperar poco** (429 con menos de 8 s): se espera lo pedido y se reintenta una vez. Un 429 no generó nada, pero el reintento es una petición más.
- **Límite por minuto o cuota del día agotada:** la IA se pausa hasta que se renueve. El turno lo narra el procedural y se avisa.
- **Sin red, puente cerrado o error de Groq:** narra el procedural y se avisa. El botón del narrador pasa a **«Narrador: respaldo»**.
- **La IA contradice el estado** (habla alguien que no está, regala oro, decide por ti, cambia de lugar, revela un secreto…): se quita en local la frase que contradice, sin gastar nada. Si no basta, se pide **una** corrección y se avisa de que gasta otra solicitud. Si tampoco basta, narra el procedural.
- **Cuando la IA vuelve**, se avisa, y narra con el estado de ahora: no hay historial viejo que arrastrar.

Nunca se cambia a otro modelo ni a otra nube por su cuenta.

## Lo que la IA puede y no puede cambiar

La IA **narra** lo que el motor ya ha decidido y **propone** efectos, cada uno con su razón y su evidencia:

- **No entra nunca:** oro, vida, objetos, experiencia, misiones aceptadas, combate, tiempo, lugar ni canon. Son de cada sistema.
- **Entra con tope:**
  - cuánto cambia la actitud de un PNJ presente (±10);
  - lo que un PNJ recordará;
  - un elemento de escena que describe;
  - un PNJ de fondo por turno;
  - una pista que no destape un secreto.

El canon lo cambias tú, fuera de la historia: escribe `canon: …`.

## Trazas y uso

En `%LOCALAPPDATA%\arcanveil\`:

- `groq-trazas.jsonl`: una línea por petición, con hora, estado, milisegundos, tamaño, tokens (y cacheados) y lo que queda de cuota. **Sin contenido de la partida ni la clave.** El turno va como huella, no en claro.
- `groq-uso.json`: peticiones y tokens de hoy, para los topes propios del puente. Estos topes van por debajo de los de la capa Free (25/min, 900/día, 180.000 tokens/día).

## Seguridad del puente

- Solo escucha en `127.0.0.1`.
- Rechaza cualquier `Host` que no sea el suyo (protege del *rebinding* de DNS) y cualquier `Origin` que no sea el de la app, además de CORS.
- Admite un único modelo y fuerza JSON, razonamiento bajo, sin razonamiento en la respuesta y topes de tamaño y tiempo.
- No reenvía los errores de Groq tal cual: los traduce.
- No se puede apuntar a otra nube.

Lo comprueba `node tools/auditar-narrador-ia.mjs`.

## Validar con partidas reales

Solo después de las comprobaciones de arriba, con el puente arrancado y el consentimiento dado:

```powershell
node tools/medir-narrador.mjs --groq --partida 1 --pausa-ms 25000 --transcripciones evaluacion/groq
```

Las seis partidas no caben en un día de la capa Free: juega una o dos al día (`--partida 1` a `6`). Para comparar con el procedural a ciegas:

```powershell
node tools/medir-narrador.mjs --transcripciones evaluacion/procedural
node tools/paquete-ciego.mjs evaluacion/procedural evaluacion/groq evaluacion/ciego
```

## Un modelo en tu propio PC (opcional)

**Narrador › Modelo instalado en este PC** habla con Ollama, LM Studio o llama.cpp, con la misma política y la misma instantánea. Nada sale del equipo.

Depende del hardware. El PC de desarrollo (i5-13600KF, 32 GB, RTX 4070 de 12 GB) da para modelos medianos. `gpt-oss-20b` (Apache 2.0 según OpenAI) ocupa unos 14 GB y no cabe entero en 12 GB de gráfica: iría más lento. No hay ningún servidor de modelos instalado; instalarlo es una descarga grande que decides tú. No todo PC puede con esto.

## Para una versión de móvil o de tienda

Una app de iOS o Android **no puede** llevar la clave dentro: hace falta un servidor propio con control de cuota por jugador. Ese servidor y la capacidad para muchos jugadores **no son gratis**, y la capa Free de Groq no garantiza servicio comercial continuo. Antes de publicar con narración en la nube hay que decidir presupuesto, política de datos y límites.
