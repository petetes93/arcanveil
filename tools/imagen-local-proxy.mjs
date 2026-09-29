#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/imagen-local-proxy.mjs
 * ---------------------------------------------------------------------------
 * Puente de IMÁGENES: la app pide una candidata de retrato y el puente la
 * genera con el proveedor configurado. La app nunca habla con el proveedor ni
 * conoce ninguna clave.
 *
 * ── Qué cambió y por qué ─────────────────────────────────────────────────
 *
 *   · Puerto propio, 11437. Compartía el 11436 con el puente de Groq: con uno
 *     levantado, el otro no arrancaba, y la app podía hablar con el servicio
 *     equivocado y tomar su respuesta por la de su puente.
 *   · Identidad comprobable: `GET /estado` dice `arcanveil-puente-imagen/1`.
 *   · Solo el origen exacto de la app y solo los `Host` de loopback. Antes
 *     respondía `Access-Control-Allow-Origin: *` y aceptaba un POST de
 *     cualquier web. CORS no es autenticación: el rechazo es aquí, ANTES de
 *     generar nada.
 *   · Topes: cuerpo pequeño, una generación a la vez (y dos en cola), por
 *     minuto y por día, tiempo máximo, tamaño máximo de la imagen devuelta,
 *     y si la app se va, se cancela la generación.
 *   · Lo que se envía al proveedor es solo la apariencia (≤ 300 caracteres),
 *     el linaje o el tipo de criatura. Nunca historia, secretos ni partidas.
 *   · Candidatas: se guardan en una caché TEMPORAL del puente, en este PC
 *     (%LOCALAPPDATA%\arcanveil\imagenes), para que volver a pedir la misma
 *     versión no la pinte otra vez. Cada archivo lleva el dueño en el nombre:
 *     cerrar el estudio las olvida (`POST /v1/olvidar {clave}`), caducan a
 *     las 24 h, no pasan de 40, «Borrar partidas» las borra todas y
 *     `node tools/imagen-local-proxy.mjs --limpiar` vacía la carpeta.
 *     Ninguna se publica sola: la app las enseña para aprobar, y solo la
 *     elegida pasa al navegador (src/art/galeria.js).
 *   · ComfyUI deja sus imágenes en su carpeta temporal (nodo PreviewImage),
 *     no en `output/`; esa carpeta la vacía ComfyUI al cerrarse.
 *
 * ── Proveedores ──────────────────────────────────────────────────────────
 *
 *   · `comfyui` (por defecto): ComfyUI en este PC. Sin cuenta ni cuota.
 *   · `cloudflare`: Workers AI, `@cf/black-forest-labs/flux-1-schnell`.
 *     PREPARADO, NO ACTIVADO. Solo arranca con ARCANVEIL_IMAGE_PROVIDER=
 *     cloudflare y la cuenta y el token en el entorno de ESTE proceso, que
 *     nunca pasan a la app. La capa Free publica 10.000 neurons/día y corta
 *     al agotarlos; no garantiza cuántas imágenes caben.
 *
 * Uso:
 *   node tools/imagen-local-proxy.mjs
 *   ARCANVEIL_ORIGIN=http://localhost:8080  (origen exacto de la app)
 *   ARCANVEIL_IMAGE_PORT=11437               COMFY_URL=http://127.0.0.1:8188
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SERVICIO_IMAGEN = 'arcanveil-puente-imagen/1';
export const PUERTO_IMAGEN = 11437;
/** Sube si cambia el estilo: invalida la caché de candidatas. */
export const VERSION_ESTILO = 'pintura-oscura-1';

export const LIMITES_IMAGEN = Object.freeze({
  maxCuerpo: 8 * 1024,
  maxDescripcion: 300,
  enCurso: 1,
  enCola: 2,
  porMinuto: 6,
  porDia: 60,
  esperaMs: 5 * 60_000,
  maxImagen: 12 * 1024 * 1024,
  /** Candidatas en caché: cuánto duran y cuántas como mucho. */
  cacheHoras: 24,
  cacheMax: 40,
});

/** Proveedores que no sacan nada del PC. Cualquier otro envía el encargo fuera. */
const LOCALES = new Set(['comfyui', 'falso']);

/** El dueño de una candidata, apto para nombre de archivo. */
const prefijoDe = (clave) => `${String(clave).replace(/[^\w.-]/g, '_')}__`;

/* ═══════════════════════════════════════════════════════════════════════════
   EL ENCARGO
   ═══════════════════════════════════════════════════════════════════════════ */

