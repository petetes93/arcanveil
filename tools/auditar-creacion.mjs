/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-creacion.mjs
 * ---------------------------------------------------------------------------
 * «¿Te gusta así o quieres cambiar algo?»
 *
 * Fija el lector de correcciones de la revelación: qué entiende, qué cambia y,
 * sobre todo, qué NO toca. Lo delicado es el sexo: «enana guerrera de barba
 * trenzada pelirroja» tiene que pasar a «enano guerrero» y dejar la barba
 * pelirroja, porque «pelirroja» va con la barba. Y el retrato tiene que decir
 * «a man» después, que es lo que de verdad se pinta.
 *
 *   node tools/auditar-creacion.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { aplicarCorreccion, cambiarSexo, resumenPersonaje, sexoDescrito } from '../src/player/Correccion.js';
import { sujetoRetrato as encargoRetrato } from '../src/art/rasgos.js';
import { crearPersonaje, construirInventarioInicial } from '../src/player/CharacterFactory.js';
import { repartoRecomendado, validarReparto } from '../src/player/Attributes.js';
import { capacidad } from '../src/inventory/Encumbrance.js';
import { obtenerPlantilla } from '../src/data/items.data.js';
import { RAZAS } from '../src/data/races.data.js';
import { CLASES } from '../src/data/classes.data.js';
import { TRASFONDOS } from '../src/data/backgrounds.data.js';
import { Logger, NIVEL } from '../src/core/Logger.js';

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

const BRUNHILDA = Object.freeze({
  id: 'pj-prueba', nombre: 'Brunhilda', genero: 'f', raza: 'ferrano', clase: 'rastreador',
  retrato: 'enana guerrera de barba trenzada pelirroja, hacha a la espalda',
  lore: 'Perdí la forja de mi padre en un incendio. Busco a quien lo provocó.',
  semillaRetrato: 124684,
});

const corregir = (texto, p = BRUNHILDA) => aplicarCorreccion(p, texto);

/* ── «mejor que sea hombre», el caso de la regresión ──────────────────────── */

{
  const r = corregir('mejor que sea hombre');
  const p = r.personaje;
  comprobar(p.genero === 'm', 'el sexo cambia', `genero=${p.genero}`);
  comprobar(p.nombre === 'Brunhilda', 'el nombre se conserva', p.nombre);
  comprobar(p.retrato === 'enano guerrero de barba trenzada pelirroja, hacha a la espalda',
    'la descripción cambia la persona y no la barba', p.retrato);
  // «a man» o, con especie, «a dwarf man»: sexo y especie van juntos.
  comprobar(/\ba (?:\w+ )?man\b/.test(encargoRetrato(p)) && !/\bwoman\b/.test(encargoRetrato(p)),
    'el retrato pide un hombre', encargoRetrato(p));
  comprobar(p.id === BRUNHILDA.id && p.raza === BRUNHILDA.raza && p.clase === BRUNHILDA.clase && p.lore === BRUNHILDA.lore,
    'lo que no se menciona no se toca');
}

/* ── El resto de correcciones ─────────────────────────────────────────────── */

const CASOS = [
  ['que se llame Brun', (p) => p.nombre === 'Brun'],
  ['que sea elfa', (p) => /^elfa guerrera/.test(p.retrato) && p.genero === 'f'],
  ['que sea un enano', (p) => /^enano guerrero/.test(p.retrato) && p.genero === 'm'],
  ['ponle una cicatriz en el ojo', (p) => /cicatriz en el ojo$/.test(p.retrato) && /scar over one eye/.test(encargoRetrato(p))],
  ['quítale la barba', (p) => p.retrato === 'enana guerrera, hacha a la espalda'],
  ['sin hacha', (p) => p.retrato === 'enana guerrera de barba trenzada pelirroja'],
  ['que sea más joven', (p) => /joven$/.test(p.retrato) && /young/.test(encargoRetrato(p))],
  ['que sea de linaje albar', (p) => p.raza === 'albar'],
  ['mejor glifista', (p) => p.clase === 'glifista'],
  ['que sea hombre y que se llame Brun', (p) => p.genero === 'm' && p.nombre === 'Brun'],
  // Lo que lleva encima: salió en la prueba de entrega y no se entendía.
  ['que lleve una capa roja', (p) => /con una capa roja$/.test(p.retrato) && p.genero === 'f'],
  ['que se llame Brun y lleva un escudo de roble', (p) => p.nombre === 'Brun' && /con un escudo de roble$/.test(p.retrato)],
  // Cambiar un rasgo que ya tenía lo sustituye: sumarlo le pedía al retrato
  // dos peinados a la vez («pelirroja… con el pelo negro»).
  ['que tenga el pelo negro', (p) => /con el pelo negro$/.test(p.retrato) && !/pelirroj/.test(p.retrato) && /barba/.test(p.retrato)],
  ['pelo negro en vez de pelirrojo', (p) => /con pelo negro$/.test(p.retrato) && !/pelirroj/.test(p.retrato)],
  ['que sea rubia', (p) => /, rubia$/.test(p.retrato) && !/pelirroj/.test(p.retrato)],
  ['cámbiale los ojos a verdes', (p) => /con ojos verdes$/.test(p.retrato)],
  ['cámbiale el nombre a Brun', (p) => p.nombre === 'Brun'],
  ['hazla más alta', (p) => /, alta$/.test(p.retrato)],
  ['que sea más vieja', (p) => /anciana$/.test(p.retrato)],
  ['dale un arco largo', (p) => /con un arco largo$/.test(p.retrato)],
];

