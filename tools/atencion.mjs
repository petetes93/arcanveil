/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/atencion.mjs
 * ---------------------------------------------------------------------------
 * ¿La respuesta atiende a lo que se preguntó y a quien se le preguntó?
 *
 * El marcador anterior daba 27/27 con respuestas que no atendían: contaba
 * como contestada cualquier pregunta sin tema reconocido, y cualquier «De
 * eso no sé nada. Pregunta a otro» como una admisión honrada. Aquí una
 * respuesta cuenta solo si cumple las tres cosas:
 *
 *   · DESTINATARIO — si se le pregunta a alguien presente, contesta él (su
 *     nombre abre o firma una línea de la respuesta) y no otro.
 *   · TEMA — la respuesta nombra lo preguntado (una palabra de contenido de
 *     la pregunta, por su raíz), o es un acto que no pide dato (ofrecer
 *     ayuda, dar las gracias) y se contesta a ese acto.
 *   · CONTENIDO — da un dato, o dice que no lo sabe y a quién preguntar.
 *
 * Es una comprobación de texto, no de sentido: sirve para cazar lo que no
 * atiende, no para certificar que una respuesta es buena. La lectura manual
 * de las transcripciones sigue mandando.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { actoDeHabla, ACTO } from '../src/engine/ActoDeHabla.js';

const llano = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Palabras de la pregunta que no son el tema. */
const VACIAS = new Set(['pregunto', 'pregunta', 'preguntar', 'sabes', 'sabe', 'algo', 'visto', 'vistos', 'alguien', 'alguno', 'alguna', 'aqui', 'por', 'para',
  'hablar', 'oido', 'otra', 'vez', 'digo', 'dime', 'cuentame', 'quien', 'donde', 'cuando', 'como', 'hay', 'esto', 'esta', 'este', 'estos', 'ese', 'esa',
  'tambien', 'entonces', 'pues', 'bueno', 'vale', 'mucho', 'poco', 'todo', 'nada', 'ahora', 'luego', 'desde', 'hasta', 'sobre', 'entre', 'tiene', 'tienen',
  'conoce', 'conoces', 'puede', 'puedes', 'podria', 'quiero', 'saber', 'habeis', 'hace', 'hacia', 'ellos', 'ellas', 'nadie', 'mismo', 'otro', 'otros']);

/** Raíz corta para comparar palabras: «incendio» y «incendios». */
const raiz = (w) => w.slice(0, Math.max(4, Math.min(6, w.length - 1)));

/**
 * Lo que de verdad se pregunta cuando se pregunta si se ha visto o si hay
 * algo: «si alguien ha visto MERCENARIOS por el camino». El camino es dónde.
 *
 * Ejemplo real (tester, 1-oct-2026): a «Le pregunto a Torket si alguien ha
 * visto mercenarios por el camino» se contestó cómo ir al Camino del Norte,
 * y la rúbrica lo daba por atendido porque la respuesta decía «camino».
 */
const ART = '(?:el |la |los |las |un |una |unos |unas |algun |alguna |algunos |algunas )?';
const NUCLEO = [
  new RegExp(`\\bsi (?:alguien |algun\\w* )?(?:ha|han|has|habeis) (?:visto|oido|pasado|venido|llegado|cruzado|aparecido|desaparecido|bajado|subido)\\s+(?:hablar de\\s+)?(?:a\\s+)?${ART}([a-zñ]+)`),
  new RegExp(`\\bsi (?:hay|queda|quedan|existe|existen|anda|andan)\\s+${ART}([a-zñ]+)`),
  new RegExp(`\\b(?:has|ha|habeis) (?:visto|oido)(?: hablar de)?\\s+(?:a\\s+)?${ART}([a-zñ]+)`),
];
const nucleoDe = (n) => NUCLEO.map((re) => n.match(re)?.[1]).find((w) => w && w.length >= 4 && !VACIAS.has(w)) ?? null;

/**
 * Negarse con motivo es contestar: «De eso no hablo» atiende (dice algo de
 * ESO, aunque sea que no) pero no informa. No es por sí solo un fallo.
 */
