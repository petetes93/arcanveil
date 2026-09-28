/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/Infinitivo.js
 * ---------------------------------------------------------------------------
 * Acciones escritas en infinitivo, y el intento de una acción.
 *
 * Las sugerencias del juego van en infinitivo («Fijarte en la figura del
 * tejado», «Hablar con Cordor») y mucha gente escribe igual. El motor espera
 * primera persona: «Fijarte en…» se tomaba por algo que se le DICE a alguien
 * (el «-te» parecía un «a ti») y salía «Le dices: «Fijarte en la figura del
 * tejado»». Aquí se pasa a primera persona antes de interpretar.
 *
 * Y al revés: un intento que falla o que es imposible no se narra como hecho.
 * «Salto 100 metros hasta el tejado» salía «Saltas 100 metros hasta el
 * tejado» antes de contar que no; ahora sale «Intentas saltar…».
 *
 * Solo se tocan los verbos de la lista: un sustantivo en -ar («Collar de
 * plata…») no se conjuga por error.
 *
 * Funciones puras.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sinAcentos } from '../utils/text.js';

/** Infinitivo → primera persona del presente. Los regulares se deducen. */
const IRREGULARES = Object.freeze({
  ir: 'voy', ser: 'soy', estar: 'estoy', dar: 'doy', ver: 'veo', hacer: 'hago', decir: 'digo', salir: 'salgo', poner: 'pongo',
  tener: 'tengo', venir: 'vengo', traer: 'traigo', caer: 'caigo', oir: 'oigo', saber: 'sé', caber: 'quepo', valer: 'valgo',
  seguir: 'sigo', pedir: 'pido', elegir: 'elijo', conseguir: 'consigo', perseguir: 'persigo', servir: 'sirvo', repetir: 'repito',
  volver: 'vuelvo', mover: 'muevo', contar: 'cuento', probar: 'pruebo', oler: 'huelo', huir: 'huyo', dormir: 'duermo', morir: 'muero',
  recordar: 'recuerdo', encontrar: 'encuentro', mostrar: 'muestro', sonar: 'sueno', soltar: 'suelto', volar: 'vuelo', rogar: 'ruego',
  acostar: 'acuesto', costar: 'cuesto', colgar: 'cuelgo', jugar: 'juego', pensar: 'pienso', cerrar: 'cierro', empezar: 'empiezo',
  comenzar: 'comienzo', despertar: 'despierto', sentar: 'siento', calentar: 'caliento', atravesar: 'atravieso', negar: 'niego',
  entender: 'entiendo', perder: 'pierdo', defender: 'defiendo', encender: 'enciendo', querer: 'quiero', sentir: 'siento', mentir: 'miento',
  advertir: 'advierto', preferir: 'prefiero', conocer: 'conozco', parecer: 'parezco', ofrecer: 'ofrezco', agradecer: 'agradezco',
  aparecer: 'aparezco', desaparecer: 'desaparezco', obedecer: 'obedezco', conducir: 'conduzco', coger: 'cojo', recoger: 'recojo',
  escoger: 'escojo', proteger: 'protejo', dirigir: 'dirijo', exigir: 'exijo', fingir: 'finjo', distinguir: 'distingo', construir: 'construyo',
  destruir: 'destruyo', incluir: 'incluyo', reir: 'río', sonreir: 'sonrío', enviar: 'envío', confiar: 'confío', guiar: 'guío', espiar: 'espío',
  vigilar: 'vigilo', continuar: 'continúo', acercar: 'acerco', alejar: 'alejo', comprobar: 'compruebo', atraer: 'atraigo',
  distraer: 'distraigo', mediar: 'medio', tranquilizar: 'tranquilizo', aceptar: 'acepto',
});