const LINAJE = Object.freeze({
  albar: 'high elf, long pointed ears, moon-pale skin',
  brumal: 'fey elf, pale translucent skin, drifting hair',
  ferrano: 'broad forge dwarf, angular weathered face',
  menudo: 'small wiry wanderer, sharp expressive face',
  griscuerno: 'very tall horned warrior, grey-blue skin, curved horns',
  sombracorteza: 'tall gaunt forest folk, bark-veined grey-brown skin',
  crisol: 'arcane mineral-born adventurer, faint crystalline skin',
  valdes: 'human adventurer, olive to bronze skin',
});

/**
 * El estilo de la referencia de Alejandro: pintura digital fantástica,
 * oscura y detallada, anatomía creíble, luz de cine, fondo con atmósfera.
 */
const ESTILO = 'dark fantasy digital painting, detailed, believable anatomy, cinematic lighting, atmospheric background, painterly brushwork, muted palette';
const NEGATIVO = 'anime, cartoon, chibi, pixel art, vector, flat colors, cel shading, line art, text, watermark, logo, frame, extra limbs, malformed face';

/**
 * El texto que se manda al proveedor. Solo lo visible: tipo, linaje,
 * apariencia recortada. Lo que no cabe se corta, no se resume con IA.
 */
export function encargo({ tipo, linaje, descripcion, rol }) {
  // Sin linaje, la app ya manda el sujeto entero (ver src/art/rasgos.js): no
  // se le antepone uno por defecto que lo contradiga.
  const de = linaje && LINAJE[linaje] ? ` of ${LINAJE[linaje]}` : '';
  const quien = tipo === 'enemigo'
    ? 'creature or enemy portrait'
    : `bust portrait${de}${rol ? `, ${rol}` : ''}`;
  return `${quien}, ${descripcion}, ${ESTILO}`;
}

/** Validación de lo que llega de la app. */
export function validarPeticion(p, L = LIMITES_IMAGEN) {
  if (!p || typeof p !== 'object') return 'Petición vacía.';
  if (!['personaje', 'pnj', 'enemigo'].includes(p.tipo)) return 'Tipo desconocido.';
  if (typeof p.clave !== 'string' || !/^[\w:.-]{1,80}$/u.test(p.clave)) return 'Clave inválida.';
  const d = typeof p.descripcion === 'string' ? p.descripcion.trim() : '';
  if (d.length < 8) return 'Falta la apariencia.';
  if (d.length > L.maxDescripcion) return 'La apariencia es demasiado larga.';
  if (p.variante != null && !(Number.isInteger(p.variante) && p.variante >= 0 && p.variante < 1000)) return 'Variante inválida.';
  if (p.linaje != null && !(typeof p.linaje === 'string' && /^[a-z]{2,20}$/.test(p.linaje))) return 'Linaje inválido.';
  if (p.rol != null && !(typeof p.rol === 'string' && p.rol.length <= 40)) return 'Rol inválido.';
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROVEEDORES
   ═══════════════════════════════════════════════════════════════════════════ */

/** ComfyUI local: encola el grafo, espera la imagen y la trae. */
export function proveedorComfy({ url = 'http://127.0.0.1:8188', modelo = 'sd_xl_base_1.0.safetensors', ancho = 768, alto = 960, pasos = 28, cfg = 6.5, sampler = 'dpmpp_2m', scheduler = 'karras' } = {}) {
  const pedir = async (ruta, init = {}) => {
    const r = await fetch(`${url}${ruta}`, init);
    if (!r.ok) throw Object.assign(new Error(`ComfyUI respondió ${r.status}`), { codigo: 'proveedor' });
    return r;
  };
  return {
    id: 'comfyui',
    async salud(signal) {
      try { await pedir('/system_stats', { signal }); return { disponible: true, modelo }; } catch { return { disponible: false, motivo: `ComfyUI no contesta en ${url}` }; }
    },
    async generar({ texto, semilla }, signal) {
      const grafo = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: modelo } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: texto, clip: ['1', 1] } },
        3: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVO, clip: ['1', 1] } },
        4: { class_type: 'EmptyLatentImage', inputs: { width: ancho, height: alto, batch_size: 1 } },
        5: { class_type: 'KSampler', inputs: { seed: semilla, steps: pasos, cfg, sampler_name: sampler, scheduler, denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
        6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
        // PreviewImage: a la carpeta temporal de ComfyUI, que se vacía al
        // cerrarlo. Con SaveImage cada candidata se quedaba en output/.
        7: { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
      };
      const cola = await (await pedir('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: grafo }), signal })).json();
      for (;;) {
        await new Promise((ok, no) => { const t = setTimeout(ok, 900); signal?.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('cancelada'), { codigo: 'cancelada' })); }, { once: true }); });
        const hist = await (await pedir(`/history/${cola.prompt_id}`, { signal })).json();
        const img = hist?.[cola.prompt_id]?.outputs?.['7']?.images?.[0];
        if (!img) continue;
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        const r = await pedir(`/view?${q}`, { signal });
        return { bytes: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'image/png' };
      }
    },
  };
}

