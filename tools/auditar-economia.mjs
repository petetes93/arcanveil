/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-economia.mjs
 * ---------------------------------------------------------------------------
 * Comercio y oro: cantidades, precios y atomicidad.
 *
 * Defecto de partida: `validarCompra` aceptaba 0, -1, 1.5 y NaN; con -1 a
 * precio 5 daba `posible: true, total: -5`, y el cargo `-total` se volvía un
 * abono. La interfaz manda siempre 1, pero el sistema recibe lo que llegue
 * por el bus (`economy:buy`) o por una llamada directa: la regla vive en el
 * dominio y en los reductores, no en el formulario.
 *
 * Cada rechazo se comprueba contra el estado entero: oro, inventario,
 * estadísticas y eventos de compra o venta.
 *
 *   node tools/auditar-economia.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { crearMotor } from './motor-sin-ventana.mjs';
import { validarCompra, validarVenta } from '../src/economy/Trade.js';
import { desdePlantilla } from '../src/inventory/ItemFactory.js';
import { ECONOMIA } from '../src/config/balance.config.js';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

const MALAS = [['0', 0], ['-1', -1], ['1.5', 1.5], ['NaN', NaN], ['Infinity', Infinity], ["'3'", '3'], ['null', null]];

console.log('\n── Dominio: validar compra y venta ──');
{
  const objeto = { nombre: 'Pan', categoria: 'consumible', peso: 0.1, cantidad: 1 };
  const jugador = { oro: 100 };
  const inventario = { objetos: { porId: {}, orden: [] } };
  for (const [nombre, cantidad] of MALAS) {
    const r = validarCompra({ objeto, cantidad, precioUnitario: 5, jugador, inventario });
    comprobar(!r.posible && r.total === 0, `compra de ${nombre}: rechazada y total 0`, JSON.stringify(r));
  }
  for (const precio of [-5, NaN, Infinity, 2.5, '5']) {
    const r = validarCompra({ objeto, cantidad: 1, precioUnitario: precio, jugador, inventario });
    comprobar(!r.posible && r.total === 0, `precio ${String(precio)}: rechazado`, JSON.stringify(r));
  }
  for (const [nombre, cantidad] of MALAS) {
    const r = validarVenta({ objeto: { ...objeto, cantidad: 3 }, cantidad, precioUnitario: 5 });
    comprobar(!r.posible && r.total === 0, `venta de ${nombre}: rechazada`, JSON.stringify(r));
  }
  const exceso = validarVenta({ objeto: { ...objeto, cantidad: 2 }, cantidad: 3, precioUnitario: 5 });
  comprobar(!exceso.posible && /Solo llevas 2/.test(exceso.mensaje), 'vender más de lo que se lleva: rechazado (antes se recortaba en silencio)', JSON.stringify(exceso));
  const stock = validarCompra({ objeto, cantidad: 3, precioUnitario: 5, jugador, inventario, stock: 2 });
  comprobar(!stock.posible && stock.motivo === 'sin_stock', 'comprar más del stock: rechazado');
  const stockRoto = validarCompra({ objeto, cantidad: 1, precioUnitario: 5, jugador, inventario, stock: NaN });
  comprobar(!stockRoto.posible, 'un stock que no es número: no se vende');
}

