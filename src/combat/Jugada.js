/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · combat/Jugada.js
 * ---------------------------------------------------------------------------
 * Lo que el jugador escribe en combate, leído como jugada.
 *
 * Antes, «salto sobre la roca y descargo el hacha sobre su cabeza» y «le lanzo
 * arena a los ojos y le golpeo» acababan en el mismo «Atacar» que el botón:
 * tres expresiones regulares decidían entre atacar, defender y huir, y el
 * texto solo servía para pintar «Intentas: …».
 *
 * Aquí la jugada escrita decide cuatro cosas sin quitar el d20:
 *
 *   · Qué es: atacar, defender, huir, curar, maniobrar o usar un objeto.
 *     La magia se reconoce pero no se resuelve: todavía no hay hechizos de
 *     combate, y se dice sin gastar el turno (ver `avisoMagia`).
 *   · A quién: «al herido», «al jefe», «al de la izquierda», por su nombre, o
 *     el que tenía marcado.
 *   · Con qué: un objeto que lleva, si lo nombra.
 *   · Cuánto premia: de −2 a +3 sobre la tirada, con motivos que se pueden
 *     leer en el parte.
 *
 * Los criterios son deterministas a propósito: la misma frase en la misma
 * situación da siempre el mismo bono, y una auditoría puede fijarlo. Suma +1
 * por cada una de estas cosas, hasta +3:
 *
 *   · Usa la escena: una roca, un barril, el barro, el río.
 *   · Usa algo que lleva, que no sea el arma de siempre.
 *   · Aprovecha el estado del enemigo: herido, cegado, en el suelo.
 *   · Encadena con lo del turno anterior: «aprovecho que está ciego».
 *
 * Y resta 2 si contradice el mundo o el inventario —una pistola, una espada
 * que no lleva—, con una línea que lo explica.
 *
 * Funciones puras.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sinAcentos } from '../utils/text.js';

/* ═══════════════════════════════════════════════════════════════════════════
   VOCABULARIO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Cosas del entorno que se pueden usar en una pelea.
 *
 * Solo lo que es del sitio. Lo que se lleva encima —una cuerda, una antorcha—
 * cuenta como objeto, no como escena: si no, la misma idea sumaría dos veces.
 */
const ESCENA = /\b(roca|rocas|piedra|arbol|rama|tronco|barro|lodo|rio|agua|arroyo|arena|polvo|tierra|ceniza|mesa|silla|banco|barril|carro|carreta|pared|muro|escalera|hoguera|brasas|puerta|columna|viga|altura|desnivel|nieve|hielo|pendiente|zanja|puente|borde|esquina|sombra|matorral|arbusto|valla|cerca|caldero)\b/;

/** Cosas que no existen en este mundo. */
const ANACRONISMOS = /\b(pistola|pistolas|laser|rifle|escopeta|ametralladora|metralleta|bomba|granada|dinamita|misil|telefono|movil|coche|moto|tanque|revolver|fusil)\b/;

/** Palabras que atan la jugada a la anterior. */
const ENCADENA = /\b(aprovech|remato|sigo|mientras (?:esta|sigue)|ahora que|tras (?:cegar|derribar|tirar)|ya que esta|antes de que se (?:levante|recupere))/;

/** Armas por su nombre, para saber si nombra una que no lleva. */
const ARMAS = /\b(espada|hacha|daga|lanza|maza|ballesta|arco|cuchillo|martillo|mandoble|sable|estoque|punal|baston|garrote)\b/;

/**
 * Maniobras que dejan al enemigo en un estado.
 *
 * `golpea` dice si la frase también lleva un golpe: «le lanzo arena a los ojos
 * y le golpeo» ciega Y hace daño; «le lanzo arena a los ojos» solo ciega.
 */
const MANIOBRAS = Object.freeze([
  { re: /\b(arena|tierra|polvo|ceniza|barro)\b.{0,30}\bojos\b|\b(le ciego|cegarle|cegarlo|cegarla)\b/, estado: 'cegado', rondas: 1, nombre: 'arena a los ojos' },
  { re: /\b(empujo|empujarle|empujarlo|lo tiro|le tiro|le derribo|derribarle|zancadilla|placaje|lo barro|le barro|lo lanzo al|le hago caer)\b/, estado: 'derribado', rondas: 1, nombre: 'derribo' },
  { re: /\b(le golpeo en la cabeza con el pomo|le doy con el escudo|le aturdo|aturdirle|aturdirlo)\b/, estado: 'aturdido', rondas: 1, nombre: 'golpe aturdidor' },
]);

