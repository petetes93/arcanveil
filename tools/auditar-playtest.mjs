/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-playtest.mjs
 * ---------------------------------------------------------------------------
 * Lo que Alejandro vio jugando, con sus textos, y lo que tiene que salir.
 *
 * En el Vado del Yunque, con la figura del tejado vigilando la bolsa del
 * mercader (semilla 5):
 *   · «Fijarte en la figura del tejado» salía «Le dices: «Fijarte…»».
 *   · «Hablar con Cordor» tres veces: «Hablas con Cordor», «Cordor espera tu
 *     respuesta. ¿Qué haces?» y ninguna conversación; se sugirió cinco veces.
 *   · Un salto imposible de 100 metros se narraba primero como vuelo.
 *   · «me enfrento a un ciudadano» daba solo «Te enfrentas a un ciudadano».
 *   · «dejame en paz» no se sabía a quién iba.
 *
 * Cada caso comprueba el texto VISIBLE y el estado antes y después (turno,
 * combate, oro), no la etiqueta del analizador. Al final, dos partidas de
 * 15 turnos en semillas distintas, con propiedades que se tienen que cumplir
 * en todas; la transcripción se escribe para leerla (`--salida carpeta`).
 *
 *   node tools/auditar-playtest.mjs [--salida carpeta]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearMotor } from './motor-sin-ventana.mjs';

