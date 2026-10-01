/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-tester.mjs
 * ---------------------------------------------------------------------------
 * Lo que encontró el tester el 1 de octubre, con sus textos.
 *
 * Contar no es contarle algo a alguien (semilla 9303, Sive rastreadora):
 *   «cuento cuánta gente hay y qué hace cada uno» salía «Cormir te escucha
 *   sin interrumpir. Cuando terminas, se queda un momento callado,
 *   midiéndote.»: un oyente elegido sin motivo y ningún número. Igual con
 *   «cuento las monedas que llevo».
 *
 * El arma que no está no se cambia por otra:
 *   «afilo el hacha a la vista de todos» sin hacha salía «No llevas hacha;
 *   afilas el arco corto» (y con un vinculado, «afilas el foco de pacto»).
 *   Se ejecutaba una acción que nadie pidió, y absurda.
 *
 * Cada caso compara el estado antes y después (turno, oro, inventario
 * entero, actitud y memoria de cada PNJ, combate, con quién se habló) y
 * escribe el texto visible completo para leerlo (`--salida carpeta`).
 *
 *   node tools/auditar-tester.mjs [--salida carpeta]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearMotor } from './motor-sin-ventana.mjs';
import { crear } from '../src/inventory/Item.js';
import { atiende, soloEco } from './atencion.mjs';

const args = process.argv.slice(2);
const salida = args.includes('--salida') ? args[args.indexOf('--salida') + 1] : null;

