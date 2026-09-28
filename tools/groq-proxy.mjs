#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/groq-proxy.mjs
 * ---------------------------------------------------------------------------
 * Puente local entre el juego y Groq, pensado para no gastar un céntimo.
 *
 * La clave vive SOLO en este proceso. El navegador habla con 127.0.0.1 y
 * nunca la ve; tampoco aparece en respuestas, errores ni trazas.
 *
 * Lo que hace, y por qué:
 *
 *   · Escucha solo en 127.0.0.1. Comprueba el Host (contra el rebinding de
 *     DNS) y el Origin exacto de la app, además de CORS: CORS por sí solo no
 *     protege un servicio local.
 *   · Un único modelo permitido: openai/gpt-oss-120b. Cualquier otro se
 *     rechaza aquí. No hay modelo de respaldo ni otra nube: si Groq no
 *     puede, contesta que no y el juego sigue con el narrador procedural.
 *   · Topes propios POR DEBAJO de los de la capa Free (30 peticiones por
 *     minuto, 1.000 al día, 8.000 tokens por minuto, 200.000 al día). Un
 *     tope local no sustituye al de Groq, pero evita llegar a él.
 *   · Un 429 se devuelve con su Retry-After; si se acaba la cuota del día,
 *     se pausan las llamadas hasta que se renueve.
 *   · Idempotencia por turno: la misma petición repetida (un reintento) no
 *     gasta otra solicitud; se devuelve la misma respuesta.
 *   · Trazas sin contenido: tamaños, tiempos, tokens y estado. Nunca el
 *     texto de la partida ni la clave.
 *
 * Se arranca con `tools/iniciar-groq.mjs`, que pide la clave sin eco. Este
 * módulo exporta `crearProxyGroq` para que las pruebas lo levanten con un
 * Groq de mentira en loopback.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** Identidad del puente: la app comprueba que habla con él y no con otra cosa. */
export const SERVICIO = 'arcanveil-puente-groq/2';

/** El único modelo que este puente acepta. */
export const MODELO_PERMITIDO = 'openai/gpt-oss-120b';

/** Groq, de verdad. */
const UPSTREAM = 'https://api.groq.com/openai/v1';

/**
 * Topes propios, por debajo de los publicados para la capa Free a 25/09/2026.
 * El panel de la cuenta manda: si allí son menores, se bajan estos.
 */
export const LIMITES_LOCALES = Object.freeze({
  porMinuto: 25,
  porDia: 900,
  tokensMinuto: 7000,
  tokensDia: 180_000,
  maxTokensSalida: 1200,
  maxCaracteresEntrada: 48_000,
  maxCuerpo: 96 * 1024,
  esperaUpstreamMs: 45_000,
});

/* ═══════════════════════════════════════════════════════════════════════════
   USO
   ---------------------------------------------------------------------------
   La cuenta de lo gastado, en un fichero fuera del repositorio y sin
   contenido. Tres reglas:

   · Se RESERVA antes de llamar, en el peor caso (sin suponer que Groq tenga
     la política en caché: eso solo se sabe cuando responde), y la reserva
     se escribe en disco ANTES de enviar. Luego se ajusta con lo que Groq
     dice que ha contado. Node atiende una cosa cada vez, y reservar es
     síncrono: dos peticiones simultáneas no pueden colarse por el mismo
     hueco.
   · Si el fichero está dañado, no se arranca; si no se puede escribir, no
     se llama a Groq. Un contador que se pierde al reiniciar es un contador
     que miente.
   · Lo que no se sabe si Groq procesó (un timeout, una conexión cortada)
     se da por gastado.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {string|null} ruta Sin ruta (pruebas), solo en memoria.
 * @param {Object} [op]
 * @param {() => number} [op.ahora]
 */
