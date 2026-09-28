/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · persistence/Serializer.js
 * ---------------------------------------------------------------------------
 * Serialización del estado de partida.
 *
 * Tres reglas gobiernan este módulo, y las tres existen por una razón concreta.
 *
 * PRIMERA: NUNCA SE SERIALIZA UNA CREDENCIAL. La clave de la API vive en una
 * variable de módulo, fuera del árbol de estado, así que no puede llegar aquí
 * ni por descuido. Pero además se filtra explícitamente cualquier rama de
 * ajustes sensible, por si mañana alguien añade un campo sin pensar.
 *
 * SEGUNDA: LAS RAMAS VOLÁTILES NO SE GUARDAN. El estado de combate, la interfaz
 * y los temporizadores se reconstruyen al cargar. Guardarlos produciría partidas
 * que arrancan a mitad de una pelea que ya no tiene sentido.
 *
 * TERCERA: TODO GUARDADO LLEVA VERSIÓN. Sin eso, un cambio de estructura
 * convierte los guardados antiguos en basura silenciosa. Con eso, `Migrations`
 * puede repararlos.
 *
 * Funciones puras.
 *
 * Dependencias: GameState, config, utils.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { RAMAS_VOLATILES, verificarForma } from '../core/GameState.js';
import { APP, PERSISTENCIA } from '../config/app.config.js';
import { clonar } from '../utils/clone.js';

/* ═══════════════════════════════════════════════════════════════════════════
   FILTRADO DE SEGURIDAD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rutas que NUNCA se serializan, por sensibles.
 *
 * La credencial no está en el estado, así que esta lista es una segunda barrera:
 * si algún día alguien añade un campo ahí, el guardado sigue siendo limpio.
 */
export const PROHIBIDO_GUARDAR = Object.freeze([
  'settings.credencial',
  'settings.clave',
  'settings.apiKey',
  'settings.token',
  'ai.credencial',
  'ai.clave',
  'runtime',
]);

/**
 * Ramas que se reconstruyen al cargar en vez de guardarse.
 *
 * Se suman a las volátiles declaradas en GameState.
 */
export const NO_PERSISTIR = Object.freeze([
  ...RAMAS_VOLATILES,
  'combat',
  'ui',
  'runtime',
]);

/* ═══════════════════════════════════════════════════════════════════════════
   SERIALIZACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} Guardado
 * @property {number} version Versión del formato.
 * @property {string} app Versión de la aplicación que lo generó.
 * @property {number} guardadoEn Marca de tiempo.
 * @property {Object} cabecera Datos para la lista de partidas.
 * @property {Object} estado El estado del juego, filtrado.
 * @property {Object} sistemas Estado propio de los sistemas.
 * @property {string} [firma] Suma de comprobación.
 */

/**
 * Serializa una partida.
 *
 * @param {Object} opciones
 * @param {Object} opciones.estado Estado completo del store.
 * @param {Object} [opciones.sistemas] Estado que los sistemas guardan aparte.
 * @param {string} [opciones.nota] Comentario del jugador.
 * @returns {Guardado}
 */
export function serializar(opciones) {
  const { estado, sistemas = {}, nota } = opciones;

  const estadoLimpio = _filtrar(estado);

  const guardado = {
    version: PERSISTENCIA.versionFormato,
    app: APP.version,
    guardadoEn: Date.now(),

    cabecera: cabecera(estado, nota),
    estado: estadoLimpio,
    sistemas: clonar(sistemas),
  };

  guardado.firma = firmar(guardado);

  return guardado;
}

/**
 * Extrae los datos de cabecera, para la lista de partidas.
 *
 * Existen aparte del estado para poder mostrar la lista sin deserializar cada
 * partida entera. Con seis ranuras da igual, pero es la clase de detalle que
 * se agradece cuando el guardado crece.
 *
 * @param {Object} estado
 * @param {string} [nota]
 * @returns {Object}
 */
