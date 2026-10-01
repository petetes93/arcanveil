/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-coherencia.mjs
 * ---------------------------------------------------------------------------
 * ¿Lo que cuenta el juego casa con lo que está pasando?
 *
 * Son fallos que no rompen nada y que un jugador nota en seguida: que al salir
 * del pueblo se anuncie que cierra la fragua, que la apertura se repita en el
 * turno siguiente, que mirar alrededor pueda «fallar». Cada caso de aquí salió
 * de una partida grabada.
 *
 * Se prueban las piezas sueltas, sin arrancar el motor: cada una depende solo
 * de lo que lee del estado, y eso se puede simular.
 *
 *   node tools/auditar-coherencia.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { TimeSystem } from '../src/world/TimeSystem.js';
import { ActionRouter } from '../src/engine/ActionRouter.js';
import { interpretar } from '../src/engine/IntentParser.js';
import { resultadosDe, categoriaDe, RESULTADOS } from '../src/data/narrative.templates.js';
import { IDMProvider } from '../src/ai/providers/IDMProvider.js';
import { ProceduralProvider } from '../src/ai/providers/ProceduralProvider.js';
import { esGolpe } from '../src/ai/Cadencia.js';
import { Exploration } from '../src/world/Exploration.js';
import { PartySystem } from '../src/npc/PartySystem.js';
import { CombatManager } from '../src/combat/CombatManager.js';
import { paraJugador } from '../src/combat/CombatLog.js';
import { fichaDeCompanero, comentario } from '../src/npc/Companero.js';
import { migrar } from '../src/persistence/Migrations.js';

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

/* ── Los comercios solo cierran donde estás ─────────────────────────────── */

/**
 * Un `TimeSystem` sin motor: lee de un estado de mentira y apunta lo que
 * narra. Es lo único que toca `_revisarServicios`.
 */
function relojDePrueba(estado) {
  const reloj = Object.create(TimeSystem.prototype);
  reloj._serviciosAnteriores = null;
  reloj._lugarServicios = null;
  reloj.narrado = [];
  reloj.leer = (ruta, porDefecto) => ruta.split('.').reduce((o, k) => o?.[k], estado) ?? porDefecto;
  reloj.emitir = (evento, datos) => { if (evento === 'narrative:direct') reloj.narrado.push(datos.texto); };
  return reloj;
}

{
  const estado = { world: { ubicacion: 'vado_yunque', tiempo: { hora: 10 } } };
  const reloj = relojDePrueba(estado);

  reloj._revisarServicios();                 // foto en el pueblo, todo abierto
  estado.world.ubicacion = 'camino_norte';   // sale al camino a las 10
  reloj._revisarServicios();

  comprobar(!reloj.narrado.some((t) => /^Cierra/.test(t)),
    'salir del pueblo no anuncia que cierran sus comercios',
    `se narró: ${reloj.narrado.join(' | ')}`);
}

{
  const estado = { world: { ubicacion: 'vado_yunque', tiempo: { hora: 18 } } };
  const reloj = relojDePrueba(estado);

  reloj._revisarServicios();                 // las 18, la fragua abierta
  estado.world.tiempo.hora = 20;             // pasa el tiempo sin moverse
  reloj._revisarServicios();

  comprobar(reloj.narrado.some((t) => /fragua/.test(t)),
    'quedarse en el pueblo cuando cierra la fragua sí se cuenta',
    `se narró: ${reloj.narrado.join(' | ') || '(nada)'}`);
}

{
  // Volver al pueblo con la fragua ya cerrada tampoco es un «cierre»: no se
  // vio abrir en esta visita.
  const estado = { world: { ubicacion: 'camino_norte', tiempo: { hora: 21 } } };
  const reloj = relojDePrueba(estado);

  reloj._revisarServicios();
  estado.world.ubicacion = 'vado_yunque';
  reloj._revisarServicios();

  comprobar(!reloj.narrado.some((t) => /^Cierra/.test(t)),
    'llegar a un pueblo de noche no anuncia cierres');
}

/* ── Guardar un arma no se tira, y se hace con la que llevas ────────────── */