console.log('\n── Sistema, bus y reductores, con el estado entero ──');
{
  const m = await crearMotor({ semilla: 3141 });
  await m.empezar({ nombre: 'Tasa', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante', genero: 'f' });
  const eco = m.sistema('economy');
  const eventos = [];
  for (const e of ['trade:bought', 'trade:sold', 'trade:completed']) m.bus.on(e, () => eventos.push(e));
  const foto = () => JSON.stringify({
    oro: m.ver('player.oro'),
    objetos: m.ver('inventory.objetos'),
    equipado: m.ver('inventory.equipado'),
    stats: m.ver('hazanas.estadisticas'),
    eventos: eventos.length,
  });
  const esperar = () => new Promise((r) => setTimeout(r, 0));
  const pan = desdePlantilla('daga');
  m.store.dispatch('inventory/oro', { delta: 50 - m.ver('player.oro', 0) });
  await esperar();

  for (const [nombre, cantidad] of MALAS) {
    const antes = foto();
    const r = eco.comprar({ refIdMercader: null, objeto: pan, cantidad });
    await esperar();
    comprobar(!r.exito && foto() === antes, `comprar(${nombre}): nada cambia (oro, inventario, estadísticas, eventos)`, `${JSON.stringify(r)}`);
  }
  for (const [nombre, cantidad] of MALAS) {
    const antes = foto();
    m.bus.emit('economy:buy', { refIdMercader: null, objeto: pan, cantidad });
    await esperar();
    comprobar(foto() === antes, `evento economy:buy con ${nombre}: nada cambia`);
  }

  // Reductores llamados a pelo: tampoco se fían de quien llama.
  const antesRed = foto();
  for (const delta of [NaN, Infinity, -Infinity, 1.5, '10']) m.store.dispatch('inventory/oro', { delta });
  await esperar();
  comprobar(foto() === antesRed, 'inventory/oro con NaN, ±Infinity, 1.5 o texto: rechazado en el reductor');
  const id = m.ver('inventory.objetos.orden', [])[0];
  const cantidadAntes = m.ver(`inventory.objetos.porId.${id}.cantidad`);
  for (const cantidad of [-1, 0, 1.5, NaN]) m.store.dispatch('inventory/retirar', { idObjeto: id, cantidad });
  m.store.dispatch('inventory/anadir', { objeto: { ...pan, cantidad: -2 } });
  m.store.dispatch('inventory/anadir', { objeto: { ...pan, cantidad: 1.5 } });
  await esperar();
  comprobar(m.ver(`inventory.objetos.porId.${id}.cantidad`) === cantidadAntes && foto() === antesRed, `retirar -1/0/1.5/NaN o añadir -2/1.5: no cambia (antes -1 sumaba una unidad)`, `${cantidadAntes} → ${m.ver(`inventory.objetos.porId.${id}.cantidad`)}`);

  // Compra válida con el oro justo.
  m.store.dispatch('inventory/oro', { delta: 1000 });
  await esperar();
  const oro0 = m.ver('player.oro');
  const n0 = m.ver('inventory.objetos.orden', []).length;
  eventos.length = 0;
  const ok = eco.comprar({ refIdMercader: null, objeto: pan, cantidad: 1 });
  await esperar();
  comprobar(ok.exito && m.ver('player.oro') === oro0 - ok.total && m.ver('inventory.objetos.orden', []).length >= n0 && eventos.filter((e) => e === 'trade:bought').length === 1,
    `una compra válida cobra ${ok.total}, entra el objeto y avisa una vez`, JSON.stringify(ok));

  const justo = ok.total;
  m.store.dispatch('inventory/oro', { delta: justo - m.ver('player.oro') });
  await esperar();
  const exacta = eco.comprar({ refIdMercader: null, objeto: pan, cantidad: 1 });
  await esperar();
  comprobar(exacta.exito && m.ver('player.oro') === 0, 'con el oro exacto: se compra y queda a 0');
  const sinOro = eco.comprar({ refIdMercader: null, objeto: pan, cantidad: 1 });
  comprobar(!sinOro.exito && m.ver('player.oro') === 0, 'sin oro: rechazada');

  // Atomicidad: si la segunda acción no entra, la primera se deshace.
  m.store.dispatch('inventory/oro', { delta: 20 });
  await esperar();
  const antesAt = foto();
  const bien = eco._despacharAtomico([
    { tipo: 'inventory/oro', payload: { delta: -5, motivo: 'prueba' } },
    { tipo: 'inventory/anadir', payload: { objeto: { ...pan, cantidad: 1.5 } } },
  ], 'prueba');
  await esperar();
  comprobar(bien === false && JSON.parse(foto()).oro === JSON.parse(antesAt).oro, 'si la segunda acción falla, el oro vuelve (transacción atómica)', `${JSON.parse(antesAt).oro} → ${JSON.parse(foto()).oro}`);

  // Venta: exceso, negativa y válida.
  const idVenta = m.ver('inventory.objetos.orden', []).find((x) => !m.ver(`inventory.objetos.porId.${x}`)?.equipado && !m.ver(`inventory.objetos.porId.${x}`)?.esMision);
  const llevo = m.ver(`inventory.objetos.porId.${idVenta}.cantidad`);
  const antesV = foto();
  const demas = eco.vender({ refIdMercader: null, idObjeto: idVenta, cantidad: llevo + 5 });
  const neg = eco.vender({ refIdMercader: null, idObjeto: idVenta, cantidad: -1 });
  await esperar();
  comprobar(!demas.exito && !neg.exito && foto() === antesV, 'vender de más o en negativo: nada cambia', `${demas.mensaje} / ${neg.mensaje}`);
  const oroV = m.ver('player.oro');
  const venta = eco.vender({ refIdMercader: null, idObjeto: idVenta, cantidad: 1 });
  await esperar();
  comprobar(venta.exito && m.ver('player.oro') === oroV + venta.total, `una venta válida paga ${venta.total}`, JSON.stringify(venta));

  // Borde del máximo: el oro no pasa del tope.
  m.store.dispatch('inventory/oro', { delta: ECONOMIA.oroMax - m.ver('player.oro') });
  m.store.dispatch('inventory/oro', { delta: 500 });
  await esperar();
  comprobar(m.ver('player.oro') === ECONOMIA.oroMax, `el oro se queda en el tope (${ECONOMIA.oroMax})`);
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
