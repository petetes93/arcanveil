/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · art/galeria.js
 * ---------------------------------------------------------------------------
 * Las imágenes que el jugador ha aprobado, guardadas en su navegador.
 *
 * Una imagen solo entra aquí cuando el jugador pulsa «Usar esta versión»:
 * lo que genera el puente local es una candidata privada hasta entonces
 * (ver `candidata.js`). Aquí se guarda el archivo entero (Blob en IndexedDB),
 * no una dirección: un `blob:` muere al recargar, y una URL de un servicio
 * de fuera deja de funcionar sin red o cuando el servicio cambia.
 *
 * Claves estables, una por identidad:
 *   · `pj:<id>`       el personaje del jugador
 *   · `pnj:<refId>`   un personaje con nombre (compañero, vecino)
 *   · `enemigo:<refId>` un tipo de enemigo: todos los saqueadores comparten
 * y cada una con la versión de estilo con que se pintó: si el estilo cambia,
 * lo aprobado sigue siendo lo que el jugador eligió hasta que pida otra.
 *
 * La interfaz pinta en síncrono, así que al abrir se cargan todas en memoria
 * como URLs de objeto (vivas mientras dure la página). Sin IndexedDB
 * (modo privado estricto, Node) funciona igual en memoria, sin persistir.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const BASE = 'arcanveil-imagenes';
const ALMACEN = 'aprobadas';

/** Tamaño máximo de una imagen aprobada: lo que devuelve el puente, con margen. */
export const TAM_MAX_APROBADA = 12 * 1024 * 1024;

/** Solo mapas de bits, como los que da el puente: un SVG puede llevar de todo. */
const MAPA_DE_BITS = /^image\/(?:png|jpeg|webp)$/;

/** clave → { url, estilo, tipo, nombre, creada } */
const enMemoria = new Map();
const oyentes = new Set();
let abierta = null;

/**
 * La clave estable de alguien.
 * @param {{tipo: 'personaje'|'pnj'|'enemigo', id?: string, refId?: string}} quien
 * @returns {string|null}
 */
export function claveDe(quien = {}) {
  const limpio = (v) => String(v ?? '').replace(/[^\w.-]/g, '').slice(0, 60);
  if (quien.tipo === 'personaje' && limpio(quien.id)) return `pj:${limpio(quien.id)}`;
  if (quien.tipo === 'pnj' && limpio(quien.refId)) return `pnj:${limpio(quien.refId)}`;
  if (quien.tipo === 'enemigo' && limpio(quien.refId)) return `enemigo:${limpio(quien.refId)}`;
  return null;
}

function idb() {
  return typeof indexedDB !== 'undefined' ? indexedDB : null;
}

function abrirBase() {
  if (abierta) return abierta;
  const fabrica = idb();
  abierta = !fabrica ? Promise.resolve(null) : new Promise((ok) => {
    let peticion;
    try { peticion = fabrica.open(BASE, 1); } catch { ok(null); return; }
    peticion.onupgradeneeded = () => {
      const db = peticion.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: 'clave' });
    };
    peticion.onsuccess = () => ok(peticion.result);
    peticion.onerror = () => ok(null);
    peticion.onblocked = () => ok(null);
  });
  return abierta;
}

function transaccion(db, modo, fn) {
  return new Promise((ok, no) => {
    const tx = db.transaction(ALMACEN, modo);
    const resultado = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => ok(resultado?.result ?? null);
    tx.onerror = () => no(tx.error);
    tx.onabort = () => no(tx.error);
  });
}

const urlDe = (blob) => (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : `memoria:${Math.random()}`);
const soltar = (url) => { if (url && url.startsWith('blob:') && URL.revokeObjectURL) URL.revokeObjectURL(url); };

function avisar(clave) {
  for (const fn of oyentes) { try { fn(clave); } catch { /* un oyente roto no para a los demás */ } }
}

/**
 * Carga lo aprobado. Se llama una vez al arrancar; llamarla otra vez no hace nada.
 * @returns {Promise<number>} Cuántas hay.
 */
