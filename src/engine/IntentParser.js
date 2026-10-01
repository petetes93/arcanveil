/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/IntentParser.js
 * ---------------------------------------------------------------------------
 * Interpretación del texto libre del jugador.
 *
 * Traduce «intento colarme por la ventana sin que me vean» en una intención
 * estructurada: tipo `hide`, habilidad `sigilo`, objetivo «ventana».
 *
 * Es lo que permite que la escritura libre no sea decorativa. Sin esto, el
 * jugador podría escribir lo que quisiera pero el motor no sabría qué tirada
 * pedir, y todo acabaría resolviéndose igual.
 *
 * El análisis es por capas, de más fiable a menos:
 *   1. Comandos explícitos (/dado, /estado)
 *   2. Opción elegida del popup, que ya trae su intención
 *   3. Verbo reconocido al principio de la frase
 *   4. Vocabulario disperso por el texto
 *   5. Habilidad deducida del catálogo
 *
 * Funciones puras.
 *
 * Dependencias: skills.data, config/ai.config.js, utils/text.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { HABILIDADES, deducirHabilidad } from '../data/skills.data.js';
import { DIRECTOR } from '../config/ai.config.js';
import { sinAcentos, limpiar } from '../utils/text.js';
import { actoDeHabla, ACTO } from './ActoDeHabla.js';
import { leerRecuento } from './Recuento.js';

/* ═══════════════════════════════════════════════════════════════════════════
   VOCABULARIO DE INTENCIONES
   ---------------------------------------------------------------------------
   Cada intención declara sus verbos, la habilidad que suele implicar y el
   umbral por defecto. El peso resuelve las ambigüedades: «atacar» pesa más
   como `attack` que «golpear», que también podría ser abrir algo a golpes.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} DefinicionIntencion
 * @property {string} tipo
 * @property {Record<string, number>} verbos Vocabulario → peso.
 * @property {string|null} habilidad Habilidad asociada por defecto.
 * @property {string} umbral Dificultad por defecto.
 * @property {boolean} requiereTirada
 */

