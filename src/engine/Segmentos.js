/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/Segmentos.js
 * ---------------------------------------------------------------------------
 * Lo que escribe el jugador, en orden y sin aplanar.
 *
 * «Le pregunto por el puente, le enseño la carta y si miente me voy» son tres
 * cosas: una pregunta, un gesto y una condición que depende de lo que conteste
 * el otro. Se reducía todo a una sola intención —hablar— y se narraba entero
 * como hecho, incluido el «me voy», que aún no ha pasado.
 *
 * Aquí se parte en segmentos:
 *
 *   · accion       — lo que hace.
 *   · dialogo      — lo que dice; lo entrecomillado es literal.
 *   · omision      — lo que deja de lado a propósito («ignoro al centinela»).
 *   · condicional  — lo que hará SI pasa algo. No se ejecuta: queda pendiente.
 *   · espera       — «luego espero».
 *   · delegacion   — «que mi compañera negocie»: actúa otro, él observa.
 *
 * Cada uno lleva además si es una negativa («no os entregaré la llave») o una
 * pregunta. Funciones puras.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sinAcentos } from '../utils/text.js';
import { leerRecuento } from './Recuento.js';

export const TIPO_SEGMENTO = Object.freeze({
  ACCION: 'accion',
  DIALOGO: 'dialogo',
  OMISION: 'omision',
  CONDICIONAL: 'condicional',
  ESPERA: 'espera',
  DELEGACION: 'delegacion',
});

const CITA = /«[^»]*»|"[^"]*"|“[^”]*”/gu;
const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

/** Palabras en -o que no son verbos y no pueden abrir un segmento. */
const NO_VERBO = new Set(['todo', 'mucho', 'poco', 'algo', 'como', 'solo', 'cuando', 'pero', 'luego', 'tanto', 'medio', 'otro', 'mismo', 'cuanto', 'dentro', 'nuestro', 'vuestro', 'cuidado', 'rapido', 'despacio', 'claro']);

const CLITICO = '(?:le|les|me|te|lo|la|los|las|se|nos|os)';

/** Un verbo en primera persona: -o, -é, y los que acaban en -oy (voy, doy, estoy, soy). */
const PRIMERA = '\\p{L}+(?:o|é|oy)\\b';

/** Dónde empieza el siguiente segmento. */
const CORTES = [
  /\s*;\s*/u,
  /(?<=[.!?…])\s+/u,
  new RegExp(`,?\\s+(?:y\\s+)?(?:luego|despu[eé]s|entonces)\\s+`, 'iu'),
  /,?\s+y\s+(?=si\s)/iu,
  /,\s*(?=si\s)/iu,
  new RegExp(`,\\s+(?=${CLITICO}\\s+${PRIMERA})`, 'iu'),
  new RegExp(`\\s+y\\s+(?=${CLITICO}\\s+${PRIMERA})`, 'iu'),
  /,\s+(?=\p{L}{3,}[oé]\b)/iu,
  /\s+y\s+(?=\p{L}{3,}[oé]\b)/iu,
];

/** ¿Hay en este trozo algo que haga el propio jugador? (primera persona) */
const HACE_EL = new RegExp(`(?:^|\\s)(?:(?:me|le|lo|la|les|los|las|nos|os|te)\\s+${PRIMERA}|(?!se\\b)\\p{L}{3,}[oé]\\b|(?:voy|doy|estoy|soy)\\b)`, 'iu');

/** Gestos que preparan lo que viene después: acercarse, volver con alguien, enseñar algo. */
const PREPARA = /^(?:me acerco|me aproximo|vuelvo|regreso|voy (?:hacia|con|junto)|me dirijo|me giro|me vuelvo hacia|(?:le|les) (?:enseno|muestro|tiendo|acerco)|saco)\b/;

