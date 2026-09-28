/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-borrados.mjs
 * ---------------------------------------------------------------------------
 * Lo que se quita del estado, se quita.
 *
 * El almacén funde cada parche con el estado: un `delete` en una copia no
 * quitaba nada. Salió al probar una poción en combate: «Te tomas poción de
 * curación», y la poción seguía ahí para la siguiente. Detrás:
 *
 *   · Lo comido, bebido, vendido o soltado seguía en `inventory.objetos.porId`
 *     aunque no en la lista: pesaba (20 pociones bebidas, 10 kilos más) y se
 *     ofrecía en combate.
 *   · Las misiones cerradas seguían en `quests.activas.porId`.
 *   · Los rasgos con recarga no se recargaban nunca.
 *
 * Aquí: el marcador `BORRAR` del almacén, los tres casos con el motor de
 * verdad, y la migración que limpia los guardados que ya los arrastran.
 *
 *   node tools/auditar-borrados.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { crearMotor } from './motor-sin-ventana.mjs';
import { aplicarParche, BORRAR } from '../src/core/Store.js';
import { crear as crearObjeto } from '../src/inventory/Item.js';
import { rasgosActivos, recargarUsos } from '../src/player/ClassSystem.js';
import { migrar } from '../src/persistence/Migrations.js';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 500)}`); }
}

/* ── El almacén ────────────────────────────────────────────────────────── */

{
  const base = { a: { x: 1, y: 2 }, b: 3 };
  const copia = { ...base.a };
  delete copia.x;
  comprobar('x' in aplicarParche(base, { a: copia }).a, 'con `delete` en la copia la clave sigue (por eso hace falta BORRAR)');
  const sin = aplicarParche(base, { a: { x: BORRAR } });
  comprobar(!('x' in sin.a) && sin.a.y === 2 && sin.b === 3, 'BORRAR quita la clave y no toca lo demás', JSON.stringify(sin));
  comprobar(aplicarParche(base, { a: { z: BORRAR } }) === base, 'BORRAR de lo que no está no cambia nada');
  comprobar(aplicarParche(base, { a: { x: null } }).a.x === null, 'null sigue siendo null');
}

/* ── Inventario ────────────────────────────────────────────────────────── */

const FICHA = { nombre: 'Alejo', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante', genero: 'm' };
const m = await crearMotor({ semilla: 7 });
await m.empezar(FICHA);
const inventario = () => m.ver('inventory.objetos');
const carga = () => m.ver('inventory.carga');

{
  const antes = { ids: Object.keys(inventario().porId).length, carga: carga() };
  for (let i = 0; i < 20; i += 1) {
    const p = crearObjeto('pocion_curacion');
    m.store.dispatch('inventory/anadir', { objeto: p, silencioso: true });
    const id = Object.values(inventario().porId).find((o) => o.refId === 'pocion_curacion').id;
    m.store.dispatch('inventory/consumir', { idObjeto: id });
    await new Promise((r) => setTimeout(r, 1));
  }
  const despues = { ids: Object.keys(inventario().porId).length, carga: carga() };
  comprobar(despues.ids === antes.ids && despues.carga === antes.carga, 'beber 20 pociones no deja 20 pociones fantasma ni 10 kilos de más', `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`);
  comprobar(Object.keys(inventario().porId).length === inventario().orden.length, 'lo que hay y la lista coinciden');
}

{
  const pan = crearObjeto('pan');
  m.store.dispatch('inventory/anadir', { objeto: { ...pan, cantidad: 3 }, silencioso: true });
  const id = Object.values(inventario().porId).find((o) => o.refId === 'pan')?.id;
  m.store.dispatch('inventory/retirar', { idObjeto: id, cantidad: 2 });
  comprobar(inventario().porId[id]?.cantidad === 1, 'retirar parte de un montón deja el resto');
  m.store.dispatch('inventory/retirar', { idObjeto: id, cantidad: 1 });
  comprobar(!(id in inventario().porId) && !inventario().orden.includes(id), 'retirar lo último lo quita de verdad');
}

{
  // Lo que ya no está no vuelve al guardar y cargar.
  m.guardarYCargar();
  comprobar(Object.keys(inventario().porId).length === inventario().orden.length, 'tras guardar y cargar, sin fantasmas');
}

/* ── Misiones ──────────────────────────────────────────────────────────── */

{
  const mision = { refId: 'prueba_borrado', titulo: 'Prueba', estado: 'activa', objetivos: [] };
  m.store.dispatch('quests/registrar', { mision });
  const dentro = 'prueba_borrado' in (m.ver('quests.activas.porId') ?? {});
  m.store.dispatch('quests/cerrar', { mision, estado: 'completada' });
  const activas = m.ver('quests.activas');
  comprobar(dentro && !('prueba_borrado' in activas.porId) && !activas.orden.includes('prueba_borrado'), 'una misión cerrada deja de estar entre las activas', JSON.stringify(Object.keys(activas.porId)));
}

/* ── Rasgos con recarga ────────────────────────────────────────────────── */

{
  const jugador = { raza: 'valdes', clase: 'baluarte', nivel: 3, usosRasgos: {} };
  const rasgo = rasgosActivos(jugador).find((r) => r.efecto?.recarga === 'combate');
  const estado = { player: { ...jugador, usosRasgos: { [rasgo.refId]: 1 } } };
  const tras = aplicarParche(estado, recargarUsos(estado.player, 'combate'));
  comprobar((tras.player.usosRasgos[rasgo.refId] ?? 0) === 0, `«${rasgo.nombre}» se recarga al acabar el combate`, JSON.stringify(tras.player.usosRasgos));
}

/* ── Guardados que ya los arrastran ────────────────────────────────────── */

{
  const guardado = {
    version: 7,
    estado: {
      inventory: {
        objetos: { porId: { a: { id: 'a' }, b: { id: 'b' }, fantasma: { id: 'fantasma' }, espada: { id: 'espada' } }, orden: ['a', 'b'] },
        equipado: { armaPrincipal: 'espada', cabeza: null },
      },
      quests: { activas: { porId: { viva: {}, cerrada: {} }, orden: ['viva'] }, completadas: [], fallidas: [] },
    },
  };
  const r = migrar(guardado);
  const e = r.guardado.estado;
  comprobar(r.guardado.version === 8, 'el guardado sube al formato 8', JSON.stringify(r).slice(0, 300));
  comprobar(Object.keys(e.inventory.objetos.porId).sort().join() === 'a,b,espada', 'la migración quita lo gastado y conserva lo equipado', JSON.stringify(e.inventory.objetos.porId));
  comprobar(Object.keys(e.quests.activas.porId).join() === 'viva', 'y las misiones cerradas', JSON.stringify(e.quests.activas.porId));
  comprobar(Object.keys(guardado.estado.inventory.objetos.porId).length === 4, 'sin tocar el guardado original');
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
