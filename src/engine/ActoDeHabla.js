/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/ActoDeHabla.js
 * ---------------------------------------------------------------------------
 * Qué HACE el jugador cuando habla, además de a quién y de qué.
 *
 * «Le pregunto a Berdar si necesita ayuda» tiene forma de pregunta, pero no
 * pide un dato: ofrece ayuda. Se contestaba como una pregunta de
 * conocimiento («De eso no sé nada. Pregunta a otro»). «Le ofrezco un poco de
 * mi agua» se leía como un regateo y se tiraba («No cuela»). «Me siento a
 * escuchar lo que se habla» describía el río. «Gracias, me has ayudado» no
 * tenía respuesta. Los cuatro fallos son el mismo: se miraba la forma de la
 * frase y no el acto.
 *
 * Aquí se clasifica el acto, una sola vez, para todos: el analizador de
 * intenciones (si se tira o no), la interpretación del turno (que la ve el
 * modelo) y el narrador procedural (qué contesta).
 *
 * Función pura.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sinAcentos } from '../utils/text.js';

const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

/** Actos que cambian lo que toca contestar. */
export const ACTO = Object.freeze({
  PREGUNTA: 'pregunta',
  SERVICIO: 'servicio',
  OFRECER_AYUDA: 'ofrecer_ayuda',
  OFRECER: 'ofrecer',
  AGRADECER: 'agradecer',
  PEDIR_AVISO: 'pedir_aviso',
  DESPEDIRSE: 'despedirse',
  ESCUCHAR: 'escuchar',
  ABRIR_CHARLA: 'abrir_charla',
  ENFRENTAR: 'enfrentar',
  ALEJAR: 'alejar',
});

/** «Déjame en paz», «lárgate»: que le dejen tranquilo. No es pedir un favor. */
const ALEJAR = /\b(?:dejame|dejadme|dejeme) (?:en paz|tranquil[oa]s?|solo|sola)\b|\b(?:largate|largaos|vete de aqui|apartate|quitate de en medio|no me molestes)\b/;

/** «Hablo con Cordor» y nada más: abrir conversación, sin tema todavía. */
const ABRIR_CHARLA = /^(?:(?:me acerco|voy|me dirijo)\s+(?:a|al|a la|hacia)\s+[^,.;]+?\s+(?:y\s+)?)?(?:hablo|charlo|converso|me pongo a hablar|entablo conversacion|voy a hablar|me acerco a hablar|me paro a hablar|intento hablar)\s+(?:un rato\s+)?con\s+[^,.;?]+?(?:\s+un rato)?$/;
/** Encararse con alguien: tensión, no combate. */
const ENFRENTAR = /\b(?:me enfrento (?:a|con)|me encaro con|encaro a|le planto cara|planto cara a|confronto a|le hago frente|hago frente a|me pongo delante de)\b/;

/** Lo que se regala sin pedir nada a cambio. */
const REGALABLE = 'agua|comida|pan|vino|cerveza|odre|cantimplora|queso|fruta|manzanas?|racion(?:es)?|tabaco|manta|capa|flor(?:es)?|carne|cecina|hidromiel|licor|trago|sopa|caldo|galletas?|nueces|miel|bollo';

/** Servicios que un pueblo tiene o no, y cómo se piden. */
const SERVICIOS = Object.freeze({
  curandero: /curander|sanador|medico|boticari|herbolari|cirujan|alguien que (?:me )?cure|quien (?:me )?cure|hierbas para/,
  herrero: /herrer|\bforja\b|fragua/,
  posada: /posada|taberna|meson|alojamiento|una cama|(?:donde|sitio para|lugar para) (?:se puede |puedo |podria |poder )?(?:dormir|pasar la noche|comer)/,
  templo: /templo|santuario|capilla|sacerdot/,
  // «¿Qué se compra y qué se vende?», «si alguien vende corteza de sauce».
  mercado: /mercado|tienda|donde comprar|que se (?:compra|vende)|(?:alguien|quien) (?:vende|compra)/,
  establo: /establo|cuadra|caballeriza/,
});

