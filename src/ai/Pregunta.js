/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · ai/Pregunta.js
 * ---------------------------------------------------------------------------
 * La pregunta de mesa con que se cierra cada turno.
 *
 * El rótulo «¿QUÉ HACES?» estaba encima de la caja, pero la narración no lo
 * preguntaba nunca: terminaba en un pájaro cruzando el cielo y el jugador no
 * sabía si el turno había acabado. En una mesa, el máster cierra devolviendo
 * la palabra. Aquí también.
 *
 * Breve y variada. La forma corta es solo «¿Qué haces?»; las demás llevan algo
 * de la escena delante —quién espera, qué se echa encima— para que no suene a
 * formulario. Va en su propia línea y no es un golpe de ritmo: no para el ojo,
 * devuelve el turno.
 *
 * Funciones puras.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** La forma corta. */
export const CORTA = '¿Qué haces?';

/**
 * Candidatas para esta escena.
 *
 * @param {Object} escena
 * @param {Array<{nombre: string}>} [escena.npcs] Quien está delante.
 * @param {Array<{nombre: string}>} [escena.enemigos] En combate.
 * @param {string} [escena.franja] 'noche', 'ocaso', 'alba'…
 * @returns {string[]}
 */
export function candidatas({ npcs = [], enemigos = [], franja = null } = {}) {
  // Las variantes delante y la corta al final: tras una corta se puede
  // nombrar a quien espera; tras una variante, siempre la corta (ver
  // `preguntaDeMesa`).
  const lista = [];

  const enemigo = enemigos.find((e) => e?.nombre)?.nombre;
  // Una sola forma de devolver la palabra, no dos: «Cordor espera tu
  // respuesta. ¿Qué haces?» apilaba dos cierres.
  if (enemigo) {
    lista.push(`${enemigo} espera tu movimiento.`, CORTA);
    return lista;
  }

  // «No te quita ojo», «te mira, esperando», «La decisión es tuya»: frases
  // que no dicen nada y se repetían cada dos turnos (49 veces en seis
  // partidas medidas con `tools/medir-narrador.mjs`). Se queda la forma
  // corta y, si alguien espera respuesta de verdad, se dice quién.
  const npc = npcs.find((n) => n?.nombre)?.nombre;
  if (npc) lista.push(`${npc} espera tu respuesta.`);

  // Las franjas son las del reloj del juego: «ocaso» y «alba», no «anochecer».
  if (franja === 'ocaso' || franja === 'noche') lista.push('La noche se echa encima. ¿Qué haces?');

  lista.push(CORTA);
  return lista;
}

/**
 * Elige una sin repetir la anterior.
 *
 * @param {Object} escena Ver `candidatas`.
 * @param {Object} [opciones]
 * @param {string|null} [opciones.anterior]
 * @param {(lista: string[]) => string} [opciones.elegir]
 * @returns {string}
 */
export function preguntaDeMesa(escena = {}, { anterior = null, elegir = (l) => l[0] } = {}) {
  // Después de una variante, la corta: «Vervek espera tu respuesta» dos
  // turnos seguidos ya es una muletilla.
  if (anterior && anterior !== CORTA) return CORTA;
  const lista = candidatas(escena);
  return elegir(lista) ?? CORTA;
}

/**
 * ¿La narración ya termina devolviendo la palabra?
 *
 * Si el narrador ya ha preguntado —un modelo lo hace a menudo—, no se añade
 * otra: dos preguntas seguidas es un máster que no escucha.
 *
 * @param {string} texto
 * @returns {boolean}
 */
export function terminaEnPregunta(texto) {
  const ultima = String(texto ?? '').trim().split('\n').filter((l) => l.trim()).at(-1) ?? '';
  // También si quien habla acaba de preguntar: «¿Qué necesitas?», dice
  // Cordor. La palabra ya está devuelta; otro «¿Qué haces?» sobra.
  return /\?[»"”]?$/u.test(ultima.trim()) || /«[^»]*\?»/u.test(ultima);
}

/**
 * Cierra la narración con la pregunta, en su propia línea.
 *
 * @param {string} texto
 * @param {string} pregunta
 * @returns {string}
 */
export function cerrarConPregunta(texto, pregunta) {
  const t = String(texto ?? '').trimEnd();
  if (!t) return pregunta;
  if (terminaEnPregunta(t)) return t;
  return `${t}\n${pregunta}`;
}

export default { CORTA, candidatas, preguntaDeMesa, terminaEnPregunta, cerrarConPregunta };
