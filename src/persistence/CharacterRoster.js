/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · persistence/CharacterRoster.js
 * ---------------------------------------------------------------------------
 * Plantel de personajes creados.
 *
 * Un personaje no es una partida: es quién eres (nombre, linaje, aspecto e
 * historia). «Nueva partida» lo ofrece otra vez a nivel 1 para empezar una
 * crónica distinta sin rellenar la ficha de nuevo. Las partidas en curso
 * siguen viviendo en las ranuras de SaveManager.
 *
 * Solo se escribe en LocalStorage cuando el jugador crea un personaje, que es
 * el momento en que pide expresamente que la app lo recuerde.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { olvidar, claveDe } from '../art/galeria.js';

const CLAVE = 'arcanveil:personajes';
const MAXIMO = 24;

/** Campos que definen al personaje. Nada de progreso ni de estado de partida. */
// El retrato elegido vive en la galería del navegador (src/art/galeria.js),
// con clave `pj:<id>`. `retratoIA` (una URL de un servicio de fuera) y
// `semillaRetrato` ya no se usan y dejan de guardarse: al volver a guardar
// un personaje antiguo, desaparecen.
const CAMPOS = ['id', 'nombre', 'raza', 'clase', 'trasfondo', 'genero', 'retrato', 'lore', 'creado', 'intensidad'];

function leerCrudo() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(lista) ? lista.filter((p) => p && p.id && p.nombre) : [];
  } catch {
    return [];
  }
}

function escribir(lista) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista.slice(0, MAXIMO)));
    return true;
  } catch {
    return false;
  }
}

/** @returns {Array<Object>} Personajes, el más reciente primero. */
export function listarPersonajes() {
  return leerCrudo().sort((a, b) => (b.creado ?? 0) - (a.creado ?? 0));
}

/** @param {string} id */
export function obtenerPersonaje(id) {
  return leerCrudo().find((p) => p.id === id) ?? null;
}

/**
 * Guarda un personaje nuevo y devuelve su ficha limpia.
 * @param {Object} datos
 * @returns {Object}
 */
export function guardarPersonaje(datos) {
  const ficha = {};
  for (const campo of CAMPOS) if (datos[campo] !== undefined) ficha[campo] = datos[campo];
  ficha.id = ficha.id ?? `pj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  ficha.creado = ficha.creado ?? Date.now();

  const lista = leerCrudo().filter((p) => p.id !== ficha.id);
  lista.unshift(ficha);
  escribir(lista);
  return ficha;
}

/**
 * Borra un personaje, y con él su retrato elegido: sin esto la imagen se
 * quedaba en la galería sin dueño.
 * @param {string} id
 */
export function borrarPersonaje(id) {
  const clave = claveDe({ tipo: 'personaje', id });
  if (clave) olvidar(clave);
  return escribir(leerCrudo().filter((p) => p.id !== id));
}

export default { listarPersonajes, obtenerPersonaje, guardarPersonaje, borrarPersonaje };