for (const [texto, bien] of CASOS) {
  const r = corregir(texto);
  comprobar(r.entendido && bien(r.personaje), `«${texto}»`,
    `${r.cambios.join(' ') || '(no entendido)'} → ${JSON.stringify({ n: r.personaje.nombre, g: r.personaje.genero, raza: r.personaje.raza, clase: r.personaje.clase, d: r.personaje.retrato })}`);
}

/* ── Confirmar y no entender ─────────────────────────────────────────────── */

for (const texto of ['sí', 'vale', 'así está bien', 'empezamos', 'vale, empezamos', '¡Adelante!']) {
  comprobar(corregir(texto).confirmar, `«${texto}» arranca la partida`);
}

// «dale» es «adelante», pero «dale un arco largo» es darle un arco: arrancaba
// la partida en vez de añadirlo. Lo mismo con un «vale, pero…».
for (const texto of ['dale un arco largo', 'vale, pero que sea hombre', 'vamos a cambiarle el pelo']) {
  comprobar(!corregir(texto).confirmar, `«${texto}» no arranca la partida`);
}

const raro = corregir('hazla azul');
comprobar(!raro.entendido && !raro.confirmar && raro.personaje.retrato === BRUNHILDA.retrato,
  'lo que no entiende no lo toca, y lo dice');

/* ── Cambiar de sexo sin romper lo demás ─────────────────────────────────── */

const SEXO = [
  ['enana guerrera, pelirroja y alta, con hacha', 'm', 'enano guerrero, pelirrojo y alto, con hacha'],
  ['elfo explorador, delgado', 'f', 'elfa exploradora, delgada'],
  ['mujer de pelo largo y trenza rubia', 'm', 'hombre de pelo largo y trenza rubia'],
];
for (const [antes, g, despues] of SEXO) {
  const real = cambiarSexo(antes, g);
  comprobar(real === despues, `«${antes}» → ${g}`, real);
}

comprobar(sexoDescrito('enana guerrera') === 'f' && sexoDescrito('de barba espesa') === null,
  'la descripción marca el sexo solo cuando lo dice');

/* ── El resumen del narrador ─────────────────────────────────────────────── */

const resumen = resumenPersonaje(BRUNHILDA);
comprobar(/^Brunhilda, rastreadora de linaje ferrano\./.test(resumen),
  'el resumen concuerda oficio con la persona y linaje con «linaje»', resumen);
comprobar(resumen.includes('«Perdí la forja de mi padre en un incendio»'),
  'la historia se cita con sus palabras, sin cambiarle la persona', resumen);

/* ── El personaje nuevo gasta sus puntos y no empieza cargado ────────────── */

// La creación es por texto y nadie reparte puntos a mano. Se usaba el reparto
// base, todo a 8: los 27 puntos se quedaban sin gastar y uno de cada cinco
// personajes empezaba sobrecargado (−3 a todo) con su propio equipo.
{
  for (const [id, clase] of Object.entries(CLASES)) {
    const v = validarReparto(repartoRecomendado(clase.atributoPrincipal));
    comprobar(v.valido && v.restantes === 0, `el reparto de ${id} es válido y gasta los 27 puntos`,
      `${v.errores.join('; ')} (quedan ${v.restantes})`);
  }

  Logger.nivel(NIVEL.AVISO);
  const sobrecargados = [];
  let cuantos = 0;
  for (const raza of Object.keys(RAZAS)) {
    for (const [claseId, clase] of Object.entries(CLASES)) {
      for (const [tfId, tf] of Object.entries(TRASFONDOS)) {
        const { jugador } = crearPersonaje({ nombre: 'Prueba', raza, clase: claseId, trasfondo: tfId });
        const peso = construirInventarioInicial(clase, tf)
          .reduce((s, { refId, cantidad }) => s + (obtenerPlantilla(refId)?.peso ?? 0) * cantidad, 0);
        cuantos += 1;
        if (peso >= 0.9 * capacidad(jugador)) sobrecargados.push(`${raza}/${claseId}/${tfId}`);
      }
    }
  }
  comprobar(!sobrecargados.length, `ninguna de las ${cuantos} combinaciones empieza sobrecargada`,
    sobrecargados.slice(0, 5).join(' | '));
}

console.log(`\n${fallos ? `${fallos} fallos.` : 'Todo correcto.'}`);
process.exit(fallos ? 1 : 0);