const NIEGA = /«(?:de eso no hablo|no pienso (?:decir|contar|hablar)|(?:eso )?no es asunto tuyo|no te lo voy a decir|mejor no preguntes)[^»]*»/i;

/**
 * ¿El turno solo repite lo que hizo el jugador y devuelve la palabra?
 *
 * «Intentas X.» + «¿Qué haces?» sin nada en medio: ni resultado, ni
 * reacción, ni dato. Los GENERICOS de `medir-narrador` buscan frases hechas
 * («Ves lo principal») y no veían esto; el tester lo encontró leyendo seis
 * partidas manuales. Es una medida aparte: no cambia ningún marcador previo.
 *
 * @param {{entrada: string, texto: string}} turno
 * @returns {boolean}
 */
export function soloEco({ entrada, texto }) {
  const lineas = String(texto ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('»'));
  if (!lineas.length) return false;
  const contenido = (t) => llano(t).split(/[^a-zñ]+/u).filter((w) => w.length >= 4 && !VACIAS.has(w)).map(raiz);
  const suyas = new Set(contenido(entrada));
  const eco = (l) => {
    const c = contenido(l);
    return c.length > 0 && c.filter((w) => suyas.has(w)).length / c.length >= 0.6;
  };
  let resto = lineas;
  if (eco(resto[0])) resto = resto.slice(1);
  while (resto.length && /\?\s*$/.test(resto.at(-1)) && !/«/.test(resto.at(-1))) resto = resto.slice(0, -1);
  return resto.length === 0;
}

/**
 * ¿Atiende la respuesta a la pregunta?
 *
 * @param {Object} turno
 * @param {string} turno.entrada Lo que escribió el jugador.
 * @param {string} turno.texto Lo que salió (puede traer la línea «» del eco).
 * @param {string[]} [turno.presentes] Nombres de quien había en escena.
 * @returns {{destinatario: string|null, atiendeDestinatario: boolean, tema: string[], atiendeTema: boolean, contenido: boolean, atiende: boolean, motivo: string}}
 */
