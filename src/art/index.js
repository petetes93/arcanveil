/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · src/art/index.js
 * ---------------------------------------------------------------------------
 * Cargador de arte. La única puerta por la que la interfaz pide imágenes.
 *
 * Tiene dos salidas y siempre da una:
 *
 *   1. Si hay un archivo de imagen declarado en el manifiesto Y carga bien, se
 *      usa ese.
 *   2. Si no hay manifiesto, o el archivo falta, o falla al cargar, se usa el
 *      SVG generado.
 *
 * El SVG se pinta SIEMPRE primero y la imagen lo sustituye después, ya cargada.
 * Al revés —poner el `<img>` y esperar— se ve un hueco, y si el archivo no
 * está, el hueco se queda. Un icono de imagen rota es peor que un vector.
 *
 * Esto es lo que permite empezar con arte vectorial hoy y pasar a imágenes
 * generadas mañana sin tocar la interfaz: basta con dejar los archivos en
 * `assets/` y declararlos en `assets/manifest.json`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { paisaje, atmosfera } from './paisaje.js';
import { retrato } from './retrato.js';
import { criatura } from './criatura.js';
import { claveDe, urlAprobada } from './galeria.js';
import { especieNombrada } from './rasgos.js';

export { paisaje, atmosfera, retrato, criatura };
export { especieNombrada, claveDe };

/* ═══════════════════════════════════════════════════════════════════════════
   MANIFIESTO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Manifiesto de imágenes disponibles.
 *
 * Forma esperada:
 *
 * ```json
 * {
 *   "base": "assets/",
 *   "paisajes":  { "vado_yunque": "paisajes/vado_yunque.webp" },
 *   "retratos":  { "valdes": "retratos/valdes.webp" },
 *   "criaturas": { "lobo_ceniciento": "criaturas/lobo.webp" }
 * }
 * ```
 *
 * Vacío por defecto: sin manifiesto el juego funciona igual, solo que todo el
 * arte es vectorial.
 */
let manifiesto = { base: '', paisajes: {}, retratos: {}, criaturas: {} };

/** Archivos que ya se sabe que no cargan: no se reintentan en cada turno. */
const fallidos = new Set();

/**
 * Cuántas veces se ha cambiado el manifiesto.
 *
 * Entra en la firma de caché de `pintarArte`. Sin esto, una pieza pintada
 * ANTES de que llegue el manifiesto se queda en vector para siempre: la firma
 * no cambiaría y el repintado se saltaría. Como el manifiesto se carga sin
 * bloquear el arranque, ese caso es el normal, no la excepción.
 */
let version = 0;

/**
 * Registra un manifiesto de imágenes.
 *
 * @param {Object} nuevo
 */
export function registrarManifiesto(nuevo, prefijo = '') {
  if (!nuevo || typeof nuevo !== 'object') return;

  manifiesto = {
    base: `${prefijo}${nuevo.base ?? ''}`,
    paisajes: nuevo.paisajes ?? {},
    retratos: nuevo.retratos ?? {},
    criaturas: nuevo.criaturas ?? {},
  };

  version += 1;
}

/**
 * Carga el manifiesto desde disco, si lo hay.
 *
 * Falla en silencio a propósito: no tener manifiesto es el caso normal, no un
 * error. En el archivo único la petición falla siempre y el juego sigue con
 * arte vectorial, que es justo lo previsto.
 *
 * @param {string} [ruta]
 * @returns {Promise<boolean>} Si se cargó algo.
 */