/** Un router sin motor, con un inventario de mentira. */
function routerCon(objetos, armaPrincipal = null) {
  const estado = { inventory: { objetos: { porId: objetos }, equipado: { armaPrincipal } } };
  const router = Object.create(ActionRouter.prototype);
  router.leer = (ruta, porDefecto) => ruta.split('.').reduce((o, k) => o?.[k], estado) ?? porDefecto;
  router.sistema = () => null;
  return router;
}

const HACHA = { id: 'o1', refId: 'hacha_mano', nombre: 'Hacha de mano', categoria: 'arma' };

{
  const intencion = interpretar('guardo la espada');
  comprobar(intencion.requiereTirada === false && intencion.tipo !== 'attack',
    '«guardo la espada» no tira dados ni cuenta como ataque',
    `tipo=${intencion.tipo} tirada=${intencion.requiereTirada}`);

  // Contrato cambiado el 1-oct-2026 (tester): antes se exigía «No llevas
  // espada; guardas el hacha de mano», es decir, hacer el gesto con otra
  // arma sin que se pidiera. Con un arco salía «afilas el arco corto». Ahora
  // se dice qué falta y se pregunta, sin hacer nada ni gastar turno.
  const r = routerCon({ o1: HACHA }, 'o1').enrutar(intencion);
  comprobar(r.ruta === 'rechazada' && r.narracion === 'No llevas espada. ¿Quieres guardar el hacha de mano?',
    'sin espada, se dice y se pregunta por el hacha que sí lleva; no se guarda nada', `salió: ${r.ruta} · ${r.narracion}`);
}

{
  const r = routerCon({ o1: HACHA }, 'o1').enrutar(interpretar('limpio mi hacha junto al fuego'));
  comprobar(r.narracion === 'Limpias tu hacha junto al fuego.',
    'con el arma nombrada, se narra lo que escribió en segunda persona', `salió: ${r.narracion}`);
}

{
  const r = routerCon({}).enrutar(interpretar('guardo la espada'));
  comprobar(r.ruta === 'rechazada' && /^No llevas espada, ni nada más que guardar\.$/.test(r.narracion ?? ''),
    'sin ningún arma, lo dice y no inventa una', `salió: ${r.narracion}`);
}

{
  const i = interpretar('guardo la espada y ataco al bandido');
  comprobar(i.tipo === 'attack', 'guardar y atacar en la misma frase sigue siendo un ataque', `tipo=${i.tipo}`);
}

/* ── Mirar alrededor no se falla ─────────────────────────────────────────── */

{
  const i = interpretar('miro alrededor');
  const categoria = categoriaDe(i.habilidad);
  const FALLO = /No sale|Falla|No consigues|No hay manera|empeora|Sale mal|peor/;

  const malas = Object.keys(RESULTADOS)
    .flatMap((grado) => resultadosDe(grado, categoria))
    .filter((f) => FALLO.test(f));

  comprobar(!malas.length, '«miro alrededor» no puede narrarse como un fracaso',
    `frases posibles: ${malas.join(' | ')}`);

  const idm = Object.create(IDMProvider.prototype);
  const minimo = idm.turnoMinimo({ tirada: { habilidad: i.habilidad, exito: false } })?.story ?? '';
  comprobar(!FALLO.test(minimo), 'tampoco en el narrador de reserva', `salió: ${minimo}`);
}

/* ── Preguntar a alguien que no está, por algo concreto ─────────────────── */