const GOLPE = /\b(ataco|golpeo|le golpeo|le doy|le pego|le clavo|descargo|lanzo un tajo|tajo|estocada|corto|hiero|apuñalo|apunalo|disparo|le parto|le rajo|le atravieso|le hundo)\b/;

/**
 * Magia. En combate todavía no hay hechizos: el motor no tiene con qué
 * resolverlos (coste, alcance, daño). «Alzo mi hechizo y fulmino al
 * saqueador» se leía como atacar y salía un golpe de bastón, sin avisar.
 * «Poción mágica» es un objeto: por eso el adjetivo no cuenta, solo el
 * sustantivo.
 */
const MAGIA = /\b(hechiz\w*|conjur\w*|sortilegi\w*|encantamient\w*|magia|fulmin\w*|invoco|invocar|canalizo|bola de fuego|rayo arcano|glifo|glifos|maldigo|maldicion)\b/;

/** Lo que nadie tiene al empezar ni se concede por escribirlo. */
const DESMEDIDO = /\b(\d{3,})\s*(?:puntos\s+)?(?:de\s+)?(?:dano|danos|puntos)\b|\b(infinit\w*|inmortal\w*|immortal\w*|omnipoten\w*|invencible|todopoderos\w*|dios|dioses|divin\w*)\b|\bmato a todos\b/;

/**
 * Lo que se le dice al jugador cuando escribe magia en combate: qué no
 * existe todavía, que no ha gastado nada y qué puede hacer en su lugar.
 *
 * @param {string} t Texto sin tildes.
 * @param {string|null} arma Nombre del arma, como se escribe.
 * @returns {string}
 */
