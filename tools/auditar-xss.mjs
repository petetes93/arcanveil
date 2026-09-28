/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-xss.mjs
 * ---------------------------------------------------------------------------
 * Por dónde podría entrar HTML en la página, y que no entre.
 *
 * Todo el texto va con textContent. Quedaban tres sitios con innerHTML:
 *
 *   · `pintarArte` (src/art/index.js): mete el SVG que generan retrato,
 *     criatura y paisaje. Reciben nombres y descripciones que vienen del
 *     narrador, de un guardado o del jugador. Aquí se les pasa texto hostil
 *     en cada campo y se comprueba que no sale ni una etiqueta ni un
 *     atributo de evento.
 *   · `crudo` (src/ui/DOM.js) y la opción `html` de `el` (app/app.js): no
 *     los usaba nadie y se han quitado.
 *
 * Y un cable trampa: cualquier innerHTML, outerHTML, insertAdjacentHTML o
 * document.write nuevo en src/ o app/ falla aquí hasta que se revise y se
 * añada a la lista, con su porqué.
 *
 * La prueba en el navegador de verdad (nombre de PNJ, acción, narración,
 * aviso y objeto hostiles, más un control que demuestra que el cebo se
 * dispara si entra como HTML) está en tools/regresion-app.mjs.
 *
 *   node tools/auditar-xss.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrato } from '../src/art/retrato.js';
import { criatura } from '../src/art/criatura.js';
import { paisaje, atmosfera } from '../src/art/paisaje.js';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

/* ── Los generadores de arte ───────────────────────────────────────────── */

const CEBOS = [
  '"><img src=x onerror=alert(1)>',
  "' onload='alert(1)",
  '</svg><script>alert(1)</script>',
  'javascript:alert(1)',
  'url(javascript:alert(1))',
  '<foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject>',
];
const CAMPOS = ['nombre', 'descripcion', 'raza', 'refId', 'tipo', 'tamano', 'terreno', 'clima', 'franja', 'semilla', 'linaje', 'rol', 'variante', 'clase', 'genero', 'especie'];

/** Lo que no puede aparecer en un SVG que va a innerHTML. */
function peligros(svg) {
  const p = [];
  // Lo que va entre comillas es el valor de un atributo: texto. Si el cebo
  // rompiera una comilla, lo que viene detrás quedaría fuera y se vería aquí.
  const estructura = svg.replace(/"[^"]*"/g, '""');
  if (/<\s*(script|img|iframe|foreignObject|object|embed|a)\b/i.test(estructura)) p.push('etiqueta');
  if (/\son[a-z]+\s*=/i.test(estructura)) p.push('atributo de evento');
  if (/<[^>]*\s(?:href|xlink:href)\s*=\s*""/i.test(estructura) && /(?:href|xlink:href)="(?!#)/i.test(svg)) p.push('enlace a fuera');
  if (/javascript:/i.test(estructura)) p.push('javascript: fuera de un texto');
  if ([...svg.matchAll(/=\s*"([^"]*)"/g)].some(([, valor]) => valor.includes('<'))) p.push('«<» sin escapar dentro de un atributo');
  return p;
}

// Control: con el nombre sin escapar, el detector salta. Si no saltara, el
// verde de abajo no demostraría nada.
comprobar(peligros(`<svg aria-label="Retrato de ${CEBOS[0]}"></svg>`).length > 0 && peligros(`<svg aria-label="${CEBOS[1]}"><rect/></svg>`).length === 0,
  'control: el detector ve un nombre sin escapar y no confunde un texto con un atributo');

const generadores = { retrato, criatura, paisaje, atmosfera };
for (const [nombre, generar] of Object.entries(generadores)) {
  const problemas = [];
  let piezas = 0;
  for (const cebo of CEBOS) {
    for (const campo of CAMPOS) {
      let svg = '';
      try { svg = generar({ [campo]: cebo }); } catch (e) { problemas.push(`${campo}: lanza ${e.message}`); continue; }
      piezas += 1;
      const p = peligros(svg);
      if (p.length) problemas.push(`${campo} = ${cebo.slice(0, 20)}…: ${p.join(', ')}`);
    }
    // Todos los campos a la vez.
    const todos = Object.fromEntries(CAMPOS.map((c) => [c, cebo]));
    const p = peligros(generar(todos));
    if (p.length) problemas.push(`todos = ${cebo.slice(0, 20)}…: ${p.join(', ')}`);
  }
  comprobar(!problemas.length, `${nombre}: ${piezas} piezas con texto hostil en cada campo, sin etiquetas ni eventos`, problemas.slice(0, 4).join(' | '));
}

{
  const svg = retrato({ nombre: 'Señora del "Pantano" & <compañía>' });
  comprobar(/aria-label="Retrato de Señora del &quot;Pantano&quot; &amp; &lt;compañía&gt;"/.test(svg), 'el nombre llega al texto alternativo, escapado', svg.match(/aria-label="[^"]*"/)?.[0]);
}

/* ── Cable trampa ──────────────────────────────────────────────────────── */

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/**
 * Sitios revisados. Cada uno con su porqué; uno nuevo no entra sin revisar.
 * La clave es «ruta: fragmento de la línea».
 */
const PERMITIDOS = new Map([
  ['src/art/index.js: nodo.innerHTML = generar(familia, opciones);', 'SVG de los generadores: todo texto pasa por escapar() (probado arriba)'],
  ['src/art/index.js: nodo.innerHTML = atmosfera(opciones);', 'SVG de atmósfera: mismo caso'],
  ["app/app.js: if (nodo) nodo.innerHTML = '';", 'vaciar con cadena vacía'],
]);

function recorrer(dir, salida = []) {
  for (const n of readdirSync(dir)) {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) recorrer(ruta, salida);
    else if (/\.(m?js)$/.test(n)) salida.push(ruta);
  }
  return salida;
}

const SUMIDERO = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(|createContextualFragment\s*\(|srcdoc\s*=/;
const encontrados = [];
for (const archivo of [...recorrer(join(RAIZ, 'src')), ...recorrer(join(RAIZ, 'app'))]) {
  const rel = relative(RAIZ, archivo).replace(/\\/g, '/');
  readFileSync(archivo, 'utf8').split(/\r?\n/).forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith('*') || t.startsWith('//')) return;
    if (SUMIDERO.test(t)) encontrados.push({ clave: `${rel}: ${t}`, donde: `${rel}:${i + 1}` });
  });
}
const nuevos = encontrados.filter((e) => !PERMITIDOS.has(e.clave));
comprobar(!nuevos.length, `solo ${PERMITIDOS.size} sitios revisados meten HTML en la página`, nuevos.map((e) => `${e.donde} → ${e.clave}`).join(' | '));
const perdidos = [...PERMITIDOS.keys()].filter((k) => !encontrados.some((e) => e.clave === k));
comprobar(!perdidos.length, 'y la lista no tiene sitios que ya no existen', perdidos.join(' | '));

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
