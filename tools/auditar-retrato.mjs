/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-retrato.mjs
 * ---------------------------------------------------------------------------
 * Imágenes solo cuando el jugador las pide, y solo las que elige.
 *
 * Antes: cada retrato y cada cambio de escena pedían una imagen a un
 * servicio anónimo de fuera (Pollinations) con estilo anime; se ponía sin
 * preguntar, como una URL que sin red o con el servicio cambiado dejaba de
 * existir, y mientras tanto se veía una cara vectorial que se parecía a
 * todas las del mismo linaje.
 *
 * Ahora:
 *   · Pintar pide una CANDIDATA al generador del propio equipo (el puente
 *     local, ComfyUI). Es privada hasta «Usar esta versión».
 *   · Lo elegido se guarda entero en el navegador (galería), con clave
 *     estable: `pj:<id>`, `pnj:<refId>`, `enemigo:<refId>`.
 *   · Sin imagen elegida, un marcador con el nombre. Pintar la ficha, llegar
 *     a un sitio o empezar un combate NUNCA pide nada.
 *
 * Aquí: la galería (en memoria: Node no tiene IndexedDB; la persistencia
 * se prueba en Chrome, en tools/regresion-app.mjs), el cliente contra el
 * puente de verdad con un proveedor falso (ninguna llamada fuera), y cables
 * trampa en el código. Lo que se le pide al generador (el sujeto) está en
 * tools/auditar-sujeto.mjs.
 *
 *   node tools/auditar-retrato.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { claveDe, aprobar, urlAprobada, olvidar, alCambiarGaleria, abrirGaleria, TAM_MAX_APROBADA } from '../src/art/galeria.js';
import { pedirCandidata, estadoGenerador } from '../src/art/candidata.js';
import { crearProxyImagen } from './imagen-local-proxy.mjs';

let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/* ── La galería ────────────────────────────────────────────────────────── */

console.log('\n── Galería: lo que el jugador elige ──');
{
  comprobar(claveDe({ tipo: 'personaje', id: 'pj_123' }) === 'pj:pj_123' && claveDe({ tipo: 'pnj', refId: 'npc_cordan' }) === 'pnj:npc_cordan'
    && claveDe({ tipo: 'enemigo', refId: 'saqueador' }) === 'enemigo:saqueador' && claveDe({ tipo: 'pnj' }) === null,
  'claves estables por identidad; sin identidad, ninguna');
  comprobar(claveDe({ tipo: 'pnj', refId: '../../x"<y>' }) === 'pnj:....xy', 'la clave no admite nada raro');

  await abrirGaleria();
  const avisos = [];
  const dejar = alCambiarGaleria((c) => avisos.push(c));
  const img = new Blob([PNG], { type: 'image/png' });
  comprobar(!(await aprobar('pnj:x', new Blob(['<svg/>'], { type: 'image/svg+xml' }), { estilo: 'e' })).ok, 'no se guarda algo que no es imagen de mapa de bits (SVG fuera)');
  comprobar(!(await aprobar('otra:cosa', img, { estilo: 'e' })).ok, 'ni con una clave inventada');
  comprobar(!(await aprobar('pnj:x', new Blob([new Uint8Array(TAM_MAX_APROBADA + 1)], { type: 'image/png' }), { estilo: 'e' })).ok, 'ni una imagen enorme');
  const r = await aprobar('enemigo:saqueador', img, { estilo: 'pintura-oscura-1', tipo: 'enemigo', nombre: 'Saqueador' });
  comprobar(r.ok && Boolean(urlAprobada('enemigo:saqueador')) && avisos.includes('enemigo:saqueador'), 'elegir una versión la guarda y avisa para repintar');
  comprobar(urlAprobada('enemigo:lobo_ceniciento') === null, 'lo que no se ha elegido no tiene imagen (se verá el marcador)');
  await olvidar('enemigo:saqueador');
  comprobar(urlAprobada('enemigo:saqueador') === null, 'y olvidarla la quita');
  dejar();
}