{
  const narrador = new ProceduralProvider({});
  narrador._latencia = async () => {};

  const accion = 'pregunto al tabernero por el incendio de la forja';
  const ctx = (npcs) => ({
    jugador: { lore: 'Perdí la forja de mi padre en un incendio.' },
    mundo: { ubicacion: 'vado_yunque' },
    npcsPresentes: npcs,
    ultimoTurno: { accion: '(inicio)' },
    canon: [],
  });
  const turno = (npcs, tirada) => narrador.generar({
    accion, intencion: interpretar(accion), tirada, tipo: 'dialogo', turno: 3, contexto: ctx(npcs),
  });

  for (const tirada of [
    { habilidad: 'trato_social', exito: true, critico: true },
    { habilidad: 'trato_social', exito: false, pifia: true },
  ]) {
    const cual = tirada.critico ? 'crítico' : 'pifia';
    const r = await turno([{ nombre: 'Corlin', rol: 'barquero' }], tirada);
    const lineas = r.story.split('\n');

    comprobar(/No hay ningún tabernero por aquí/.test(r.story),
      `(${cual}) sin tabernero en escena, se dice`, r.story);
    // Hay tres variantes de respuesta por grado y se reparten sin repetir:
    // seis vueltas las recorren todas, no solo la que toque en la primera.
    const respuestas = [r.story];
    for (let i = 0; i < 6; i += 1) respuestas.push((await turno([{ nombre: 'Corlin', rol: 'barquero' }], tirada)).story);
    // La primera línea repite la acción del jugador en segunda persona y ya
    // lleva el tema: se mira solo lo que dice o hace quien contesta.
    const respuestaDe = (s) => s.split('\n').slice(1).join(' ');
    const sinTema = respuestas.filter((s) => !/incendio de la forja/i.test(respuestaDe(s)));
    comprobar(!sinTema.length,
      `(${cual}) todas las respuestas nombran lo que se preguntó`, sinTema[0] ?? '');
    comprobar(!lineas.some(esGolpe),
      `(${cual}) ningún sonido detrás de un diálogo`, lineas.filter(esGolpe).join(' | '));
    comprobar(!lineas.some((l) => (l.match(/«/g)?.length ?? 0) !== (l.match(/»/g)?.length ?? 0)),
      `(${cual}) ninguna réplica partida entre dos líneas`, r.story);
  }

  const conPosadera = await turno([{ nombre: 'Maela', rol: 'posadera' }], { habilidad: 'trato_social', exito: true });
  comprobar(!/No hay/.test(conPosadera.story) && /Maela/.test(conPosadera.story),
    'si hay posadera, «el tabernero» es ella', conPosadera.story);
}

/* ── El grupo ─────────────────────────────────────────────────────────────── */

