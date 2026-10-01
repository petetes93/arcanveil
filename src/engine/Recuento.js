/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/Recuento.js
 * ---------------------------------------------------------------------------
 * «Contar» tiene dos verbos dentro: cuantificar y narrar.
 *
 * «cuento cuánta gente hay y qué hace cada uno» se leía como hablar, y salía
 * «Cormir te escucha sin interrumpir… se queda un momento callado,
 * midiéndote»: un oyente inventado para una observación, y ningún número.
 * «cuento las monedas que llevo» igual, sin decir el saldo.
 *
 * Se distingue por la sintaxis y el objeto, no por una lista de frases:
 *   · Narrar: con destinatario («le cuento», «te cuento», «cuento a Cormir»),
 *     con oración («cuento que…», «cuento cómo…») o con algo que se narra
 *     («una historia», «lo que pasó», «lo del puente», «mi historia»).
 *   · Contar cosas: «cuánto/a(s)…», o un sintagma con artículo, posesivo o
 *     número («las monedas», «mis flechas», «los pasos», «la gente»).
 * Lo que no encaja en ninguno no es un recuento: se queda como estaba.
 *
 * Funciones puras.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sinAcentos } from '../utils/text.js';

/** Abre un recuento: el verbo al principio, con o sin un «me pongo a». */
const VERBO = /^(?:y\s+)?(?:me pongo a |vuelvo a |voy a |intento |paro a )?(?:cuento|contar|recuento|hago (?:el |un )?recuento de|calculo)\s+(.+)$/;

/** Lo que se narra, no se cuenta. */
const NARRA = /^(?:a\s|al\s|que\s|como\s|por que\s|cuando\s|donde\s|una? (?:historia|cuento|anecdota|chiste|leyenda|mentira|secreto)|lo que\s|lo de\s|lo del\s|mi historia|mi vida|mi pasado|todo\b|algo\b|nada\b|con\s|en voz alta)/;

/** Lo que se cuenta: cuántos, o algo con artículo, posesivo o cifra. */
const CUENTA = /^(?:cuant[oa]s?\b|las\s|los\s|la gente|el oro|el dinero|mis?\s|tus?\s|sus?\s|nuestr[oa]s?\s|\d+\s|cada\s|a cuant)/;

/** Contar en voz alta o para sí: ni se habla con nadie ni hay dato que dar. */
const EN_VOZ = /^hasta\s+(?:\d+|tres|cinco|diez|veinte|cien|mil)\b/;

const GENTE = /\b(?:gente|personas|vecinos|clientes|presentes|hombres|mujeres|guardias|quien(?:es)? hay|cuantos hay|cuantas hay)\b/;
const ORO = /\b(?:monedas|oro|dinero|plata|cobre|dineros|bolsa)\b/;

/** Palabras que no nombran lo contado. */
const RELLENO = new Set(['cuantos', 'cuantas', 'cuanto', 'cuanta', 'las', 'los', 'la', 'el', 'mis', 'tus', 'sus', 'que', 'llevo', 'tengo', 'hay', 'me', 'quedan', 'queda', 'quedo', 'de', 'del', 'y', 'cada', 'uno', 'hace', 'aqui', 'encima', 'en', 'mi', 'bolsa', 'mochila']);

/**
 * ¿Es un recuento? Y de qué.
 *
 * @param {string} texto
 * @returns {{que: 'gente'|'oro'|'objeto'|'otro', termino: string|null, detalle: boolean}|null}
 *   `detalle`: pide también qué hace cada uno.
 */
export function leerRecuento(texto) {
  const t = sinAcentos(String(texto ?? '').toLowerCase()).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(VERBO);
  if (!m) return null;
  const resto = m[1];
  if (EN_VOZ.test(resto)) return { que: 'otro', termino: resto, detalle: false };
  if (NARRA.test(resto) || !CUENTA.test(resto)) return null;
  const detalle = /\bque hace\b|\bque hacen\b|\ba que se dedica/.test(resto);
  if (GENTE.test(resto)) return { que: 'gente', termino: null, detalle };
  if (ORO.test(resto)) return { que: 'oro', termino: null, detalle: false };
  const palabras = resto.split(' ').filter((p) => p && !RELLENO.has(p) && !/^\d+$/.test(p));
  return { que: 'objeto', termino: palabras[0] ?? null, detalle: false };
}

export default { leerRecuento };