export function atiende({ entrada, texto, presentes = [] }) {
  const cuerpo = String(texto ?? '').split('\n').filter((l) => l && !l.startsWith('»')).join('\n');
  // Sin el eco de la acción: «Le preguntas a Corvane por el incendio» no es
  // Corvane contestando ni el tema atendido.
  const lineas = cuerpo.split('\n').filter((l) => !/^(?:Le |Les )?(?:preguntas|dices|pides|cuentas|gritas|ofreces)\b/.test(l));
  const respuesta = lineas.join('\n');
  const n = llano(entrada);

  const nombres = presentes.filter(Boolean).map((p) => p.split(/\s+/)[0]);
  const destinatario = nombres.find((p) => new RegExp(`\\b${llano(p)}\\b`).test(n)) ?? null;
  const habla = (quien) => new RegExp(`(?:^|\\n)${quien}\\b|,? (?:te )?(?:dice|suelta|contesta|responde|añade) ${quien}\\b|${quien} (?:lo|te|niega|asiente|sonr|duda|no )`, 'u').test(respuesta);
  const otros = nombres.filter((p) => p !== destinatario);
  const hablaOtro = otros.some((p) => habla(p)) && !(destinatario && habla(destinatario));
  const niega = NIEGA.test(respuesta);
  // A nadie en concreto: vale quien conteste. Una negativa cuenta como suya
  // si es él quien aparece en la escena («A Cormir se le tensa la cara…
  // «De eso no hablo», dice»).
  const atiendeDestinatario = destinatario
    ? (habla(destinatario) || (niega && new RegExp(`\\b${destinatario}\\b`).test(respuesta))) && !hablaOtro
    : true;

  const acto = actoDeHabla(entrada)?.acto ?? null;
  const tema = llano(entrada.replace(destinatario ? new RegExp(`\\b${destinatario}\\b`, 'g') : /$^/, ''))
    .split(/[^a-zñ]+/u).filter((w) => w.length >= 4 && !VACIAS.has(w));
  const r = llano(respuesta);
  const actoSinDato = [ACTO.OFRECER_AYUDA, ACTO.AGRADECER, ACTO.OFRECER, ACTO.PEDIR_AVISO, ACTO.DESPEDIRSE].includes(acto);
  // «¿Qué te ha pasado?» se atiende contando lo que le pasó, con sus
  // palabras: no hace falta que repita «pasado».
  const quePaso = /\bque (?:te |le )?(?:ha |han )?(?:pasado|ocurrido|sucedido)\b|\bque (?:te |le )?paso\b|\bque tal (?:sigue|sigues|esta|estas)\b|\bcomo (?:sigue|sigues|estas)\b/.test(n);
  // «¿Cómo se llama esto?» se atiende diciendo un nombre.
  const comoSeLlama = /\bcomo se llama\b/.test(n) && /«[^»]*\b(?:es|son)\s+\p{Lu}\p{Ll}+/u.test(respuesta);
  // Si se pregunta si se ha visto o si hay algo, el tema es eso; nombrar el
  // sitio («camino») no basta.
  const nucleo = nucleoDe(n);
  const atiendeTema = niega
    || (comoSeLlama || actoSinDato || quePaso
      ? /«[^»]{3,}»/.test(respuesta)
      : nucleo
        ? r.includes(raiz(nucleo))
        : tema.some((w) => r.includes(raiz(w))) || (acto === ACTO.SERVICIO && /«[^»]*(?:hay|templo|posada|fragua|mercado|aqui no|a \w+ de aqui)[^»]*»/i.test(respuesta)));

  const dato = /«[^»]{15,}»/.test(respuesta) && !/no s[eé] nada|pregunta a otro/i.test(respuesta.match(/«[^»]{15,}»/)?.[0] ?? '');
  const admite = /no (?:lo )?s[eé]|no he visto|no tengo ni idea|no sabr[ií]a/i.test(respuesta) && /pregunta (?:a|en)|en la posada|en el templo|a la guardia|al herrero|quien baje/i.test(respuesta)
    && !/pregunta a otro; de eso yo no entiendo/i.test(respuesta);
  const contenido = actoSinDato ? atiendeTema : (dato || admite);

  // Preguntarle a quien no está: lo correcto es decirlo, y no cuenta como
  // pregunta contestada ni fallada.
  const ausente = /^(?:No has visto a ning|No conoces a nadie con ese nombre)|no está aquí\.|ya se ha ido de aquí|ya no puede contestar/m.test(cuerpo);
  if (ausente) return { aplica: false, destinatario, atiendeDestinatario: true, tema, atiendeTema: true, contenido: false, atiende: true, informa: false, motivo: 'no está: se dice' };

  // Atender es contestar ÉL y sobre ESO. Informar, además, es dar un dato o
  // decir a quién preguntar; «de eso no sé nada» atiende pero no informa.
  const atiendeTodo = atiendeDestinatario && atiendeTema;
  const motivo = !atiendeDestinatario ? (hablaOtro ? 'contesta otro' : `${destinatario} no contesta`)
    : !atiendeTema ? (nucleo ? `no nombra lo preguntado (${nucleo})` : 'no nombra el tema')
      : niega ? 'se niega a contestar (vale, no informa)'
        : contenido ? 'atiende' : 'atiende, sin dato ni a quién preguntar';
  return { aplica: true, destinatario, atiendeDestinatario, tema: nucleo ? [nucleo] : tema, atiendeTema, contenido: niega ? false : contenido, atiende: atiendeTodo, informa: atiendeTodo && contenido && !niega, motivo };
}

/** ¿Es una pregunta, o un acto que pide respuesta de alguien? */
export function pideRespuesta(entrada) {
  const n = llano(entrada);
  const acto = actoDeHabla(entrada)?.acto;
  return /\?|\bpregunt/.test(n) || [ACTO.SERVICIO, ACTO.OFRECER_AYUDA, ACTO.AGRADECER, ACTO.OFRECER, ACTO.PEDIR_AVISO].includes(acto);
}

export default { atiende, pideRespuesta, soloEco };