{
  for (const frase of ['¿vienes conmigo?', 'Grom, únete a mí', 'acompáñame hasta el vado', 'te pago para que me guíes']) {
    comprobar(interpretar(frase).tipo === 'recruit', `«${frase}» pide que se una`, interpretar(frase).tipo);
  }
  comprobar(interpretar('te pago para que me guíes').pago === true, 'ofrecer dinero se nota');
  for (const frase of ['vete a casa, Grom', 'puedes irte, Maela']) {
    comprobar(interpretar(frase).tipo === 'dismiss', `«${frase}» despide`, interpretar(frase).tipo);
  }
  comprobar(interpretar('hablo con Grom del camino').tipo !== 'recruit', 'hablar con alguien no es reclutarlo');

  // Con compañeros se habla en plural, y el viaje tiene que entenderse igual.
  for (const frase of ['vamos hacia Saucedo', 'Ulmir, vamos a Saucedo', 'partimos hacia el norte', 'volvemos al vado']) {
    comprobar(interpretar(frase).tipo === 'travel', `«${frase}» es un viaje`, interpretar(frase).tipo);
  }
  for (const frase of ['vamos a hablar con el posadero', 'vamos a ver qué hay']) {
    comprobar(interpretar(frase).tipo !== 'travel', `«${frase}» no es un viaje`, interpretar(frase).tipo);
  }

  // Nombrar el mercado no es comerciar: abría el panel de compra en silencio
  // y el turno se quedaba sin narrar.
  comprobar(interpretar('escucho las conversaciones del mercado').tipo !== 'trade', 'escuchar en el mercado no es comerciar');
  comprobar(interpretar('compro pan').tipo === 'trade' && interpretar('quiero vender la daga').tipo === 'trade', 'comprar y vender sí lo son');

  const herrera = fichaDeCompanero({ refId: 'npc_maela', nombre: 'Maela', rol: 'herrera', genero: 'f', rasgo: 'brazos quemados' });
  comprobar(herrera.ataque.nombre === 'Martillo de forja' && herrera.vidaMax === 22, 'la ficha sale del oficio, en masculino y en femenino');
  comprobar(/^mujer, herrera/.test(herrera.descripcion), 'su retrato se pide con su sexo y su oficio', herrera.descripcion);

  const dicho = comentario(herrera, { nombreLugar: 'El Vado del Yunque', titulo: 'Una cuenta pendiente' }, (l) => l[1]);
  comprobar(dicho.includes('del Vado del Yunque') && !/«[^»]*«/.test(dicho), 'lo que comenta nombra la misión sin «de El» ni comillas anidadas', dicho);

  // Si el enemigo esquiva al compañero, el ataque no era tuyo.
  const esquiva = paraJugador({
    tipo: 'ataque',
    atacante: { nombre: 'Ulmir', esCompanero: true }, objetivo: { nombre: 'Saqueador A' },
    resultado: 'esquivado', tirada: { total: 9, umbral: 12 },
  });
  comprobar(esquiva === 'Saqueador A esquiva el ataque de Ulmir.', 'si esquivan al compañero, el parte no dice «tu ataque»', esquiva);

  // Lo que pasa tras el combate: herido salvo en Brutal.
  const tras = (puedenMorir) => {
    const estado = { party: { miembros: [{ refId: 'npc_maela', vida: { actual: 22, max: 22 }, herido: false }] } };
    const hechos = [];
    const grupo = Object.create(PartySystem.prototype);
    grupo.leer = (ruta, d) => ruta.split('.').reduce((o, k) => o?.[k], estado) ?? d;
    grupo.despachar = (tipo, datos) => hechos.push({ tipo, datos });
    grupo.sistema = () => ({ actualizar: (id, c) => hechos.push({ tipo: 'npc', c }) });
    const lineas = grupo.despuesDelCombate([{ esCompanero: true, refId: 'npc_maela', nombre: 'Maela', genero: 'f', vivo: false, vida: { actual: 0, max: 22 } }], { puedenMorir });
    return { lineas, hechos };
  };
  const normal = tras(false);
  comprobar(normal.hechos.some((h) => h.datos?.cambios?.herido === true) && /Maela está herida, pero viva/.test(normal.lineas[0] ?? ''),
    'fuera de Brutal, un compañero caído queda herido', normal.lineas[0]);
  const brutal = tras(true);
  comprobar(brutal.hechos.some((h) => h.tipo === 'party/despedir') && brutal.hechos.some((h) => h.c?.situacion === 'muerto'),
    'en Brutal, un compañero caído no se levanta');

  // Reclutar se puede en una partida normal. La gente del pueblo empieza
  // entre 0 y 12: con «neutral = contra 20» solo valía un 20 natural. Y quien
  // te recomienda alguien que no puede ir, se convence fácil.
  const umbralAlPedir = (npc) => {
    let pedido = null;
    const grupo = Object.create(PartySystem.prototype);
    grupo.leer = (ruta, d) => ({ 'party.miembros': [], 'player.oro': 0 })[ruta] ?? d;
    grupo.enGrupo = () => false;
    grupo.sistema = (n) => (n === 'rules'
      ? { resolver: (t) => { pedido = t.umbral; return { exito: false, natural: 1, total: 1, umbral: 0 }; } }
      : null);
    grupo._ofrecerRelevo = () => null;
    grupo.reclutar({ refId: 'npc_x', nombre: 'Ulket', rol: 'aprendiz de forja', ...npc });
    return pedido;
  };
  comprobar(umbralAlPedir({ actitud: 8 }) === 'moderada', 'a un vecino neutral se le convence con una tirada moderada', umbralAlPedir({ actitud: 8 }));
  comprobar(umbralAlPedir({ actitud: -25 }) === 'dificil', 'a quien te tiene manía cuesta más');
  comprobar(umbralAlPedir({ actitud: 25, recomendadoPor: 'npc_dadar' }) === 'facil', 'al recomendado por quien no puede ir se le convence fácil');

  // Las partidas guardadas antes del grupo siguen cargando.
  const viejo = { version: 5, estado: { player: { nombre: 'X' }, meta: {} } };
  const migrado = migrar(viejo);
  comprobar(migrado.guardado?.estado?.party?.miembros?.length === 0 && migrado.guardado.version >= 6,
    'una partida del formato 5 carga con el grupo vacío', JSON.stringify(migrado.guardado?.estado?.party));

  // Las partidas donde el pasado se abrió como hilos: se cierran como
  // trasfondo, sin darlos por resueltos, y la misión guardada no se toca.
  const conHilos = {
    version: 6,
    estado: {
      player: { nombre: 'X', lore: 'Mi hermana cruzó el Umbral.' }, meta: {}, party: { miembros: [] },
      ai: { memoria: { hilos: [
        { id: 'h1', texto: 'De su historia: Mi hermana cruzó el Umbral.', relacionadoCon: 'player_lore', cerrado: false },
        { id: 'h2', texto: 'Prometió volver con el dinero', relacionadoCon: 'npc_corlin', cerrado: false },
      ] } },
      quests: { activas: { porId: { q1: { refId: 'q1', tipo: 'principal', estado: 'aceptada', objetivos: [{ hecho: true }] } }, orden: ['q1'] } },
    },
  };
  const cargada = migrar(conHilos).guardado;
  const [h1, h2] = cargada.estado.ai.memoria.hilos;
  comprobar(h1.cerrado && h1.resolucion === null && !h2.cerrado,
    'al cargar, los hilos del pasado se cierran como trasfondo y los de la partida siguen abiertos', JSON.stringify(cargada.estado.ai.memoria.hilos));
  comprobar(cargada.estado.quests.activas.porId.q1.estado === 'aceptada' && cargada.estado.player.lore === 'Mi hermana cruzó el Umbral.',
    'la misión guardada y la historia se conservan');
}

