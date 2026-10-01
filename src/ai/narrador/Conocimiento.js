/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · ai/narrador/Conocimiento.js
 * ---------------------------------------------------------------------------
 * Qué sabe un PNJ de lo que le preguntan, y cómo lo cuenta.
 *
 * Antes, preguntar al herrero por el paso del norte daba «El paso del norte…
 * mira», y no terminaba la frase; al preguntarle otra vez reciclaba un rumor
 * sobre hierro que no venía a cuento. Las respuestas salían de tres
 * plantillas evasivas y de un gancho del lugar elegido al azar.
 *
 * Ahora la respuesta sale del estado:
 *   · del mapa — por dónde se va, cuántas horas, qué peligro, si cierra en
 *     invierno;
 *   · de lo que se sabe del lugar — su ficha, dicha con la voz de quien vive
 *     cerca;
 *   · de lo que el PNJ ha visto — situaciones de aquí y hechos recordados;
 *   · de su oficio — un herrero sabe de metal y de minas; un carretero, de
 *     caminos; una posadera, de quién pasa.
 *
 * Si no lo sabe, lo dice y señala a quién o dónde preguntar. Solo esquiva si
 * tiene una razón que se pueda contar (no se fía de ti, le negaste algo), y
 * esa razón se ve. Lo que cuenta un PNJ es lo que ÉL dice: se guarda como
 * testimonio suyo, no como verdad del mundo.
 *
 * Funciones puras: todo lo que necesita llega en los argumentos.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { LUGARES, obtenerLugar } from '../../data/locations.data.js';
import { buscarRasgo } from '../../data/rasgos.data.js';
import * as Mapa from '../../world/MapGraph.js';
import { seguirFrase } from '../../utils/text.js';
import { actoDeHabla } from '../../engine/ActoDeHabla.js';

const llano = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Palabras que no identifican nada: se ignoran al buscar de qué se habla. */
// También las palabras de la propia pregunta: en «le pregunto otra vez qué
// pasa» el tema no es «pregunto», y salía «De pregunto no sé nada».
const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'al', 'y', 'a', 'en', 'por', 'que', 'se', 'lo', 'le',
  'pregunto', 'preguntar', 'preguntarle', 'vuelvo', 'otra', 'vez', 'mas', 'sabes', 'sabe', 'sabeis', 'dime', 'cuentame', 'digo', 'hablo',
  'algo', 'eso', 'esto', 'aqui', 'ahora', 'tambien', 'entonces', 'bueno', 'vale', 'oye']);

/* ═══════════════════════════════════════════════════════════════════════════
   OFICIOS: DE QUÉ SABE CADA UNO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lo que un oficio conoce más allá de su pueblo.
 * `alcance` son los saltos del mapa que conoce de primera mano.
 */
const OFICIOS = Object.freeze({
  herrero: { alcance: 2, temas: /hierro|metal|arma|armas|espada|hacha|forja|fragua|mina|montana|clan|gremio|yunque/, fuente: 'la fragua' },
  carretero: { alcance: 3, temas: /camino|caminos|carro|ruta|paso|puente|peaje|carga/, fuente: 'los caminos' },
  mercader: { alcance: 3, temas: /precio|mercado|ruta|caravana|robo|bolsa|comprar|vender/, fuente: 'el mercado' },
  tendero: { alcance: 1, temas: /precio|harina|balanza|mercado|comprar|vender/, fuente: 'el mercado' },
  buhonero: { alcance: 3, temas: /camino|caminos|ruta|pueblo|pueblos|mula|genero/, fuente: 'los caminos' },
  posadero: { alcance: 2, temas: /viajero|viajeros|forastero|forasteros|gente|habitacion|comida|rumor/, fuente: 'la posada' },
  tabernero: { alcance: 2, temas: /viajero|viajeros|forastero|forasteros|gente|rumor|bebida/, fuente: 'la taberna' },
  guardia: { alcance: 2, temas: /ley|peaje|guardia|bandido|bandidos|ladron|robo|camino|manda|alcalde|capitan/, fuente: 'la guardia' },
  pastor: { alcance: 1, temas: /cabra|cabras|ganado|monte|campo/, fuente: 'el monte' },
  sacerdote: { alcance: 1, temas: /templo|dios|dioses|velo|muerto|muertos/, fuente: 'el templo' },
  cazador: { alcance: 2, temas: /bosque|caza|lobo|lobos|huellas|monte/, fuente: 'el monte' },
});