export function libroDeUso(ruta, { ahora = () => Date.now() } = {}) {
  const hoy = () => new Date(ahora()).toISOString().slice(0, 10);
  const valida = (x) => x && Number.isFinite(x.t) && Number.isFinite(x.tokens);
  let datos = { version: 1, dia: hoy(), peticiones: 0, tokens: 0, minuto: [] };
  let roto = null;

  if (ruta && existsSync(ruta)) {
    let leido;
    try { leido = JSON.parse(readFileSync(ruta, 'utf8')); } catch { leido = null; }
    if (!leido || typeof leido.dia !== 'string' || !Number.isFinite(leido.peticiones) || !Number.isFinite(leido.tokens)) {
      throw new Error(`El fichero de uso (${ruta}) está dañado. El puente no arranca con la cuenta a ciegas: revísalo o bórralo a mano sabiendo que se pierde lo contado hoy.`);
    }
    const minuto = Array.isArray(leido.minuto) ? leido.minuto.filter(valida) : [];
    datos = leido.dia === hoy()
      ? { version: 1, dia: leido.dia, peticiones: leido.peticiones, tokens: leido.tokens, minuto }
      : { version: 1, dia: hoy(), peticiones: 0, tokens: 0, minuto };
  }

  const persistir = (nuevo) => {
    if (!ruta) return;
    mkdirSync(dirname(ruta), { recursive: true });
    const tmp = `${ruta}.tmp`;
    writeFileSync(tmp, JSON.stringify(nuevo));
    renameSync(tmp, ruta);
  };

  /** El estado de ahora: día renovado y minuto limpio. */
  const vigente = () => {
    const t = ahora();
    const base = datos.dia === hoy() ? datos : { ...datos, dia: hoy(), peticiones: 0, tokens: 0 };
    return { ...base, minuto: base.minuto.filter((x) => t - x.t < 60_000) };
  };

  return {
    get: () => vigente(),
    get roto() { return roto; },

    /**
     * Reserva sitio para una petición. Síncrono y persistido antes de volver.
     * @returns {{ok: true, reserva: Object} | {ok: false, estado: number, motivo: string, espera?: number, dia?: boolean}}
     */
    reservar(tokens, L) {
      if (roto) return { ok: false, estado: 503, motivo: roto };
      const d = vigente();
      const t = ahora();
      const tokensMin = d.minuto.reduce((s, x) => s + x.tokens, 0);
      const falta = (ms) => Math.max(1, Math.ceil(ms / 1000));
      if (d.peticiones + 1 > L.porDia) return { ok: false, estado: 429, dia: true, motivo: 'tope diario de peticiones de este puente' };
      if (d.tokens + tokens > L.tokensDia) return { ok: false, estado: 429, dia: true, motivo: 'tope diario de tokens de este puente' };
      if (d.minuto.length + 1 > L.porMinuto) return { ok: false, estado: 429, espera: falta(60_000 - (t - d.minuto[0].t)), motivo: 'tope por minuto de este puente' };
      if (tokensMin + tokens > L.tokensMinuto) return { ok: false, estado: 429, espera: falta(60_000 - (t - (d.minuto[0]?.t ?? t))), motivo: 'tope de tokens por minuto de este puente' };
      const reserva = { t, tokens };
      const nuevo = { ...d, peticiones: d.peticiones + 1, tokens: d.tokens + tokens, minuto: [...d.minuto, reserva] };
      try {
        persistir(nuevo);
      } catch {
        roto = 'No se pudo guardar el uso en disco: el puente no llama a Groq sin poder contarlo.';
        return { ok: false, estado: 503, motivo: roto };
      }
      datos = nuevo;
      return { ok: true, reserva };
    },

    /**
     * Ajusta una reserva con lo que de verdad se gastó.
     * @param {Object} reserva
     * @param {Object} real
     * @param {number} real.tokens
     * @param {boolean} [real.noEnviada] No llegó a Groq: tampoco cuenta como petición.
     */
    ajustar(reserva, { tokens, noEnviada = false }) {
      const d = vigente();
      const minuto = d.minuto.map((x) => (x === reserva || (x.t === reserva.t && x.tokens === reserva.tokens) ? { ...x, tokens } : x))
        .filter((x) => !(noEnviada && x.t === reserva.t && x.tokens === tokens && tokens === 0));
      const nuevo = { ...d, tokens: Math.max(0, d.tokens - reserva.tokens + tokens), peticiones: Math.max(0, d.peticiones - (noEnviada ? 1 : 0)), minuto };
      try {
        persistir(nuevo);
        datos = nuevo;
      } catch {
        // No se pudo apuntar el ajuste: se deja la reserva (el peor caso) y
        // no se llama más hasta reiniciar.
        roto = 'No se pudo guardar el uso en disco: el puente no llama a Groq sin poder contarlo.';
      }
    },
  };
}

