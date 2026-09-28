/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-encargos.mjs
 * ---------------------------------------------------------------------------
 * Comprueba que el encargo del retrato dice lo que el jugador escribió.
 *
 * Existe porque el fallo era invisible desde el código: `encargoRetrato()`
 * devolvía una frase en inglés perfectamente formada, y solo mirando la imagen
 * se descubría que faltaban el sexo, la especie y medio equipo. Una descripción
 * de «enano pelirrojo con parche» acababa siendo un humano alto y castaño.
 *
 * Cada caso declara lo que TIENE que aparecer en el encargo y lo que NO puede
 * aparecer. Lo segundo importa tanto como lo primero: el fallo del enano no
 * era que faltara «dwarf», era que el linaje metía «tall and gaunt» encima.
 *
 *   node tools/auditar-encargos.mjs          comprueba y sale con 0 o 1
 *   node tools/auditar-encargos.mjs --ver    además imprime cada encargo
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sujetoRetrato as encargoRetrato } from '../src/art/rasgos.js';

const VER = process.argv.includes('--ver');

/**
 * Casos de prueba.
 *
 * Los dos primeros son los del informe de juego del 24-09: son los que se
 * generaron de verdad y salieron mal.
 */
const CASOS = [
  {
    nombre: 'Lyra',
    raza: 'brumal',
    descripcion: 'elfa exploradora de pelo plateado largo, ojos azul brillante, '
      + 'cicatriz en la ceja izquierda, armadura de cuero negro y capa verde',
    exige: ['woman', 'elf', 'pointed ears', 'green cloak', 'black leather',
      'silver white hair', 'blue eyes', 'left eyebrow'],
    prohibe: ['one person'],
  },
  {
    nombre: 'Borin',
    raza: 'sombracorteza',
    descripcion: 'enano pelirrojo con barba trenzada, parche en el ojo derecho, '
      + 'armadura de placas y un martillo de guerra al hombro',
    // Sexo y especie juntos: «a dwarf man» es una persona; «a man, a dwarf»
    // eran dos cosas y el modelo elegía.
    exige: ['a dwarf man', 'red hair', 'eyepatch', 'warhammer', 'plate armour',
      'braided beard', 'right side'],
    prohibe: ['tall and gaunt', 'one person'],
  },
  {
    nombre: 'sin sexo ni especie',
    raza: 'valdes',
    descripcion: 'herrero de barba gris y delantal de cuero quemado',
    exige: ['a man', 'a beard', 'leather apron'],
    prohibe: [],
  },
  {
    nombre: 'maga con libro',
    raza: 'albar',
    descripcion: 'maga anciana de ojos dorados con una tunica azul y un libro bajo el brazo',
    exige: ['a woman', 'amber eyes', 'blue tunic', 'book'],
    prohibe: ['one person'],
  },
];

let fallos = 0;

for (const c of CASOS) {
  const encargo = encargoRetrato({ raza: c.raza, descripcion: c.descripcion }) ?? '';
  const bajo = encargo.toLowerCase();

  const faltan = c.exige.filter((t) => !bajo.includes(t.toLowerCase()));
  const sobran = c.prohibe.filter((t) => bajo.includes(t.toLowerCase()));

  const bien = !faltan.length && !sobran.length;
  if (!bien) fallos += 1;

  console.log(`${bien ? 'OK  ' : 'MAL '} ${c.nombre}`);
  if (faltan.length) console.log(`     falta:  ${faltan.join(', ')}`);
  if (sobran.length) console.log(`     sobra:  ${sobran.join(', ')}`);
  if (VER || !bien) console.log(`     → ${encargo}\n`);
}

console.log(`\n${CASOS.length - fallos}/${CASOS.length} encargos correctos.`);
process.exit(fallos ? 1 : 0);
