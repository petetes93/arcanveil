/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-mision.mjs
 * ---------------------------------------------------------------------------
 * ¿Hay algo que hacer desde el turno 1, y cada turno devuelve la palabra?
 *
 * La apertura era atmósfera y lore sin un objetivo, y la narración terminaba
 * en un pájaro cruzando el cielo: el jugador no sabía por dónde tirar ni si le
 * tocaba hablar. Aquí se sujetan las dos cosas:
 *
 *   · 50 aperturas con semillas distintas: siempre hay misión principal con un
 *     lugar del mapa, alguien con nombre y oficio, y una pista.
 *   · La pregunta de mesa: toda narración termina en pregunta, sin duplicarla.
 *
 *   node tools/auditar-mision.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { leerTrasfondo, trasfondoParaDirector } from '../src/ai/Trasfondo.js';
import { QuestSystem } from '../src/quests/QuestSystem.js';
import { preguntaDeMesa, cerrarConPregunta, terminaEnPregunta, candidatas } from '../src/ai/Pregunta.js';
import { TurnResolver } from '../src/engine/TurnResolver.js';

let fallos = 0;

function comprobar(bien, texto, detalle = '') {
  if (bien) {
    console.log(`OK   ${texto}`);
  } else {
    fallos += 1;
    console.log(`MAL  ${texto}`);
    if (detalle) console.log(`     ${detalle}`);
  }
}

/* ── El pasado del personaje es canon, no guion ──────────────────────────── */

// Antes, de la historia salía una misión principal ya aceptada en el turno 1
// (lugar, PNJ y pista), y al cumplirla la siguiente. El autor lo rechazó: la
// biografía aporta datos y posibilidades, no dicta la campaña.

comprobar(typeof QuestSystem.prototype.iniciarPrincipal === 'undefined' && typeof QuestSystem.prototype.tomarRelevo === 'undefined',
  'el sistema de misiones ya no fabrica misiones desde el pasado ni las encadena');

{
  const t = leerTrasfondo('Mi hermana cruzó el Umbral con nuestro medallón. La busco desde entonces. Dicen que la vieron en el norte.');
  comprobar(t.hechos.length === 1 && /hermana cruzó/.test(t.hechos[0]), 'lo que afirma es un hecho', JSON.stringify(t));
  comprobar(t.aspiraciones.length === 1 && /La busco/.test(t.aspiraciones[0]), 'lo que busca es una aspiración, no un encargo', JSON.stringify(t));
  comprobar(t.sospechas.length === 1 && /Dicen que/.test(t.sospechas[0]), 'lo que le contaron es una sospecha, no un hecho', JSON.stringify(t));

  const s1 = leerTrasfondo('Creo que debo volver al vado.');
  comprobar(s1.sospechas.length === 1 && !s1.aspiraciones.length, 'lo que cree no se toma por decidido', JSON.stringify(s1));

  const director = trasfondoParaDirector('Perdí la forja de mi padre en un incendio. Busco a quien lo provocó.');
  comprobar(/canon, no guion/.test(director) && /NO es una misión/.test(director) && /Perdí la forja/.test(director),
    'el director recibe el pasado como canon y con la regla de no hacerlo misión', director);
  comprobar(trasfondoParaDirector('') === '', 'sin historia, nada que decir al director');
}

/* ── La pregunta de mesa ─────────────────────────────────────────────────── */

const escenas = [
  {},
  { npcs: [{ nombre: 'Corlin' }] },
  { enemigos: [{ nombre: 'Saqueador B' }] },
  { franja: 'noche' },
  { npcs: [{ nombre: 'Maela' }], franja: 'alba' },
];

const todas = escenas.flatMap((e) => candidatas(e));
// Cada candidata devuelve la palabra UNA vez: o pregunta, o dice quién
// espera. «Corlin espera tu respuesta. ¿Qué haces?» apilaba dos cierres.
const devuelve = (p) => /\?$/.test(p) || /espera tu (?:respuesta|movimiento)\.$/.test(p);
const dos = (p) => /espera tu (?:respuesta|movimiento)\./.test(p) && /\?/.test(p);
comprobar(todas.every((p) => devuelve(p) && !dos(p)), 'toda pregunta candidata devuelve la palabra una sola vez',
  todas.filter((p) => !devuelve(p) || dos(p)).join(' | '));