/** Estimación grosera de tokens: ~3,5 caracteres por token en español. */
const estimar = (texto) => Math.ceil(String(texto ?? '').length / 3.5);

/* ═══════════════════════════════════════════════════════════════════════════
   PROXY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * El sitio de la app por sus dos nombres de bucle local. Abrir el juego en
 * http://127.0.0.1:8080 en vez de http://localhost:8080 es la misma máquina
 * y el mismo puerto, pero para el navegador otro origen: el puente lo
 * rechazaba y la app decía «No se encuentra el puente».
 *
 * @param {string} origen
 * @returns {Set<string>}
 */
export function origenesDe(origen) {
  const o = String(origen);
  const gemelo = o.includes('//localhost') ? o.replace('//localhost', '//127.0.0.1') : o.replace('//127.0.0.1', '//localhost');
  return new Set([o, gemelo]);
}

/**
 * @param {Object} op
 * @param {string} op.clave La clave de Groq. Solo en memoria.
 * @param {number} [op.puerto=11436]
 * @param {string} op.origen Origen exacto de la app, p. ej. http://localhost:8080
 * @param {string} [op.upstream] Solo para pruebas: un Groq falso en 127.0.0.1.
 * @param {Object} [op.limites]
 * @param {string|null} [op.rutaUso] Dónde guardar las cuentas del día.
 * @param {(traza: Object) => void} [op.trazar]
 * @returns {{servidor: import('node:http').Server, escuchar: () => Promise<number>, cerrar: () => Promise<void>, estado: () => Object}}
 */
