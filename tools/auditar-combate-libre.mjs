/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-combate-libre.mjs
 * ---------------------------------------------------------------------------
 * Lo que el jugador escribe en combate, con el motor de verdad.
 *
 * En el playtest, contra dos saqueadores:
 *   · «alzo mi hechizo de dios immortal y fulmino al saqueador» salía
 *     «Atacas a Saqueador y aciertas: 5 de daño contundente»: un golpe de
 *     bastón sin avisar, y los saqueadores respondían.
 *   · «lanzo hechizo del fuego infinito que hace 9999 daño», lo mismo.
 *
 * Todavía no hay magia de combate. Lo que tiene que pasar: se dice, no se
 * concede, no se convierte en otra cosa y no cuesta nada (ni vida, ni maná,
 * ni la ronda, ni el turno: el enemigo no aprovecha).
 *
 * Cada caso anota vida, maná, ronda y de quién es el turno antes y después,
 * y el texto que ve el jugador. Y las jugadas que sí valen se siguen
 * resolviendo: atacar, a otro objetivo, arena a los ojos, defenderse, huir,
 * parlamentar y curarse con lo que se lleva.
 *
 *   node tools/auditar-combate-libre.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { crearMotor } from './motor-sin-ventana.mjs';
import { leerJugada } from '../src/combat/Jugada.js';
import { crear as crearObjeto } from '../src/inventory/Item.js';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).replace(/\n/g, ' | ').slice(0, 600)}`); }
}

const esperar = async (cond, ms = 5000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

const HECHIZOS = [
  'alzo mi hechizo de dios immortal y fulmino al saqueador',
  'lanzo hechizo del fuego infinito que hace 9999 daño',
];

/* ── La lectura, sin motor ─────────────────────────────────────────────── */

{
  const enemigos = [{ id: 'a', nombre: 'Saqueador A', vida: { actual: 10, max: 10 } }, { id: 'b', nombre: 'Saqueador B', vida: { actual: 10, max: 10 } }];
  const leer = (t, extra = {}) => leerJugada(t, { enemigos, arma: 'Bastón de glifos', ...extra });
  for (const h of HECHIZOS) {
    const j = leer(h);
    comprobar(j.tipo === 'magia' && !j.objetivo && /no gastas ni el turno ni maná/.test(j.aviso), `«${h}» se lee como magia, sin objetivo, y se avisa`, JSON.stringify(j));
  }
  comprobar(/Ni poderes de dios/.test(leer(HECHIZOS[0]).aviso), 'el poder de dios se niega en voz alta');
  comprobar(/bastón de glifos/.test(leer(HECHIZOS[0]).aviso), 'y se dice con qué se puede atacar');
  comprobar(leer('bebo la poción mágica', { inventario: [{ id: 'p', nombre: 'Poción mágica', categoria: 'consumible' }] }).tipo === 'curar', '«poción mágica» es un objeto, no magia');
  comprobar(leer('ataco al saqueador B').tipo === 'atacar' && leer('ataco al saqueador B').objetivo === 'b', 'atacar a otro objetivo sigue siendo atacar, y a ese');
  const golpe = leer('le doy un golpe que hace 9999 de daño');
  comprobar(golpe.tipo === 'atacar' && /El daño no se elige/.test(golpe.aviso ?? ''), 'un golpe con cifra imposible es un golpe, y la cifra se niega', JSON.stringify(golpe));
  comprobar(leer('me despido: adiós').tipo !== 'magia' && !/dios/.test(leer('adiós, saqueador').aviso ?? ''), '«adiós» no es un dios');
}

/* ── En combate, con el motor ──────────────────────────────────────────── */

async function pelea(clase = 'glifista', semilla = 7) {
  const m = await crearMotor({ semilla });
  await m.empezar({ nombre: 'Alejo', raza: 'valdes', clase, trasfondo: 'errante', genero: 'm' });
  m.bus.emit('combat:request', { enemies: [{ refId: 'saqueador', count: 2 }] });
  await esperar(() => m.sistema('combat').esperandoJugador);
  const dichos = [];
  m.bus.on('narrative:direct', (d) => dichos.push(d.texto));
  m.bus.on('combat:log', (d) => dichos.push(d.texto));
  const foto = () => {
    const c = m.ver('combat.combatientes', {}) ?? {};
    return {
      ronda: m.ver('combat.ronda'),
      turno: m.ver('combat.turnoActual'),
      vida: Object.values(c).map((x) => `${x.nombre}:${x.vida?.actual}`).join(' '),
      mana: m.ver('player.mana.actual'),
      activo: Boolean(m.ver('combat.activo')),
      esperando: Boolean(m.sistema('combat').esperandoJugador),
      estados: (c.jugador?.estados ?? []).map((e) => e.refId).join(','),
    };
  };
  async function jugada(texto) {
    const antes = foto();
    dichos.length = 0;
    await m.sistema('combat').jugadaLibre(texto);
    await esperar(() => m.sistema('combat').esperandoJugador || !m.ver('combat.activo'));
    return { antes, despues: foto(), texto: dichos.join('\n') };
  }
  return { m, jugada, foto };
}

const resumen = (r) => `antes ${JSON.stringify(r.antes)} · después ${JSON.stringify(r.despues)} · «${r.texto}»`;

for (const clase of ['glifista', 'rastreador']) {
  const { jugada } = await pelea(clase);
  for (const h of HECHIZOS) {
    const r = await jugada(h);
    const igual = ['ronda', 'turno', 'vida', 'mana', 'estados'].every((k) => r.antes[k] === r.despues[k]);
    comprobar(igual && r.despues.esperando && r.despues.activo, `${clase}, «${h}»: ni vida, ni maná, ni ronda, ni turno; sigue siendo tu turno`, resumen(r));
    comprobar(/magia de combate todavía no está en el juego/.test(r.texto) && !/Atacas a|te ataca/.test(r.texto), `${clase}: se dice que no hay magia de combate, y nadie ataca`, resumen(r));
  }
}

{
  const { jugada, m } = await pelea('rastreador');
  let r = await jugada('ataco al saqueador B');
  comprobar(/Atacas a Saqueador B/.test(r.texto) && r.despues.ronda === r.antes.ronda + 1, 'atacar a otro objetivo: ataca a ese y pasa la ronda', resumen(r));

  r = await jugada('le lanzo arena a los ojos al saqueador A');
  comprobar(/Saqueador A queda cegad|Lo intentas con Saqueador A/.test(r.texto) && !/Atacas a/.test(r.texto), 'arena a los ojos: maniobra sin golpe, contra quien se dice', resumen(r));

  r = await jugada('me defiendo');
  const expiraAntes = r.texto.indexOf('se le pasa el efecto de protegido');
  const primerAtaque = r.texto.search(/te ataca/);
  comprobar(/Te cubres/.test(r.texto) && (expiraAntes < 0 || expiraAntes > primerAtaque) && r.despues.estados.includes('protegido'),
    'defenderse: la protección sigue puesta cuando atacan los enemigos', resumen(r));

  m.store.dispatch('inventory/anadir', { objeto: crearObjeto('pocion_curacion'), silencioso: true });
  const pociones = () => Object.values(m.ver('inventory.objetos.porId', {}) ?? {})
    .filter((o) => o.refId === 'pocion_curacion').reduce((n, o) => n + (o.cantidad ?? 1), 0);
  const antesPocion = pociones();
  r = await jugada('me bebo la poción de curación');
  comprobar(antesPocion === 1 && pociones() === 0 && /poción/i.test(r.texto.split('\n')[0] ?? ''),
    'curarse con lo que lleva: se bebe la poción, se gasta, y es lo primero que se cuenta', `${antesPocion}→${pociones()} · ${resumen(r)}`);
}

{
  const { jugada } = await pelea('portavoz', 11);
  const r = await jugada('bajad las armas, no quiero pelear');
  comprobar(/Te escuchan|No quieren saber nada|No hay con quién/.test(r.texto) && !/Atacas a/.test(r.texto), 'parlamentar: se habla, no se ataca', resumen(r));
}

{
  const { jugada } = await pelea('sombra', 3);
  const r = await jugada('huyo por el callejón');
  comprobar(!r.despues.activo || /No encuentras por dónde salir/.test(r.texto), 'huir: o sales, o pierdes el turno intentándolo, y se dice', resumen(r));
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