/* ── Caer en combate detiene la partida también al acabar la pelea ────────── */

{
  const terminar = CombatManager.prototype._reducirTerminar;
  comprobar(terminar({ meta: { fase: 'fin' } }).meta.fase === 'fin',
    'si el jugador cayó en la pelea, acabarla no reabre la partida');
  comprobar(terminar({ meta: { fase: 'combate' } }).meta.fase === 'exploracion',
    'una pelea normal vuelve a exploración al acabar');
}

/* ── La intensidad manda en los encuentros ──────────────────────────────── */

/**
 * Treinta turnos con un dado que SIEMPRE dice que sí: lo único que puede
 * frenar los encuentros es la intensidad. Así la cuenta no depende de la
 * suerte y la prueba no pasa por casualidad.
 */
function encuentrosEn30(dificultad) {
  const estado = { settings: { dificultad }, world: { turnosDesdeEncuentro: 0 } };
  const exploracion = Object.create(Exploration.prototype);
  exploracion.leer = (ruta, porDefecto) => ruta.split('.').reduce((o, k) => o?.[k], estado) ?? porDefecto;

  const probabilidades = [];
  const siempre = { oportunidad: (p) => { probabilidades.push(p); return true; } };
  let encuentros = 0;

  for (let turno = 1; turno <= 30; turno += 1) {
    estado.world.turnosDesdeEncuentro += 1;            // lo que hace alTurno
    if (exploracion.tocaEncuentro(0.35, siempre)) {
      encuentros += 1;
      estado.world.turnosDesdeEncuentro = 0;           // lo que hace _presentar
    }
  }
  return { encuentros, probabilidad: probabilidades[0] ?? 0 };
}

{
  const pacifica = encuentrosEn30('relato');
  const equilibrada = encuentrosEn30('equilibrado');
  const brutal = encuentrosEn30('implacable');

  comprobar(pacifica.encuentros <= 1, 'Pacífica: como mucho un encuentro en 30 turnos', `hubo ${pacifica.encuentros}`);
  comprobar(equilibrada.encuentros > pacifica.encuentros && brutal.encuentros > equilibrada.encuentros,
    'más intensidad, más encuentros posibles',
    `pacífica ${pacifica.encuentros}, equilibrada ${equilibrada.encuentros}, brutal ${brutal.encuentros}`);
  comprobar(pacifica.probabilidad < equilibrada.probabilidad && equilibrada.probabilidad < brutal.probabilidad,
    'y cada tirada es más o menos probable según la intensidad',
    `${pacifica.probabilidad.toFixed(3)} < ${equilibrada.probabilidad.toFixed(3)} < ${brutal.probabilidad.toFixed(3)}`);
  // Gracia de 3 turnos: como mucho uno cada tres, 10 en 30. Sin gracia serían 30.
  comprobar(equilibrada.encuentros <= 10, 'hay periodo de gracia también en Equilibrada', `hubo ${equilibrada.encuentros}`);
}

console.log(`\n${fallos ? `${fallos} fallos.` : 'Todo correcto.'}`);
process.exit(fallos ? 1 : 0);