const OMISION = /^(?:ignoro|paso de|no hago caso|sin hacer caso|me desentiendo|dejo (?:estar|en paz|atras)|no me meto)\b/;
const ESPERA = /^(?:espero|aguardo|me quedo esperando|me quedo quiet[oa]|no hago nada|observo(?: en silencio)?)\s*[.!]?$/;
const HABLA = new RegExp(`^(?:${CLITICO}\\s+)?(?:digo|pregunto|cuento|explico|contesto|respondo|grito|susurro|suplico|exijo|pido|advierto|aviso)\\b|^(?:hablo|charlo|converso)\\s+(?:un rato\\s+)?con\\b`);
const NEGATIVA = /\b(?:me niego|no acepto|no pienso|no voy a|no (?:os|te|le|les)\s+(?:entregar|dar|vender|dejar|devolver)\w*|no (?:entregar|dar|vender|dejar|devolver)\w*|no (?:lo|la|los|las) (?:hare|har[eé]|dare|dar[eé]|entregare|entregar[eé])|jamas|ni hablar|ni loco|ni loca)\b/;
const DELEGA = /^(?:que|dejo que|deja que)\s+(mi compañer[oa]|mi amig[oa]|[A-ZÁÉÍÓÚÑ][\p{L}]+)\s+(.+)$/iu;
/**
 * Lo que se le dice a alguien sin comillas: «No voy a darte mis monedas»,
 * «os lo advierto». Un pronombre de segunda persona dirigido a otro (te, os,
 * o pegado al verbo: darte, deciros) en boca del jugador es habla, no algo
 * que haga. Se tomaba por acción, y el eco lo pasaba a segunda persona:
 * «No vas a darte tus monedas».
 */
const A_TI = /(?:^|\s)(?:te|os)\s+\p{L}+|\p{L}+(?:ar|er|ir|ando|iendo)(?:te|os)(?:lo|la|los|las)?\b|\b(?:dame|dadme|vete|largate|apartate|escuchame|mirame)\b/u;

/** Algo que haría el jugador si pasa lo de la condición: «me voy», «lo ataco». */
const CONSECUENCIA = /(?:^|\s)(?:me|le|lo|la|les|los|las|te|os|nos)\s+\p{L}+(?:o|e)\b|\b(?:voy|huyo|ataco|corro|salgo|grito|disparo|pago|pego|golpeo|sigo|espero|vuelvo)\b/u;

const CONECTOR_INICIAL =/^(?:y|luego|despu[eé]s|entonces|pero)\s+/iu;

/**
 * Parte el texto del jugador en segmentos ordenados.
 *
 * @param {string} texto
 * @returns {Array<{tipo: string, texto: string, negativa: boolean, pregunta: boolean,
 *   condicion?: string, consecuencia?: string, quien?: string, delegado?: string, objeto?: string}>}
 */