export function crearProxyGroq({ clave, puerto = 11436, origen, upstream = UPSTREAM, limites = {}, rutaUso = null, trazar = () => {} }) {
  if (!clave || clave.length < 20 || /\s/.test(clave)) throw new Error('Falta una clave con forma válida.');
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(String(origen ?? ''))) throw new Error('El origen de la app debe ser http://localhost:<puerto> o http://127.0.0.1:<puerto>.');
  if (upstream !== UPSTREAM && !/^http:\/\/127\.0\.0\.1:\d+(?:\/.*)?$/.test(upstream)) throw new Error('Solo se admite Groq o un doble de pruebas en 127.0.0.1.');

  const L = { ...LIMITES_LOCALES, ...limites };
  // Si el fichero de uso está dañado, esto lanza y el puente no arranca.
  const uso = libroDeUso(rutaUso);
  const cache = new Map();      // turno → {huella, promesa, expira}
  const inciertos = new Map();  // turno → expira: resultado desconocido, no se reenvía
  let pausaHasta = 0;           // hasta cuándo no se llama (429, cuota)
  let motivoPausa = null;
  let ultimosLimites = null;    // lo último que dijo Groq en sus cabeceras

  // El puerto real se conoce al escuchar (con 0, el sistema elige uno).
  let hosts = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`]);
  const origenes = origenesDe(origen);

  // A quién se contesta: el origen permitido que ha preguntado.
  function cabeceras(extra = {}, quien = origen) {
    return {
      'Access-Control-Allow-Origin': quien,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Arcanveil-Turno',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    };
  }

  function responder(res, estado, cuerpo, extra) {
    res.writeHead(estado, cabeceras(extra, res.origenPermitido));
    res.end(JSON.stringify(cuerpo));
  }

  /** Nunca se reenvía un error crudo: solo un mensaje nuestro y un código limpio. */
  function error(res, estado, mensaje, extra = {}, codigo = null) {
    responder(res, estado, { error: { message: mensaje, code: codigo && /^[a-z_]{1,40}$/.test(codigo) ? codigo : null } }, extra);
  }

  function leerCuerpo(req) {
    return new Promise((ok, no) => {
      let tam = 0;
      const trozos = [];
      const reloj = setTimeout(() => { req.destroy(); no(Object.assign(new Error('cuerpo lento'), { estado: 408 })); }, 10_000);
      req.on('data', (b) => {
        tam += b.length;
        // Lo que pasa del tope se descarta sin guardarlo; al terminar, 413.
        if (tam <= L.maxCuerpo) trozos.push(b);
      });
      req.on('end', () => {
        clearTimeout(reloj);
        if (tam > L.maxCuerpo) { no(Object.assign(new Error('demasiado grande'), { estado: 413 })); return; }
        try { ok(JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')); } catch { no(Object.assign(new Error('JSON inválido'), { estado: 400 })); }
      });
      req.on('error', (e) => { clearTimeout(reloj); no(e); });
    });
  }

  /** Solo lo que el juego necesita, con los valores que cuidan la cuota. */
  function sanear(entrada) {
    if (entrada?.model !== MODELO_PERMITIDO) return { fallo: `Modelo no permitido. Este puente solo usa ${MODELO_PERMITIDO}.` };
    const mensajes = Array.isArray(entrada.messages) ? entrada.messages : [];
    if (mensajes.length < 2 || mensajes.length > 4) return { fallo: 'Se esperan entre 2 y 4 mensajes.' };
    if (mensajes[0]?.role !== 'system') return { fallo: 'El primer mensaje debe ser la política del narrador (system).' };
    let total = 0;
    for (const m of mensajes) {
      if (!['system', 'user', 'assistant'].includes(m?.role) || typeof m.content !== 'string') return { fallo: 'Mensaje con forma inválida.' };
      total += m.content.length;
    }
    if (total > L.maxCaracteresEntrada) return { fallo: 'El contexto del turno es demasiado largo.' };
    const maxTokens = Math.min(Math.max(Number(entrada.max_tokens) || 700, 64), L.maxTokensSalida);
    return {
      cuerpo: {
        model: MODELO_PERMITIDO,
        messages: mensajes.map((m) => ({ role: m.role, content: m.content })),
        temperature: Math.min(Math.max(Number(entrada.temperature ?? 0.8), 0), 1.2),
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
        reasoning_effort: 'low',
        include_reasoning: false,
        stream: false,
      },
      // El peor caso: todo lo enviado más la salida máxima. Si Groq tenía la
      // política en caché, se sabrá al responder y se devuelve la diferencia.
      estimados: estimar(mensajes.map((m) => m.content).join('')) + maxTokens,
      caracteres: total,
    };
  }

  function leerLimites(h) {
    const n = (k) => { const v = h.get(k); return v == null ? null : Number(v); };
    ultimosLimites = {
      restantesPeticiones: n('x-ratelimit-remaining-requests'),
      limitePeticiones: n('x-ratelimit-limit-requests'),
      restantesTokens: n('x-ratelimit-remaining-tokens'),
      limiteTokens: n('x-ratelimit-limit-tokens'),
      renuevaPeticiones: h.get('x-ratelimit-reset-requests'),
      renuevaTokens: h.get('x-ratelimit-reset-tokens'),
    };
    // Sin peticiones en el día: se para hasta que Groq diga que renueva.
    if (ultimosLimites.restantesPeticiones === 0) {
      pausaHasta = Date.now() + Math.max(duracion(ultimosLimites.renuevaPeticiones), 60_000);
      motivoPausa = 'Groq indica que no quedan peticiones hoy';
    }
  }

  /** «2m59.56s», «7.66s», «1h2m» → milisegundos. */
  function duracion(texto) {
    let ms = 0;
    for (const [, n, u] of String(texto ?? '').matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[u]);
    return ms;
  }

  async function llamar(cuerpo) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), L.esperaUpstreamMs);
    try {
      const r = await fetch(`${upstream}/chat/completions`, {
        method: 'POST',
        signal: control.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
        body: JSON.stringify(cuerpo),
      });
      leerLimites(r.headers);
      const datos = await r.json().catch(() => ({}));
      return { estado: r.status, datos, retry: r.headers.get('retry-after') };
    } catch (e) {
      // No llegó (no hay conexión, no resuelve): no se gastó nada. Timeout o
      // conexión cortada a medias: Groq pudo haberla procesado.
      const codigo = e?.cause?.code ?? e?.code;
      if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(codigo)) return { estado: 502, datos: {}, retry: null, noEnviada: true };
      return { estado: e?.name === 'AbortError' ? 504 : 502, datos: {}, retry: null, incierto: true };
    } finally {
      clearTimeout(reloj);
    }
  }

  const MENSAJES = {
    400: 'Groq rechazó la forma de la petición.',
    401: 'Groq no acepta la clave: revisa que sea la de tu cuenta y que no esté revocada.',
    403: 'La cuenta no tiene acceso a este modelo.',
    404: 'El modelo no está disponible en esta cuenta.',
    413: 'El contexto del turno es demasiado largo para Groq.',
    // Solo lo usa `probar`: en un turno, el 429 se trata aparte (con su espera).
    429: 'Groq ha frenado esta cuenta: cuota o ritmo de la capa gratuita. Espera un rato; mientras, narra el narrador interno.',
    498: 'Groq no tiene capacidad ahora mismo.',
    502: 'No se pudo hablar con Groq (red).',
    503: 'Groq no está disponible ahora mismo.',
    504: 'Groq tardó demasiado en responder.',
  };

  async function completar(req, res, inicio) {
    const turno = String(req.headers['x-arcanveil-turno'] ?? '');
    if (turno && !/^[A-Za-z0-9_.:-]{1,64}$/.test(turno)) return error(res, 400, 'Identificador de turno inválido.');

    let entrada;
    try { entrada = await leerCuerpo(req); } catch (e) { return error(res, e.estado ?? 400, e.estado === 413 ? 'Petición demasiado grande.' : 'Petición ilegible.'); }

    const s = sanear(entrada);
    if (s.fallo) return error(res, 400, s.fallo, {}, 'rechazado_por_puente');

    // Un reintento del mismo turno no gasta otra solicitud.
    const huella = createHash('sha256').update(JSON.stringify(s.cuerpo.messages)).digest('hex');
    const previo = turno ? cache.get(turno) : null;
    if (previo && previo.expira > Date.now()) {
      if (previo.huella !== huella) return error(res, 409, 'Ese turno ya se pidió con otro contenido.');
      const r = await previo.promesa;
      trazar({ ruta: 'completar', estado: r.estado, repetido: true, ms: Date.now() - inicio, turno: resumir(turno) });
      return responder(res, r.estado, r.cuerpo, r.extra);
    }

    // Un turno cuyo resultado no se conoce no se reenvía: Groq pudo haberlo
    // procesado y cobrado.
    if (turno && (inciertos.get(turno) ?? 0) > Date.now()) {
      trazar({ ruta: 'completar', estado: 409, local: true, motivo: 'resultado incierto', turno: resumir(turno) });
      return error(res, 409, 'Ese turno tuvo un resultado incierto (Groq pudo procesarlo). No se reenvía: sigue con el narrador procedural.', {}, 'resultado_incierto');
    }

    const ahora = Date.now();
    if (pausaHasta > ahora) {
      const espera = Math.ceil((pausaHasta - ahora) / 1000);
      trazar({ ruta: 'completar', estado: 429, local: true, motivo: motivoPausa, turno: resumir(turno) });
      return error(res, 429, `Pausa: ${motivoPausa ?? 'límite de la capa gratuita'}.`, { 'Retry-After': String(espera) }, espera > 120 ? 'cuota_diaria' : 'cuota_minuto');
    }

    const hueco = uso.reservar(s.estimados, L);
    if (!hueco.ok) {
      trazar({ ruta: 'completar', estado: hueco.estado, local: true, motivo: hueco.motivo, turno: resumir(turno) });
      if (hueco.estado === 503) return error(res, 503, hueco.motivo, {}, 'uso_no_persistido');
      return error(res, 429, `Pausa: ${hueco.motivo}.`, { 'Retry-After': String(hueco.espera ?? 3600) }, hueco.dia ? 'cuota_diaria' : 'cuota_minuto');
    }

    const promesa = (async () => {
      const r = await llamar(s.cuerpo);
      const cacheados = Number(r.datos?.usage?.prompt_tokens_details?.cached_tokens) || 0;
      if (r.estado === 200) {
        // Lo que Groq dice que contó; si no lo dice, se queda la reserva.
        const total = Number(r.datos?.usage?.total_tokens);
        uso.ajustar(hueco.reserva, { tokens: Number.isFinite(total) ? Math.max(total - cacheados, 0) : s.estimados });
      } else if (r.noEnviada) {
        uso.ajustar(hueco.reserva, { tokens: 0, noEnviada: true });
      } else if ([400, 401, 403, 404, 413, 415, 422].includes(r.estado)) {
        // Rechazada antes de generar: la petición cuenta, los tokens no.
        uso.ajustar(hueco.reserva, { tokens: 0 });
      }
      // 429, 5xx, timeout o corte: se queda la reserva entera (el peor caso).
      if (r.incierto && turno) inciertos.set(turno, Date.now() + 10 * 60_000);
      if (r.datos?.usage) r.datos.usage.cacheados = cacheados;

      if (r.estado === 200) {
        const contenido = r.datos?.choices?.[0]?.message?.content ?? '';
        return {
          estado: 200,
          cuerpo: {
            object: 'chat.completion',
            model: MODELO_PERMITIDO,
            choices: [{ index: 0, message: { role: 'assistant', content: String(contenido) }, finish_reason: r.datos?.choices?.[0]?.finish_reason ?? null }],
            usage: {
              prompt_tokens: Number(r.datos?.usage?.prompt_tokens) || null,
              completion_tokens: Number(r.datos?.usage?.completion_tokens) || null,
              total_tokens: Number(r.datos?.usage?.total_tokens) || null,
              cached_tokens: cacheados,
            },
            limites: ultimosLimites,
          },
          extra: {},
          usage: r.datos?.usage,
        };
      }

      if (r.estado === 429) {
        // Sin Retry-After, o uno que no se entiende, se esperan 60 s: nunca
        // un reintento apresurado. Y nadie más llama hasta entonces.
        const leida = Number(r.retry);
        const espera = Number.isFinite(leida) && leida > 0 ? Math.ceil(leida) : 60;
        pausaHasta = Math.max(pausaHasta, Date.now() + espera * 1000);
        motivoPausa = espera > 120 ? 'Groq indica que se ha agotado la cuota' : 'Groq pide esperar';
        return { estado: 429, cuerpo: { error: { message: 'Groq pide esperar: límite de la capa gratuita.', code: espera > 120 ? 'cuota_diaria' : 'cuota_minuto' } }, extra: { 'Retry-After': String(espera) } };
      }

      const codigo = r.incierto ? 'resultado_incierto' : (typeof r.datos?.error?.code === 'string' ? r.datos.error.code : null);
      const mensaje = r.incierto ? `${MENSAJES[r.estado]} No se sabe si Groq llegó a procesarla: se cuenta como gastada.` : (MENSAJES[r.estado] ?? `Groq respondió con un error ${r.estado}.`);
      return { estado: r.estado, cuerpo: { error: { message: mensaje, code: codigo && /^[a-z_]{1,40}$/.test(codigo) ? codigo : null } }, extra: {} };
    })();

    if (turno) cache.set(turno, { huella, promesa, expira: Date.now() + 10 * 60_000 });
    for (const [k, v] of cache) if (v.expira < Date.now()) cache.delete(k);

    const r = await promesa;
    // Solo se recuerda lo que salió bien: tras un 429 o un fallo, el
    // reintento tiene que poder volver a pedir.
    if (turno && r.estado !== 200) cache.delete(turno);
    trazar({
      ruta: 'completar',
      estado: r.estado,
      ms: Date.now() - inicio,
      turno: resumir(turno),
      entradaCaracteres: s.caracteres,
      tokens: r.usage ? { entrada: r.usage.prompt_tokens, cacheados: r.usage.cacheados ?? 0, salida: r.usage.completion_tokens, total: r.usage.total_tokens } : null,
      restantes: ultimosLimites ? { peticiones: ultimosLimites.restantesPeticiones, tokens: ultimosLimites.restantesTokens } : null,
    });
    return responder(res, r.estado, r.cuerpo, r.extra);
  }

  /** Probar la conexión sin generar nada: se pide la lista de modelos. */
  async function probar(res, inicio) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 15_000);
    try {
      const r = await fetch(`${upstream}/models`, { signal: control.signal, headers: { Authorization: `Bearer ${clave}` } });
      const datos = await r.json().catch(() => ({}));
      trazar({ ruta: 'probar', estado: r.status, ms: Date.now() - inicio });
      if (!r.ok) return responder(res, r.status, { servicio: SERVICIO, error: { message: MENSAJES[r.status] ?? `Groq respondió con un error ${r.status}.`, code: null } });
      const hay = (datos?.data ?? []).some((m) => m?.id === MODELO_PERMITIDO);
      return responder(res, 200, { ok: hay, servicio: SERVICIO, modelo: MODELO_PERMITIDO, disponible: hay, generacion: false });
    } catch {
      return responder(res, 502, { servicio: SERVICIO, error: { message: MENSAJES[502], code: null } });
    } finally {
      clearTimeout(reloj);
    }
  }

  function estado() {
    const d = uso.get();
    return {
      // Quién es: la app no confía en una dirección cualquiera que conteste.
      servicio: SERVICIO,
      modelo: MODELO_PERMITIDO,
      limitesLocales: { porMinuto: L.porMinuto, porDia: L.porDia, tokensMinuto: L.tokensMinuto, tokensDia: L.tokensDia },
      usoHoy: { dia: d.dia, peticiones: d.peticiones, tokens: d.tokens },
      pausa: pausaHasta > Date.now() ? { hasta: new Date(pausaHasta).toISOString(), motivo: motivoPausa } : null,
      persistencia: uso.roto ? { ok: false, motivo: uso.roto } : { ok: true },
      groq: ultimosLimites,
    };
  }

  const servidor = createServer(async (req, res) => {
    const inicio = Date.now();
    // El Host lo fija el navegador: una web ajena con un DNS que apunte aquí
    // llegaría con su propio nombre y se queda fuera.
    if (!hosts.has(String(req.headers.host ?? ''))) { trazar({ ruta: 'rechazo', motivo: 'host' }); return error(res, 421, 'Host no permitido.'); }
    const origenPeticion = req.headers.origin;
    if (!origenes.has(origenPeticion)) { trazar({ ruta: 'rechazo', motivo: 'origen' }); return error(res, 403, 'Origen no permitido.'); }
    res.origenPermitido = origenPeticion;

    const ruta = String(req.url ?? '').split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204, cabeceras({}, origenPeticion)); return res.end(); }
    if (req.method === 'GET' && ruta === '/estado') return responder(res, 200, estado());
    if (req.method === 'GET' && ruta === '/probar') return probar(res, inicio);
    if (req.method === 'POST' && ruta === '/v1/chat/completions') {
      if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return error(res, 415, 'Se espera JSON.');
      return completar(req, res, inicio);
    }
    return error(res, 404, 'Ruta no encontrada.');
  });
  servidor.headersTimeout = 15_000;
  servidor.requestTimeout = 60_000;

  return {
    servidor,
    estado,
    escuchar: () => new Promise((ok, no) => {
      servidor.once('error', no);
      servidor.listen(puerto, '127.0.0.1', () => {
        const real = servidor.address().port;
        hosts = new Set([`127.0.0.1:${real}`, `localhost:${real}`]);
        ok(real);
      });
    }),
    cerrar: () => new Promise((ok) => servidor.close(() => ok())),
  };
}

/** El identificador de turno, recortado a una huella que no dice nada. */
function resumir(turno) {
  return turno ? createHash('sha256').update(turno).digest('hex').slice(0, 8) : null;
}

/** Dónde guarda el puente sus cuentas y trazas: fuera del repositorio. */
export function carpetaDatos() {
  const base = process.env.LOCALAPPDATA || join(homedir(), '.local', 'share');
  return join(base, 'arcanveil');
}

/** Escribe una traza en consola y en el fichero de trazas. Sin contenido. */
export function trazadorArchivo(ruta) {
  return (t) => {
    const linea = JSON.stringify({ t: new Date().toISOString(), ...t });
    console.log(`[groq] ${linea}`);
    if (!ruta) return;
    try { mkdirSync(dirname(ruta), { recursive: true }); appendFileSync(ruta, `${linea}\n`); } catch { /* sin disco: solo consola */ }
  };
}