/** Verbos regulares que admite (además de los de arriba). */
const REGULARES = new Set(`hablar preguntar mirar observar fijar examinar buscar registrar escuchar esperar caminar andar correr saltar trepar subir bajar entrar
cruzar tomar llevar dejar abrir coger lanzar tirar empujar arrastrar levantar ayudar avisar atacar golpear defender esconder ocultar acechar seguir
comprar vender pagar regatear ofrecer beber comer descansar curar vendar rezar leer escribir guardar sacar usar equipar desenvainar afilar
preparar cocinar montar desmontar llamar gritar susurrar saludar despedir agradecer negar aceptar rechazar amenazar intimidar convencer
persuadir engañar mentir robar hurtar investigar rastrear seguir huir escapar retroceder avanzar acercar alejar rodear esquivar parar detener
tocar oler probar coger soltar atar desatar forzar romper reparar arreglar limpiar lavar encender apagar quemar cavar enterrar desenterrar
recoger mostrar ensenar explicar contar responder contestar insistir interrogar vigilar espiar escalar nadar remar pescar cazar cortar talar
enfrentar encarar calmar tranquilizar consolar abrazar besar invitar reclutar contratar despedir recorrer explorar volver sentar acostar levantar
quedar marchar partir llegar visitar pasar asomar agachar arrodillar tumbar colocar poner meter lanzar apuntar disparar tensar cargar`.split(/\s+/));

/** Pronombres pegados al infinitivo y cómo quedan delante del verbo. */
const ENCLITICOS = [
  ['te', 'me '], ['se', 'me '], ['me', 'me '], ['nos', 'nos '],
  ['lo', 'lo '], ['la', 'la '], ['los', 'los '], ['las', 'las '], ['le', 'le '], ['les', 'les '],
];

const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

/** Primera persona de un infinitivo (sin tildes), o null si no es de la lista. */
export function primeraDe(infinitivo) {
  const inf = llano(infinitivo);
  if (IRREGULARES[inf]) return IRREGULARES[inf];
  if (!REGULARES.has(inf)) return null;
  return `${inf.slice(0, -2)}o`;
}

/**
 * «Fijarte en la figura» → «me fijo en la figura»; «Hablar con Cordor» →
 * «hablo con Cordor»; «Ayudarle con el carro» → «le ayudo con el carro».
 * Si no empieza por un infinitivo conocido, devuelve el texto tal cual.
 *
 * @param {string} texto
 * @returns {string}
 */
export function infinitivoAPrimera(texto) {
  const t = String(texto ?? '').trim();
  const m = t.match(/^(\p{L}+)(\b.*)$/su);
  if (!m) return t;
  const palabra = llano(m[1]);
  // Con pronombre pegado: fijarte, acercarse, ayudarle.
  for (const [pron, delante] of ENCLITICOS) {
    if (palabra.length > pron.length + 2 && palabra.endsWith(pron)) {
      const base = palabra.slice(0, -pron.length);
      const primera = /(ar|er|ir)$/.test(base) ? primeraDe(base) : null;
      if (primera) return `${delante}${primera}${m[2]}`;
    }
  }
  if (!/(ar|er|ir)$/.test(palabra)) return t;
  const primera = primeraDe(palabra);
  return primera ? `${primera}${m[2]}` : t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL INTENTO
   ═══════════════════════════════════════════════════════════════════════════ */

/** Primera persona → infinitivo, construido a partir de la tabla de arriba. */
const INVERSO = new Map();
for (const [inf, pri] of Object.entries(IRREGULARES)) if (!INVERSO.has(llano(pri))) INVERSO.set(llano(pri), inf);
for (const inf of REGULARES) { const pri = `${inf.slice(0, -2)}o`; if (!INVERSO.has(pri)) INVERSO.set(pri, inf); }

/**
 * «salto 100 metros hasta el tejado» → «Intentas saltar 100 metros hasta el
 * tejado.»; «me fijo en la figura» → «Intentas fijarte en la figura.»; «le
 * pregunto a Aldo» → «Intentas preguntarle a Aldo.». Si el verbo no está en
 * la lista, null: quien llama deja el eco como estaba.
 *
 * @param {string} accion En primera persona.
 * @returns {string|null}
 */
export function intento(accion) {
  const t = String(accion ?? '').trim().replace(/[.!…]+$/u, '');
  const m = t.match(/^(?:(me|te|se|le|les|lo|la|los|las|nos)\s+)?(\p{L}+)(.*)$/su);
  if (!m) return null;
  const inf = INVERSO.get(llano(m[2]));
  if (!inf) return null;
  const pron = m[1] ? llano(m[1]) : null;
  // El reflexivo del jugador pasa a segunda: «me fijo» → «fijarte».
  const pegado = pron === 'me' ? 'te' : pron;
  return `Intentas ${inf}${pegado ?? ''}${m[3]}.`;
}

export default { infinitivoAPrimera, intento, primeraDe };