let fallos = 0;
let casos = 0;
const transcripcion = [];
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).replace(/\n/g, ' | ').slice(0, 500)}`); }
}

const visible = (t) => String(t).split('\n').filter((l) => l && !l.startsWith('»')).join('\n');

/** Una partida limpia con lo que haga falta para medir cada turno. */
async function partida(semilla, clase = 'rastreador') {
  const m = await crearMotor({ semilla });
  await m.empezar({ nombre: 'Sive', raza: 'valdes', clase, trasfondo: 'errante', genero: 'f' });
  const hablados = [];
  let combates = 0;
  m.bus.on('npc:talked', (d) => hablados.push(d.refId));
  m.bus.on('combat:request', () => { combates += 1; });

  const foto = () => ({
    turno: m.ver('meta.turno'),
    oro: m.ver('player.oro'),
    inventario: JSON.stringify(m.ver('inventory.objetos.porId', {})),
    // Lo que es relación con el jugador. La memoria no: el mundo sigue y un
    // PNJ puede quejarse del peaje mientras uno cuenta (eso es la escena, no
    // el recuento); que no se habló con nadie lo dice `npc:talked`.
    relaciones: Object.fromEntries(Object.values(m.ver('npcs.conocidos.porId', {}) ?? {})
      .map((n) => [n.refId, JSON.stringify([n.actitud, n.oro, n.deudas?.length, n.promesas?.length])])),
    reputacion: JSON.stringify(m.ver('factions.reputacion', {})),
    combate: Boolean(m.ver('combat.activo', false)),
  });
  const presentes = () => (m.ver('npcs.presentes', []) ?? []).map((id) => m.ver(`npcs.conocidos.porId.${id}`)).filter((n) => n?.nombre);

  /** Juega y devuelve el texto, con quién se habló y el estado antes/después. */
  async function turno(frase) {
    const antes = foto();
    const h0 = hablados.length;
    const c0 = combates;
    const texto = visible(await m.jugar(frase));
    transcripcion.push(`[${semilla} ${clase}] > ${frase}\n${texto}\n`);
    return { texto, antes, despues: foto(), hablo: hablados.slice(h0), combate: combates > c0 };
  }

  const dar = (refId, cantidad = 1) => m.sistema('inventory').recibirBotin({ oro: 0, objetos: [crear(refId, { cantidad })] });
  return { m, turno, presentes, dar };
}

/** Nada cambia salvo, si se dice, el turno. */
const quieto = (r, { gastaTurno = true } = {}) =>
  r.despues.oro === r.antes.oro && r.despues.inventario === r.antes.inventario
  && Object.entries(r.antes.relaciones).every(([id, v]) => r.despues.relaciones[id] === v)
  && r.despues.reputacion === r.antes.reputacion
  && !r.combate && !r.despues.combate
  && r.despues.turno === r.antes.turno + (gastaTurno ? 1 : 0);

const NUMEROS = ['ninguna', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];

/* ═══════════════════════════════════════════════════════════════════════════
   6 · CONTAR COSAS / CONTAR ALGO A ALGUIEN
   ═══════════════════════════════════════════════════════════════════════════ */

for (const semilla of [9303, 5]) {
  console.log(`\n── Contar no es hablar (semilla ${semilla}) ──`);
  const p = await partida(semilla);
  const gente = p.presentes();
  const [primero, segundo] = gente;
  comprobar(gente.length >= 2, `escena con gente delante: ${gente.map((n) => n.nombre).join(', ')}`);

  let r = await p.turno('cuento cuánta gente hay y qué hace cada uno');
  comprobar(/^Cuentas a la gente/.test(r.texto) && r.texto.includes(`${NUMEROS[gente.length] ?? gente.length} persona`)
    && gente.every((n) => r.texto.includes(n.nombre)),
  '«cuento cuánta gente hay y qué hace cada uno»: dice cuántos y quiénes, con el dato de la escena', r.texto);
  comprobar(!r.hablo.length && !/te escucha|midiéndote|callad/.test(r.texto), '  nadie «escucha»: no se habla con ningún PNJ', `${r.hablo} · ${r.texto}`);
  comprobar(quieto(r), '  ni oro, ni inventario, ni relaciones, ni combate; un turno');

  r = await p.turno('contar la gente');
  comprobar(/^Cuentas a la gente/.test(r.texto) && !r.hablo.length && quieto(r), '«contar la gente»: recuento, sin destinatario', r.texto);

  const oro = p.m.ver('player.oro');
  r = await p.turno('cuento las monedas que llevo');
  comprobar(r.texto.includes(`${oro} monedas de oro`) && !r.hablo.length && quieto(r), `«cuento las monedas que llevo»: ${oro} monedas, el saldo real, sin crear ni quitar oro`, r.texto);

  r = await p.turno('cuento mis flechas');
  comprobar(/no tienes flechas/.test(r.texto) && !r.hablo.length && quieto(r), '«cuento mis flechas» sin flechas: lo dice, sin inventar un número', r.texto);
  p.dar('flecha', 20);
  r = await p.turno('cuento mis flechas');
  comprobar(/20 × flecha/i.test(r.texto) && !r.hablo.length && quieto(r), '  con 20 flechas: 20, y siguen siendo 20', r.texto);

  // Con alguien con quien se acaba de hablar: el recuento no va a él.
  r = await p.turno(`hablo con ${primero.nombre}`);
  comprobar(r.hablo.includes(primero.refId), `«hablo con ${primero.nombre}»: conversación abierta con ${primero.nombre}`, r.texto);
  r = await p.turno('cuento cuánta gente hay');
  comprobar(/^Cuentas a la gente/.test(r.texto) && !r.hablo.length && !new RegExp(`${primero.nombre} te escucha`).test(r.texto) && quieto(r),
    `  y después «cuento cuánta gente hay»: sigue siendo un recuento, ${primero.nombre} no «escucha»`, r.texto);

  // Narrar sí es hablar, y con quien se nombra.
  r = await p.turno(`le cuento a ${segundo.nombre} lo que pasó en el puente`);
  comprobar(r.hablo.length === 1 && r.hablo[0] === segundo.refId, `«le cuento a ${segundo.nombre} lo que pasó en el puente»: se habla con ${segundo.nombre}`, `${r.hablo} · ${r.texto}`);
  r = await p.turno(`cuento a ${primero.nombre} lo del puente`);
  comprobar(r.hablo.length === 1 && r.hablo[0] === primero.refId, `«cuento a ${primero.nombre} lo del puente»: se habla con ${primero.nombre}`, `${r.hablo} · ${r.texto}`);
  r = await p.turno('le cuento mi historia');
  comprobar(r.hablo.length === 1 && r.hablo[0] === primero.refId, `«le cuento mi historia» justo después: va a ${primero.nombre}, el último con quien se habló`, `${r.hablo} · ${r.texto}`);
  r = await p.turno('te cuento que vengo del sur');
  comprobar(r.hablo.length <= 1 && !/^Cuentas a la gente|monedas de oro/.test(r.texto), '«te cuento que vengo del sur»: es habla, no un recuento', r.texto);

  // Guardar y cargar: el recuento sigue leyendo el estado.
  const antes = { oro: p.m.ver('player.oro'), inv: JSON.stringify(p.m.ver('inventory.objetos.porId', {})) };
  p.m.guardarYCargar();
  comprobar(p.m.ver('player.oro') === antes.oro && JSON.stringify(p.m.ver('inventory.objetos.porId', {})) === antes.inv, 'guardar y cargar: oro e inventario idénticos');
  r = await p.turno('cuento las monedas que llevo');
  comprobar(r.texto.includes(`${antes.oro} monedas de oro`) && !r.hablo.length && quieto(r), '  y tras cargar, el recuento da lo mismo', r.texto);
  r = await p.turno('cuento mis flechas');
  comprobar(/20 × flecha/i.test(r.texto) && quieto(r), '  y las flechas siguen siendo 20', r.texto);
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · EL ARMA QUE NO ESTÁ NO SE CAMBIA POR OTRA
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('\n── El arma que no está (semilla 9303) ──');
{
  // Rastreadora: arco corto y cuchillo de caza. Sin hacha ni espada.
  const p = await partida(9303, 'rastreador');
  const korsa = p.presentes()[1];

  let r = await p.turno('afilo el hacha a la vista de todos');
  comprobar(/^No llevas hacha\./.test(r.texto) && !/afilas/i.test(r.texto) && !/arco/.test(r.texto),
    'hacha ausente + arco: dice qué falta, no afila nada y no ofrece el arco (no tiene filo)', r.texto);
  comprobar(/¿Quieres afilar el cuchillo de caza\?/.test(r.texto), '  y pregunta por lo que sí se puede afilar', r.texto);
  comprobar(quieto(r, { gastaTurno: false }), '  aclarar no gasta turno ni toca nada');

  r = await p.turno('afilo el arco');
  comprobar(/^Un arco no se puede afilar/.test(r.texto) && quieto(r, { gastaTurno: false }), 'arco presente + afilar: no se afila un arco, y no se hace otra cosa', r.texto);

  r = await p.turno('guardo la espada');
  comprobar(/^No llevas espada\. ¿Quieres guardar el arco corto o el cuchillo de caza\?$/.test(r.texto) && quieto(r, { gastaTurno: false }),
    'guardar espada ausente: dice qué falta y deja elegir entre lo que lleva', r.texto);

  r = await p.turno('limpio el cuchillo');
  comprobar(/^Limpias el cuchillo\./.test(r.texto) && quieto(r) && !r.hablo.length, 'limpiar algo que sí lleva: se hace, sin tirada ni combate, y el inventario no cambia', r.texto);

  r = await p.turno(`afilo el hacha y ataco a ${korsa.nombre}`);
  comprobar(/^No llevas hacha\./.test(r.texto) && !/atacas/.test(r.texto) && quieto(r, { gastaTurno: false }),
    'orden compuesta con ataque y hacha ausente: aclara antes de hacer nada, sin combate', r.texto);
  r = await p.turno(`afilo el cuchillo y ataco a ${korsa.nombre}`);
  comprobar(new RegExp(`atacas a ${korsa.nombre}`).test(r.texto) && r.despues.turno === r.antes.turno + 1 && r.despues.inventario === r.antes.inventario,
    '  con el cuchillo, que sí lleva: el ataque no se pierde detrás del gesto', r.texto);

  p.dar('hacha_mano');
  r = await p.turno('afilo el hacha a la vista de todos');
  comprobar(/^Afilas el hacha a la vista de todos\./.test(r.texto) && quieto(r), 'hacha presente: se afila el hacha, sin tirada ni combate', r.texto);

  p.m.guardarYCargar();
  r = await p.turno('afilo el hacha');
  comprobar(/^Afilas el hacha\./.test(r.texto) && quieto(r), 'guardar y cargar con hacha: sigue ahí y se afila', r.texto);
}
{
  // Un motor a la vez: el de antes ya no se usa.
  const p = await partida(9303, 'rastreador');
  p.m.guardarYCargar();
  const r = await p.turno('afilo el hacha a la vista de todos');
  comprobar(/^No llevas hacha\./.test(r.texto) && !/afilas/i.test(r.texto) && quieto(r, { gastaTurno: false }), 'guardar y cargar sin hacha: la misma aclaración', r.texto);
}

console.log('\n── El arma que no está (vinculado y otra semilla) ──');
{
  // Vinculado: foco de pacto y daga ritual.
  const p = await partida(9303, 'vinculado');
  let r = await p.turno('afilo el hacha a la vista de todos');
  comprobar(/^No llevas hacha\./.test(r.texto) && !/foco/.test(r.texto) && quieto(r, { gastaTurno: false }), 'hacha ausente + foco: ni se afila el foco ni se ofrece', r.texto);
  r = await p.turno('afilo la espada');
  comprobar(/^No llevas espada\. ¿Quieres afilar la daga ritual\?$/.test(r.texto) && quieto(r, { gastaTurno: false }), 'espada ausente + daga: ofrece la daga, no la afila', r.texto);

  const q = await partida(5, 'rastreador');
  r = await q.turno('envaino la espada');
  comprobar(/^No llevas espada\./.test(r.texto) && !/arco/.test(r.texto) && quieto(r, { gastaTurno: false }), 'semilla 5: envainar sin espada no envaina el arco', r.texto);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CUALITATIVO · LO QUE SE PREGUNTA, NO LA PALABRA SUELTA
   ═══════════════════════════════════════════════════════════════════════════ */

for (const semilla of [9303, 5]) {
  console.log(`\n── Mercenarios por el camino (semilla ${semilla}) ──`);
  const p = await partida(semilla);
  const [a, b, c] = p.presentes();
  const variantes = [
    [`le pregunto a ${a.nombre} si alguien ha visto mercenarios por el camino`, a, 'mercenarios'],
    [`le pregunto a ${b.nombre} si han pasado soldados por el camino del norte`, b, 'soldados'],
    [`le pregunto a ${c.nombre} si hay mercenarios en el camino`, c, 'mercenarios'],
  ];
  for (const [frase, quien, nucleo] of variantes) {
    const r = await p.turno(frase);
    const directo = atiende({ entrada: frase, texto: r.texto, presentes: p.presentes().map((n) => n.nombre) });
    const sinIndicaciones = !/Se va derecho|Camino principal hacia el norte|media mañana a buen paso/.test(r.texto);
    const niega = /De eso no hablo/.test(r.texto);
    comprobar(sinIndicaciones && (new RegExp(nucleo).test(r.texto) || niega) && directo.atiende && r.hablo.includes(quien.refId),
      `«${frase}»: contesta ${quien.nombre} sobre ${nucleo} (o se niega), no cómo ir al camino`, `${directo.motivo} · ${r.texto}`);
    // Hablar puede mover la actitud de quien contesta (es una conversación);
    // lo que no puede es crear oro, tocar el inventario o abrir combate.
    comprobar(!/Se dice que|cuentan que|rumor/i.test(r.texto) && r.despues.oro === r.antes.oro && r.despues.inventario === r.antes.inventario && !r.combate,
      '  sin abrir un rumor ajeno ni tocar oro, inventario o combate', r.texto);
  }
  const r = await p.turno(`le pregunto a ${a.nombre} por el camino del norte`);
  comprobar(/Camino del Norte|norte/i.test(r.texto) && !/De mercenarios|De soldados/.test(r.texto), `control: «por el camino del norte» sigue dando el camino`, r.texto);
}

console.log('\n── La rúbrica de atención, con ejemplos reales ──');
{
  const presentes = ['Torket', 'Cormir', 'Korsa'];
  let j = atiende({
    entrada: 'Le pregunto a Torket si alguien ha visto mercenarios por el camino',
    texto: '«¿El Camino del Norte? Se va derecho por el camino: media mañana a buen paso», te dice Torket.\n«Camino principal hacia el norte.» Parece que sabe más de lo que ha dicho.',
    presentes,
  });
  comprobar(!j.atiende && /mercenarios/.test(j.motivo), 'el caso del tester (indicaciones del camino a una pregunta por mercenarios) ya no cuenta como atendido', j.motivo);
  j = atiende({
    entrada: 'Le pregunto a Cormir si alguien ha visto mercenarios por el camino',
    texto: 'A Cormir se le tensa la cara al oírlo.\nEs la primera vez que duda antes de contestar.\n«De eso no hablo», dice, y cambia de tema demasiado deprisa.',
    presentes,
  });
  comprobar(j.atiende && !j.informa, '«De eso no hablo» con motivo: atiende (es una respuesta), pero no informa', j.motivo);
  j = atiende({
    entrada: 'le pregunto a Korsa si hay bandidos en el camino',
    texto: 'Korsa lo piensa y niega.\n«De bandidos no sé nada. Pregunta a los carreteros o en la posada, que por ahí pasa todo el que viaja».',
    presentes,
  });
  comprobar(j.atiende && j.informa, 'no saber y decir a quién preguntar: atiende e informa', j.motivo);
  comprobar(soloEco({ entrada: 'trepo al pretil del puente', texto: 'Trepas al pretil del puente.\n¿Qué haces?' }),
    'solo eco: «Trepas al pretil del puente. ¿Qué haces?» (medir-narrador, 3 de 132 turnos) se cuenta');
  comprobar(!soloEco({ entrada: 'afilo el hacha', texto: 'Afilas el hacha.\nKorsa deja de pregonar y te mira la hoja.\n¿Qué haces?' }),
    '  y un turno con una reacción en medio no');
}

console.log('\n── Salir del pueblo no es un viaje a la fuerza ──');
{
  const p = await partida(9303);
  const donde = p.m.ver('world.ubicacion');
  let r = await p.turno('salgo del pueblo');
  const destinos = p.m.sistema('world').destinos().map((d) => d.nombre.replace(/^(El|La|Los|Las)\s/, ''));
  comprobar(p.m.ver('world.ubicacion') === donde && /afueras/.test(r.texto) && destinos.every((d) => r.texto.includes(d)) && /¿Hacia dónde\?/.test(r.texto),
    '«salgo del pueblo»: sigue en el pueblo, en las afueras, con los caminos que hay y la pregunta de adónde', r.texto);
  comprobar(!/Calles de tierra/.test(r.texto) && quieto(r), '  sin describir las calles del centro como si no se hubiera movido', r.texto);
  r = await p.turno('salgo de la posada');
  comprobar(/^No estás dentro de la posada/.test(r.texto) && quieto(r, { gastaTurno: false }), '«salgo de la posada» estando fuera: se dice, sin narrar la posada ni gastar turno', r.texto);
  r = await p.turno('me voy del pueblo por el camino del norte');
  comprobar(p.m.ver('world.ubicacion') === 'camino_norte', '«me voy del pueblo por el camino del norte»: con destino, sí es un viaje', r.texto);
}

if (salida) {
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, 'tester-transcripcion.txt'), transcripcion.join('\n'), 'utf8');
  console.log(`\nTranscripción en ${join(salida, 'tester-transcripcion.txt')}`);
}

console.log(`\n${casos - fallos}/${casos} comprobaciones bien.`);
process.exit(fallos ? 1 : 0);