const args = process.argv.slice(2);
const salida = args.includes('--salida') ? args[args.indexOf('--salida') + 1] : null;

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).replace(/\n/g, ' | ').slice(0, 500)}`); }
}

const FICHA = { nombre: 'Alejo', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante', genero: 'm' };
const visible = (t) => String(t).split('\n').filter((l) => l && !l.startsWith('»')).join('\n');
const nombre = (m, id) => m.ver(`npcs.conocidos.porId.${id}.nombre`);
const presentes = (m) => (m.ver('npcs.presentes', []) ?? []).map((id) => nombre(m, id));
const opciones = (m) => m.opciones().map((o) => o.label);

console.log('\n── La figura del tejado (semilla 5) ──');
{
  const m = await crearMotor({ semilla: 5 });
  await m.empezar(FICHA);
  const [cordor] = presentes(m);
  const mercader = m.sistema('situations').aqui()[0]?.actores?.mercader?.nombre;
  comprobar(m.sistema('situations').aqui()[0]?.refId === 'encapuchado_vigila' && cordor, `escena de partida: la figura vigila a ${mercader}; ${cordor} delante`);

  const sugerida = m.opciones().find((o) => /figura del tejado/.test(o.label));
  let t = visible(await m.pulsar(sugerida));
  comprobar(/^Te fijas en la figura del tejado\./.test(t) && !/Le dices/.test(t), 'pulsar «Fijarte en la figura del tejado»: se narra como acción, no como algo dicho', t);
  comprobar(/guantes de cuero/.test(t), 'y con éxito se ve el detalle de la escena', t);
  comprobar(!opciones(m).some((o) => /^Fijarte/.test(o)) && opciones(m).some((o) => /Avisar|Seguir|Gritarle/.test(o)), 'y la sugerencia pasa a lo que se puede hacer con ello', opciones(m).join(' | '));

  t = visible(await m.jugar('Fijarte en la figura del tejado'));
  comprobar(!/Le dices|Calles de tierra/.test(t) && /figura/.test(t), 'escrito a mano otra vez: habla de la figura, no de las calles', t);

  const turno0 = m.ver('meta.turno');
  t = visible(await m.jugar(`Hablar con ${cordor}`));
  const saludo = t;
  comprobar(new RegExp(`«[^»]+»[^\\n]*${cordor}|${cordor}[^\\n]*«`).test(t) && !/espera tu respuesta\. ¿Qué haces\?/.test(t), `«Hablar con ${cordor}»: ${cordor} dice algo, y la palabra se devuelve una vez`, t);
  t = visible(await m.jugar(`Hablar con ${cordor}`));
  comprobar(t !== saludo && !/Buenas|Pasa, pasa/.test(t) && /pregúntalo|hace falta/.test(t), 'la segunda vez no repite el saludo: pide algo concreto', t);
  comprobar(opciones(m).some((o) => /^Pregunt/.test(o)) && !opciones(m).includes(`Hablar con ${cordor}`), 'y se sugieren temas, no otro «Hablar con»', opciones(m).join(' | '));
  comprobar(m.ver('meta.turno') === turno0 + 2, 'cada conversación es un turno');

  const oro = m.ver('player.oro');
  t = visible(await m.jugar('salto 100 metros hasta el tejado de enfrente'));
  comprobar(/^Intentas saltar 100 metros/.test(t) && !/^Saltas 100/.test(t), 'el salto imposible se narra como intento', t);
  comprobar(!/dedo a los labios|te mira desde arriba|Calles de tierra/.test(t), 'y nadie en el tejado reacciona como si hubiera llegado', t);
  comprobar(m.ver('player.oro') === oro && !m.ver('combat.activo', false), 'sin efectos raros: ni oro ni combate');

  const turnoA = m.ver('meta.turno');
  t = visible(await m.jugar('me enfrento a un ciudadano'));
  comprobar(/^¿Con quién\?/.test(t) && new RegExp(cordor).test(t) && m.ver('meta.turno') === turnoA && !m.ver('combat.activo', false), '«me enfrento a un ciudadano»: pregunta con quién, lista quién hay, no gasta turno ni abre combate', t);
  t = visible(await m.jugar(`me enfrento a ${mercader}`));
  comprobar(new RegExp(`${mercader}`).test(t) && /«[^»]+»/.test(t) && !m.ver('combat.activo', false) && !/guardia/i.test(t), `«me enfrento a ${mercader}»: reacciona con tensión, sin combate ni guardias inventados`, t);

  t = visible(await m.jugar('dejame en paz'));
  comprobar(new RegExp(`^Le dices a ${mercader}: «Déjame en paz»`).test(t) && !/espera tu respuesta/.test(t) && !/Eso no puedo hacerlo/.test(t), '«dejame en paz» tras hablar con alguien: va a esa persona, que se aparta; nadie «espera tu respuesta»', t);

  // Guardar y cargar: las sugerencias usadas siguen usadas.
  const antes = JSON.stringify(m.ver('narrative.sugerenciasUsadas'));
  m.guardarYCargar();
  comprobar(JSON.stringify(m.ver('narrative.sugerenciasUsadas')) === antes, 'tras guardar y cargar, lo ya sugerido y usado se recuerda');
}

console.log('\n── Una orden sin nadie a quien dársela ──');
{
  const m = await crearMotor({ semilla: 5 });
  await m.empezar(FICHA);
  const turno = m.ver('meta.turno');
  const t = visible(await m.jugar('dejame en paz'));
  comprobar(/^¿A quién se lo dices\?/.test(t) && m.ver('meta.turno') === turno, 'sin interlocutor reciente: aclara y no gasta turno', t);
}

console.log('\n── Dos partidas de 15 turnos: propiedades en todas ──');
{
  const GUION = (a, b) => [
    'miro alrededor', `Hablar con ${a}`, `Hablar con ${a}`, `le pregunto a ${a} qué se cuenta por aquí`, 'Fijarte en lo que está pasando',
    `me enfrento a ${b}`, 'dejame en paz', 'salto 50 metros por encima del río', 'me siento a escuchar lo que se habla', `le doy las gracias a ${a}`,
    `le ofrezco a ${b} un poco de mi agua`, `le pregunto a ${b} si hay un curandero`, 'me enfrento a un vecino', 'espero', 'miro alrededor',
  ];
  for (const semilla of [5, 24]) {
    const m = await crearMotor({ semilla });
    const apertura = await m.empezar(FICHA);
    const [a, b = a] = presentes(m);
    const lineas = [`# Semilla ${semilla}`, '', ...apertura.split('\n'), ''];
    const problemas = [];
    let anteriores = [];
    let todo = apertura;
    const nombres = () => presentes(m).filter(Boolean);
    for (const entrada of GUION(a, b)) {
      const t = visible(await m.jugar(entrada));
      todo += `\n${t}`;
      const ofrecidas = opciones(m);
      lineas.push(`» ${entrada}`, ...t.split('\n'), `  [sugiere: ${ofrecidas.join(' | ')}]`, '');
      if (/^Intentas .*\d+ metros/.test(t) && /Te falta un poco|por los pelos|por poco/.test(t)) problemas.push(`imposible narrado como casi: ${entrada}`);
      // «Déjame en paz» a alguien tiene reacción de ese alguien, no solo el eco.
      const orden = t.match(/^Le dices a (\p{Lu}\p{Ll}+): «Déjame en paz»\.\n(.*)/u);
      if (orden && !orden[2].includes(orden[1]) && !/^«/.test(orden[2])) problemas.push(`«Déjame en paz» sin reacción de ${orden[1]}`);
      // Quien «espera tu respuesta» es el último que ha hablado.
      const espera = t.match(/(\p{Lu}\p{Ll}+) espera tu respuesta\.$/u);
      if (espera) {
        const tras = t.slice(t.lastIndexOf(espera[1], t.length - espera[0].length - 1) + espera[1].length, t.length - espera[0].length);
        const otro = nombres().find((x) => x !== espera[1] && tras.includes(x));
        if (otro) problemas.push(`cierra con ${espera[1]} esperando, pero después habla ${otro}: ${entrada}`);
      }
      // Lo que se sugiere por el detalle de la escena exige haberlo visto.
      if (ofrecidas.some((o) => /^(?:Avisar a .* de que le vigilan|Seguir a la figura sin que te vea)$/.test(o)) && !/guantes de cuero/.test(todo)) {
        problemas.push(`sugiere actuar sobre un detalle no visto: ${entrada}`);
      }
      if (/Le dices: «\p{Lu}\p{Ll}+(?:ar|er|ir)(?:te|se)?\b/u.test(t)) problemas.push(`infinitivo tomado por habla: ${entrada}`);
      if (/espera tu (?:respuesta|movimiento)\. ¿Qué haces\?/.test(t)) problemas.push(`dos cierres: ${entrada}`);
      if (/¿Qué haces\?\n¿Qué haces\?/.test(t)) problemas.push(`cierre repetido: ${entrada}`);
      if (/^(?:Saltas|Vuelas) \d/m.test(t)) problemas.push(`imposible narrado como hecho: ${entrada}`);
      if (m.ver('combat.activo', false)) problemas.push(`combate abierto sin pedirlo: ${entrada}`);
      // Lo que se acaba de usar no vuelve si nada ha cambiado.
      const usada = anteriores.find((o) => o.toLowerCase() === entrada.toLowerCase());
      if (usada && ofrecidas.includes(usada) && JSON.stringify(m.ver('narrative.sugerenciasUsadas')).includes(usada.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) problemas.push(`sugerencia usada vuelve igual: ${usada}`);
      anteriores = ofrecidas;
    }
    comprobar(problemas.length === 0, `semilla ${semilla}: 15 turnos sin infinitivos tomados por habla, cierres dobles, imposibles narrados como hechos ni combates sin pedir`, problemas.join(' / '));
    if (salida) { mkdirSync(salida, { recursive: true }); writeFileSync(join(salida, `playtest-${semilla}.md`), lineas.join('\n')); }
  }
}