/** @type {Record<string, DefinicionIntencion>} */
export const INTENCIONES = Object.freeze({

  attack: {
    tipo: 'attack',
    verbos: {
      atacar: 10, ataco: 10, golpear: 7, golpeo: 7, pegar: 6,
      apuñalar: 9, acuchillar: 9, disparar: 9, lanzar: 5, matar: 9,
      embestir: 8, cargar: 6, arremeter: 8, herir: 7, abatir: 8,
      // Las formas en primera, que son las que se escriben de verdad: nadie
      // teclea «disparar una flecha», teclea «disparo una flecha».
      apuñalo: 9, acuchillo: 9, disparo: 9, mato: 9, embisto: 8,
      arremeto: 8, hiero: 7, abato: 8, desenvaino: 6, remato: 8,
      // Los nombres de arma acompañan a un ataque, pero no lo declaran.
      //
      // Con su peso anterior bastaba nombrarlas: «guardo la espada» y «me
      // acerco con la mano lejos de la espada» se leían como atacar, y desde
      // que atacar abre combate de verdad eso significa empezar una pelea por
      // mencionar que llevas un arma encima. Se quedan con peso residual, para
      // desempatar cuando ya hay un verbo de ataque en la frase.
      espada: 1, arma: 1, flecha: 1,
    },
    habilidad: null,   // El ataque usa el arma, no una competencia.
    umbral: 'moderada',
    requiereTirada: true,
  },

  talk: {
    tipo: 'talk',
    verbos: {
      hablar: 10, hablo: 10, decir: 7, digo: 7, preguntar: 9, pregunto: 9,
      saludar: 8, conversar: 9, charlar: 8, comentar: 6, contar: 6,
      responder: 7, contestar: 7, dirigirme: 7, dirigirse: 7,
      cuento: 6, explico: 6, respondo: 7, contesto: 7,
    },
    habilidad: 'trato_social',
    umbral: 'facil',
    requiereTirada: false,
  },

  persuade: {
    tipo: 'persuade',
    verbos: {
      convencer: 10, convenzo: 10, persuadir: 10, persuado: 10,
      suplicar: 8, rogar: 8, pedir: 6, razonar: 8, apelar: 7,
      seducir: 7, encandilar: 7,
    },
    habilidad: 'trato_social',
    umbral: 'moderada',
    requiereTirada: true,
  },

  intimidate: {
    tipo: 'intimidate',
    verbos: {
      intimidar: 10, intimido: 10, amenazar: 10, amenazo: 10,
      asustar: 8, coaccionar: 9, presionar: 7, advertir: 6,
      gritar: 6, imponerme: 8,
      // Como se escribe: «le grito que se largue», «le exijo que hable».
      grito: 6, exijo: 7, advierto: 6,
    },
    habilidad: 'intimidacion',
    umbral: 'moderada',
    requiereTirada: true,
  },

  deceive: {
    tipo: 'deceive',
    verbos: {
      mentir: 10, miento: 10, engañar: 10, engaño: 10, fingir: 9,
      disimular: 8, disfrazar: 8, suplantar: 9, timar: 8,
      distraer: 7, despistar: 7,
    },
    habilidad: 'engano',
    umbral: 'moderada',
    requiereTirada: true,
  },

  negotiate: {
    tipo: 'negotiate',
    verbos: {
      negociar: 10, negocio: 10, regatear: 10, ofrecer: 8, proponer: 8,
      pactar: 9, acordar: 8, tratar: 6, sobornar: 9, comprar: 5, vender: 5,
      // Conjugados: «les ofrezco dos monedas para que me dejen pasar» se
      // leía como esperar (por «pasar») y la patrulla lo tomaba por ignorarla.
      ofrezco: 9, propongo: 8, soborno: 10, regateo: 10, pacto: 8,
    },
    habilidad: 'trato_social',
    umbral: 'moderada',
    requiereTirada: true,
  },

  explore: {
    tipo: 'explore',
    verbos: {
      explorar: 10, exploro: 10, avanzar: 8, avanzo: 8, seguir: 7,
      continuar: 7, adentrarme: 9, entrar: 7, salir: 6, subir: 6,
      bajar: 6, cruzar: 7, atravesar: 8, recorrer: 8,
    },
    habilidad: null,
    umbral: 'facil',
    requiereTirada: false,
  },

  search: {
    tipo: 'search',
    verbos: {
      buscar: 10, busco: 10, registrar: 10, registro: 9, rebuscar: 9,
      inspeccionar: 9, revisar: 8, rastrear: 8, husmear: 7,
      cachear: 8, escudriñar: 8,
    },
    habilidad: 'percepcion',
    umbral: 'moderada',
    requiereTirada: true,
  },

  observe: {
    tipo: 'observe',
    verbos: {
      mirar: 9, miro: 9, observar: 10, observo: 10, examinar: 9,
      fijarme: 8, contemplar: 7, estudiar: 8, escuchar: 8,
      atender: 6, vigilar: 8, esperar: 4,
      // Como se escribe jugando: «examino la orilla», «me fijo en la
      // balanza». Solo estaba el infinitivo, y eso salía sin tirada: mirar
      // con cuidado no podía encontrar nada.
      examino: 9, inspecciono: 9, inspeccionar: 9, fijo: 8, contemplo: 7,
      escucho: 8, vigilo: 8, reviso: 8, revisar: 8,
    },
    habilidad: 'percepcion',
    umbral: 'facil',
    requiereTirada: true,
  },

  hide: {
    tipo: 'hide',
    verbos: {
      esconderme: 10, esconderse: 10, escondo: 10, ocultarme: 10,
      colarme: 9, infiltrarme: 9, sigilo: 9, agazaparme: 8,
      acechar: 7, seguir: 4, espiar: 8, disimular: 5,
    },
    habilidad: 'sigilo',
    umbral: 'moderada',
    requiereTirada: true,
  },

  open: {
    tipo: 'open',
    verbos: {
      abrir: 10, abro: 10, forzar: 9, fuerzo: 9, desbloquear: 8,
      ganzúa: 10, ganzua: 10, descerrajar: 9, romper: 6,
      levantar: 5, destapar: 7,
    },
    habilidad: 'juego_manos',
    umbral: 'moderada',
    requiereTirada: true,
  },

  use_item: {
    tipo: 'use_item',
    verbos: {
      usar: 9, uso: 9, beber: 9, bebo: 9, comer: 9, como: 8,
      aplicar: 7, tomar: 6, consumir: 8, encender: 7, activar: 7,
      poción: 8, pocion: 8, vendar: 8,
    },
    habilidad: null,
    umbral: 'facil',
    requiereTirada: false,
  },

  cast: {
    tipo: 'cast',
    verbos: {
      lanzar: 6, conjurar: 10, invocar: 9, hechizar: 9, glifo: 10,
      trazar: 7, canalizar: 9, magia: 7, encantamiento: 8, ritual: 8,
    },
    habilidad: 'saber_arcano',
    umbral: 'moderada',
    requiereTirada: true,
  },

  flee: {
    tipo: 'flee',
    verbos: {
      huir: 10, huyo: 10, escapar: 10, escapo: 10, correr: 7,
      retirarme: 9, retroceder: 8, alejarme: 8, largarme: 9,
      abandonar: 7, salir: 5,
    },
    habilidad: 'acrobacias',
    umbral: 'moderada',
    requiereTirada: true,
  },

  rest: {
    tipo: 'rest',
    verbos: {
      descansar: 10, descanso: 10, dormir: 10, duermo: 10,
      acampar: 9, recuperarme: 8, sentarme: 6, reposar: 9,
      pernoctar: 9,
    },
    habilidad: null,
    umbral: 'facil',
    requiereTirada: false,
  },

  travel: {
    tipo: 'travel',
    verbos: {
      viajar: 10, viajo: 10, ir: 6, voy: 6, dirigirme: 8,
      partir: 8, parto: 8, marchar: 8, caminar: 7, volver: 7, regresar: 8,
      encaminarme: 8,
      // Como se dice de verdad al irse de un sitio. «Salgo del pueblo por el
      // camino del norte» se quedaba en `custom` y el personaje no se movía:
      // la narración decía que salías y el rótulo seguía en el mismo pueblo.
      salir: 8, salgo: 8, abandonar: 7, abandono: 7, largarme: 7, largo: 5,
      // Ambiguos: «tomo» y «sigo» solo cuentan como viaje cuando lo que se
      // toma o se sigue es un camino. «Tomo la espada» y «sigo al ladrón» no
      // son viajes, y por eso llevan freno en AMBIGUOS.
      tomar: 7, tomo: 7, sigo: 6,
      // En plural, que es como se habla yendo con compañeros: «vamos hacia
      // Saucedo» se quedaba en `custom` y nadie se movía. Llevan freno en
      // AMBIGUOS: «vamos a hablar con él» no es un viaje.
      vamos: 6, vayamos: 6, partimos: 8, marchamos: 8, volvemos: 7, regresamos: 8,
    },
    habilidad: null,
    umbral: 'facil',
    requiereTirada: false,
  },

  trade: {
    tipo: 'trade',
    verbos: {
      comerciar: 10, comprar: 9, compro: 9, vender: 9, vendo: 9,
      trueque: 8, regateo: 8, regatear: 8,
      // Sin sustantivos de sitio: «escucho las conversaciones del mercado»
      // abría el panel de compra y el turno se quedaba sin narrar.
    },
    habilidad: 'tasacion',
    umbral: 'facil',
    requiereTirada: false,
  },

  wait: {
    tipo: 'wait',
    verbos: {
      esperar: 9, espero: 9, aguardar: 9, quedarme: 7,
      permanecer: 7, pasar: 4, nada: 5,
    },
    habilidad: null,
    umbral: 'facil',
    requiereTirada: false,
  },
});

