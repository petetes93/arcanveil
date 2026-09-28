/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-guardados.mjs
 * ---------------------------------------------------------------------------
 * Un archivo de partida es texto de fuera: se mira antes de fiarse.
 *
 * Lo que pasaba al importar:
 *   · Un `__proto__` en el archivo cambiaba el prototipo de la rama (la
 *     ficha heredaba lo que el archivo quisiera).
 *   · Miles de niveles de anidamiento reventaban la pila al fundir o clonar.
 *   · «"version": "7; drop"» se aceptaba.
 *   · Un archivo de cientos de megas se leía entero antes de mirar nada.
 *
 * Y lo que tiene que seguir funcionando: exportar una partida de verdad e
 * importarla, y abrir guardados antiguos.
 *
 *   node tools/auditar-guardados.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { crearMotor } from './motor-sin-ventana.mjs';
import * as Ser from '../src/persistence/Serializer.js';
import { crearEstadoInicial } from '../src/core/GameState.js';
import { PERSISTENCIA } from '../src/config/app.config.js';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

const V = PERSISTENCIA.versionFormato;

{
  const l = Ser.desdeTexto(`{"version":${V},"estado":{"player":{"__proto__":{"inyectado":"sí"},"nombre":"X"}}}`);
  const r = Ser.deserializar(l.guardado, crearEstadoInicial());
  comprobar(r.valido && r.estado.player.inyectado === undefined && Object.getPrototypeOf(r.estado.player) === Object.prototype && ({}).inyectado === undefined,
    '«__proto__» en el archivo no cambia ningún prototipo');
  const g = { version: V, estado: JSON.parse('{"player":{"__proto__":{"inyectado":"sí"}}}') };
  const r2 = Ser.deserializar(g, crearEstadoInicial());
  comprobar(r2.estado.player.inyectado === undefined, 'tampoco si el guardado llega ya parseado por otro camino');
}

{
  let hondo = '1';
  for (let i = 0; i < 20000; i += 1) hondo = `{"a":${hondo}}`;
  let lanzo = null;
  let l;
  try { l = Ser.desdeTexto(`{"version":${V},"estado":{"player":${hondo}}}`); } catch (e) { lanzo = e; }
  comprobar(!lanzo && !l.guardado && /estructura imposible/.test(l.error), '20.000 niveles de anidamiento: se rechaza con un motivo, sin reventar', lanzo?.message ?? l?.error);
  const trampa = Ser.desdeTexto(`{"version":${V},"estado":{"player":{"nombre":"[[[[{{{{"}}}`);
  comprobar(Boolean(trampa.guardado), 'corchetes dentro de un texto no cuentan como anidamiento', trampa.error);
}

{
  comprobar(/no dice de qué versión/.test(Ser.desdeTexto('{"version":"7; drop","estado":{}}').error ?? ''), 'una versión que no es un número entero se rechaza');
  comprobar(/no dice de qué versión/.test(Ser.desdeTexto('{"version":-3,"estado":{}}').error ?? ''), 'ni una negativa');
  comprobar(/no parece un guardado/.test(Ser.desdeTexto('[1,2,3]').error ?? ''), 'un array no es un guardado');
  const grande = `{"version":${V},"estado":{"x":"${'a'.repeat(PERSISTENCIA.importacionMaxBytes)}"}}`;
  comprobar(/demasiado grande/.test(Ser.desdeTexto(grande).error ?? ''), 'un texto de más de 3 MB se rechaza antes de parsearlo');
}

const m = await crearMotor({ semilla: 7 });
await m.empezar({ nombre: 'Alejo', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante', genero: 'm' });
await m.jugar('miro alrededor');
const saves = m.sistema('saves');

{
  let leido = false;
  const enorme = { size: 400 * 1024 * 1024, text: async () => { leido = true; return ''; } };
  const r = await saves.importarArchivo(enorme);
  comprobar(!r.exito && !leido && /demasiado grande/.test(r.motivo), 'un archivo de 400 MB se rechaza sin leerlo', r.motivo);
}

{
  saves.guardar('9', { silencioso: true });
  const texto = localStorage.getItem([...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((k) => /9$/.test(k)));
  const guardado = JSON.parse(texto);
  const profundidad = (o) => (o && typeof o === 'object' ? 1 + Math.max(0, ...Object.values(o).map(profundidad)) : 0);
  comprobar(profundidad(guardado) < PERSISTENCIA.profundidadMax / 2, `una partida real anida ${profundidad(guardado)} niveles: holgura de sobra frente a ${PERSISTENCIA.profundidadMax}`);
  const exportado = Ser.aTexto(guardado);
  comprobar(exportado.length < PERSISTENCIA.importacionMaxBytes / 3, `una exportación real ocupa ${Math.round(exportado.length / 1024)} KB, lejos del tope`);
  const r = saves.importar(exportado);
  comprobar(r.exito && m.ver('player.nombre') === 'Alejo', 'exportar e importar una partida de verdad sigue funcionando', r.motivo);
  comprobar(saves.cargar('9').exito, 'y cargar de una ranura también');
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