export function cabecera(estado, nota) {
  const jugador = estado.player ?? {};
  const mundo = estado.world ?? {};
  const stats = estado.hazanas?.estadisticas ?? {};

  return {
    nombre: jugador.nombre ?? 'Sin nombre',
    nivel: jugador.nivel ?? 1,
    raza: jugador.raza ?? null,
    clase: jugador.clase ?? null,
    // Para dibujar el rostro en «Cargar» sin deserializar la partida.
    retrato: jugador.retrato ?? '',
    genero: jugador.genero ?? null,
    semillaRetrato: jugador.semillaRetrato ?? null,
    personajeId: estado.meta?.personajeId ?? null,

    // La intensidad elegida al crearla: «Nivel 3 · El Vado · Pacífica».
    intensidad: estado.settings?.dificultad ?? 'equilibrado',

    lugar: mundo.ubicacion
      ? (mundo.localizaciones?.porId?.[mundo.ubicacion]?.nombre ?? mundo.ubicacion)
      : null,

    turno: estado.meta?.turno ?? 0,
    dia: mundo.tiempo?.dia ?? 1,

    vida: jugador.vida ? `${jugador.vida.actual}/${jugador.vida.max}` : null,
    oro: jugador.oro ?? 0,

    misiones: stats.misionesCompletadas ?? 0,
    hazanas: estado.hazanas?.conseguidas?.length ?? 0,

    nota: nota ?? null,
  };
}

/**
 * Filtra el estado, retirando lo que no debe guardarse.
 *
 * @param {Object} estado
 * @returns {Object}
 * @private
 */
function _filtrar(estado) {
  const salida = {};

  for (const [rama, contenido] of Object.entries(estado)) {
    if (NO_PERSISTIR.includes(rama)) continue;

    salida[rama] = clonar(contenido);
  }

  // ─── Segunda barrera: rutas prohibidas ──────────────────────────────────
  for (const ruta of PROHIBIDO_GUARDAR) {
    _borrarRuta(salida, ruta);
  }

  return salida;
}

/**
 * Borra una ruta anidada de un objeto.
 * @private
 */