/* ═══════════════════════════════════════════════════════════════════════════
   VERBOS DE DOS CARAS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Verbos que significan dos cosas, con la prueba que decide cuál.
 *
 * «Partir» es irse y también romper. Vivía solo en `travel`, así que «intento
 * partir la montaña en dos de un tajo» —una hazaña desmedida, de las que el
 * juego sabe narrar— acababa en el enrutador de viajes y devolvía la línea de
 * sistema «No sabes cómo llegar a Los Pozos Hondos». Ni narración ni tirada:
 * el jugador escribe algo épico y el juego le contesta con un error de mapa.
 *
 * La prueba es la preposición. Uno parte HACIA un sitio, o parte y ya está; lo
 * que se parte sin preposición es una cosa. `\s*$` cubre «parto ya».
 *
 * Si no se confirma, el verbo simplemente no puntúa para ese tipo y la frase
 * se resuelve por lo demás que lleve: «partir la montaña» se queda sin verbo
 * reconocido y cae en el análisis por habilidad, que es donde la evalúa
 * `Ambicion`.
 *
 * @type {Record<string, {tipo: string, confirma: RegExp}>}
 */
/** Lo que convierte «tomo» o «sigo» en un viaje: que haya un camino de por medio. */
const RUMBO = /\b(camino|senda|sendero|ruta|calzada|vereda|carretera|rumbo)\b|\bhacia\s+(el|la|los|las)?\s*(norte|sur|este|oeste|salida)/;

