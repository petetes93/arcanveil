/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-sujeto.mjs
 * ---------------------------------------------------------------------------
 * ¿Lo que se le pide al generador es lo que escribió el jugador?
 *
 * El sujeto del retrato (src/art/rasgos.js): si nombra especie, manda su
 * especie y no el linaje de la ficha; quién es va delante; lo que lo hace
 * reconocible (barba, hacha, cicatriz) antes que el resto. Estas pruebas
 * vivían en auditar-retrato.mjs cuando el retrato se pedía a Pollinations;
 * el servicio se fue y la regla se queda.
 *
 *   node tools/auditar-sujeto.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sujetoRetrato as encargoRetrato, especieNombrada } from '../src/art/rasgos.js';
import { RAZAS } from '../src/data/races.data.js';
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

const ENANA = 'enana guerrera de barba trenzada pelirroja, hacha a la espalda';

/* ── La especie escrita manda sobre la ficha ─────────────────────────────── */

const conCuernos = encargoRetrato({ raza: 'griscuerno', descripcion: ENANA });

comprobar(!/grey-blue|horns?/.test(conCuernos),
  'con especie escrita no se cuelan piel ni cuernos del linaje de la ficha',
  conCuernos);

comprobar(/\bdwarf\b/.test(conCuernos), 'la especie escrita llega al encargo', conCuernos);

// La misma descripción debe dar el mismo sujeto sea cual sea el dado.
const encargos = new Set(Object.keys(RAZAS).map((raza) => encargoRetrato({ raza, descripcion: ENANA })));
comprobar(encargos.size === 1,
  `con especie escrita el encargo es igual para los ${Object.keys(RAZAS).length} linajes`,
  `salieron ${encargos.size} encargos distintos`);

/* ── Lo que distingue al personaje, delante ─────────────────────────────── */

const pos = (t) => conCuernos.indexOf(t);

comprobar(pos('braided beard') > 0 && pos('battle axe') > 0,
  'la barba y el hacha están en el encargo', conCuernos);

comprobar(pos('braided beard') < pos('red hair') && pos('battle axe') < pos('red hair'),
  'la barba y el hacha van antes que el pelo',
  `barba ${pos('braided beard')}, hacha ${pos('battle axe')}, pelo ${pos('red hair')}`);

// El sujeto sigue siendo lo primero: la barba no puede adelantar a «a woman».
comprobar(pos('a woman') < pos('braided beard'), 'el sexo sigue delante de los rasgos', conCuernos);

const cicatriz = encargoRetrato({ raza: 'valdes', descripcion: 'herrero con delantal de cuero, ojos grises y cicatriz en la ceja' });
comprobar(cicatriz.indexOf('scar') < cicatriz.indexOf('eyes'),
  'la cicatriz va antes que los ojos', cicatriz);

/* ── Sin especie escrita, el linaje sí cuenta ───────────────────────────── */

const sinEspecie = encargoRetrato({ raza: 'griscuerno', descripcion: 'guerrera de pelo rojo y cicatriz en la ceja' });
comprobar(/horns/.test(sinEspecie),
  'sin especie escrita, el linaje de la ficha sigue aportando sus rasgos', sinEspecie);

const neutro = encargoRetrato({ raza: 'valdes', descripcion: 'con cicatriz y barba espesa y ojos grises' });
comprobar(/one person/.test(neutro) && neutro.indexOf('one person') < neutro.indexOf('beard'),
  'sin sexo ni especie, el encargo empieza por un sujeto y no por un rasgo suelto', neutro);

/* ── Qué especie ha nombrado ────────────────────────────────────────────── */

const ESPECIES = [
  ['enana guerrera de barba trenzada', 'enana'],
  ['Elfa exploradora de ojos verdes', 'elfa'],
  ['un orco enorme con colmillos', 'orco'],
  ['mediana ladrona muy rápida', 'mediana'],
  ['guerrera pelirroja con hacha', null],
];

for (const [texto, espera] of ESPECIES) {
  const sale = especieNombrada(texto);
  comprobar(sale === espera, `«${texto}» nombra ${espera ?? 'ninguna especie'}`, `salió ${sale}`);
}

console.log(`
${fallos ? `${fallos} fallos.` : 'Todo correcto.'}`);
process.exit(fallos ? 1 : 0);
