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

import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { claveDe, aprobar, urlAprobada, olvidar, alCambiarGaleria, abrirGaleria, borrarGaleria, TAM_MAX_APROBADA } from '../src/art/galeria.js';
import { borrarPersonaje } from '../src/persistence/CharacterRoster.js';
import { pedirCandidata, estadoGenerador, olvidarCandidatas } from '../src/art/candidata.js';
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

  // «Borrar partidas y personajes» vaciaba localStorage y dejaba las
  // imágenes: al recargar volvían. (La base de verdad, IndexedDB, se prueba
  // en Chrome: tools/regresion-app.mjs.)
  await aprobar('pj:pj_a', img, { estilo: 'e', tipo: 'personaje' });
  await aprobar('pnj:npc_b', img, { estilo: 'e', tipo: 'pnj' });
  avisos.length = 0;
  const b = await borrarGaleria();
  comprobar(b.ok && b.borradas === 2 && !urlAprobada('pj:pj_a') && !urlAprobada('pnj:npc_b') && avisos.includes(null), 'borrar la galería quita todas las elegidas y avisa para repintar marcadores');
  await aprobar('pj:pj_c', img, { estilo: 'e', tipo: 'personaje' });
  borrarPersonaje('pj_c');
  await new Promise((ok) => setTimeout(ok, 10));
  comprobar(!urlAprobada('pj:pj_c'), 'borrar un personaje olvida también su retrato elegido');
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

/* ── Qué se envía y qué queda en disco ─────────────────────────────────── */

console.log('\n── Ciclo de vida de las candidatas ──');
{
  // El estudio decía «no se guarda ni se envía a ningún sitio» y el puente
  // escribía cada candidata en disco antes de aprobarla. Ahora se dice lo
  // que pasa, y se borra al cerrar el estudio.
  const carpeta = mkdtempSync(join(tmpdir(), 'arcanveil-ciclo-'));
  const archivos = () => readdirSync(carpeta).filter((n) => n.endsWith('.img'));
  const falso = (id) => ({ id, salud: async () => ({ disponible: true }), generar: async () => ({ bytes: PNG, tipo: 'image/png' }) });
  const p1 = crearProxyImagen({ origen: ORIGEN, puerto: 0, cache: carpeta, proveedor: falso('comfyui'), limites: { porMinuto: 100 } });
  const q1 = await p1.escuchar();
  const f1 = navegador(ORIGEN, q1);
  const e1 = await estadoGenerador({ fetch: f1 });
  comprobar(e1.envia === 'local' && e1.cache?.horas === 24, 'con ComfyUI el puente dice que no sale del PC, y cuánto dura la caché', JSON.stringify(e1));
  const pj = { tipo: 'personaje', clave: 'pj:pj_1', descripcion: 'a dwarf woman, a braided beard, red hair' };
  const otro = { tipo: 'pnj', clave: 'pnj:npc_cordan', descripcion: 'an old innkeeper with a grey beard' };
  await pedirCandidata(pj, { fetch: f1 });
  await pedirCandidata(pj, { variante: 1, fetch: f1 });
  await pedirCandidata(otro, { fetch: f1 });
  comprobar(archivos().length === 3 && archivos().filter((n) => n.startsWith('pj_pj_1__')).length === 2, 'pintar y «otra versión» dejan su candidata en la caché del puente, con su dueño en el nombre', archivos().join(' '));
  const o = await olvidarCandidatas({ clave: pj.clave }, { fetch: f1 });
  comprobar(o.ok && o.borradas === 2 && archivos().length === 1 && archivos()[0].startsWith('pnj_npc_cordan__'), 'cerrar el estudio olvida las de ese personaje y no las de otro', `${o.borradas} · ${archivos().join(' ')}`);
  const todas = await olvidarCandidatas({ todas: true }, { fetch: f1 });
  comprobar(todas.ok && archivos().length === 0, '«todas» las borra todas');
  const ajena = await olvidarCandidatas({ todas: true }, { fetch: navegador('https://web-ajena.example', q1) });
  comprobar(!ajena.ok, 'otra web no puede mandar borrar');
  await p1.cerrar();

  // Caducidad y tope.
  const p2 = crearProxyImagen({ origen: ORIGEN, puerto: 0, cache: carpeta, proveedor: falso('comfyui'), limites: { porMinuto: 100, cacheMax: 2 } });
  const q2 = await p2.escuchar();
  for (let v = 0; v < 4; v += 1) await pedirCandidata(pj, { variante: v, fetch: navegador(ORIGEN, q2) });
  comprobar(archivos().length === 2, `no pasan del tope (${archivos().length} de 4 pedidas, tope 2)`);
  await p2.cerrar();
  const viejo = join(carpeta, archivos()[0]);
  utimesSync(viejo, new Date(Date.now() - 48 * 3600_000), new Date(Date.now() - 48 * 3600_000));
  const p3 = crearProxyImagen({ origen: ORIGEN, puerto: 0, cache: carpeta, proveedor: falso('comfyui') });
  await p3.escuchar();
  await new Promise((ok) => setTimeout(ok, 100));
  comprobar(!existsSync(viejo) && archivos().length === 1, 'al arrancar, lo de más de 24 h se borra');
  await p3.cerrar();

  // Un proveedor en la nube: el estudio tiene que saber que el encargo viaja.
  const p4 = crearProxyImagen({ origen: ORIGEN, puerto: 0, cache: carpeta, proveedor: falso('cloudflare') });
  const q4 = await p4.escuchar();
  const e4 = await estadoGenerador({ fetch: navegador(ORIGEN, q4) });
  comprobar(e4.envia === 'nube', 'con Cloudflare el puente dice que el encargo sale del PC (y el estudio pide permiso)', JSON.stringify(e4));
  await p4.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
}

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