const ESCUCHAR = /\b(?:me (?:siento|pongo|quedo) a (?:escuchar|oir)|me quedo (?:un rato |un momento )?(?:oyendo|escuchando)|(?:oyendo|escuchando) (?:lo que|a la gente|las conversaciones|los rumores)|escucho (?:lo que|las conversaciones|a la gente|a los|a las|los rumores)|pego la oreja|presto (?:atencion|oido)|pongo (?:la )?oreja|atiendo a lo que|a ver que se (?:dice|cuenta|habla|comenta)|(?:escuchar|oir) (?:lo que se|las conversaciones|a la gente|los rumores|que se dice)|oigo lo que (?:se )?(?:dice|habla|cuenta)|escucho\b(?! a \p{Lu}))/u;
const AGRADECER = /\b(?:gracias|te agradezco|le agradezco|os agradezco|les agradezco|doy las gracias|agradecid[oa])\b/;
const OFRECER_AYUDA = /\bsi (?:necesita|necesitas|necesitan|necesitais)\b|\b(?:si )?puedo hacer algo por\b|\b(?:te|le|os|les) (?:puedo )?(?:ayudo|ayudar|echo una mano|echar una mano)\b|\bpuedo ayudar|\ben que (?:te|le|os|les) (?:puedo )?ayud|\bme ofrezco a ayudar|\b(?:le|te|les|os) ofrezco (?:mi )?ayuda|\bquieres? que (?:te|le) (?:ayude|eche una mano)|\bnecesita(?:s|n)? (?:ayuda|una mano)\b/;
const PEDIR_AVISO = /\b(?:avisame|me avisas|me avisaras|avisa(?:me)? si|dime si (?:lo |la )?(?:ves|oyes)|me dices si)\b/;
const DESPEDIRSE = /\b(?:adios|me despido|hasta luego|hasta pronto|nos vemos|que te vaya bien)\b/;

/**
 * El acto de habla de un texto del jugador.
 *
 * @param {string} texto
 * @returns {{acto: string, cosa?: string, servicio?: string}|null} null si no es un acto de habla que cambie la respuesta.
 */
export function actoDeHabla(texto) {
  const n = llano(texto);
  if (!n) return null;
  if (ESCUCHAR.test(n)) return { acto: ACTO.ESCUCHAR };
  if (ENFRENTAR.test(n)) return { acto: ACTO.ENFRENTAR };
  if (ALEJAR.test(n)) return { acto: ACTO.ALEJAR };
  // Con tema detrás del nombre («hablo con Cordor del incendio») ya es una
  // pregunta, no solo abrir la conversación.
  const conTema = /\bcon\s+\p{Lu}\p{Ll}+\s+(?:de|del|sobre|acerca|por)\b/u.test(String(texto));
  if (!conTema && ABRIR_CHARLA.test(n.replace(/[.!]+$/, '').trim())) return { acto: ACTO.ABRIR_CHARLA };
  if (OFRECER_AYUDA.test(n)) return { acto: ACTO.OFRECER_AYUDA };
  // «Le ofrezco a Berdar un poco de mi agua»: el destinatario puede ir en medio.
  const regalo = n.match(new RegExp(`\\b(?:le|te|les|os) (?:ofrezco|doy|regalo|tiendo|acerco|paso|comparto)(?: (?:a|al|a la) \\p{L}+(?: \\p{L}+)?)? (?:un poco de |algo de |un trago de |parte de |un trozo de |un pedazo de |media |un mendrugo de )?(?:mi |mis |un |una |el |la |unos |unas )?(${REGALABLE})\\b`, 'u'));
  // A un animal no se le regala: se le atrae («le ofrezco pan a la cabra»).
  const aUnAnimal = /\b(?:a la|al|a los|a las|a una|a un) (?:cabra|perro|perra|caballo|yegua|mula|burro|asno|gato|oveja|lobo|animal|bestia|cerdo|vaca|gallina|cuervo|halcon)s?\b/.test(n);
  if (regalo && !aUnAnimal && !/\ba cambio\b|\bsi me\b|\bpara que\b|\bpor (?:que|dejarme)\b/.test(n)) return { acto: ACTO.OFRECER, cosa: regalo[1] };
  if (AGRADECER.test(n)) return { acto: ACTO.AGRADECER };
  if (PEDIR_AVISO.test(n)) return { acto: ACTO.PEDIR_AVISO };
  const pide = /\?|\b(?:pregunt\w*|hay|habra|donde|sabes|sabe|conoces|conoce|busco|necesito|alguien)\b/.test(n);
  if (pide) {
    for (const [servicio, re] of Object.entries(SERVICIOS)) {
      if (re.test(n) && /\b(?:hay|habra|donde|conoce|conoces|sabe|sabes|busco|necesito|alguien|algun|alguna|quien|que se)\b/.test(n)) return { acto: ACTO.SERVICIO, servicio };
    }
  }
  if (DESPEDIRSE.test(n)) return { acto: ACTO.DESPEDIRSE };
  if (/\?|\bpregunt/.test(n)) return { acto: ACTO.PREGUNTA };
  return null;
}

export default { actoDeHabla, ACTO };