/** Un verbo en plural seguido de un destino, no de un infinitivo. */
function DESTINO_PLURAL(verbo) {
  return new RegExp(`\\b${verbo}\\s+(?:hacia|para|rumbo|de vuelta|al\\b|a\\s+(?![a-zñ]+(?:ar|er|ir)\\b)[a-zñ])`);
}

const AMBIGUOS = Object.freeze({
  partir: { tipo: 'travel', confirma: /\bpartir\s+(hacia|para|rumbo|de vuelta|al\b|a\s+\w)|\bpartir\s*$/ },
  parto: { tipo: 'travel', confirma: /\bparto\s+(hacia|para|rumbo|de vuelta|al\b|a\s+\w|ya\b)|\bparto\s*$/ },

  // «Vamos a Saucedo» es un viaje; «vamos a hablar con él», no: tras «a»
  // no puede venir un infinitivo.
  vamos: { tipo: 'travel', confirma: DESTINO_PLURAL('vamos') },
  vayamos: { tipo: 'travel', confirma: DESTINO_PLURAL('vayamos') },
  partimos: { tipo: 'travel', confirma: /\bpartimos\s+(hacia|para|rumbo|de vuelta|al\b|a\s+\w|ya\b)|\bpartimos\s*$/ },
  marchamos: { tipo: 'travel', confirma: DESTINO_PLURAL('marchamos') },
  volvemos: { tipo: 'travel', confirma: DESTINO_PLURAL('volvemos') },
  regresamos: { tipo: 'travel', confirma: DESTINO_PLURAL('regresamos') },

  // Se toma y se sigue un camino, pero también una espada o un ladrón.
  tomar: { tipo: 'travel', confirma: RUMBO },
  tomo: { tipo: 'travel', confirma: RUMBO },
  sigo: { tipo: 'travel', confirma: RUMBO },
});

/* ═══════════════════════════════════════════════════════════════════════════
   COMANDOS DE DEPURACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/** Comandos que no consumen turno. */
export const COMANDOS = Object.freeze({
  '/dado': { descripcion: 'Tira dados: /dado 2d6+3' },
  '/estado': { descripcion: 'Muestra tu estado completo' },
  '/inventario': { descripcion: 'Abre el inventario' },
  '/misiones': { descripcion: 'Lista las misiones activas' },
  '/mapa': { descripcion: 'Muestra el mapa' },
  '/ayuda': { descripcion: 'Lista los comandos disponibles' },
  '/guardar': { descripcion: 'Guarda la partida' },
});

/* ═══════════════════════════════════════════════════════════════════════════
   GESTOS CON EL EQUIPO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cosas que se hacen con un arma sin que sean pelear.
 *
 * «Guardo la espada» se leía como ataque —«espada» puntúa para atacar— y
 * aunque desde hace poco ya no abre combate, seguía tirando dados: salía
 * «Todo encaja a la primera. Ni tú te esperabas que saliera así. SHHHNG.»
 * por guardar un arma. Guardar, colgar, limpiar o afilar no se pueden fallar,
 * así que no se tira. Desenvainar no está: sacar el arma sí es una amenaza.
 */
const VERBOS_GESTO = Object.freeze({
  guardo: 'guardas', envaino: 'envainas', enfundo: 'enfundas', cuelgo: 'cuelgas',
  ajusto: 'ajustas', limpio: 'limpias', afilo: 'afilas', reviso: 'revisas',
  compruebo: 'compruebas', engraso: 'engrasas', pulo: 'pules', coloco: 'colocas',
});