/* ── El cliente contra el puente de verdad ─────────────────────────────── */

console.log('\n── Candidatas: el puente local y un proveedor falso ──');
const ORIGEN = 'http://localhost:8080';
const cache = mkdtempSync(join(tmpdir(), 'arcanveil-retrato-'));
const llamadas = [];
let proveedorCaido = false;
const puente = crearProxyImagen({
  origen: ORIGEN, puerto: 0, cache,
  proveedor: {
    id: 'falso',
    salud: async () => (proveedorCaido ? { disponible: false, motivo: 'ComfyUI no contesta' } : { disponible: true }),
    generar: async ({ texto, semilla }) => {
      llamadas.push({ texto, semilla });
      await new Promise((ok) => setTimeout(ok, 60));
      if (proveedorCaido) throw Object.assign(new Error('ComfyUI no contesta'), { codigo: 'proveedor' });
      return { bytes: PNG, tipo: 'image/png' };
    },
  },
});
const puerto = await puente.escuchar();

/**
 * `fetch` como una página de `pagina`, llevando lo de 127.0.0.1:11437 a este
 * puerto. Cualquier otra dirección es un fallo de la prueba: el cliente no
 * puede hablar con nada más.
 */
const fuera = [];
function navegador(pagina = ORIGEN, desvio = puerto) {
  return async (url, op = {}) => {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' || u.port !== '11437') { fuera.push(url); throw new TypeError('Failed to fetch'); }
    u.port = String(desvio);
    const r = await fetch(u, { ...op, headers: { ...(op.headers ?? {}), Origin: pagina } });
    if (op.mode === 'no-cors') return { type: 'opaque' };
    const permitido = r.headers.get('access-control-allow-origin');
    if (permitido !== pagina) throw new TypeError('Failed to fetch');
    return r;
  };
}

{
  const g = await estadoGenerador({ fetch: navegador() });
  comprobar(g.ok && g.estilo === 'pintura-oscura-1', `el estudio ve el generador y su estilo (${g.estilo})`, JSON.stringify(g));
  comprobar(llamadas.length === 0, 'mirar el estado no pinta nada');

  const encargo = { tipo: 'personaje', clave: 'pj:pj_1', descripcion: 'a dwarf woman, a braided beard, red hair' };
  const [a, b] = await Promise.all([pedirCandidata(encargo, { fetch: navegador() }), pedirCandidata(encargo, { fetch: navegador() })]);
  comprobar(a === b && a.blob.type === 'image/png' && llamadas.length === 1, 'dos «Pintar» iguales a la vez: un solo viaje, una sola imagen', `${llamadas.length} generaciones`);
  comprobar(/dark fantasy digital painting/.test(llamadas[0].texto) && /a dwarf woman/.test(llamadas[0].texto) && !/anime|cel shad/i.test(llamadas[0].texto.split('dark fantasy')[0]),
    'el encargo: el sujeto del jugador y el estilo de fantasía oscura, nada de anime', llamadas[0].texto);
  const otra = await pedirCandidata(encargo, { variante: 1, fetch: navegador() });
  comprobar(otra.variante === 1 && llamadas.length === 2 && llamadas[0].semilla !== llamadas[1].semilla, '«Otra versión» es otra semilla');

  let e = await pedirCandidata({ ...encargo, descripcion: 'corto' }, { fetch: navegador() }).catch((x) => x);
  comprobar(e?.causa === 'datos' && llamadas.length === 2, 'sin descripción suficiente no se pide nada', e?.message);

  const ajena = await estadoGenerador({ fetch: navegador('http://localhost:9999') });
  comprobar(!ajena.ok && ajena.causa === 'no_deja_leer', 'desde otra dirección: se dice que algo contesta pero no deja leer', ajena.motivo);
  const gemela = await estadoGenerador({ fetch: navegador('http://127.0.0.1:8080') });
  comprobar(gemela.ok, 'la misma máquina por su otro nombre (127.0.0.1:8080) sí vale');

  const hueco = createServer();
  const libre = await new Promise((ok) => hueco.listen(0, '127.0.0.1', () => ok(hueco.address().port)));
  await new Promise((ok) => hueco.close(ok));
  const nadie = await estadoGenerador({ fetch: navegador(ORIGEN, libre) });
  comprobar(!nadie.ok && nadie.causa === 'sin_generador' && /ComfyUI/.test(nadie.motivo) && /imagen-local-proxy/.test(nadie.motivo), 'sin puente: se dice qué arrancar', nadie.motivo);

  proveedorCaido = true;
  const caido = await estadoGenerador({ fetch: navegador() });
  comprobar(!caido.ok && caido.causa === 'proveedor' && /ComfyUI/.test(caido.motivo), 'puente sin ComfyUI: se dice que es ComfyUI', caido.motivo);
  e = await pedirCandidata(encargo, { variante: 7, fetch: navegador() }).catch((x) => x);
  comprobar(e?.causa === 'proveedor', 'y pedir entonces falla con ese mismo motivo, sin romper nada', e?.message);
  proveedorCaido = false;

  const control = new AbortController();
  const cancelada = pedirCandidata(encargo, { variante: 9, signal: control.signal, fetch: navegador() }).catch((x) => x);
  control.abort();
  comprobar((await cancelada)?.causa === 'cancelada', 'cerrar el estudio cancela lo que se estaba pintando');

  comprobar(fuera.length === 0, 'el cliente no ha intentado hablar con nada fuera de 127.0.0.1:11437', fuera.join(' '));
}
await puente.cerrar();
rmSync(cache, { recursive: true, force: true });

