/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · art/candidata.js
 * ---------------------------------------------------------------------------
 * Pedir una imagen candidata al generador del propio equipo.
 *
 * Solo cuando el jugador lo pide («Pintar retrato», «Otra versión»): nunca
 * al repintar, al llegar a un sitio, al encontrarse con alguien ni en
 * combate. Lo que vuelve es una CANDIDATA: se enseña en el estudio y solo
 * pasa a la galería si el jugador pulsa «Usar esta versión» (ver
 * `galeria.js`). Mientras tanto el puente la guarda en su caché temporal,
 * en este PC, para no repintar la misma versión; cerrar el estudio la
 * olvida (`olvidarCandidatas`). Con ComfyUI el encargo no sale del PC; con
 * un proveedor en la nube, sí (`estadoGenerador().envia`).
 *
 * Habla únicamente con el puente local (127.0.0.1:11437, ver
 * tools/imagen-local-proxy.mjs), que genera con ComfyUI en esta máquina.
 * El proveedor en la nube (Cloudflare) está preparado en el puente pero no
 * se activa desde aquí. No hay servicio anónimo de respaldo: sin puente, se
 * dice por qué y el marcador con el nombre se queda.
 *
 * Dos peticiones iguales (misma clave y misma variante) comparten viaje; la
 * respuesta de una variante vieja no pisa a la nueva (eso lo decide quien
 * llama, con `variante`).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ORIGEN_GENERADOR = 'http://127.0.0.1:11437';
const SERVICIO = /^arcanveil-puente-imagen\/\d+$/;

/** Mensajes por causa: lo que el jugador puede hacer. */
export const MOTIVOS = Object.freeze({
  sin_generador: 'No hay generador de imágenes en este equipo. Abre ComfyUI y arranca el puente: node tools/imagen-local-proxy.mjs (lo explica IMAGEN_LOCAL.md).',
  no_deja_leer: 'Algo contesta en el puerto 11437, pero no deja leer desde esta página: o el puente se arrancó para otra dirección, o ese puerto lo usa otro programa.',
  otro_servicio: 'En el puerto 11437 contesta otro programa, no el puente de imágenes de ARCANVEIL. No se le pide nada.',
  proveedor: 'El puente está, pero el generador no respondió bien. ¿Está ComfyUI abierto y con el modelo cargado?',
  sin_clave: 'El puente está configurado para un proveedor en la nube sin credenciales. Arráncalo con ComfyUI (el de por defecto).',
  limite: 'Has llegado al tope de imágenes del puente por ahora. Prueba dentro de un rato.',
  ocupado: 'Ya se está pintando otra imagen. Espera a que termine.',
  tiempo: 'La imagen tardó demasiado. Prueba otra vez; si se repite, mira ComfyUI.',
  datos: 'Hace falta una descripción de al menos 8 letras para pintar.',
  cancelada: 'Cancelada.',
});

const enCurso = new Map();

function error(causa, detalle = null) {
  return Object.assign(new Error(MOTIVOS[causa] ?? detalle ?? 'No se pudo pintar.'), { causa, detalle });
}

/**
 * ¿Hay alguien escuchando aunque no se le pueda leer? `fetch` falla igual
 * en los dos casos; una petición opaca sale si algo contesta.
 */
async function sinLectura(pedir) {
  try {
    await pedir(`${ORIGEN_GENERADOR}/estado`, { mode: 'no-cors', cache: 'no-store' });
    return error('no_deja_leer');
  } catch {
    return error('sin_generador');
  }
}

/**
 * Estado del generador, sin generar nada.
 * @param {{fetch?: Function}} [op]
 * @returns {Promise<{ok: boolean, causa: string|null, motivo: string|null, proveedor?: string, estilo?: string, disponible?: boolean}>}
 */