/** Armas que el jugador puede nombrar, con su género para concordar. */
export const ARMAS = Object.freeze({
  espada: 'f', hacha: 'f', daga: 'f', lanza: 'f', maza: 'f', ballesta: 'f',
  arco: 'm', cuchillo: 'm', martillo: 'm', escudo: 'm', baston: 'm', punal: 'm',
  mandoble: 'm', sable: 'm', estoque: 'm', garrote: 'm',
});

/** Verbos que declaran un ataque; los nombres de arma no cuentan. */
const DECLARA_ATAQUE = () => Object.entries(INTENCIONES.attack.verbos)
  .filter(([, peso]) => peso >= 5)
  .map(([v]) => sinAcentos(v));

/**
 * ¿Es un gesto con un arma? Solo si hay un verbo de gesto y un arma, y ningún
 * verbo de ataque: «guardo la espada y ataco» es un ataque.
 *
 * @param {string} texto
 * @returns {{verbo: string, segunda: string, arma: string}|null}
 */
export function leerGesto(texto) {
  const normal = sinAcentos(String(texto ?? '').toLowerCase());
  const palabras = normal.split(/[^a-zñ]+/u).filter(Boolean);

  const verbo = palabras.find((p) => VERBOS_GESTO[p]);
  const arma = palabras.find((p) => ARMAS[p]);
  if (!verbo || !arma) return null;

  const ataque = DECLARA_ATAQUE();
  if (palabras.some((p) => ataque.includes(p))) return null;

  return { verbo, segunda: VERBOS_GESTO[verbo], arma };
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL GRUPO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pedirle a alguien que se una, o despedir a quien va con él.
 *
 * Son frases que no se parecen a ninguna otra intención —«¿vienes conmigo?»
 * no es hablar a secas— y por eso se miran antes que el análisis léxico.
 */
const RECLUTA = /\b(vienes conmigo|te vienes|quieres venir conmigo|vente conmigo|venid conmigo|unete a mi|unete a nosotros|te unes|acompaname|acompañame|me acompanas|me acompañas|te pago para que|te pagare para que|necesito un guia|guiame|me guias|hazme de guia)\b/;
const DESPIDE = /\b(vete a casa|vuelve a casa|puedes irte|te puedes ir|despido a|nuestros caminos se separan|hasta aqui hemos llegado|ya no te necesito)\b/;
const PAGO = /\b(te pago|te pagare|te doy (?:oro|monedas|dinero)|pagarte|a cambio de (?:oro|monedas))\b/;

/**
 * @param {string} texto
 * @returns {{tipo: 'recruit'|'dismiss', pago: boolean}|null}
 */
export function leerGrupo(texto) {
  const t = sinAcentos(String(texto ?? '').toLowerCase());
  if (DESPIDE.test(t)) return { tipo: 'dismiss', pago: false };
  if (RECLUTA.test(t)) return { tipo: 'recruit', pago: PAGO.test(t) };
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANÁLISIS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} Intencion
 * @property {string} tipo Uno de DIRECTOR.intenciones.
 * @property {string|null} habilidad
 * @property {string} umbral
 * @property {boolean} requiereTirada
 * @property {string|null} objetivo Sustantivo hacia el que se dirige la acción.
 * @property {number} confianza 0-1.
 * @property {string} texto Texto original.
 * @property {boolean} esComando
 * @property {string|null} comando
 * @property {string[]} argumentos
 */

/**
 * Interpreta la acción del jugador.
 *
 * @param {string} texto
 * @param {Object} [contexto]
 * @param {string} [contexto.intencionSugerida] Si vino del popup.
 * @param {boolean} [contexto.enCombate=false]
 * @param {Array<Object>} [contexto.npcsPresentes]
 * @returns {Intencion}
 */
export function interpretar(texto, contexto = {}) {
  const original = limpiar(texto ?? '');

  const base = {
    tipo: 'custom',
    habilidad: null,
    umbral: 'moderada',
    requiereTirada: false,
    objetivo: null,
    confianza: 0,
    texto: original,
    esComando: false,
    comando: null,
    argumentos: [],
  };

  if (!original) return base;

  // ─── 1. Comandos ────────────────────────────────────────────────────────
  if (original.startsWith('/')) {
    const [comando, ...argumentos] = original.split(/\s+/);
    if (COMANDOS[comando.toLowerCase()]) {
      return { ...base, esComando: true, comando: comando.toLowerCase(), argumentos, confianza: 1 };
    }
  }

  // ─── 2. Intención sugerida por el popup ─────────────────────────────────
  // Si el jugador pulsó una opción, su intención ya viene declarada y es fiable.
  if (contexto.intencionSugerida && INTENCIONES[contexto.intencionSugerida]) {
    const def = INTENCIONES[contexto.intencionSugerida];
    return {
      ...base,
      ...def,
      objetivo: extraerObjetivo(original),
      confianza: 0.95,
    };
  }

  // ─── 2a. El grupo ───────────────────────────────────────────────────────
  const grupo = leerGrupo(original);
  if (grupo) {
    return { ...base, tipo: grupo.tipo, pago: grupo.pago, requiereTirada: false, objetivo: extraerObjetivo(original), confianza: 0.9 };
  }

  // ─── 2b. Gestos con el equipo ───────────────────────────────────────────
  // Van antes del análisis léxico porque ahí el nombre del arma puntúa para
  // atacar. Sin tirada: guardar un arma no se falla.
  const gesto = leerGesto(original);
  if (gesto) {
    return { ...base, tipo: 'custom', gesto, requiereTirada: false, objetivo: gesto.arma, confianza: 0.9 };
  }

  // ─── 2b'. Contar cosas no es contar algo a alguien ──────────────────────
  // «Cuento las monedas que llevo» puntuaba como hablar («cuento») y salía un
  // oyente inventado. Es mirar lo que hay; lo resuelve el motor con el dato
  // del estado (ver `engine/Recuento.js` y `ActionRouter._recontar`).
  const recuento = leerRecuento(original);
  if (recuento) {
    return { ...base, tipo: 'observe', habilidad: 'percepcion', requiereTirada: false, recuento, objetivo: null, confianza: 0.9 };
  }

  // ─── 2c'. Lanzarse contra alguien es atacar ─────────────────────────────
  // «Me lanzo contra el primero que vea» se narraba como un gesto: «lanzo»
  // suelto puede ser tirar una piedra, pero lanzarse CONTRA alguien no.
  if (/\bme (?:lanzo|abalanzo|tiro|echo) (?:contra|sobre|encima de)\b|\b(?:cargo|arremeto) contra\b/.test(sinAcentos(original.toLowerCase()))) {
    return { ...base, ...INTENCIONES.attack, objetivo: extraerObjetivo(original), confianza: 0.8 };
  }

  // ─── 2c. Un regalo no es un regateo ─────────────────────────────────────
  // «Le ofrezco un poco de mi agua» puntuaba como negociar por «ofrezco» y se
  // tiraba: salía «No cuela», como si hubiera algo que ceder. Se habla, sin
  // dado; lo que siente quien lo recibe lo pone quien narra.
  const acto = actoDeHabla(original);
  // Encararse con alguien tampoco es un ataque ni un regateo: es tensión, y
  // la reacción la pone quien lo recibe (ver `ProceduralProvider`).
  if (acto?.acto === ACTO.OFRECER || acto?.acto === ACTO.ENFRENTAR) {
    return { ...base, tipo: 'talk', habilidad: 'trato_social', requiereTirada: false, acto, objetivo: extraerObjetivo(original), confianza: 0.8 };
  }

  // ─── 3. Análisis léxico ─────────────────────────────────────────────────
  const normal = sinAcentos(original.toLowerCase());
  const palabras = normal.split(/\s+/).filter((p) => p.length > 2);

  const marcador = new Map();

  for (const [tipo, def] of Object.entries(INTENCIONES)) {
    let puntos = 0;

    for (const [verbo, peso] of Object.entries(def.verbos)) {
      const verboNormal = sinAcentos(verbo);

      // Un verbo ambiguo solo puntúa para su tipo si el contexto lo confirma.
      const amb = AMBIGUOS[verboNormal];
      if (amb && amb.tipo === tipo && !amb.confirma.test(normal)) continue;

      // El verbo al principio de la frase pesa el doble: «ataco al goblin» es
      // más claro que «al goblin, si me deja, quizá ataque».
      if (palabras[0] === verboNormal) puntos += peso * 2;
      else if (palabras.includes(verboNormal)) puntos += peso;
      // El respaldo existe para los verbos pegados a un signo («voy, y luego»),
      // que `palabras` deja como «voy,». Pero buscaba la subcadena a pelo, y
      // «ir» casa dentro de «partir»: «intento partir la montaña» puntuaba como
      // viaje por un verbo que no está. Con el límite de palabra delante sigue
      // cogiendo «voy,» y deja de inventarse verbos dentro de otros.
      else if (new RegExp(`\\b${verboNormal}`).test(normal)) puntos += peso * 0.6;
    }

    if (puntos > 0) marcador.set(tipo, puntos);
  }

  if (!marcador.size) {
    // Sin verbo reconocido: se prueba con el catálogo de habilidades.
    const habilidad = deducirHabilidad(original);
    if (habilidad) {
      return {
        ...base,
        tipo: 'custom',
        habilidad: habilidad.refId,
        umbral: 'moderada',
        requiereTirada: true,
        objetivo: extraerObjetivo(original),
        confianza: habilidad.confianza * 0.7,
      };
    }
    return { ...base, objetivo: extraerObjetivo(original) };
  }

  // ─── 4. Mejor candidato ─────────────────────────────────────────────────
  const orden = [...marcador.entries()].sort((a, b) => b[1] - a[1]);
  const [tipoElegido, puntos] = orden[0];
  const segundo = orden[1]?.[1] ?? 0;

  // La confianza combina fuerza absoluta y ventaja sobre el segundo.
  const ventaja = segundo > 0 ? (puntos - segundo) / puntos : 1;
  const fuerza = Math.min(puntos / 12, 1);
  const confianza = Math.min(ventaja * 0.5 + fuerza * 0.5, 1);

  const def = INTENCIONES[tipoElegido];

  const intencion = {
    ...base,
    tipo: def.tipo,
    habilidad: def.habilidad,
    umbral: def.umbral,
    requiereTirada: def.requiereTirada,
    // En un viaje manda el extractor de destinos: el general se quedaba con el
    // primer sintagma tras una preposición, y en «salgo del pueblo por el
    // camino del norte con la mano en la empuñadura» eso era «mano».
    objetivo: (def.tipo === 'travel' ? extraerDestino(original) : null) ?? extraerObjetivo(original),
    confianza,
  };

  // ─── 5. Ajustes por contexto ────────────────────────────────────────────
  return ajustarPorContexto(intencion, contexto);
}

/**
 * Ajusta la intención según la situación de la partida.
 *
 * En combate, «esperar» significa defenderse, no descansar. Hablar con alguien
 * requiere que haya alguien. Estas correcciones evitan resultados absurdos.
 *
 * @param {Intencion} intencion
 * @param {Object} contexto
 * @returns {Intencion}
 */
export function ajustarPorContexto(intencion, contexto) {
  const salida = { ...intencion };

  if (contexto.enCombate) {
    // Descansar en mitad de un combate no tiene sentido: se reinterpreta.
    if (salida.tipo === 'rest') {
      salida.tipo = 'wait';
      salida.requiereTirada = false;
    }
    // Huir en combate es más difícil que alejarse tranquilamente.
    if (salida.tipo === 'flee') {
      salida.umbral = 'dificil';
    }
    // Explorar durante un combate se interpreta como observar el campo.
    if (salida.tipo === 'explore' || salida.tipo === 'travel') {
      salida.tipo = 'observe';
      salida.habilidad = 'percepcion';
    }
  }

  // Hablar sin nadie delante rebaja la confianza.
  const hayNPC = (contexto.npcsPresentes?.length ?? 0) > 0;
  if (!hayNPC && ['talk', 'persuade', 'intimidate', 'deceive', 'negotiate'].includes(salida.tipo)) {
    salida.confianza *= 0.6;
  }

  return salida;
}

/**
 * Extrae el objetivo de la acción: el sustantivo al que se dirige.
 *
 * Busca tras las preposiciones habituales, que es donde suele estar en español:
 * «ataco AL goblin», «hablo CON la posadera», «miro EN el cofre».
 *
 * @param {string} texto
 * @returns {string|null}
 */
/**
 * Saca el destino de una frase de viaje.
 *
 * Hace falta aparte porque el extractor general busca el primer sintagma tras
 * una preposición y en «salgo del pueblo por el camino del norte con la mano
 * en la empuñadura» se quedaba con «mano»: el destino iba en medio, entre dos
 * complementos que no pintaban nada.
 *
 * Aquí se busca lo contrario: el camino o el punto cardinal, que es lo único
 * que puede ser un destino. Si no hay ninguno, se devuelve null y decide el
 * extractor general.
 *
 * @param {string} texto
 * @returns {string|null}
 */
function extraerDestino(texto) {
  const t = texto.toLowerCase();

  // «el camino del norte», «la senda de los pinos».
  const camino = t.match(/\b(?:el|la)\s+(camino|senda|sendero|ruta|calzada|vereda)\s+(?:del?|de la|de los|de las)\s+([a-záéíóúñü]+)/);
  if (camino) return `${camino[1]} del ${camino[2]}`;

  // «hacia el norte», «por el sur», «rumbo al oeste».
  const cardinal = t.match(/\b(?:hacia|rumbo a|rumbo al|por|al|hasta)\s+(?:el\s+|la\s+)?(norte|sur|este|oeste)\b/);
  if (cardinal) return cardinal[1];

  return null;
}

export function extraerObjetivo(texto) {
  const patrones = [
    /\b(?:a|al|a la|a los|a las)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?)/i,
    /\b(?:con|contra|hacia)\s+(?:el |la |los |las |un |una )?([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?)/i,
    /\b(?:en|sobre|dentro de)\s+(?:el |la |los |las |un |una )?([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?)/i,
    /\b(?:el|la|los|las|un|una)\s+([a-záéíóúñü]+)$/i,
  ];

  // Palabras funcionales que no pueden formar parte de un objetivo.
  const funcionales = /^(que|para|por|sin|con|como|donde|cuando|si|pero|y|o|a|de|del|al|en|el|la|los|las|un|una)$/i;

  // Locuciones adverbiales que los patrones capturan como si fueran objetivos:
  // «registro a fondo» no tiene por objetivo «fondo».
  const adverbiales = /^(fondo|dentro|traves|través|veces|solas|prisa|escondidas|oscuras|tientas|conciencia|cuidado|calma)$/i;

  for (const p of patrones) {
    const m = texto.match(p);
    if (!m?.[1]) continue;

    // El patrón puede capturar dos palabras: se recorta en cuanto aparece una
    // funcional. «al lobo con la espada» → «lobo», no «lobo con».
    const palabras = m[1].trim().split(/\s+/);
    const utiles = [];

    for (const palabra of palabras) {
      if (funcionales.test(palabra)) break;
      utiles.push(palabra);
    }

    if (utiles.length && !adverbiales.test(utiles[0])) return utiles.join(' ');
  }

  return null;
}

/**
 * Comprueba si una intención requiere que haya un objetivo válido.
 * @param {string} tipo
 * @returns {boolean}
 */
export function necesitaObjetivo(tipo) {
  return ['attack', 'talk', 'persuade', 'intimidate', 'deceive', 'negotiate', 'trade'].includes(tipo);
}

/**
 * Tipo de turno que corresponde a una intención, para elegir el perfil de
 * muestreo del proveedor.
 *
 * @param {Intencion} intencion
 * @param {Object} contexto
 * @returns {string}
 */
export function tipoDeTurno(intencion, contexto = {}) {
  if (contexto.enCombate) return 'combate';
  if (intencion.tipo === 'trade') return 'comercio';
  if (['talk', 'persuade', 'intimidate', 'deceive', 'negotiate'].includes(intencion.tipo)) return 'dialogo';
  return 'narracion';
}

export default {
  INTENCIONES,
  COMANDOS,
  interpretar,
  ajustarPorContexto,
  extraerObjetivo,
  necesitaObjetivo,
  tipoDeTurno,
};