/* ── Cables trampa ─────────────────────────────────────────────────────── */

console.log('\n── Nada pide imágenes por su cuenta ──');
{
  const recorrer = (dir, salida = []) => {
    for (const n of readdirSync(dir)) {
      const ruta = join(dir, n);
      if (statSync(ruta).isDirectory()) recorrer(ruta, salida);
      else if (/\.(m?js|html)$/.test(n)) salida.push(ruta);
    }
    return salida;
  };
  const archivos = [...recorrer(join(RAIZ, 'src')), ...recorrer(join(RAIZ, 'app'))];
  const leer = (f) => readFileSync(f, 'utf8');
  const conFuera = archivos.filter((f) => /image\.pollinations|https:\/\/[a-z0-9.-]+\/(?:prompt|image)\//i.test(leer(f)));
  comprobar(!conFuera.length, 'ningún archivo del juego apunta a un servicio de imágenes de fuera', conFuera.map((f) => relative(RAIZ, f)).join(' '));

  const arte = leer(join(RAIZ, 'src', 'art', 'index.js'));
  comprobar(!/from '\.\/candidata\.js'|pedirCandidata|estadoGenerador|11437/.test(arte), 'pintar (src/art/index.js) no pide nada a ningún generador (solo lee el manifiesto de assets/)');

  const app = leer(join(RAIZ, 'app', 'app.js'));
  const llamadasCandidata = app.match(/pedirCandidata\(/g)?.length ?? 0;
  const estudio = app.slice(app.indexOf('function abrirEstudio'), app.indexOf('function abrirEstudio') + 6000);
  comprobar(llamadasCandidata === 1 && /pedirCandidata\(/.test(estudio), 'la app pide candidatas en un solo sitio: el estudio', `${llamadasCandidata} llamadas`);
  comprobar(/if \(ver\('combat\.activo', false\)\)/.test(estudio.slice(0, 400)), 'y el estudio no abre en combate');
  comprobar(!/scene:changed/.test(app), 'cambiar de escena no dispara nada de imágenes en la app');
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