/**
 * Cloudflare Workers AI (FLUX.1 schnell). PREPARADO, NO ACTIVADO: exige
 * cuenta y token en el entorno del puente. `base` solo cambia en las pruebas
 * (un doble en 127.0.0.1).
 */
export function proveedorCloudflare({ cuenta, token, base = 'https://api.cloudflare.com' } = {}) {
  const listo = Boolean(cuenta && token);
  if (base !== 'https://api.cloudflare.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Solo Cloudflare o un doble en 127.0.0.1.');
  return {
    id: 'cloudflare',
    async salud() { return listo ? { disponible: true, modelo: '@cf/black-forest-labs/flux-1-schnell' } : { disponible: false, motivo: 'Cloudflare no configurado (falta cuenta o token en el entorno del puente)' }; },
    async generar({ texto, semilla }, signal) {
      if (!listo) throw Object.assign(new Error('Cloudflare no configurado'), { codigo: 'sin_clave' });
      const r = await fetch(`${base}/client/v4/accounts/${encodeURIComponent(cuenta)}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: texto, steps: 4, seed: semilla }),
        signal,
      });
      if (r.status === 429) throw Object.assign(new Error('Cuota agotada o límite'), { codigo: 'limite' });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Credenciales rechazadas'), { codigo: 'sin_clave' });
      if (!r.ok) throw Object.assign(new Error(`Cloudflare respondió ${r.status}`), { codigo: 'proveedor' });
      const datos = await r.json();
      const b64 = datos?.result?.image;
      if (typeof b64 !== 'string') throw Object.assign(new Error('Respuesta sin imagen'), { codigo: 'proveedor' });
      return { bytes: Buffer.from(b64, 'base64'), tipo: 'image/jpeg' };
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL PUENTE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Dónde guarda el puente sus candidatas: fuera del repositorio. */
export function carpetaImagenes() {
  const base = process.env.LOCALAPPDATA || join(homedir(), '.local', 'share');
  return join(base, 'arcanveil', 'imagenes');
}

/**
 * @param {Object} op
 * @param {string} op.origen Origen exacto de la app (http://localhost:8080).
 * @param {Object} op.proveedor Uno de los de arriba (o un doble).
 * @param {number} [op.puerto]
 * @param {string|null} [op.cache] Carpeta de caché; null sin caché.
 * @param {Object} [op.limites]
 */
export function crearProxyImagen({ origen, proveedor, puerto = PUERTO_IMAGEN, cache = carpetaImagenes(), limites = {}, trazar = () => {} }) {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(String(origen ?? ''))) throw new Error('El origen de la app debe ser http://localhost:<puerto> o http://127.0.0.1:<puerto>.');
  if (!proveedor?.generar) throw new Error('Falta un proveedor de imagen.');
  const L = { ...LIMITES_IMAGEN, ...limites };
  let hosts = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`]);
  let enCurso = 0;
  const cola = [];
  const minuto = [];
  const dia = { fecha: new Date().toISOString().slice(0, 10), n: 0 };
  const pendientes = new Map(); // huella → promesa, para no generar dos veces lo mismo
  // La app por sus dos nombres de bucle local (mismo puerto): abrir el juego
  // en 127.0.0.1:8080 en vez de localhost:8080 no es otra web.
  const gemelo = origen.includes('//localhost') ? origen.replace('//localhost', '//127.0.0.1') : origen.replace('//127.0.0.1', '//localhost');
  const origenes = new Set([origen, gemelo]);

  /**
   * Candidatas en disco: caducadas fuera, y si aun así sobran, las más
   * viejas. Lo que falle al borrar se deja (se intentará en la siguiente).
   */
  async function podar() {
    if (!cache) return;
    let nombres;
    try { nombres = (await readdir(cache)).filter((n) => n.endsWith('.img')); } catch { return; }
    const ahora = Date.now();
    const vivas = [];
    for (const n of nombres) {
      const ruta = join(cache, n);
      try {
        const { mtimeMs } = await stat(ruta);
        if (ahora - mtimeMs > L.cacheHoras * 3600_000) await unlink(ruta);
        else vivas.push({ ruta, mtimeMs });
      } catch { /* ya no está */ }
    }
    vivas.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const { ruta } of vivas.slice(0, Math.max(0, vivas.length - L.cacheMax))) await unlink(ruta).catch(() => {});
  }

  /** Olvida las candidatas de un dueño, o todas. @returns {Promise<number>} */
  async function olvidar({ clave, todas }) {
    if (!cache) return 0;
    let nombres;
    try { nombres = await readdir(cache); } catch { return 0; }
    const prefijo = todas ? null : prefijoDe(clave);
    let n = 0;
    for (const nombre of nombres) {
      if (!nombre.endsWith('.img') || (prefijo && !nombre.startsWith(prefijo))) continue;
      try { await unlink(join(cache, nombre)); n += 1; } catch { /* sigue con las demás */ }
    }
    return n;
  }
  podar();

  const cabeceras = (extra = {}, quien = origen) => ({
    'Access-Control-Allow-Origin': quien,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-Arcanveil-Servicio, X-Arcanveil-Proveedor',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Arcanveil-Servicio': SERVICIO_IMAGEN,
    ...extra,
  });
  const json = (res, estado, cuerpo) => { res.writeHead(estado, cabeceras({ 'Content-Type': 'application/json; charset=utf-8' }, res.origenPermitido)); res.end(JSON.stringify(cuerpo)); };
  const fallo = (res, estado, codigo, mensaje) => json(res, estado, { error: { code: codigo, message: mensaje } });
  /** Rechazo de origen o Host: sin ninguna cabecera CORS. */
  const rechazo = (res, estado, codigo, mensaje) => {
    res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ error: { code: codigo, message: mensaje } }));
  };

  function leer(req) {
    return new Promise((ok, no) => {
      let tam = 0;
      const trozos = [];
      const reloj = setTimeout(() => { req.destroy(); no(Object.assign(new Error('cuerpo lento'), { estado: 408 })); }, 10_000);
      req.on('data', (b) => { tam += b.length; if (tam <= L.maxCuerpo) trozos.push(b); });
      req.on('end', () => {
        clearTimeout(reloj);
        if (tam > L.maxCuerpo) return no(Object.assign(new Error('demasiado grande'), { estado: 413, codigo: 'demasiado_grande' }));
        try { ok(JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')); } catch { no(Object.assign(new Error('JSON inválido'), { estado: 400, codigo: 'json' })); }
      });
      req.on('error', (e) => { clearTimeout(reloj); no(e); });
    });
  }

  /** Cupo por minuto y por día. Se cuenta al empezar a generar. */
  function cupo() {
    const hoy = new Date().toISOString().slice(0, 10);
    if (dia.fecha !== hoy) { dia.fecha = hoy; dia.n = 0; }
    const ahora = Date.now();
    while (minuto.length && ahora - minuto[0] > 60_000) minuto.shift();
    if (dia.n >= L.porDia) return 'Tope diario de imágenes del puente alcanzado.';
    if (minuto.length >= L.porMinuto) return 'Demasiadas imágenes en un minuto: espera un poco.';
    return null;
  }

  async function turno(signal) {
    if (enCurso < L.enCurso) { enCurso += 1; return; }
    if (cola.length >= L.enCola) throw Object.assign(new Error('Hay otras imágenes generándose.'), { estado: 429, codigo: 'ocupado' });
    await new Promise((ok, no) => {
      const item = { ok, no };
      cola.push(item);
      signal.addEventListener('abort', () => { const i = cola.indexOf(item); if (i >= 0) cola.splice(i, 1); no(Object.assign(new Error('cancelada'), { codigo: 'cancelada' })); }, { once: true });
    });
    enCurso += 1;
  }
  function liberar() {
    enCurso -= 1;
    cola.shift()?.ok();
  }

  async function candidata(req, res) {
    let p;
    try { p = await leer(req); } catch (e) { return fallo(res, e.estado ?? 400, e.codigo ?? 'peticion', e.message); }
    const invalida = validarPeticion(p, L);
    if (invalida) return fallo(res, 400, 'peticion', invalida);

    const texto = encargo(p);
    const huella = createHash('sha256').update(JSON.stringify([proveedor.id, VERSION_ESTILO, p.tipo, p.clave, p.linaje ?? '', p.rol ?? '', p.descripcion.trim(), p.variante ?? 0])).digest('hex');
    const archivo = cache ? join(cache, `${prefijoDe(p.clave)}${huella}.img`) : null;

    // Lo ya generado se devuelve sin gastar cupo.
    if (archivo && existsSync(archivo)) {
      const bytes = await readFile(archivo);
      res.writeHead(200, cabeceras({ 'Content-Type': bytes[0] === 0xff ? 'image/jpeg' : 'image/png', 'X-Arcanveil-Proveedor': proveedor.id }, res.origenPermitido));
      return res.end(bytes);
    }

    const ctrl = new AbortController();
    // Si la app se va, se cancela: no se gasta en una imagen que nadie verá.
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    // El tiempo cuenta desde que empieza a generar, no desde que espera turno.
    let reloj = null;
    let ocupado = false;
    try {
      let promesa = pendientes.get(huella);
      if (!promesa) {
        const sin = cupo();
        if (sin) return fallo(res, 429, 'limite', sin);
        await turno(ctrl.signal);
        ocupado = true;
        reloj = setTimeout(() => ctrl.abort(), L.esperaMs);
        minuto.push(Date.now());
        dia.n += 1;
        const semilla = parseInt(huella.slice(0, 12), 16) % 2147483647;
        promesa = proveedor.generar({ texto, semilla }, ctrl.signal);
        pendientes.set(huella, promesa);
      }
      const { bytes, tipo } = await promesa;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw Object.assign(new Error('El proveedor no devolvió imagen.'), { codigo: 'proveedor' });
      if (bytes.length > L.maxImagen) throw Object.assign(new Error('Imagen demasiado grande.'), { codigo: 'proveedor' });
      if (!/^image\/(?:png|jpeg|webp)$/.test(tipo)) throw Object.assign(new Error('El proveedor no devolvió una imagen.'), { codigo: 'proveedor' });
      if (archivo) { await mkdir(cache, { recursive: true }); await writeFile(archivo, bytes); await podar(); }
      trazar({ ruta: 'candidata', tipo: p.tipo, proveedor: proveedor.id, bytes: bytes.length });
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, cabeceras({ 'Content-Type': tipo, 'X-Arcanveil-Proveedor': proveedor.id }, res.origenPermitido));
      res.end(bytes);
    } catch (e) {
      if (res.destroyed) return;
      const codigo = ctrl.signal.aborted && !res.destroyed ? 'tiempo' : (e.codigo ?? 'proveedor');
      const estado = e.estado ?? ({ limite: 429, ocupado: 429, sin_clave: 503, tiempo: 504, cancelada: 499 }[codigo] ?? 502);
      trazar({ ruta: 'candidata', error: codigo });
      fallo(res, estado, codigo, codigo === 'tiempo' ? 'La generación tardó demasiado.' : e.message);
    } finally {
      clearTimeout(reloj);
      pendientes.delete(huella);
      if (ocupado) liberar();
    }
  }

  const servidor = createServer(async (req, res) => {
    if (!hosts.has(String(req.headers.host ?? ''))) return rechazo(res, 421, 'host', 'Host no permitido.');
    const ruta = String(req.url ?? '').split('?')[0];
    const o = req.headers.origin;
    // Estado sin Origin: la comprobación desde la terminal. Todo lo demás
    // exige el origen exacto de la app, y se comprueba ANTES de generar.
    if (!(req.method === 'GET' && ruta === '/estado' && o === undefined) && !origenes.has(o)) return rechazo(res, 403, 'origen', 'Origen no permitido.');
    if (o) res.origenPermitido = o;
    if (req.method === 'OPTIONS') { res.writeHead(204, cabeceras({}, o)); return res.end(); }
    if (req.method === 'GET' && ruta === '/estado') {
      const salud = await proveedor.salud?.().catch(() => ({ disponible: false, motivo: 'sin respuesta' })) ?? { disponible: true };
      return json(res, 200, {
        servicio: SERVICIO_IMAGEN, proveedor: proveedor.id, estilo: VERSION_ESTILO, ...salud, usoHoy: dia.n,
        limites: { porDia: L.porDia, porMinuto: L.porMinuto },
        // Qué pasa con lo que se pide: la app lo dice ANTES de pintar.
        envia: LOCALES.has(proveedor.id) ? 'local' : 'nube',
        cache: { horas: L.cacheHoras, maximo: L.cacheMax },
      });
    }
    if (req.method === 'POST' && ruta === '/v1/olvidar') {
      if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return fallo(res, 415, 'tipo', 'Se espera JSON.');
      let p;
      try { p = await leer(req); } catch (e) { return fallo(res, e.estado ?? 400, e.codigo ?? 'peticion', e.message); }
      const todas = p?.todas === true;
      if (!todas && !(typeof p?.clave === 'string' && /^[\w:.-]{1,80}$/u.test(p.clave))) return fallo(res, 400, 'peticion', 'Falta la clave, o «todas».');
      const borradas = await olvidar({ clave: p.clave, todas });
      trazar({ ruta: 'olvidar', todas, borradas });
      return json(res, 200, { servicio: SERVICIO_IMAGEN, borradas });
    }
    if (req.method === 'POST' && ruta === '/v1/candidata') {
      if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return fallo(res, 415, 'tipo', 'Se espera JSON.');
      return candidata(req, res);
    }
    return fallo(res, 404, 'ruta', 'Ruta no encontrada.');
  });
  servidor.headersTimeout = 15_000;

  return {
    servidor,
    escuchar: () => new Promise((ok, no) => {
      servidor.once('error', no);
      servidor.listen(puerto, '127.0.0.1', () => {
        const real = servidor.address().port;
        hosts = new Set([`127.0.0.1:${real}`, `localhost:${real}`]);
        ok(real);
      });
    }),
    cerrar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LÍNEA DE ÓRDENES
   ═══════════════════════════════════════════════════════════════════════════ */

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--limpiar')) {
  // Vaciar la caché de candidatas desde este PC, sin levantar nada en red.
  const carpeta = carpetaImagenes();
  let n = 0;
  for (const nombre of await readdir(carpeta).catch(() => [])) {
    if (!nombre.endsWith('.img')) continue;
    try { await unlink(join(carpeta, nombre)); n += 1; } catch (e) { console.error(`No se pudo borrar ${nombre}: ${e.code}`); }
  }
  console.log(`Candidatas borradas: ${n} (${carpeta}).`);
  console.log('Las imágenes elegidas viven en el navegador y se borran con «Borrar partidas y personajes».');
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const puerto = Number(process.env.ARCANVEIL_IMAGE_PORT) || PUERTO_IMAGEN;
  const origen = process.env.ARCANVEIL_ORIGIN || 'http://localhost:8080';
  const configRuta = join(process.cwd(), '.arcanveil-image-config.json');
  const config = existsSync(configRuta) ? JSON.parse(await readFile(configRuta, 'utf8')) : {};
  const elegido = process.env.ARCANVEIL_IMAGE_PROVIDER || 'comfyui';
  const proveedor = elegido === 'cloudflare'
    ? proveedorCloudflare({ cuenta: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN })
    // FLUX.1 schnell (perfil de `configurar-imagen-local.ps1`) pide cfg 1 y
    // pocos pasos; SDXL, lo de siempre. La configuración local manda.
    : proveedorComfy({
      url: process.env.COMFY_URL || 'http://127.0.0.1:8188',
      modelo: process.env.ARCANVEIL_IMAGE_MODEL || config.model,
      ancho: Number(config.width) || 768,
      alto: Number(config.height) || 960,
      pasos: Number(config.steps) || (config.architecture === 'flux' ? 4 : 28),
      cfg: Number(config.cfg) || (config.architecture === 'flux' ? 1 : 6.5),
      sampler: config.sampler || (config.architecture === 'flux' ? 'euler' : 'dpmpp_2m'),
      scheduler: config.scheduler || (config.architecture === 'flux' ? 'simple' : 'karras'),
    });
  const proxy = crearProxyImagen({ origen, proveedor, puerto, trazar: (t) => console.log(`[imagen] ${JSON.stringify(t)}`) });
  try {
    const real = await proxy.escuchar();
    const salud = await proveedor.salud();
    console.log(`ARCANVEIL puente de imagen: http://127.0.0.1:${real} (${SERVICIO_IMAGEN}) · proveedor ${proveedor.id} · app ${origen}`);
    console.log(salud.disponible ? `  proveedor listo${salud.modelo ? `: ${salud.modelo}` : ''}` : `  ⚠ proveedor no disponible: ${salud.motivo}`);
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `El puerto ${puerto} está ocupado por otro programa. Ciérralo o usa ARCANVEIL_IMAGE_PORT.` : e.message);
    process.exit(1);
  }
}