function avisoMagia(t, arma) {
  const desmedido = t.match(DESMEDIDO);
  const limite = !desmedido ? ''
    : desmedido[1] ? `Nadie hace ${desmedido[1]} de daño, ni con magia ni sin ella. `
      : 'Ni poderes de dios ni fuego infinito: aquí nadie empieza siendo eso. ';
  const conQue = arma ? `atacar con tu ${String(arma).toLowerCase()}` : 'atacar con lo que llevas';
  return `${limite}La magia de combate todavía no está en el juego: el hechizo no sale, y no gastas ni el turno ni maná. Puedes ${conQue}, defenderte, huir, hablarles o usar un objeto.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   OBJETIVO
   ═══════════════════════════════════════════════════════════════════════════ */

const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

/**
 * A quién va la jugada.
 *
 * @param {string} t Texto sin tildes.
 * @param {Array<Object>} enemigos Vivos, en el orden de la pantalla.
 * @param {string|null} marcado El que tenía marcado el jugador.
 * @returns {Object|null}
 */
function elegirObjetivo(t, enemigos, marcado) {
  const vivos = enemigos.filter((e) => (e.vida?.actual ?? 1) > 0);
  if (!vivos.length) return null;

  // Por su nombre: «al saqueador B», «a Corlin».
  const porNombre = vivos.find((e) => t.includes(llano(e.nombre)));
  if (porNombre) return porNombre;

  // Por una palabra de su nombre, si solo la lleva uno: «al guardia» es el
  // Guardia corrupto; «al saqueador», con dos saqueadores, no dice cuál.
  const porPalabra = vivos.filter((e) => llano(e.nombre).split(/\s+/)
    .some((p) => p.length >= 4 && new RegExp(`\\b${p}\\b`).test(t)));
  if (porPalabra.length === 1) return porPalabra[0];

  // Por su letra, que es como el parte los distingue: «al B», «a la C».
  const letra = t.match(/\b(?:al|a la|a el|contra el|contra la)\s+([a-e])\b/)?.[1];
  if (letra) {
    const porLetra = vivos.find((e) => new RegExp(`\\b${letra}$`, 'i').test(e.nombre));
    if (porLetra) return porLetra;
  }

  const fraccion = (e) => (e.vida?.actual ?? 0) / Math.max(1, e.vida?.max ?? 1);

  if (/\b(herido|tocado|mas herido|debil|que sangra|que cojea)\b/.test(t)) {
    return [...vivos].sort((a, b) => fraccion(a) - fraccion(b))[0];
  }
  if (/\b(jefe|lider|grande|mas grande|fuerte|el que manda)\b/.test(t)) {
    return [...vivos].sort((a, b) => (b.vida?.max ?? 0) - (a.vida?.max ?? 0))[0];
  }
  if (/\b(de la izquierda|izquierdo|primero)\b/.test(t)) return vivos[0];
  if (/\b(de la derecha|derecho|ultimo)\b/.test(t)) return vivos.at(-1);

  return vivos.find((e) => e.id === marcado) ?? vivos[0];
}

/* ═══════════════════════════════════════════════════════════════════════════
   LECTURA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lee una jugada escrita.
 *
 * @param {string} texto
 * @param {Object} contexto
 * @param {Array<Object>} contexto.enemigos Combatientes enemigos (id, nombre, vida, estados).
 * @param {Array<Object>} [contexto.inventario] Objetos que lleva (id, nombre, categoria, subtipo).
 * @param {string|null} [contexto.arma] Nombre del arma equipada.
 * @param {string|null} [contexto.marcado] Id del objetivo marcado.
 * @param {Object|null} [contexto.anterior] La jugada del turno anterior.
 * @returns {{
 *   tipo: string, objetivo: string|null, objeto: Object|null,
 *   estado: Object|null, golpea: boolean,
 *   creatividad: {valor: number, motivos: string[]},
 *   aviso: string|null
 * }}
 */
/** Palabras en vez de acero. */
const PARLAMENTA = /\b(?:me rindo|rendirme|tregua|parlament\w*|negocio|negociar|pacto|podemos hablar|no quiero pelear|no quiero luchar|bajad las armas|bajo (?:el|mi) arma|os ofrezco|les ofrezco|le ofrezco|dejadme pasar|les hablo|le hablo|les digo|le digo|os digo)\b/;

export function leerJugada(texto, contexto = {}) {
  const t = llano(texto);
  const enemigos = contexto.enemigos ?? [];
  const inventario = contexto.inventario ?? [];
  const arma = llano(contexto.arma ?? '');

  const motivos = [];
  let valor = 0;
  let aviso = null;

  // ─── Qué es ─────────────────────────────────────────────────────────────
  // La magia va antes que nada: no se puede resolver, y convertirla en otra
  // cosa (un golpe, una huida) sería decidir por el jugador.
  if (MAGIA.test(t)) {
    return {
      tipo: 'magia', objetivo: null, objeto: null, estado: null, golpea: false,
      creatividad: { valor: 0, motivos: [] },
      aviso: avisoMagia(t, contexto.arma ?? null),
    };
  }

  let tipo = 'atacar';
  // Hablar en mitad de la pelea no es atacar ni defenderse: «no quiero
  // pelear», «os ofrezco una tregua», «me rindo». Salvo que en la misma
  // frase golpee.
  if (PARLAMENTA.test(t) && !GOLPE.test(t)) tipo = 'parlamentar';
  else if (/\b(huyo|huir|escapo|escapar|me retiro|retirarme|salgo corriendo|me largo|corro hacia la salida)\b/.test(t)) tipo = 'huir';
  else if (/\b(vendo|vendarme|me curo|curarme|me trato|pocion|taponar|primeros auxilios|bebo la|me bebo)\b/.test(t)) tipo = 'curar';
  else if (/\b(me defiendo|defiendo|bloqueo|me cubro|cubrirme|me protejo|protegerme|me parapeto|me agacho|esquivo)\b/.test(t)) tipo = 'defender';

  const maniobra = MANIOBRAS.find((m) => m.re.test(t)) ?? null;
  const golpea = GOLPE.test(t);
  if (tipo === 'atacar' && maniobra) tipo = golpea ? 'atacar' : 'maniobra';

  const objetivo = ['atacar', 'maniobra'].includes(tipo)
    ? elegirObjetivo(t, enemigos, contexto.marcado ?? null)
    : null;

  // ─── Con qué ────────────────────────────────────────────────────────────
  // Un objeto del inventario nombrado en la frase. El arma de siempre no
  // cuenta como ingenio: atacar con tu hacha es atacar.
  const palabras = new Set(t.split(/[^a-zñ]+/u).filter((p) => p.length >= 4));
  const objeto = inventario.find((o) => {
    const n = llano(o.nombre);
    if (arma && n === arma) return false;
    return n.split(/\s+/).some((p) => p.length >= 4 && palabras.has(p));
  }) ?? null;

  // ─── Lo que no puede ser ────────────────────────────────────────────────
  const anacronismo = t.match(ANACRONISMOS)?.[1];
  if (anacronismo) {
    valor -= 2;
    aviso = `No hay ${anacronismo === 'laser' ? 'nada láser' : `${anacronismo}s`} en este mundo: te lanzas con lo que llevas.`;
  }

  // «Un golpe que hace 9999 de daño»: el golpe se da, el número no se
  // concede. El daño lo ponen el arma y la tirada, y se dice.
  const cifra = t.match(DESMEDIDO);
  if (!aviso && cifra && ['atacar', 'maniobra'].includes(tipo)) {
    aviso = cifra[1] ? `El daño no se elige: ni ${cifra[1]} ni ningún otro número. Lo ponen tu arma y la tirada.` : 'Eso no lo tienes: atacas como lo que eres, y el daño lo ponen tu arma y la tirada.';
  }

  const armaNombrada = t.match(ARMAS)?.[1];
  const llevaArma = (nombre) => arma.includes(nombre)
    || inventario.some((o) => o.categoria === 'arma' && llano(o.nombre).split(/\s+/).includes(nombre));
  if (!aviso && armaNombrada && !llevaArma(armaNombrada)) {
    valor -= 2;
    // El arma que sí lleva se nombra como se escribe, con sus tildes.
    const conQue = contexto.arma ? `tu ${String(contexto.arma).toLowerCase()}` : 'lo que tienes';
    aviso = `No llevas ${armaNombrada === 'punal' ? 'puñal' : armaNombrada === 'baston' ? 'bastón' : armaNombrada}: atacas con ${conQue}.`;
  }

  // ─── Lo que premia ──────────────────────────────────────────────────────
  // Solo en jugadas que tiran contra el enemigo: defender o huir no suman
  // ingenio a ninguna tirada de ataque.
  if (!aviso && ['atacar', 'maniobra'].includes(tipo)) {
    const escena = t.match(ESCENA)?.[1];
    if (escena) { valor += 1; motivos.push(`usa ${escena === 'rio' ? 'el río' : escena === 'arbol' ? 'el árbol' : `la escena (${escena})`}`); }

    if (objeto) { valor += 1; motivos.push(`usa ${objeto.nombre.toLowerCase()}`); }

    const herido = objetivo && (objetivo.vida?.actual ?? 1) / Math.max(1, objetivo.vida?.max ?? 1) < 0.5;
    const tocado = objetivo?.estados?.some?.((e) => ['cegado', 'derribado', 'aturdido', 'paralizado', 'apresado', 'aterrado'].includes(e.refId ?? e));
    const loDice = /\b(herido|sangra|cojea|ciego|cegado|en el suelo|caido|derribado|aturdido|tambalea)\b/.test(t);
    if (loDice && (herido || tocado)) { valor += 1; motivos.push('aprovecha cómo está'); }

    if (ENCADENA.test(t) && contexto.anterior?.estado) { valor += 1; motivos.push('encadena con lo anterior'); }
  }

  valor = Math.max(-2, Math.min(3, valor));

  return {
    tipo,
    objetivo: objetivo?.id ?? null,
    // Para curarse solo se gasta lo que nombra y se puede consumir: «vendo la
    // herida» no se bebe la poción que lleva, se venda.
    objeto: tipo === 'curar' ? (objeto?.categoria === 'consumible' ? objeto : null) : objeto,
    estado: maniobra ? { refId: maniobra.estado, rondas: maniobra.rondas, nombre: maniobra.nombre } : null,
    golpea,
    creatividad: { valor, motivos },
    aviso,
  };
}

export default { leerJugada };