console.log('\n── Repetición sostenida: 20 turnos por semilla, con contadores ──');
{
  // Los casos de arriba prueban frases concretas; esto, que no se repita lo
  // mismo turno tras turno. Antes (medido en 2a8e2e9): el mismo trío de
  // sugerencias que el turno anterior en 9 y 10 de 20 turnos, una misma
  // sugerencia hasta 9 turnos seguidos, y «¿Qué haces?» a secas en 15 y 16.
  const GUION = (a, b) => [
    'miro alrededor', `Hablar con ${a}`, `Hablar con ${a}`, `le pregunto a ${a} qué se cuenta por aquí`, 'Fijarte en lo que está pasando',
    `me enfrento a ${b}`, 'dejame en paz', 'salto 50 metros por encima del río', 'me siento a escuchar lo que se habla', `le doy las gracias a ${a}`,
    `le ofrezco a ${b} un poco de mi agua`, `le pregunto a ${b} si hay un curandero`, 'me enfrento a un vecino', 'espero', 'miro alrededor',
    'sigo a la figura', 'me acerco al puente', `le pregunto a ${a} por la figura del tejado`, 'descanso un rato', 'miro alrededor',
  ];
  for (const semilla of [5, 24]) {
    const m = await crearMotor({ semilla });
    await m.empezar(FICHA);
    const [a, b = a] = presentes(m);
    let previo = null; let trios = 0; let rachas = new Map(); let racha = 0; let corta = 0;
    const raras = [];
    let usadaVuelve = 0;
    for (const entrada of GUION(a, b)) {
      const t = visible(await m.jugar(entrada));
      const ops = opciones(m);
      const clave = ops.join(' | ');
      if (clave === previo) trios += 1;
      previo = clave;
      const nuevas = new Map();
      for (const o of ops) { const n = (rachas.get(o) ?? 0) + 1; nuevas.set(o, n); racha = Math.max(racha, n); }
      rachas = nuevas;
      if (/(^|\n)¿Qué haces\?$/.test(t.trim())) corta += 1;
      for (const o of ops) {
        const mismo = o.match(/^Preguntar a (\p{Lu}\p{Ll}+) por (\p{Lu}\p{Ll}+)$/u);
        if ((mismo && mismo[1] === mismo[2]) || /^Hablar$/.test(o)) raras.push(o);
      }
      // Lo que se acaba de hacer con otras palabras no se vuelve a proponer.
      if (/qué se cuenta/.test(entrada) && ops.some((o) => new RegExp(`^Preguntar a ${a} qué se cuenta`).test(o))) usadaVuelve += 1;
      if (/«[^»]*\?[^»]*»$/.test(t.trim().split('\n').at(-2) ?? '') && /¿Qué haces\?$/.test(t.trim())) raras.push(`cierre tras pregunta: ${entrada}`);
      if (/¿Qué haces\?\nCierra/.test(t)) raras.push('aviso del mundo tras el cierre');
    }
    comprobar(trios <= 3 && racha <= 3, `semilla ${semilla}: el mismo trío que el turno anterior en ${trios}/20 turnos, una sugerencia como mucho ${racha} turnos seguidos (≤ 3 y ≤ 3)`);
    comprobar(corta <= 12, `semilla ${semilla}: «¿Qué haces?» a secas cierra ${corta}/20 turnos (≤ 12); si hay trama, pregunta por ella`);
    comprobar(!raras.length && !usadaVuelve, `semilla ${semilla}: sin «Preguntar a X por X», «Hablar» a secas, lo recién hecho otra vez ni cierres encima de una pregunta`, [...raras, usadaVuelve ? 'vuelve «qué se cuenta» recién preguntado' : ''].join(' | '));
  }
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