let cargada = null;
export function abrirGaleria() {
  if (cargada) return cargada;
  cargada = (async () => {
    const db = await abrirBase();
    if (!db) return enMemoria.size;
    try {
      const todas = await transaccion(db, 'readonly', (s) => s.getAll());
      for (const r of todas ?? []) {
        if (!(r?.blob instanceof Blob) || !MAPA_DE_BITS.test(r.blob.type)) continue;
        soltar(enMemoria.get(r.clave)?.url);
        enMemoria.set(r.clave, { url: urlDe(r.blob), estilo: r.estilo, tipo: r.tipo, nombre: r.nombre ?? '', creada: r.creada });
      }
      if (enMemoria.size) avisar(null);
    } catch { /* sin galería se juega igual, con marcadores */ }
    return enMemoria.size;
  })();
  return cargada;
}

/**
 * La imagen aprobada de alguien, lista para `<img src>`.
 * @param {string|null} clave
 * @returns {string|null}
 */
export function urlAprobada(clave) {
  return clave ? enMemoria.get(clave)?.url ?? null : null;
}

/**
 * Guarda la versión que el jugador ha elegido. Sustituye a la anterior.
 *
 * @param {string} clave
 * @param {Blob} blob
 * @param {{estilo: string, tipo: string, nombre?: string}} meta
 * @returns {Promise<{ok: boolean, persistente: boolean, motivo?: string}>}
 */
export async function aprobar(clave, blob, meta) {
  if (!clave || !/^(?:pj|pnj|enemigo):[\w.-]{1,60}$/.test(clave)) return { ok: false, persistente: false, motivo: 'Clave inválida.' };
  if (!(blob instanceof Blob) || !MAPA_DE_BITS.test(blob.type)) return { ok: false, persistente: false, motivo: 'No es una imagen.' };
  if (blob.size > TAM_MAX_APROBADA) return { ok: false, persistente: false, motivo: 'La imagen es demasiado grande.' };

  const registro = { clave, blob, estilo: meta?.estilo ?? 'desconocido', tipo: meta?.tipo ?? 'pnj', nombre: String(meta?.nombre ?? '').slice(0, 80), creada: Date.now() };
  let persistente = false;
  const db = await abrirBase();
  if (db) {
    try { await transaccion(db, 'readwrite', (s) => s.put(registro)); persistente = true; } catch { persistente = false; }
  }
  soltar(enMemoria.get(clave)?.url);
  enMemoria.set(clave, { url: urlDe(blob), estilo: registro.estilo, tipo: registro.tipo, nombre: registro.nombre, creada: registro.creada });
  avisar(clave);
  return { ok: true, persistente };
}

/**
 * Quita la imagen aprobada de alguien: vuelve el marcador.
 * @param {string} clave
 */
export async function olvidar(clave) {
  const db = await abrirBase();
  if (db) { try { await transaccion(db, 'readwrite', (s) => s.delete(clave)); } catch { /* se quita de memoria igual */ } }
  soltar(enMemoria.get(clave)?.url);
  enMemoria.delete(clave);
  avisar(clave);
}

/** @returns {Array<{clave: string, estilo: string, tipo: string, nombre: string}>} */
export function listarAprobadas() {
  return [...enMemoria].map(([clave, r]) => ({ clave, estilo: r.estilo, tipo: r.tipo, nombre: r.nombre }));
}

/**
 * Avisa cuando cambia algo (se aprueba, se olvida o termina de cargar).
 * @param {(clave: string|null) => void} fn
 * @returns {() => void} Para dejar de escuchar.
 */
export function alCambiarGaleria(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** Solo pruebas: vacía la memoria y olvida la base abierta. */
export function _reiniciarGaleria() {
  for (const r of enMemoria.values()) soltar(r.url);
  enMemoria.clear();
  abierta = null;
  cargada = null;
}

export default { claveDe, abrirGaleria, urlAprobada, aprobar, olvidar, listarAprobadas, alCambiarGaleria, TAM_MAX_APROBADA };