/** Quién sabría de qué: para mandar al jugador a alguien cuando no se sabe. */
const A_QUIEN = [
  [/camino|ruta|paso|distancia|norte|sur|pueblo|viaje/, 'a los carreteros o en la posada, que por ahí pasa todo el que viaja'],
  [/forastero|viajero|alguien|hombre|mujer|hermano|hermana|padre|madre/, 'en la posada: quien pasa por aquí duerme allí o come allí'],
  [/robo|ladron|bolsa|guardia|ley/, 'a la guardia del peaje'],
  [/hierro|metal|forja|mina/, 'al herrero'],
  [/lobo|bestia|animal|huella|rastro|perro|caza/, 'a quien baje del monte: cazadores, pastores; paran en la posada'],
];

/** Servicios de un pueblo, con cómo se nombran. */
const SERVICIO = Object.freeze({
  curandero: { nombre: 'un curandero' },
  herrero: { nombre: 'un herrero' },
  posada: { nombre: 'una posada' },
  templo: { nombre: 'un templo' },
  mercado: { nombre: 'un mercado' },
  establo: { nombre: 'un establo' },
});

function oficioDe(rol) {
  const r = llano(rol);
  return Object.entries(OFICIOS).find(([clave]) => r.startsWith(clave.slice(0, -1)))?.[1] ?? { alcance: 1, temas: null, fuente: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ¿DE QUÉ SE HABLA?
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resuelve de qué habla el texto: un lugar, alguien, un rasgo del sitio, lo
 * que le ha pasado, quién manda, forasteros…
 *
 * @param {string} texto Lo que pregunta el jugador.
 * @param {Object} escena
 * @param {string} escena.lugar refId del lugar actual.
 * @param {Array<{refId: string, nombre: string, rol?: string}>} [escena.conocidos] PNJ que existen.
 * @param {string} [escena.interlocutor] refId de a quien se pregunta.
 * @returns {{tipo: string, ref?: string, nombre?: string}}
 */
export function resolverTema(texto, { lugar, conocidos = [], interlocutor = null } = {}) {
  const n = llano(texto);

  if (/\bque (?:te |le |os |les )?(?:ha |han )?(?:pasado|ocurrido|sucedido)\b|\bque (?:te |le )?paso\b|\bestas bien\b/.test(n)) return { tipo: 'suceso' };
  // «¿Qué pasa aquí?» es lo que está pasando; «qué pasa por aquí», lo que se cuenta.
  if (/\bque (?:pasa|ocurre|sucede|esta pasando)\b(?! por aqui)/.test(n)) return { tipo: 'suceso' };
  if (/\bquien manda\b|\bquien gobierna\b|\bquien decide\b|\bla autoridad\b|\bel alcalde\b/.test(n)) return { tipo: 'autoridad' };
  if (/\bforaster|\bviajer|\bha(?:s)? visto (?:pasar )?a (?:alguien|algun)|\bdesconocid/.test(n)) return { tipo: 'forasteros' };

  if (/\bque se cuenta\b|\bque se dice\b|\brumor|\bnovedad|\bque hay de nuevo\b|\bnoticias\b|\bque pasa por aqui\b/.test(n)) return { tipo: 'rumores' };

  // «¿Hay un curandero?»: un servicio, que el pueblo tiene o no.
  const servicio = actoDeHabla(texto)?.servicio;
  if (servicio) return { tipo: 'servicio', servicio, nombre: SERVICIO[servicio]?.nombre ?? servicio };

  // El sitio donde se está: «cómo se llama esto», «quién vive aquí».
  if (/\b(?:como se llama (?:esto|este|el sitio|el pueblo|el lugar)|que (?:sitio|lugar|pueblo) es (?:este|esto)|donde estamos|quien vive aqui)\b/.test(n)) return { tipo: 'aqui', nombre: 'este sitio' };
  // Cómo está él: «¿qué tal sigues?».
  if (/\bque tal (?:sigue|sigues|esta|estas|va|vas|anda|andas)\b|\bcomo (?:sigue|sigues|esta usted|estas|te va|le va|anda|andas)\b/.test(n)) return { tipo: 'estado' };
  // Trabajo: «si alguien necesita un recado».
  if (/\b(?:trabajo|recado|encargo|faena|jornal)\b|\balguien necesita\b|\bnecesita alguien\b/.test(n)) return { tipo: 'trabajo', nombre: 'trabajo' };

  // Alguien con nombre, que no sea a quien se le pregunta.
  const persona =conocidos.find((p) => p?.nombre && p.refId !== interlocutor && new RegExp(`\\b${llano(p.nombre)}\\b`).test(n));
  if (persona) return { tipo: 'persona', ref: persona.refId, nombre: persona.nombre };

  // Un lugar del mapa. Gana el que comparte más palabras con el nombre; el
  // primer sustantivo pesa más («el paso del norte» es el Paso, al que se
  // llega por el Camino del Norte). Desempata la cercanía.
  const palabras = n.split(/[^a-zñ]+/u).filter((p) => p.length > 2 && !VACIAS.has(p));
  // «le pregunto a Vervek por el paso»: el tema va tras «por», no tras «a».
  const tema = n.match(/\b(?:por|sobre|acerca de|hacia|donde esta|donde queda)\s+(?:el |la |los |las |un |una |unos |unas |mi |mis |tu |su )?([a-zñ]+)/)?.[1]
    ?? n.match(/\b(?:de|a|del|al)\s+(?:el |la |los |las |un |una |unos |unas |mi |mis |tu |su )?([a-zñ]+)/)?.[1]
    ?? palabras[0];
  // Lo que se pregunta, tal como lo dijo: «la luna», «mi hermano».
  // Solo lo que de verdad nombra («por el paso», «hablar de un incendio»,
  // «conoce a los Cuervos Rojos»); si no nombra nada, no hay tema que
  // repetir. Salía «De necesita no sé nada» con la primera palabra suelta.
  // «Si han visto un lobo enorme por aquí»: el tema es el lobo, no «aquí».
  // Igual con «si han desaparecido perros», «si hay alguien enfermo», «si ha
  // soñado con una campana», «quién es el más rico del pueblo».
  const OBJETO = String.raw`((?:el |la |los |las |un |una |unos |unas |algún |algun |alguna |alguien )?\p{L}+(?:\s+(?!por\b|en\b|aquí\b|aqui\b|esta\b|este\b|alguna\b)\p{L}+){0,4})`;
  const visto = String(texto).match(new RegExp(String.raw`\bsi (?:ha|han|has|habéis|habeis) (?:\p{L}+(?:ado|ido|isto|echo|icho|uesto))\s+(?:por (?:aquí|aqui|allí|alli)\s+)?(?:alguna vez\s+)?(?:a |con |de |en )?${OBJETO}`, 'iu'))?.[1]
    ?? String(texto).match(new RegExp(String.raw`\bsi (?:hay|queda|quedan|existe|existen)\s+${OBJETO}`, 'iu'))?.[1]
    ?? String(texto).match(new RegExp(String.raw`\bquién (?:es|era|tiene)\s+${OBJETO}`, 'iu'))?.[1]
    // En directo: «¿Has visto a un hombre con capa roja?», «¿Sabes algo de un incendio?».
    ?? String(texto).match(new RegExp(String.raw`\b(?:has|ha|habéis|habeis) (?:visto|oído|oido)(?: hablar de)?\s+(?:a\s+)?${OBJETO}`, 'iu'))?.[1]
    ?? String(texto).match(new RegExp(String.raw`\b(?:sabes|sabe|sabéis|sabeis) (?:algo |nada )?(?:de|del|sobre)\s+${OBJETO}`, 'iu'))?.[1];
  const explicito = visto
    ?? String(texto).match(/\b(?:por|sobre|acerca de)\s+(?!aquí\b|aqui\b|allí\b|alli\b)([^,.;:!?¿¡«»"]+)/iu)?.[1]
    ?? String(texto).match(/\b(?:hablar de|oído hablar de|oido hablar de|sabes de|sabe de|conoce a|conoces a|conoce al|conoces al)\s+((?:el |la |los |las |un |una |unos |unas |mi |mis )?\p{L}+(?:\s+(?:de\s+)?\p{L}+){0,3})/iu)?.[1];
  const dicho = explicito ? explicito.trim().replace(/[?¿!¡.]+$/u, '').split(/\s+/).slice(0, 8).join(' ') : null;
  // «¿Quién es el más rico del pueblo?» pregunta por alguien, no por el
  // pueblo: sin esto se contestaba describiendo las calles.
  if (/\bquien (?:es|era|tiene)\b/.test(n) && dicho) return { tipo: 'otro', nombre: dicho };
  // «Si alguien ha visto mercenarios por el camino»: se pregunta por los
  // mercenarios; el camino es dónde. Contestaba cómo ir al Camino del Norte
  // porque «camino» era la palabra tras «por». Cuando la pregunta nombra lo
  // visto o lo que hay, un lugar solo es el tema si sale en eso nombrado.
  const nucleo = visto ? llano(visto).split(/[^a-zñ]+/u).filter((p) => p.length > 2 && !VACIAS.has(p)) : null;
  const enNucleo = (p) => !nucleo || nucleo.some((q) => q === p || (q.length > 4 && p.startsWith(q.slice(0, -1))));
  let mejor = null;
  for (const l of Object.values(LUGARES)) {
    if (!l?.refId || !l.nombre) continue;
    const suyas = llano(l.nombre).split(/[^a-zñ]+/u).filter((p) => p.length > 2 && !VACIAS.has(p));
    const comunes = suyas.filter((p) => palabras.some((q) => q === p || (q.length > 4 && p.startsWith(q.slice(0, -1)))));
    // Tiene que casar lo principal de la pregunta, o dos palabras del nombre:
    // «el incendio de la forja» no es Forja Alta por compartir «forja».
    if (!comunes.length || (!comunes.includes(tema) && comunes.length < 2)) continue;
    if (!comunes.some(enNucleo)) continue;
    const puntos = comunes.length * 2 + (comunes.includes(tema) ? 3 : 0) + (l.refId === lugar ? -1 : 0);
    const cerca = Mapa.ruta(lugar, l.refId)?.ruta?.length ?? 99;
    if (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && cerca < mejor.cerca)) mejor = { puntos, cerca, lugar: l };
  }
  if (mejor) return { tipo: 'lugar', ref: mejor.lugar.refId, nombre: mejor.lugar.nombre };

  // Algo que está aquí: el puente, el pozo, el río.
  // Lo mismo con lo que hay aquí: preguntar por «el incendio de la forja» no
  // es preguntar por la fragua.
  const rasgo = buscarRasgo(texto, lugar, obtenerLugar(lugar)?.terreno);
  if (rasgo && enNucleo(tema) && rasgo.palabras.split('|').some((w) => w === tema || w.split(' ').includes(tema))) return { tipo: 'rasgo', ref: rasgo.clave, rasgo };

  return { tipo: 'otro', nombre: dicho ?? '' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LO QUE SABE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Horas de marcha dichas como las diría alguien de pueblo. */
export function horasDichas(horas) {
  if (horas <= 2) return 'un par de horas';
  if (horas <= 5) return 'media mañana';
  if (horas <= 9) return 'una jornada';
  if (horas <= 14) return 'jornada y media';
  if (horas <= 22) return 'dos jornadas largas';
  const dias = Math.round(horas / 9);
  return `unos ${NUMEROS[dias] ?? dias} días`;
}

const NUMEROS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];

/** «El Camino del Norte» dentro de una frase: «el Camino del Norte». */
const enFrase = (nombre) => String(nombre).replace(/^(El|La|Los|Las)\s/, (a) => a.toLowerCase());

/** La primera frase de la ficha que habla de lo que se busca. */
function fraseDelLore(lugar, patron) {
  const frases = String(lugar?.promptLore ?? '').split(/(?<=\.)\s+/).filter(Boolean);
  return frases.find((f) => patron.test(llano(f))) ?? null;
}

/**
 * Los datos que un PNJ puede dar sobre un lugar, del más útil al menos.
 * Vacío si no lo conoce.
 */
function datosDeLugar(destino, { desde, alcance, estacion }) {
  const r = Mapa.ruta(desde, destino.refId);
  if (!r?.encontrada) return [];
  const saltos = r.ruta.length - 1;
  const datos = [];

  if (saltos === 0) {
    datos.push(destino.descripcion);
  } else if (saltos <= alcance) {
    const via = r.tramos.length > 1 ? `Se va por ${enFrase(r.tramos[0].nombreHasta)}` : 'Se va derecho por el camino';
    const cierra = r.tramos.find((t) => t.estacional);
    datos.push(`${via}: ${horasDichas(r.tiempoTotal)} a buen paso.`);
    if (cierra) datos.push(cierra.estacional === estacion ? 'Y ahora mismo está cerrado por la nieve.' : 'Con las primeras nieves se cierra, y hasta la primavera no se pasa.');
    if (r.peligroMaximo >= 3) datos.push('No es camino para ir solo: la última parte es mala.');
    const lore = String(destino.promptLore ?? '').split(/(?<=\.)\s+/).filter(Boolean);
    // Lo que no repite lo de la nieve, que ya está dicho.
    for (const f of lore) if (!/nieve|primavera/i.test(f)) datos.push(f);
  } else {
    // De oídas: lo que se cuenta, marcado como tal.
    const f = String(destino.promptLore ?? '').split(/(?<=\.)\s+/)[0];
    if (f) datos.push(`Por lo que cuentan: ${seguirFrase(f)}`);
    datos.push(`Yo no he ido nunca; queda lejos, ${horasDichas(r.tiempoTotal)} por lo menos.`);
  }
  return datos.filter(Boolean);
}

/**
 * «De X no sé nada», solo si X es un tema que se pueda decir. Un trozo
 * suelto de la pregunta («De aquí una mujer con un», «De un») se dice
 * «De eso».
 *
 * @param {string|null} nombre
 * @returns {string}
 */
function deQue(nombre) {
  const t = String(nombre ?? '').trim();
  const n = llano(t);
  const roto = !t || t.length < 3 || /\b(?:aqui|alli|eso|esto|un|una|unos|unas|que|si|con)$/.test(n) || /^(?:aqui|que|si|donde|como|quien)\b/.test(n)
    || n.split(/\s+/).length > 8;
  if (roto) return 'De eso';
  return `De ${t.replace(/^mi\b/i, 'tu').replace(/^mis\b/i, 'tus')}`.replace(/^De el /, 'Del ');
}

/**
 * Un hecho del mundo contado por quien lo vivió: «la cabra de Marlo se
 * comió el huerto» en boca de Marlo es «mi cabra se comió el huerto». Si
 * aun así se nombra a sí mismo, no lo puede decir así y se descarta.
 *
 * @param {string} texto
 * @param {{nombre?: string}|null} npc
 * @returns {string|null}
 */
function enSuBoca(texto, npc) {
  const nombre = npc?.nombre?.split(/\s+/)[0];
  if (!nombre) return texto;
  const propio = String(texto).replace(
    new RegExp(`\\b(?:el|la|los|las)\\s+(\\p{L}+)\\s+de\\s+${nombre}\\b`, 'giu'),
    (m, cosa) => (/^(?:los|las)\s/i.test(m) ? `mis ${cosa}` : `mi ${cosa}`),
  );
  return new RegExp(`\\b${nombre}\\b`, 'u').test(propio) ? null : propio;
}

/**
 * Qué sabe `npc` de lo que le preguntan.
 *
 * @param {Object} args
 * @param {Object} args.npc {refId, nombre, rol, actitud, memoria}
 * @param {string} args.texto La pregunta.
 * @param {string} args.lugar refId del lugar actual.
 * @param {Array<Object>} [args.conocidos] PNJ conocidos.
 * @param {Object|null} [args.situacion] La situación de aquí: {actores, agenda, texto}.
 * @param {Array<{texto: string}>} [args.hechos] Hechos recordados del mundo.
 * @param {string|null} [args.estacion]
 * @param {string|null} [args.lore] Historia del jugador: canon suyo, el PNJ no la conoce.
 * @returns {{tema: Object, datos: string[], nuevos: string[], yaDicho: string[], motivoEvasion: string|null, remite: string|null}}
 */
export function queSabe({ npc, texto, lugar, conocidos = [], situacion = null, hechos = [], sucesos = null, estacion = null, lore = null }) {
  // A quien se le pregunta no es el tema: «le pregunto a Dalrok si hay un
  // curandero» salía «De Dalrok no sé nada».
  // Sobre el texto original: el tema se repite con sus mayúsculas («los
  // Cuervos Rojos»), no en minúscula.
  const nombre = String(npc?.nombre ?? '').split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propio = nombre ? new RegExp(`(?:(?<!\\p{L})(?:a|al|con)\\s+)?(?<!\\p{L})${nombre}(?!\\p{L}),?`, 'giu') : null;
  const sinNombre = propio ? String(texto).replace(propio, ' ') : texto;
  const tema = resolverTema(sinNombre, { lugar, conocidos, interlocutor: npc?.refId });
  const oficio = oficioDe(npc?.rol);
  const aqui = obtenerLugar(lugar);
  let datos = [];

  switch (tema.tipo) {
    case 'lugar': {
      const destino = obtenerLugar(tema.ref);
      datos = destino ? datosDeLugar(destino, { desde: lugar, alcance: oficio.alcance, estacion }) : [];
      break;
    }
    case 'rasgo':
      datos = [tema.rasgo.ve];
      break;
    case 'aqui':
      if (aqui) datos.push(`Esto es ${aqui.nombre}. ${aqui.descripcion ?? ''}`.trim(), ...String(aqui.promptLore ?? '').split(/(?<=\.)\s+/).filter(Boolean).slice(0, 1));
      break;
    case 'estado': {
      // Si está metido en algo, se le nota; si no, lo de siempre.
      const metido = (situacion?.actores ?? []).some((a) => a.refId && a.refId === npc?.refId);
      datos.push(metido ? 'Ya ves cómo ando. Mejor no preguntes.' : 'Tirando, que no es poco.');
      break;
    }
    case 'trabajo': {
      // Lo que se necesita aquí de verdad: las noticias del lugar que piden
      // manos y lo que está pasando delante.
      for (const g of (aqui?.ganchos ?? []).filter((x) => /necesit|busca|falta|quiere|pide/.test(llano(x)))) datos.push(`Lo que sé es que ${g}.`);
      if (situacion?.texto) datos.push(`Y ahí tienes lo que está pasando: ${seguirFrase(String(situacion.texto).split(/(?<=\.)\s+/)[0])}`);
      break;
    }
    case 'servicio': {
      // De la ficha del lugar: lo que hay aquí, y si no, el sitio más cerca
      // que lo tiene. Nada que el mapa no diga.
      const s = tema.servicio;
      const sitio = aqui?.sublugares?.find((x) => x.tipo === s);
      if (aqui?.servicios?.includes(s)) {
        datos.push(sitio ? `${sitio.nombre}. Pregunta por ella a cualquiera y te la señalan.` : `Sí, aquí hay ${SERVICIO[s]?.nombre ?? s}.`);
        break;
      }
      datos.push(s === 'curandero' && aqui?.servicios?.includes('templo')
        ? 'Curandero como tal no hay. Prueba en el templo: allí saben de heridas más que nadie aquí.'
        : `Aquí no hay ${SERVICIO[s]?.nombre ?? s}.`);
      const cerca = (aqui?.conexiones ?? [])
        .map((c) => ({ l: obtenerLugar(c.hasta), r: Mapa.ruta(lugar, c.hasta) }))
        .filter((x) => x.l?.servicios?.includes(s) && x.r?.encontrada)
        .sort((a, b) => a.r.tiempoTotal - b.r.tiempoTotal)[0];
      if (cerca) datos.push(`En ${enFrase(cerca.l.nombre)} sí, a ${horasDichas(cerca.r.tiempoTotal)} de aquí.`);
      break;
    }
    case 'autoridad': {
      // Primero quién manda, dicho; luego lo que la ficha cuenta de ello.
      // Salía solo «Tres mil almas y una guardia de doce»: un dato, pero no
      // la respuesta a quién manda.
      const f = fraseDelLore(aqui, /manda|decide|guardia|clan|circulo|gremio|autoridad|ley/);
      const quien = [['alcalde', 'el alcalde'], ['consejo', 'el consejo'], ['circulo', 'el círculo'], ['clan', 'el clan'], ['gremio', 'el gremio'], ['guardia', 'la guardia']]
        .find(([k]) => llano(f ?? '').includes(k))?.[1];
      if (quien) datos.push(`Aquí manda ${quien}.${f ? ` ${f}` : ''}`);
      else if (f) datos.push(f);
      if (aqui?.servicios?.includes('templo')) datos.push('Para lo demás, el templo; para las peleas, la guardia.');
      break;
    }
    case 'forasteros': {
      // Los de la situación de aquí que no son del pueblo, y lo que se ve.
      const extranos = Object.values(situacion?.actores ?? {}).filter((a) => /encapuchad|buhoner|forastero|viajero/.test(llano(a.rol)));
      for (const a of extranos) datos.push(`Hoy, ${a.rol === 'encapuchado' ? `uno con capucha que no se quita, ${a.nombre} dicen que se llama, y no compra nada` : `${a.nombre}, ${a.rol}`}.`);
      if (aqui?.servicios?.includes('posada')) datos.push('Los que pasan de verdad duermen en la posada. Allí sabrán más.');
      break;
    }
    case 'persona': {
      const p = conocidos.find((c) => c.refId === tema.ref);
      if (p) {
        const actitud = p.actitud ?? 0;
        datos.push(`${p.rol ? `Es ${p.genero === 'f' ? 'la' : 'el'} ${p.rol}` : 'Anda por aquí'}${actitud >= 30 ? ', buena gente' : actitud <= -20 ? ', y yo que tú no me fiaba' : ''}.`);
        // Lo que se ve de él, no lo que pretende: eso no lo sabe quien
        // contesta.
        const suyo = Object.values(situacion?.actores ?? {}).find((a) => a.refId === p.refId);
        if (suyo && situacion?.texto) datos.push(situacion.texto);
      }
      break;
    }
    case 'suceso': {
      // Si a él no le ha pasado nada (el testimonio lo pone el narrador
      // antes, si lo hay), cuenta lo último que ha pasado aquí de verdad: un
      // hecho del mundo, no lo que se comenta ni lo que dijo otro.
      // Lo que pasó de verdad (los sucesos del mundo), si se tienen.
      const ultimo = (sucesos ?? (hechos ?? []).map((h) => h.texto))
        .filter((t) => t && !/^(?:Según |En .+?: |En .+? se comenta|[^\s(]+ \([^)]+\): |El personaje |Conoció a )/.test(t) && !/quiere|intentará|necesita/.test(t))
        .at(-1);
      const propio = ultimo ? enSuBoca(ultimo, npc) : null;
      datos.push(propio ? `¿A mí? Nada. Lo que ha pasado aquí es esto: ${seguirFrase(propio)}` : '¿A mí? Nada. Aquí no ha pasado nada que yo sepa.');
      break;
    }
    case 'rumores': {
      // Lo que se comenta en el pueblo: los rumores que conoce y lo que pasa
      // en el sitio. Aquí sí vale el gancho del lugar: es una noticia.
      datos.push(...(npc?.conocimiento?.rumores ?? []));
      // Lo que el jugador ya ha oído en la calle no se le cuenta como nuevo.
      const oidos = (hechos ?? []).map((h) => llano(h.texto));
      const nuevos = (aqui?.ganchos ?? []).filter((g) => !oidos.some((t) => t.includes(llano(g))));
      for (const [i, g] of nuevos.entries()) datos.push(`${i ? 'Y también que' : 'Se comenta que'} ${g}.`);
      break;
    }
    default: {
      // Su oficio: si le preguntan por lo suyo, habla de lo suyo, y ahí
      // encaja la noticia del lugar que toca su oficio.
      if (oficio.temas?.test(llano(texto))) {
        const suyo = (aqui?.ganchos ?? []).find((g) => oficio.temas.test(llano(g)));
        if (suyo) datos.push(`Lo que te puedo decir es que ${suyo}.`);
      }
      break;
    }
  }

  // Lo que ha visto con sus ojos pesa más que lo que sabe de oídas.
  const vistos = (hechos ?? []).map((h) => h.texto).filter((t) => tema.nombre && llano(t).includes(llano(tema.nombre)));
  datos.push(...vistos.map((t) => enSuBoca(t, npc)).filter(Boolean).map((t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`));

  // Lo que ya le ha contado no lo repite como nuevo.
  const dicho = new Set([
    ...(npc?.conocimiento?.compartidos ?? []),
    ...(npc?.memoria ?? []).filter((m) => m.tipo === 'dicho').map((m) => m.texto),
  ]);
  const nuevos = datos.filter((d) => !dicho.has(d));
  const yaDicho = datos.filter((d) => dicho.has(d));

  // Esquivar necesita un motivo que se pueda contar: no se fía, le negaste
  // algo, o toca algo que esconde.
  const negativa = (npc?.memoria ?? []).some((m) => m.tipo === 'negativa');
  const actitud = typeof npc?.actitud === 'number' ? npc.actitud : 0;
  const claveTema = llano(`${texto} ${tema.nombre ?? ''}`);
  const COMUNES = new Set(['algo', 'pero', 'para', 'como', 'esta', 'este', 'todo', 'nada', 'hace', 'donde', 'quien', 'desde', 'hasta']);
  // Dónde está la fragua lo sabe y lo dice cualquiera: preguntar por un
  // servicio no roza ningún secreto aunque comparta palabra con él.
  const tocaSecreto = tema.tipo !== 'servicio' && (npc?.conocimiento?.secretos ?? []).some((s) => llano(s).split(/[^a-zñ]+/u)
    .some((p) => p.length >= 4 && !COMUNES.has(p) && new RegExp(`\\b${p}\\b`).test(claveTema)));
  const motivoEvasion = actitud <= -30 ? 'desconfianza'
    : tocaSecreto && actitud < 50 ? 'secreto'
      : negativa && actitud < 10 ? 'rencor' : null;

  // Si no sabe: a quién preguntar.
  const clave = llano(`${texto} ${tema.nombre ?? ''}`);
  // Por alguien con nombre («Varenne», «los Cuervos Rojos») se pregunta
  // donde para la gente que viaja, si aquí hay posada.
  const conNombre = /^\p{Lu}/u.test(String(tema.nombre ?? '').replace(/^(?:el|la|los|las|a|al)\s+/iu, ''));
  const remite = A_QUIEN.find(([re]) => re.test(clave))?.[1]
    ?? (conNombre && aqui?.servicios?.includes('posada') ? 'en la posada: por allí pasa todo el que viaja' : 'a otro; de eso yo no entiendo');

  // Su propia historia (la del jugador) no la conoce nadie de aquí.
  const suPasado = Boolean(lore) && tema.tipo === 'otro' && palabrasComunes(clave, lore);

  return { tema, datos, nuevos, yaDicho, motivoEvasion, remite, suPasado, oficio };
}

function palabrasComunes(a, b) {
  const suyas = new Set(llano(b).split(/[^a-zñ]+/u).filter((p) => p.length >= 5));
  return llano(a).split(/[^a-zñ]+/u).some((p) => p.length >= 5 && suyas.has(p));
}

/* ═══════════════════════════════════════════════════════════════════════════
   CÓMO LO CUENTA
   ═══════════════════════════════════════════════════════════════════════════ */

const comillas = (t) => `«${String(t).trim().replace(/^«|»$/g, '')}»`;

/**
 * La respuesta dicha, en líneas, y lo que queda registrado.
 *
 * La forma depende de la actitud y de lo que sabe, no de un dado de frases:
 * quien te aprecia cuenta más y añade lo que le parece útil; quien no se fía
 * contesta lo justo y se nota por qué.
 *
 * @param {ReturnType<typeof queSabe>} saber
 * @param {Object} npc
 * @param {Object} [opciones]
 * @param {(l: string[]) => string} [opciones.elegir]
 * @returns {{lineas: string[], contado: string[]}}
 */
export function responder(saber, npc, { elegir = (l) => l[0], seco = false, recordado = false } = {}) {
  const nombre = npc?.nombre ?? 'Quien tienes delante';
  const actitud = typeof npc?.actitud === 'number' ? npc.actitud : 0;
  const lineas = [];
  const contado = [];

  if (saber.motivoEvasion) {
    // Si ya se ha dicho que se acuerda de la negativa, no se repite.
    const motivo = saber.motivoEvasion === 'rencor'
      ? (recordado ? '' : `${nombre} no ha olvidado tu negativa, y se le nota en la voz.`)
      : saber.motivoEvasion === 'secreto'
        ? `A ${nombre} se le tensa la cara al oírlo. Es la primera vez que duda antes de contestar.`
        : `${nombre} te mira de arriba abajo antes de contestar: no se fía de ti.`;
    if (motivo) lineas.push(motivo);
    // Un secreto no se suelta: se nota que lo hay, y eso ya es una pista.
    const uno = saber.motivoEvasion === 'secreto' ? null : (saber.nuevos[0] ?? saber.yaDicho[0]);
    if (saber.motivoEvasion === 'secreto') {
      lineas.push(`${comillas('De eso no hablo')}, dice, y cambia de tema demasiado deprisa.`);
    } else if (uno) {
      lineas.push(`${comillas(sinPunto(recortarPrimera(uno)))}, dice ${nombre}, y no añade nada más.`);
      contado.push(uno);
    } else {
      lineas.push(`${comillas('Pregunta a otro')}, dice, y se vuelve a lo suyo.`);
    }
    return { lineas, contado };
  }

  if (saber.suPasado) {
    const de = deQue(saber.tema.nombre);
    lineas.push(`${nombre} niega despacio. ${comillas(`${de} no sé nada, y no voy a inventármelo`)}.`);
    lineas.push(`${comillas(`Si alguien sabe, pregunta ${saber.remite}`)}.`);
    return { lineas, contado };
  }

  if (!saber.nuevos.length && saber.yaDicho.length) {
    lineas.push(`${comillas(`Ya te lo he dicho: ${minus(saber.yaDicho[0])}`)}. ${nombre} no tiene más que añadir.`);
    return { lineas, contado };
  }

  if (!saber.nuevos.length) {
    const que = deQue(saber.tema.nombre);
    lineas.push(`${nombre} lo piensa y niega. ${comillas(`${que} no sé nada. Pregunta ${saber.remite}`)}.`);
    return { lineas, contado };
  }

  // Cuenta lo nuevo: una o dos cosas, más si te aprecia.
  const cuantos = actitud >= 30 ? 3 : 2;
  const dice = saber.nuevos.slice(0, cuantos);
  contado.push(...dice);
  const [dato, ...resto] = dice;
  // El tema por delante, como se contesta de verdad: «¿Saucedo? Aldea
  // pequeña…». Sin él, la ficha del lugar dicha tal cual sonaba a enciclopedia.
  // Solo la primera vez: al volver a preguntar ya se sabe de qué se habla.
  const conTema = ['lugar', 'rasgo', 'persona'].includes(saber.tema.tipo) && saber.tema.nombre && !dato.includes('?');
  const eco = conTema && !saber.yaDicho.length ? `¿${saber.tema.nombre}? ` : '';
  // Al volver a preguntar, lo nuevo va atado al tema: «Transitado de día»
  // suelto no decía de qué hablaba.
  const sobre = String(saber.tema.nombre ?? '').replace(/^(El|La|Los|Las)\s/, (a) => a.toLowerCase());
  const ancla = conTema && saber.yaDicho.length ? `${/^el\s/.test(sobre) ? `Del ${sobre.slice(3)}` : `De ${sobre}`}, además: ` : '';
  const primera = ancla ? `${ancla}${minus(dato)}.` : `${eco}${dato}`;
  // Quien contesta sin ganas no «lo dice sin pensarlo»: lo suelta y ya.
  const entrada = seco ? `${comillas(sinPunto(primera))}, suelta ${nombre}.` : elegir([
    `${comillas(sinPunto(primera))}, te dice ${nombre}.`,
    `${nombre} no tiene que pensarlo. ${comillas(primera)}`,
    `${comillas(primera)} ${nombre} lo dice sin dejar lo que está haciendo.`,
  ]);
  lineas.push(entrada);
  if (resto.length) lineas.push(comillas(resto.join(' ')));
  if (saber.nuevos.length > cuantos) lineas.push(`Parece que sabe más de lo que ha dicho.`);
  return { lineas, contado };
}

function sinPunto(t) {
  return String(t).trim().replace(/\.$/, '');
}

function recortarPrimera(t) {
  return String(t).split(/(?<=\.)\s+/)[0];
}

function minus(t) {
  return seguirFrase(String(t).trim().replace(/\.$/, ''));
}

export default { resolverTema, queSabe, responder, horasDichas };