export async function cargarManifiesto(ruta = 'assets/manifest.json') {
  try {
    const respuesta = await fetch(ruta, { cache: 'no-cache' });
    if (!respuesta.ok) return false;

    // Las rutas del manifiesto se resuelven contra el PROPIO manifiesto, no
    // contra el documento. `app/index.html` pide `../assets/manifest.json`, y
    // sin este prefijo un `retratos/x.webp` de dentro acabaría buscándose en
    // `app/retratos/x.webp`.
    const carpeta = ruta.slice(0, ruta.lastIndexOf('/') + 1);

    registrarManifiesto(await respuesta.json(), carpeta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ruta del archivo de imagen de una clave, si está declarado.
 *
 * @param {'paisajes'|'retratos'|'criaturas'} familia
 * @param {string} clave
 * @returns {string|null}
 */
export function rutaRaster(familia, clave) {
  const relativa = manifiesto[familia]?.[clave];
  if (!relativa) return null;

  const completa = `${manifiesto.base ?? ''}${relativa}`;
  return fallidos.has(completa) ? null : completa;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GENERACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Devuelve el SVG de una pieza según su familia.
 *
 * @param {string} familia
 * @param {Object} opciones
 * @returns {string}
 */
function generar(familia, opciones) {
  switch (familia) {
    case 'retratos': return retrato(opciones);
    case 'criaturas': return criatura(opciones);
    case 'paisajes':
    default: return paisaje(opciones);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PINTADO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pinta una pieza de arte dentro de un nodo.
 *
 * @param {HTMLElement} nodo Contenedor. Se vacía.
 * @param {Object} peticion
 * @param {'paisajes'|'retratos'|'criaturas'} peticion.familia
 * @param {string} peticion.clave Identificador para el manifiesto y la semilla.
 * @param {Object} [peticion.opciones] Lo que recibe el generador.
 * @returns {void}
 */
export function pintarArte(nodo, peticion) {
  if (!nodo) return;

  const { familia, clave, opciones = {} } = peticion;

  // Se evita repintar lo mismo: el paisaje se pide en cada refresco y
  // regenerarlo hace parpadear la imagen sin motivo.
  const firma = `${version}:${familia}:${clave}:${JSON.stringify(opciones)}`;
  if (nodo.dataset.firmaArte === firma) return;

  nodo.dataset.firmaArte = firma;
  // Qué es y de qué tamaño: los marcos de combate encuadran la silueta de
  // una criatura distinto que un paisaje (ver index.html, «criaturas»).
  nodo.dataset.familiaArte = familia;
  if (opciones.tamano) nodo.dataset.tamanoArte = opciones.tamano;
  nodo.innerHTML = generar(familia, opciones);

  /* ── Mejora a imagen, si la hay ───────────────────────────────────────── */
  const ruta = opciones.sinRaster ? null : rutaRaster(familia, clave);
  if (!ruta) return;

  const img = new Image();

  img.addEventListener('load', () => {
    // Puede haber cambiado de lugar mientras cargaba; si es así, no se pisa.
    if (nodo.dataset.firmaArte !== firma) return;

    img.className = 'arte arte--imagen';
    img.alt = opciones.nombre ?? '';

    if (familia === 'paisajes' && opciones.hibrido) {
      // La ilustración da el impacto de un momento clave; la capa SVG mantiene
      // la hora, el clima y las partículas vivas encima de ella.
      nodo.innerHTML = atmosfera(opciones);
      nodo.prepend(img);
      return;
    }

    nodo.replaceChildren(img);
  });

  img.addEventListener('error', () => {
    // Se apunta para no volver a intentarlo en cada turno. El SVG ya está
    // puesto, así que no hay nada más que hacer.
    fallidos.add(ruta);
  });

  img.src = ruta;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ATAJOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pinta el paisaje de un lugar, con la hora y el clima del mundo.
 *
 * @param {HTMLElement} nodo
 * @param {Object} lugar Entrada de `locations.data.js`.
 * @param {Object} [mundo] `{ franja, clima }`.
 */
export function pintarLugar(nodo, lugar, mundo = {}) {
  if (!lugar) return;

  pintarArte(nodo, {
    familia: 'paisajes',
    clave: lugar.refId,
    opciones: {
      refId: lugar.refId,
      terreno: lugar.terreno,
      tipo: lugar.tipo,
      nombre: lugar.nombre,
      franja: mundo.franja ?? 'manana',
      clima: mundo.clima ?? 'despejado',
      hibrido: Boolean(mundo.momentoClave),
      sinRaster: !mundo.momentoClave,
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   CARAS: APROBADA O MARCADOR
   ---------------------------------------------------------------------------
   Una cara solo es una imagen que el jugador ha elegido (ver `galeria.js`),
   o, para un tipo de enemigo, la ilustración que trae el juego. Si no hay,
   se ve un marcador neutro con el nombre: la cara vectorial de antes se
   parecía a todas las demás del mismo linaje y se tomaba por el retrato.
   Pintar aquí NUNCA pide nada a ningún generador: eso solo pasa cuando el
   jugador lo pide (ver `candidata.js`).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Marcador neutro: la inicial y el nombre, sin nada que parezca una cara.
 * Todo con textContent: el nombre puede venir del narrador o de un guardado.
 *
 * @param {HTMLElement} nodo
 * @param {{nombre?: string, familia?: string}} [datos]
 */
export function pintarMarcador(nodo, { nombre = '', familia = 'retratos' } = {}) {
  if (!nodo) return;
  const limpio = String(nombre ?? '').trim();
  const firma = `marcador:${familia}:${limpio}`;
  if (nodo.dataset.firmaArte === firma) return;
  nodo.dataset.firmaArte = firma;
  nodo.dataset.familiaArte = familia;

  const caja = document.createElement('div');
  caja.className = 'arte marcador-arte';
  caja.setAttribute('role', 'img');
  caja.setAttribute('aria-label', limpio ? `${limpio}, sin imagen` : 'Sin imagen');
  const inicial = document.createElement('span');
  inicial.className = 'marcador-arte__inicial';
  inicial.setAttribute('aria-hidden', 'true');
  inicial.textContent = (Array.from(limpio)[0] ?? '·').toUpperCase();
  const rotulo = document.createElement('span');
  rotulo.className = 'marcador-arte__nombre';
  rotulo.setAttribute('aria-hidden', 'true');
  rotulo.textContent = limpio || 'Sin imagen';
  caja.append(inicial, rotulo);
  nodo.replaceChildren(caja);
}

/** Pone una imagen ya elegida. @returns {boolean} */
function pintarImagen(nodo, url, { nombre = '', familia, clase = 'arte--aprobada' }) {
  const firma = `imagen:${url}`;
  if (nodo.dataset.firmaArte === firma) return true;
  nodo.dataset.firmaArte = firma;
  nodo.dataset.familiaArte = familia;
  const img = new Image();
  img.className = `arte arte--imagen ${clase}`;
  img.alt = nombre ? `Retrato de ${nombre}` : '';
  img.decoding = 'async';
  img.src = url;
  nodo.replaceChildren(img);
  return true;
}

/**
 * La clave de imagen de quien se pinta.
 *
 * @param {Object} quien `{ claveImagen }`, o `{ id }` (personaje del jugador),
 *   o `{ refId }` (personaje con nombre).
 * @returns {string|null}
 */
export function claveRetrato(quien = {}) {
  if (quien.claveImagen) return quien.claveImagen;
  if (quien.id) return claveDe({ tipo: 'personaje', id: quien.id });
  if (quien.refId) return claveDe({ tipo: 'pnj', refId: quien.refId });
  return null;
}

/**
 * Pinta el retrato de un personaje: el aprobado, o el marcador con su nombre.
 *
 * @param {HTMLElement} nodo
 * @param {Object} personaje `{ nombre, id | refId | claveImagen }`.
 */
export function pintarRetrato(nodo, personaje = {}) {
  if (!nodo) return;
  const clave = claveRetrato(personaje);
  nodo.dataset.claveImagen = clave ?? '';
  const url = urlAprobada(clave);
  if (url) { pintarImagen(nodo, url, { nombre: personaje.nombre, familia: 'retratos' }); return; }
  pintarMarcador(nodo, { nombre: personaje.nombre, familia: 'retratos' });
}

/**
 * Pinta un enemigo: la imagen aprobada de su tipo, la ilustración que trae
 * el juego, o el marcador con su nombre.
 *
 * Todos los saqueadores comparten imagen: la clave es el tipo (`refId`), no
 * cada saqueador. Si la ilustración del juego no carga, se queda el marcador.
 *
 * @param {HTMLElement} nodo
 * @param {Object} enemigo Entrada de `enemies.data.js`.
 */
export function pintarCriatura(nodo, enemigo = {}) {
  if (!nodo) return;
  const refId = enemigo.refId ?? 'criatura';
  const clave = claveDe({ tipo: 'enemigo', refId });
  nodo.dataset.claveImagen = clave ?? '';
  if (enemigo.tamano) nodo.dataset.tamanoArte = enemigo.tamano;

  const aprobada = urlAprobada(clave);
  if (aprobada) { pintarImagen(nodo, aprobada, { nombre: enemigo.nombre, familia: 'criaturas' }); return; }

  const ruta = rutaRaster('criaturas', refId);
  if (!ruta) { pintarMarcador(nodo, { nombre: enemigo.nombre, familia: 'criaturas' }); return; }

  const firma = `ilustracion:${version}:${ruta}`;
  if (nodo.dataset.firmaArte === firma) return;
  // El marcador mientras carga; la ilustración encima cuando llega.
  pintarMarcador(nodo, { nombre: enemigo.nombre, familia: 'criaturas' });
  nodo.dataset.firmaArte = firma;
  const img = new Image();
  img.className = 'arte arte--imagen';
  img.alt = enemigo.nombre ?? '';
  img.addEventListener('load', () => { if (nodo.dataset.firmaArte === firma) nodo.replaceChildren(img); });
  img.addEventListener('error', () => { fallidos.add(ruta); });
  img.src = ruta;
}