function _borrarRuta(objeto, ruta) {
  const partes = ruta.split('.');
  const ultima = partes.pop();

  let cursor = objeto;
  for (const parte of partes) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parte];
  }

  if (cursor && typeof cursor === 'object' && ultima in cursor) {
    delete cursor[ultima];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DESERIALIZACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Deserializa un guardado.
 *
 * No aplica migraciones: eso lo hace `Migrations` antes de llamar aquí. Este
 * módulo asume que la versión ya es la correcta.
 *
 * @param {Guardado} guardado
 * @param {Object} estadoInicial Estado limpio con el que rellenar lo que falte.
 * @returns {{
 *   valido: boolean, estado: Object|null, sistemas: Object,
 *   avisos: string[], error: string|null
 * }}
 */
export function deserializar(guardado, estadoInicial) {
  const avisos = [];

  // ─── Validación estructural ─────────────────────────────────────────────
  if (!guardado || typeof guardado !== 'object') {
    return { valido: false, estado: null, sistemas: {}, avisos, error: 'guardado vacío o corrupto' };
  }

  if (!guardado.estado) {
    return { valido: false, estado: null, sistemas: {}, avisos, error: 'el guardado no contiene estado' };
  }

  if (guardado.version !== PERSISTENCIA.versionFormato) {
    return {
      valido: false,
      estado: null,
      sistemas: {},
      avisos,
      error: `versión de formato ${guardado.version}, se esperaba ${PERSISTENCIA.versionFormato}`,
    };
  }

  // ─── Firma ──────────────────────────────────────────────────────────────
  // Una firma que no cuadra no invalida el guardado: puede ser una edición
  // manual legítima. Se avisa y se sigue.
  if (guardado.firma && guardado.firma !== firmar(guardado)) {
    avisos.push('la firma no coincide: el guardado puede haberse editado a mano');
  }

  // ─── Reconstrucción ─────────────────────────────────────────────────────
  // Las ramas volátiles se toman del estado inicial, no del guardado.
  const estado = clonar(estadoInicial);

  for (const [rama, contenido] of Object.entries(guardado.estado)) {
    if (NO_PERSISTIR.includes(rama)) continue;

    if (!(rama in estado)) {
      avisos.push(`rama desconocida ignorada: ${rama}`);
      continue;
    }

    // Se funde en vez de sustituir, para que los campos nuevos del estado
    // inicial sobrevivan a un guardado antiguo.
    estado[rama] = _fundir(estado[rama], contenido);
  }

  // ─── Comprobación de forma ──────────────────────────────────────────────
  const forma = verificarForma(estado);
  if (!forma.valido) {
    avisos.push(...forma.problemas.map((p) => `forma: ${p}`));
  }

  return {
    valido: true,
    estado,
    sistemas: guardado.sistemas ?? {},
    avisos,
    error: null,
  };
}

/**
 * Funde el contenido guardado sobre la estructura inicial.
 *
 * Es lo que permite que un guardado de hace tres versiones siga cargando: los
 * campos que no existían entonces conservan su valor por defecto.
 *
 * @param {*} base
 * @param {*} guardado
 * @returns {*}
 * @private
 */
function _fundir(base, guardado) {
  // Los tipos primitivos y los arrays se sustituyen enteros.
  if (guardado === null || typeof guardado !== 'object') return guardado;
  if (Array.isArray(guardado)) return clonar(guardado);

  // Si la base no es un objeto, el guardado manda.
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return clonar(guardado);
  }

  const salida = { ...base };

  for (const [clave, valor] of Object.entries(guardado)) {
    // `__proto__ in base` es cierto: se fundía con Object.prototype y
    // cambiaba el prototipo de la rama. Lo quita ya `parsearSeguro`; aquí,
    // por si el guardado llega por otro camino.
    if (CLAVES_PROHIBIDAS.has(clave)) continue;
    salida[clave] = Object.prototype.hasOwnProperty.call(base, clave) ? _fundir(base[clave], valor) : clonar(valor);
  }

  return salida;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRMA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calcula una suma de comprobación del guardado.
 *
 * No es criptografía: es detección de corrupción. Sirve para avisar de que un
 * guardado se ha editado o truncado, no para impedirlo. En un juego local,
 * impedir que el jugador toque su propia partida sería absurdo.
 *
 * @param {Guardado} guardado
 * @returns {string}
 */
export function firmar(guardado) {
  // La firma no se incluye en su propio cálculo.
  const { firma, ...resto } = guardado;

  const texto = JSON.stringify(resto);

  // Hash FNV-1a de 32 bits: rápido y suficiente para detectar cambios.
  let h = 0x811c9dc5;

  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTACIÓN E IMPORTACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Convierte un guardado en texto para descargar.
 *
 * Se indenta a propósito: un guardado legible es un guardado que el jugador
 * puede inspeccionar, y eso encaja con un juego que corre entero en su máquina.
 *
 * @param {Guardado} guardado
 * @returns {string}
 */
export function aTexto(guardado) {
  return JSON.stringify(guardado, null, 2);
}

/** Claves que en un objeto de JavaScript no son datos. */
const CLAVES_PROHIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Cuánto se anida un JSON, contado sobre el texto y sin parsearlo: se para
 * en cuanto pasa del tope. Parsear primero no vale, porque lo que revienta
 * con miles de niveles es precisamente recorrer lo parseado.
 *
 * @param {string} texto
 * @param {number} tope
 * @returns {boolean} true si no pasa del tope.
 */
function anidamientoDentro(texto, tope) {
  let nivel = 0;
  let enCadena = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    if (enCadena) {
      if (c === 92) i += 1;            // «\»: salta lo escapado
      else if (c === 34) enCadena = false;
      continue;
    }
    if (c === 34) enCadena = true;
    else if (c === 123 || c === 91) { nivel += 1; if (nivel > tope) return false; }
    else if (c === 125 || c === 93) nivel -= 1;
  }
  return true;
}

/**
 * Parsea un guardado sin fiarse de él: tamaño, anidamiento y claves que no
 * son datos, antes de que nada lo recorra.
 *
 * Un `__proto__` en el archivo cambiaba el prototipo de la rama al fundirla
 * (`clave in base` es cierto para `__proto__`), y miles de niveles de
 * anidamiento reventaban la pila.
 *
 * @param {string} texto
 * @returns {{objeto: Object|null, error: string|null, quitadas: number}}
 */
export function parsearSeguro(texto) {
  if (texto.length > PERSISTENCIA.importacionMaxBytes) {
    const kb = (n) => Math.round(n / 1024);
    return { objeto: null, quitadas: 0, error: `el archivo es demasiado grande para ser una partida (${kb(texto.length)} KB; como mucho ${kb(PERSISTENCIA.importacionMaxBytes)} KB)` };
  }
  if (!anidamientoDentro(texto, PERSISTENCIA.profundidadMax)) {
    return { objeto: null, quitadas: 0, error: 'el archivo tiene una estructura imposible para una partida' };
  }
  let quitadas = 0;
  try {
    const objeto = JSON.parse(texto, (clave, valor) => {
      if (CLAVES_PROHIBIDAS.has(clave)) { quitadas += 1; return undefined; }
      return valor;
    });
    return { objeto, error: null, quitadas };
  } catch (e) {
    return { objeto: null, quitadas: 0, error: `no es un guardado válido: ${e.message}` };
  }
}

/**
 * Lee un guardado desde texto.
 *
 * @param {string} texto
 * @returns {{guardado: Guardado|null, error: string|null}}
 */
export function desdeTexto(texto) {
  if (typeof texto !== 'string' || !texto.trim()) {
    return { guardado: null, error: 'el archivo está vacío' };
  }

  const { objeto, error } = parsearSeguro(texto);
  if (error) return { guardado: null, error };

  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto) || !objeto.estado || typeof objeto.estado !== 'object' || !objeto.version) {
    return { guardado: null, error: 'el archivo no parece un guardado de ARCANVEIL' };
  }

  // La versión decide qué migraciones se aplican: un número entero, o nada.
  if (!Number.isInteger(objeto.version) || objeto.version < 1) {
    return { guardado: null, error: 'el archivo no dice de qué versión es: no se puede abrir' };
  }

  return { guardado: objeto, error: null };
}