export function segmentar(texto) {
  const original = String(texto ?? '').trim();
  if (!original) return [];

  // Las citas no se parten por dentro: se guardan y se reponen al final.
  const citas = [];
  let protegido = original.replace(CITA, (c) => {
    citas.push(c);
    return `\u0000${citas.length - 1}\u0000`;
  });

  let trozos = [protegido];
  for (const corte of CORTES) {
    trozos = trozos.flatMap((t) => t.split(corte));
  }

  const reponer = (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => citas[Number(i)]);

  const limpios = trozos
    .map((t) => reponer(t).trim().replace(CONECTOR_INICIAL, '').replace(/[,;]\s*$/u, '').trim())
    .filter(Boolean);

  // Se recosen dos casos que los cortes separan de más:
  //   · un trozo que empieza por una palabra que no es verbo («mucho
  //     sigilo») era parte del anterior;
  //   · una condición sin consecuencia («si el guardia se niega») se lleva
  //     el trozo siguiente («lo empujo al río»).
  //   · un conector suelto («mientras», «de momento») va con lo que sigue:
  //     salía «Mientras y esperas»;
  //   · un «y si…» sin consecuencia detrás de una pregunta es parte de la
  //     pregunta («le pregunto por el camino y si hay trabajo allí»), no una
  //     condición del jugador: salía «Queda en el aire lo que harás si hay».
  //   · un vocativo suelto («Corvane, si ves al encapuchado, avísame») es a
  //     quien va lo que sigue: salía un segmento «Corvane» y una condición
  //     del jugador («Queda en el aire lo que harás si ves…»).
  //
  // Un nombre suelto solo es vocativo si una coma lo ata a la frase
  // («Corvane, si ves…», «¿Te echo una mano, Ianvio?») o va entre
  // exclamaciones («¡Rensa!»). Tras un punto o un punto y coma empieza otra
  // cosa: en «No voy a darte mis monedas. Espero», «Espero» es lo que hace, y
  // se cosía como si se lo dijera a alguien («…monedas., Espero»).
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const vocativoDelante = (t) => esVocativo(t)
    && (/^¡.*!$/u.test(t) || new RegExp(`^\\s*[¿¡]?\\s*${esc(t)}\\s*,`, 'u').test(original));
  const vocativoDetras = (t) => esVocativo(t.replace(/[?!.]+$/u, '').trim())
    && new RegExp(`,\\s*${esc(t)}\\s*$`, 'u').test(original.trim());
  const unidos = [];
  let conector = null;
  let vocativo = null;
  for (const t0 of limpios) {
    if (/^(?:mientras(?: tanto)?|entretanto|entre tanto|de momento|por ahora|por el momento)$/iu.test(t0.trim())) { conector = t0.trim(); continue; }
    if (!unidos.length && !vocativo && vocativoDelante(t0.trim())) { vocativo = t0.trim().replace(/^¡\s*|\s*!$/gu, ''); continue; }
    const t = vocativo ? `${vocativo}, ${t0}` : conector ? `${conector} ${t0}` : t0;
    if (vocativo) { vocativo = null; unidos.push(t); continue; }
    conector = null;
    const previo = unidos.at(-1);
    const primera = llano(t).split(/\s+/)[0];
    // «¿Te echo una mano, Ianvio?»: el nombre del final es a quien se habla,
    // no otra cosa que hace («… y ianvio»).
    if (previo && vocativoDetras(t)) {
      unidos[unidos.length - 1] = `${previo}, ${t}`;
      continue;
    }
    if (previo && /^si\s/i.test(t) && !t.includes(',') && /\bpregunt\w*|\?/.test(llano(previo))
      && !CONSECUENCIA.test(llano(t.replace(/^si\s+\S+/i, '')))) {
      unidos[unidos.length - 1] = `${previo} y ${t}`;
    } else if (previo && NO_VERBO.has(primera)) {
      unidos[unidos.length - 1] = `${previo} y ${t}`;
    } else if (previo && /^si\s/i.test(previo) && !previo.includes(',')
      && (original.includes(`${previo},`) || !HACE_EL.test(previo.replace(/^si\s+\S+/i, '')))) {
      // Con la coma del jugador («si el herrero me sigue mirando, me voy»)
      // no hace falta adivinar dónde acaba la condición: acaba ahí. Sin ella
      // se adivinaba por la forma de las palabras, y «herrero» parecía un
      // verbo en primera persona.
      unidos[unidos.length - 1] = `${previo}, ${t}`;
    } else {
      unidos.push(t);
    }
  }
  if (vocativo) unidos.push(vocativo);
  return unidos.map(clasificar);
}

/** Palabras que abren frase con coma y no son a quién se habla. */
const NO_VOCATIVO = new Set(['luego', 'entonces', 'bueno', 'vale', 'ahora', 'despues', 'primero', 'pues', 'oye', 'mira', 'venga', 'claro',
  'bien', 'vamos', 'tranquilo', 'tranquila', 'perfecto', 'rapido', 'despacio', 'sin', 'con', 'mientras', 'al', 'total', 'aun', 'ademas', 'finalmente']);