export async function estadoGenerador({ fetch: pedir = globalThis.fetch } = {}) {
  let r;
  try { r = await pedir(`${ORIGEN_GENERADOR}/estado`, { cache: 'no-store' }); } catch {
    const e = await sinLectura(pedir);
    return { ok: false, causa: e.causa, motivo: e.message };
  }
  const datos = await r.json().catch(() => ({}));
  if (!SERVICIO.test(String(datos?.servicio ?? ''))) return { ok: false, causa: 'otro_servicio', motivo: MOTIVOS.otro_servicio };
  // Qué pasa con lo pedido: con ComfyUI no sale del PC; con un proveedor en
  // la nube, el encargo viaja. Un puente viejo que no lo dice cuenta como nube.
  const envia = datos.envia === 'local' ? 'local' : 'nube';
  const comun = { proveedor: datos.proveedor, estilo: datos.estilo, envia, cache: datos.cache ?? null };
  if (datos.disponible === false) return { ok: false, causa: 'proveedor', motivo: `${MOTIVOS.proveedor}${datos.motivo ? ` (${datos.motivo})` : ''}`, ...comun };
  return { ok: true, causa: null, motivo: null, disponible: true, ...comun };
}

/**
 * Olvida las candidatas de un dueño (al cerrar el estudio) o todas (al
 * borrar partidas). Las que el jugador ya eligió viven en la galería y no se
 * tocan. Sin puente, no hay nada que hacer aquí: caducan solas.
 *
 * @param {{clave?: string, todas?: boolean}} que
 * @param {{fetch?: Function}} [op]
 * @returns {Promise<{ok: boolean, borradas: number}>}
 */
export async function olvidarCandidatas(que, { fetch: pedir = globalThis.fetch } = {}) {
  try {
    const r = await pedir(`${ORIGEN_GENERADOR}/v1/olvidar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(que?.todas ? { todas: true } : { clave: String(que?.clave ?? '') }),
    });
    const datos = await r.json().catch(() => ({}));
    return { ok: r.ok && SERVICIO.test(String(datos?.servicio ?? '')), borradas: Number(datos?.borradas) || 0 };
  } catch {
    return { ok: false, borradas: 0 };
  }
}

/**
 * Pide una candidata.
 *
 * @param {Object} encargo
 * @param {'personaje'|'pnj'|'enemigo'} encargo.tipo
 * @param {string} encargo.clave Clave estable (ver `galeria.claveDe`).
 * @param {string} encargo.descripcion Apariencia, 8 a 300 caracteres.
 * @param {string} [encargo.linaje]
 * @param {string} [encargo.rol]
 * @param {Object} [op]
 * @param {number} [op.variante=0] «Otra versión» sube este número: otra semilla.
 * @param {AbortSignal} [op.signal]
 * @param {Function} [op.fetch]
 * @returns {Promise<{blob: Blob, proveedor: string|null, variante: number}>}
 */
export function pedirCandidata(encargo, { variante = 0, signal, fetch: pedir = globalThis.fetch } = {}) {
  const descripcion = String(encargo?.descripcion ?? '').trim().slice(0, 300);
  if (descripcion.length < 8) return Promise.reject(error('datos'));
  const clave = String(encargo?.clave ?? '');
  if (!/^[\w:.-]{1,80}$/.test(clave)) return Promise.reject(error('datos'));

  const id = `${clave}#${variante}`;
  const previa = enCurso.get(id);
  if (previa) return previa;

  const promesa = (async () => {
    let r;
    try {
      r = await pedir(`${ORIGEN_GENERADOR}/v1/candidata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal,
        body: JSON.stringify({
          tipo: encargo.tipo,
          clave,
          descripcion,
          ...(encargo.linaje ? { linaje: encargo.linaje } : {}),
          ...(encargo.rol ? { rol: String(encargo.rol).slice(0, 40) } : {}),
          variante,
        }),
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw error('cancelada');
      throw await sinLectura(pedir);
    }
    if (!SERVICIO.test(String(r.headers?.get?.('X-Arcanveil-Servicio') ?? ''))) throw error('otro_servicio');
    if (!r.ok) {
      const datos = await r.json().catch(() => ({}));
      const causa = datos?.error?.codigo ?? datos?.error?.code ?? null;
      throw error(MOTIVOS[causa] ? causa : 'proveedor', datos?.error?.message);
    }
    const blob = await r.blob();
    if (!/^image\/(?:png|jpeg|webp)$/.test(blob.type)) throw error('otro_servicio');
    return { blob, proveedor: r.headers.get('X-Arcanveil-Proveedor'), variante };
  })();

  enCurso.set(id, promesa);
  promesa.then(() => enCurso.delete(id), () => enCurso.delete(id));
  return promesa;
}

export default { pedirCandidata, estadoGenerador, olvidarCandidatas, MOTIVOS, ORIGEN_GENERADOR };