/**
 * Nombre de archivo sugerido para una exportación.
 *
 * @param {Object} cabecera
 * @returns {string}
 */
export function nombreArchivo(cabecera) {
  const nombre = (cabecera?.nombre ?? 'cronica')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const fecha = new Date().toISOString().slice(0, 10);

  return `arcanveil-${nombre}-n${cabecera?.nivel ?? 1}-${fecha}.json`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAMAÑO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Estima el tamaño de un guardado.
 *
 * LocalStorage tiene un límite práctico de unos cinco megabytes compartidos por
 * todo el dominio. Con seis ranuras conviene vigilar.
 *
 * @param {Guardado} guardado
 * @returns {{bytes: number, kb: number, dentroDelLimite: boolean}}
 */
export function medir(guardado) {
  const texto = JSON.stringify(guardado);
  const bytes = new Blob([texto]).size;

  return {
    bytes,
    kb: Math.round(bytes / 1024 * 10) / 10,
    dentroDelLimite: bytes < PERSISTENCIA.tamanoMaxRanura,
  };
}

/**
 * Comprueba si un estado contiene algo sensible antes de guardarlo.
 *
 * Es una red de seguridad para el desarrollo: si alguien mete una credencial en
 * el estado, esto lo detecta en la consola en vez de dejarlo pasar.
 *
 * @param {Object} estado
 * @returns {{limpio: boolean, encontrado: string[]}}
 */
export function auditar(estado) {
  const encontrado = [];
  const sospechosas = /clave|credencial|token|apikey|secret|password/i;

  const recorrer = (objeto, ruta = '') => {
    if (!objeto || typeof objeto !== 'object') return;

    for (const [clave, valor] of Object.entries(objeto)) {
      const rutaCompleta = ruta ? `${ruta}.${clave}` : clave;

      // Una clave sospechosa con un valor no vacío es lo que buscamos.
      if (sospechosas.test(clave) && valor && typeof valor === 'string' && valor.length > 8) {
        encontrado.push(rutaCompleta);
      }

      if (typeof valor === 'object' && !Array.isArray(valor)) {
        recorrer(valor, rutaCompleta);
      }
    }
  };

  recorrer(estado);

  return { limpio: encontrado.length === 0, encontrado };
}

export default {
  PROHIBIDO_GUARDAR,
  NO_PERSISTIR,
  serializar,
  deserializar,
  cabecera,
  firmar,
  aTexto,
  desdeTexto,
  nombreArchivo,
  medir,
  auditar,
};