/** «Corvane» o «¡Corvane!», solo: a quien se habla. @private */
function esVocativo(t) {
  const nombre = t.replace(/^¡\s*|\s*!$/gu, '');
  // «Espero», «Aguardo»: son lo que hace, aunque vayan en mayúscula.
  return /^\p{Lu}\p{Ll}{2,}$/u.test(nombre) && !NO_VOCATIVO.has(llano(nombre)) && !ESPERA.test(llano(nombre));
}

/**
 * A quién se habla por su nombre, esté donde esté el vocativo, y lo que se le
 * dice sin él:
 *
 *   «Corvane, ¿has oído…?», «Oye, Corvane, ¿has oído…?», «¡Corvane! ¿Has
 *   oído…?» y «¿Te echo una mano, Corvane?».
 *
 * @param {string} texto
 * @returns {{nombre: string, dicho: string}|null}
 */
export function separarVocativo(texto) {
  const t = String(texto ?? '').trim();
  const delante = t.match(/^([¿¡]?)\s*(?:(?:oye|eh|perdona|perdone|disculpa|disculpe|mira|hola|buenas)\s*,?\s*)?(\p{Lu}\p{Ll}{2,})\s*(,|!)\s*(.+)$/iu);
  if (delante && !NO_VOCATIVO.has(llano(delante[2])) && /^\p{Lu}/u.test(delante[2])) {
    let dicho = delante[4].trim();
    // «¿Corvane, has oído…?»: la pregunta abre con el nombre y se cierra al final.
    if (delante[1] === '¿' && !/^¿/u.test(dicho)) dicho = `¿${dicho}`;
    if (delante[1] === '¡' && delante[3] === ',' && !/^¡/u.test(dicho)) dicho = `¡${dicho}`;
    return { nombre: delante[2], dicho: `${dicho.replace(/^([¿¡]?)(\p{Ll})/u, (_, s, l) => `${s}${l.toUpperCase()}`)}` };
  }
  const detras = t.match(/^(.+?),\s*(\p{Lu}\p{Ll}{2,})\s*([?!.]?)\s*$/u);
  if (detras && !NO_VOCATIVO.has(llano(detras[2])) && /[?!]$|^[¿¡]/u.test(t)) {
    return { nombre: detras[2], dicho: `${detras[1].trim()}${detras[3]}` };
  }
  return null;
}

/**
 * Una orden a otro: «avísame», «dímelo», «ven». Con ella detrás, «si ves al
 * lobo, avísame» es algo que se le pide a alguien, no un plan del jugador.
 */
const ORDEN_A_OTRO = /^(?:no\s+)?(?:\p{L}{2,}(?:ame|eme|ime|amelo|emelo|imelo|anos|enos)|dime|dimelo|dile|ven|venid|avisa|avisad|decidme)\b/u;