comprobar(candidatas({}).includes('¿Qué haces?'), 'la forma corta existe');

comprobar(candidatas({ npcs: [{ nombre: 'Corlin' }] }).some((p) => p.includes('Corlin')),
  'con alguien delante, hay pregunta que lo nombra');

comprobar(preguntaDeMesa({ npcs: [{ nombre: 'Corlin' }] }, { anterior: '¿Qué haces?' }) !== '¿Qué haces?',
  'no repite la pregunta anterior');

// Cerrar: en su propia línea, y nunca dos preguntas.
const cerrado = cerrarConPregunta('El viento arrastra hojas secas.', '¿Qué haces?');
comprobar(cerrado === 'El viento arrastra hojas secas.\n¿Qué haces?', 'la pregunta va en su propia línea', cerrado);

const yaPreguntaba = cerrarConPregunta('Corlin te mira. «¿Quién eres tú?»', '¿Qué haces?');
comprobar(yaPreguntaba === 'Corlin te mira. «¿Quién eres tú?»', 'si ya termina en pregunta, no se añade otra', yaPreguntaba);

comprobar(terminaEnPregunta('Algo.\n¿Qué haces?') && !terminaEnPregunta('Algo.\nNada.'),
  'reconoce si un texto termina en pregunta');

/* ── «Hablar con…» se cumple al hablar, aunque la frase haga otra cosa ──── */

{
  // Salió en el playtest: «busco a Dadar y le pregunto por el hierro» se leyó
  // como una búsqueda y el objetivo «Hablar con Dadar» no avanzó.
  const turnos = Object.create(TurnResolver.prototype);
  const estado = { npcs: { presentes: ['npc_dadar', 'npc_ulket'], conocidos: { porId: {
    npc_dadar: { refId: 'npc_dadar', nombre: 'Dadar' }, npc_ulket: { refId: 'npc_ulket', nombre: 'Ulket' },
  } } } };
  turnos.leer = (ruta, d) => ruta.split('.').reduce((o, k) => o?.[k], estado) ?? d;
  turnos.sistema = () => null;
  const conQuien = (accion, tipo) => {
    const dichos = [];
    turnos.emitir = (evento, datos) => { if (evento === 'npc:talked') dichos.push(datos.refId); };
    turnos._registrarConversacion({ events: [] }, tipo, accion);
    return dichos;
  };

  comprobar(conQuien('busco a Dadar, el herrero, y le pregunto por el hierro marcado', 'accion').includes('npc_dadar'),
    'preguntar a alguien nombrado cuenta como hablar con él, aunque el turno sea otra cosa');
  comprobar(!conQuien('busco a Dadar', 'accion').length, 'buscar a alguien no es hablar con él');
  comprobar(!conQuien('le pregunto por el hierro', 'accion').length, 'sin nombre, fuera del diálogo no se adivina con quién');

  // La pregunta de cierre solo nombra a quien se ha hablado. Tras hablar con
  // la posadera cerraba «Ulket te mira, esperando», y Ulket no pintaba nada.
  turnos.rng = null;
  turnos.leer = (ruta, d) => ({ 'npcs.presentes': ['npc_dadar', 'npc_ulket'], 'combat.activo': false, 'world.tiempo.franja': 'manana' })[ruta]
    ?? ruta.split('.').reduce((o, k) => o?.[k], estado) ?? d;
  const nombra = (interlocutor) => {
    const salidas = new Set();
    for (let i = 0; i < 12; i += 1) {
      turnos._ultimaPregunta = [...salidas].at(-1) ?? null;
      salidas.add(turnos._preguntar(interlocutor));
    }
    return [...salidas];
  };
  const sinNadie = nombra(null);
  comprobar(!sinNadie.some((p) => /Dadar|Ulket/.test(p)), 'sin interlocutor, la pregunta no nombra a los presentes', sinNadie.join(' | '));
  const conDadar = nombra({ nombre: 'Dadar' });
  comprobar(conDadar.some((p) => /Dadar/.test(p)) && !conDadar.some((p) => /Ulket/.test(p)),
    'tras hablar con Dadar, la pregunta puede nombrarle a él y a nadie más', conDadar.join(' | '));
}

console.log(`\n${fallos ? `${fallos} fallos.` : 'Todo correcto.'}`);
process.exit(fallos ? 1 : 0);
