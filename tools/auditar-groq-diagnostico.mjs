/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-groq-diagnostico.mjs
 * ---------------------------------------------------------------------------
 * Cuando Groq no va, el jugador tiene que saber POR QUÉ, y qué hacer.
 *
 * Antes, cualquier fallo de red decía «No se encuentra el puente.
 * Arráncalo…», también con el puente arrancado: bastaba abrir el juego en
 * http://127.0.0.1:8080 en vez de http://localhost:8080 para que el puente
 * lo rechazara por origen y el mensaje mandara a arrancarlo otra vez. Y con
 * el puerto ocupado, el lanzador reventaba después de pegar la clave.
 *
 * Aquí, con el puente de verdad y un Groq falso en 127.0.0.1 (ninguna
 * llamada real), cada causa con su mensaje:
 *
 *   sin puente · otro programa en el puerto · puente para otra dirección ·
 *   la misma máquina por su otro nombre · clave rechazada · modelo no
 *   disponible · cuota · puerto ocupado al arrancar
 *
 * El navegador se emula: manda `Origin` y aplica CORS (una respuesta sin
 * permiso para esta página no se puede leer; `no-cors` sale opaca).
 *
 *   node tools/auditar-groq-diagnostico.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { crearProxyGroq, MODELO_PERMITIDO } from './groq-proxy.mjs';
import { GroqProvider } from '../src/ai/providers/GroqProvider.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

const CLAVE = 'gsk-doble-de-pruebas-sin-valor-0000000000';
const escuchar = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s.address().port)));
const cerrar = (s) => new Promise((ok) => s.close(() => ok()));

/** `fetch` como lo haría una página servida desde `pagina`. */
function fetchNavegador(pagina) {
  return async (url, op = {}) => {
    const r = await fetch(url, { ...op, headers: { ...(op.headers ?? {}), Origin: pagina } });
    if (op.mode === 'no-cors') return { type: 'opaque', ok: false, status: 0, json: async () => { throw new TypeError('opaca'); } };
    const permitido = r.headers.get('access-control-allow-origin');
    if (permitido !== pagina && permitido !== '*') throw new TypeError('Failed to fetch');
    return r;
  };
}

/** Un Groq falso: `/models` contesta según se le diga. */
function groqFalso() {
  const g = { estado: 200, modelos: [MODELO_PERMITIDO], llamadas: 0 };
  const servidor = createServer((req, res) => {
    g.llamadas += 1;
    if (g.estado !== 200) { res.writeHead(g.estado, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"falso"}}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: g.modelos.map((id) => ({ id })) }));
  });
  return { g, servidor };
}

async function probarCon({ pagina, url }) {
  globalThis.location = { origin: pagina };
  const p = new GroqProvider({ fetch: fetchNavegador(pagina) });
  p.configurar({ url });
  return { resultado: await p.probar(), proveedor: p };
}

const { g, servidor: upstream } = groqFalso();
const pu = await escuchar(upstream);
const UP = `http://127.0.0.1:${pu}`;