/** @private */
function clasificar(texto) {
  const n = llano(texto);
  const sinCitas = llano(texto.replace(CITA, ''));
  const base = {
    texto,
    negativa: NEGATIVA.test(n),
    pregunta: /\?/.test(texto) || /^(?:le |les )?pregunto\b/.test(n),
  };

  // Hablado a alguien por su nombre: «Corvane, si ves al encapuchado,
  // avísame». Sus palabras, tal cual.
  if (!/^(?:le |les )?pregunto\b/.test(n) && separarVocativo(texto)) {
    return { ...base, tipo: TIPO_SEGMENTO.DIALOGO, citaImplicita: true };
  }

  if (/^si\s+/.test(n)) {
    const resto = texto.replace(/^si\s+/i, '');
    const coma = resto.indexOf(',');
    const corte = coma > 0
      ? coma
      : resto.search(new RegExp(`\\s(?=(?:me|le|lo|la|les|los|las|nos|os|te)\\s+${PRIMERA}|(?!se\\b)\\p{L}{3,}[oé]\\b|(?:voy|doy|estoy|soy)\\b)`, 'iu'));
    const condicion = corte > 0 ? resto.slice(0, corte).trim() : resto.trim();
    const consecuencia = corte > 0 ? resto.slice(corte + 1).trim() : '';
    if (ORDEN_A_OTRO.test(llano(consecuencia))) return { ...base, tipo: TIPO_SEGMENTO.DIALOGO, citaImplicita: true };
    return { ...base, tipo: TIPO_SEGMENTO.CONDICIONAL, condicion, consecuencia };
  }

  if (OMISION.test(sinCitas)) {
    const objeto = texto.replace(/^\S+\s+(?:de\s+|caso\s+(?:a\s+|al\s+)?|a\s+|al\s+)?/iu, '').trim();
    return { ...base, tipo: TIPO_SEGMENTO.OMISION, objeto };
  }

  const delega = texto.match(DELEGA);
  if (delega) {
    return { ...base, tipo: TIPO_SEGMENTO.DELEGACION, quien: delega[1], delegado: delega[2] };
  }

  if (ESPERA.test(sinCitas)) return { ...base, tipo: TIPO_SEGMENTO.ESPERA };

  // «Cuento las monedas» no es hablar: no tiene destinatario (ver Recuento.js).
  if (CITA.test(texto) || (HABLA.test(sinCitas) && !leerRecuento(sinCitas))) {
    CITA.lastIndex = 0;
    return { ...base, tipo: TIPO_SEGMENTO.DIALOGO };
  }
  CITA.lastIndex = 0;

  // Habla sin comillas: se conserva literal para no reescribir sus palabras.
  // Un infinitivo con «-te» al principio («Relajarte un rato») es una acción
  // escrita como sugerencia, no algo dicho a alguien.
  if (A_TI.test(sinCitas) && !/^(?:me|nos)\s/.test(sinCitas) && !/^\p{L}+(?:ar|er|ir)(?:te|se)\b/u.test(sinCitas)) {
    return { ...base, tipo: TIPO_SEGMENTO.DIALOGO, citaImplicita: true };
  }

  return { ...base, tipo: TIPO_SEGMENTO.ACCION };
}

/**
 * Qué se resuelve en este turno y qué no.
 *
 * El foco es lo primero que hace o dice: de ahí salen la intención y la
 * tirada. Salvo que lo primero sea solo preparar lo segundo: en «me acerco
 * al herrero y le pregunto por el paso», lo que pide respuesta es la
 * pregunta, y el foco se quedaba en acercarse. Lo condicional queda
 * pendiente; lo omitido, apuntado.
 *
 * @param {ReturnType<typeof segmentar>} segmentos
 * @returns {{foco: Object|null, hechos: Object[], pendientes: Object[], omisiones: Object[], delegacion: Object|null}}
 */
export function ordenar(segmentos) {
  const hechos = segmentos.filter((s) => [TIPO_SEGMENTO.ACCION, TIPO_SEGMENTO.DIALOGO, TIPO_SEGMENTO.ESPERA, TIPO_SEGMENTO.DELEGACION].includes(s.tipo));
  let foco = hechos.find((s) => s.tipo === TIPO_SEGMENTO.ACCION || s.tipo === TIPO_SEGMENTO.DIALOGO || s.tipo === TIPO_SEGMENTO.DELEGACION) ?? null;
  const dialogo = hechos.find((s) => s.tipo === TIPO_SEGMENTO.DIALOGO);
  if (foco?.tipo === TIPO_SEGMENTO.ACCION && dialogo
    && hechos.slice(0, hechos.indexOf(dialogo)).every((s) => s.tipo === TIPO_SEGMENTO.ACCION && PREPARA.test(llano(s.texto)))) {
    foco = dialogo;
  }
  return {
    foco,
    hechos,
    pendientes: segmentos.filter((s) => s.tipo === TIPO_SEGMENTO.CONDICIONAL),
    omisiones: segmentos.filter((s) => s.tipo === TIPO_SEGMENTO.OMISION),
    delegacion: segmentos.find((s) => s.tipo === TIPO_SEGMENTO.DELEGACION) ?? null,
  };
}

export default { segmentar, ordenar, TIPO_SEGMENTO };
