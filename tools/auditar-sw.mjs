/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-sw.mjs
 * ---------------------------------------------------------------------------
 * El trabajador de servicio de verdad (`sw.js`), en un ámbito simulado.
 *
 * Lo que hacía mal:
 *   · Guardaba en caché CUALQUIER respuesta GET, también de otros orígenes:
 *     el `GET /estado` del puente de Groq (127.0.0.1:11436) se contestaba
 *     desde la caché a partir de la primera vez, y el diagnóstico decía lo
 *     mismo aunque el puente se hubiera caído o arrancado después.
 *   · Si fallaba cualquier petición (un script, una imagen), devolvía la
 *     página del juego: HTML donde se esperaba otra cosa.
 *
 * Lo que tiene que hacer: solo lo propio pasa por la caché; la página de
 * respaldo sin conexión, solo al navegar.
 *
 *   node tools/auditar-sw.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${detalle}`); }
}

const ORIGEN = 'https://arcanveil.test';
const codigo = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

/** Monta el trabajador con una caché en memoria y una red controlada. */
function montar() {
  const guardado = new Map();
  const oyentes = {};
  let red = async () => { throw new TypeError('sin red'); };
  const cache = {
    put: async (req, res) => { guardado.set(typeof req === 'string' ? new URL(req, ORIGEN).href : req.url, res); },
    addAll: async () => {},
  };
  const scope = {
    location: new URL(`${ORIGEN}/sw.js`),
    addEventListener: (tipo, fn) => { oyentes[tipo] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req) => {
      const url = typeof req === 'string' ? new URL(req, `${ORIGEN}/`).href : req.url;
      return guardado.get(url)?.clone();
    },
  };
  new Function('self', 'caches', 'fetch', codigo)(scope, caches, (...a) => red(...a));

  /** Lanza un fetch como el navegador; `null` si el trabajador no lo toma. */
  async function pedir(url, { mode = 'cors' } = {}) {
    const request = { url: new URL(url, ORIGEN).href, method: 'GET', mode, clone() { return this; } };
    let respuesta = null;
    oyentes.fetch({ request, respondWith: (p) => { respuesta = p; } });
    if (!respuesta) return null;
    try { return await respuesta; } catch (e) { return { error: e }; }
  }
  return { pedir, guardado, fijarRed: (fn) => { red = fn; } };
}

const texto = async (r) => (r && !r.error && typeof r.text === 'function' ? r.text() : null);

{
  const sw = montar();
  let n = 0;
  sw.fijarRed(async () => new Response(`{"n":${++n}}`, { status: 200 }));
  const primera = await sw.pedir('http://127.0.0.1:11436/estado');
  const segunda = await sw.pedir('http://127.0.0.1:11436/estado');
  comprobar(primera === null && segunda === null, 'el estado del puente de Groq no pasa por el trabajador: cada vez pregunta al puente',
    `primera ${await texto(primera)} · segunda ${await texto(segunda)}`);
  comprobar(![...sw.guardado.keys()].some((k) => k.includes('11436')), 'y no queda nada suyo en la caché');
  comprobar(await sw.pedir('https://fonts.example.org/fuente.woff2') === null, 'ningún otro origen pasa por la caché');
}

{
  const sw = montar();
  sw.fijarRed(async () => new Response('<!doctype html><title>juego</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await sw.pedir(`${ORIGEN}/app/index.html`, { mode: 'navigate' });
  sw.fijarRed(async () => { throw new TypeError('sin red'); });
  const pagina = await sw.pedir(`${ORIGEN}/app/partida`, { mode: 'navigate' });
  comprobar(/juego/.test(await texto(pagina) ?? ''), 'sin conexión, navegar a una página que no está en caché abre el juego');
  const script = await sw.pedir(`${ORIGEN}/src/no-existe.js`);
  const html = /juego/.test(await texto(script) ?? '');
  comprobar(!html && (script?.error || script?.type === 'error'), 'pero un script que falla no recibe la página del juego: falla', html ? 'devolvió HTML' : '');
}

{
  const sw = montar();
  let n = 0;
  sw.fijarRed(async () => new Response(`v${++n}`, { status: 200 }));
  await sw.pedir(`${ORIGEN}/src/main.js`);
  const otra = await sw.pedir(`${ORIGEN}/src/main.js`);
  comprobar(await texto(otra) === 'v1', 'lo propio sí se sirve de la caché (el juego funciona sin conexión)');
  sw.fijarRed(async () => new Response('no', { status: 404 }));
  await sw.pedir(`${ORIGEN}/src/falta.js`);
  comprobar(!sw.guardado.has(`${ORIGEN}/src/falta.js`), 'un 404 no se guarda');
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