// ─── Sin puente ──────────────────────────────────────────────────────────
{
  const hueco = createServer();
  const libre = await escuchar(hueco);
  await cerrar(hueco);
  const { resultado } = await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${libre}` });
  comprobar(resultado.causa === 'sin_puente' && /No hay nada escuchando/.test(resultado.motivo) && /iniciar-groq/.test(resultado.motivo), 'sin puente: lo dice y cómo arrancarlo', resultado.motivo);
}

// ─── Otro programa en el puerto ──────────────────────────────────────────
{
  const conCors = createServer((req, res) => { res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }); res.end('{"hola":1}'); });
  const p1 = await escuchar(conCors);
  let { resultado } = await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${p1}` });
  comprobar(resultado.causa === 'otro_servicio' && /otro programa/.test(resultado.motivo), 'otro programa que sí deja leer: no es el puente y no se le envía nada', resultado.motivo);
  await cerrar(conCors);

  const sinCors = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>otra cosa</h1>'); });
  const p2 = await escuchar(sinCors);
  ({ resultado } = await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${p2}` }));
  comprobar(resultado.causa === 'no_deja_leer' && /Algo contesta/.test(resultado.motivo) && /otro programa/.test(resultado.motivo), 'otro programa sin CORS: algo contesta, y se dice qué puede ser', resultado.motivo);
  await cerrar(sinCors);
}

// ─── Puente para otra dirección, y la misma por su otro nombre ───────────
{
  const puente = crearProxyGroq({ clave: CLAVE, puerto: 0, origen: 'http://localhost:9999', upstream: UP, rutaUso: null });
  const pp = await puente.escuchar();
  const antes = g.llamadas;
  const { resultado } = await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${pp}` });
  comprobar(resultado.causa === 'no_deja_leer' && /arrancó para otra dirección/.test(resultado.motivo) && !/No hay nada/.test(resultado.motivo),
    'puente arrancado para otra dirección: no dice «no hay puente»', resultado.motivo);
  comprobar(g.llamadas === antes, 'y no ha llamado a Groq');
  await puente.cerrar();
}
{
  const puente = crearProxyGroq({ clave: CLAVE, puerto: 0, origen: 'http://localhost:8080', upstream: UP, rutaUso: null });
  const pp = await puente.escuchar();
  const { resultado } = await probarCon({ pagina: 'http://127.0.0.1:8080', url: `http://127.0.0.1:${pp}` });
  comprobar(resultado.ok, 'el juego abierto en 127.0.0.1:8080 con el puente para localhost:8080: funciona', resultado.motivo);
  const ajena = await probarCon({ pagina: 'http://127.0.0.1:8081', url: `http://127.0.0.1:${pp}` });
  comprobar(!ajena.resultado.ok, 'pero otro puerto sigue siendo otra dirección', ajena.resultado.motivo);

  // ─── La cuenta: clave, modelo, cuota ──────────────────────────────────
  g.estado = 401;
  let r = (await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${pp}` })).resultado;
  comprobar(r.causa === 'puente_401' && /no acepta la clave/.test(r.motivo), 'clave rechazada por Groq: se dice que es la clave', r.motivo);
  g.estado = 429;
  r = (await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${pp}` })).resultado;
  comprobar(r.causa === 'puente_429' && /cuota o ritmo/.test(r.motivo), 'Groq frena la cuenta: se dice que es la cuota', r.motivo);
  g.estado = 200;
  g.modelos = ['otro-modelo'];
  r = (await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${pp}` })).resultado;
  comprobar(r.causa === 'modelo' && new RegExp(MODELO_PERMITIDO.replace(/[/.]/g, '\\$&')).test(r.motivo), 'modelo no disponible en la cuenta: se dice cuál', r.motivo);
  g.modelos = [MODELO_PERMITIDO];

  // ─── La barrera de consentimiento sigue ───────────────────────────────
  const { resultado: bien, proveedor } = await probarCon({ pagina: 'http://localhost:8080', url: `http://127.0.0.1:${pp}` });
  const sinPermiso = proveedor.comprobar();
  comprobar(bien.ok && !sinPermiso.disponible && /aceptes/.test(sinPermiso.motivo), 'aunque el puente responda, sin aceptar no se usa Groq', sinPermiso.motivo);
  await puente.cerrar();
}

// ─── Puerto ocupado al arrancar ──────────────────────────────────────────
{
  const ocupante = createServer();
  const ocupado = await escuchar(ocupante);
  const hijo = spawn(process.execPath, ['tools/iniciar-groq.mjs'], { cwd: RAIZ, env: { ...process.env, GROQ_PROXY_PORT: String(ocupado) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (b) => { salida += b; });
  hijo.stderr.on('data', (b) => { salida += b; });
  const codigo = await new Promise((ok) => hijo.on('exit', ok));
  comprobar(codigo === 1 && new RegExp(`El puerto ${ocupado}`).test(salida) && /No se ha pedido ni enviado nada/.test(salida) && !/Pega la clave|Has comprobado/.test(salida),
    'puerto ocupado: se dice antes de pedir la clave, y sale sin hacer nada', salida.trim().split('\n').slice(-2).join(' | '));
  await cerrar(ocupante);
}

await cerrar(upstream);
console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
