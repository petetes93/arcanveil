/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-servidores.mjs
 * ---------------------------------------------------------------------------
 * Pruebas de caja negra de los servidores locales: qué sirven, a quién y con
 * qué topes. Sin red externa, sin claves reales y sin generar imágenes: el
 * proveedor de imagen es un doble que cuenta cuántas veces le llaman.
 *
 *   · servir.mjs: solo lo público, solo en 127.0.0.1 por defecto, solo a los
 *     Host esperados.
 *   · imagen-local-proxy.mjs: origen y Host exactos antes de generar, topes
 *     de cuerpo, concurrencia, minuto y día, tiempo, cancelación y caché.
 *   · Groq e imagen no comparten puerto.
 *
 *   node tools/auditar-servidores.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearServidorEstatico, esPublica } from './servir.mjs';
import { crearProxyImagen, proveedorCloudflare, PUERTO_IMAGEN, SERVICIO_IMAGEN } from './imagen-local-proxy.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fallos = 0;
let casos = 0;
function comprobar(bien, texto, detalle = '') {
  casos += 1;
  if (bien) console.log(`OK   ${texto}`);
  else { fallos += 1; console.log(`MAL  ${texto}`); if (detalle) console.log(`     ${String(detalle).slice(0, 400)}`); }
}

/** Petición HTTP cruda: la ruta va tal cual (sin que `fetch` la normalice). */
function pedir(puerto, ruta, { metodo = 'GET', host = `127.0.0.1:${puerto}`, cabeceras = {}, cuerpo = null, ip = '127.0.0.1' } = {}) {
  return new Promise((ok) => {
    const req = request({ host: ip, port: puerto, path: ruta, method: metodo, headers: { Host: host, ...cabeceras } }, (res) => {
      const trozos = [];
      res.on('data', (b) => trozos.push(b));
      res.on('end', () => ok({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos) }));
    });
    req.on('error', (e) => ok({ estado: 0, error: e.code }));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}
const escuchar = (s) => new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s.address().port)));

/* ═══════════════════════════════════════════════════════════════════════════
   1. SERVIDOR ESTÁTICO
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('\n── servir.mjs: lo público y nada más ──');
{
  const real = crearServidorEstatico();
  const p = await escuchar(real);
  for (const ruta of ['/app/index.html', '/src/core/RNG.js', '/sw.js', '/manifest.webmanifest', '/styles/', '/index.html']) {
    const r = await pedir(p, ruta);
    comprobar(r.estado === 200 || (ruta === '/styles/' && r.estado === 404), `público: ${ruta} → ${r.estado}`);
  }
  for (const ruta of ['/.gitignore', '/tools/iniciar-groq.mjs', '/tools/groq-proxy.mjs', '/README.md', '/CLAUDE.md', '/paths.tmp', '/.git/config',
    '/app/..%2f.gitignore', '/%2e%2e/%2e%2e/Windows/win.ini', '/app/%2e%2e/tools/servir.mjs', '/app%5c..%5c.gitignore', '/src/../.gitignore',
    '/dist/regresion/x.png', '/demo/motor.mjs', '/app/index.html%00.png', '//etc/passwd', '/C:/Windows/win.ini']) {
    const r = await pedir(p, ruta);
    comprobar(r.estado !== 200 && !r.cuerpo?.includes('node_modules'), `privado: ${ruta} → ${r.estado} (sin bytes del archivo)`);
  }
  const ajeno = await pedir(p, '/app/index.html', { host: 'evil.test' });
  comprobar(ajeno.estado === 421, `un Host ajeno no se atiende (${ajeno.estado})`);
  const post = await pedir(p, '/app/index.html', { metodo: 'POST' });
  comprobar(post.estado === 405, `solo lectura: POST → ${post.estado}`);
  comprobar(esPublica('src/engine/TurnResolver.js') && !esPublica('src/.oculto/x.js') && !esPublica('app/x.exe'), 'la lista: módulos sí, carpetas con punto y tipos raros no');
  real.close();

  // Una raíz de prueba con secretos FALSOS: el servidor no debe tocarlos.
  const tmp = mkdtempSync(join(tmpdir(), 'arcanveil-servir-'));
  mkdirSync(join(tmp, 'app'));
  mkdirSync(join(tmp, 'tools'));
  mkdirSync(join(tmp, '.arcanveil-images'));
  writeFileSync(join(tmp, 'app', 'index.html'), '<p>hola</p>');
  writeFileSync(join(tmp, '.env'), 'CLAVE_FALSA=esto-no-es-una-clave');
  writeFileSync(join(tmp, '.arcanveil-image-config.json'), '{"model":"falso"}');
  writeFileSync(join(tmp, 'tools', 'iniciar-groq.mjs'), '// falso');
  writeFileSync(join(tmp, '.arcanveil-images', 'x.png'), 'PNGFALSO');
  const prueba = crearServidorEstatico({ raiz: tmp });
  const q = await escuchar(prueba);
  comprobar((await pedir(q, '/app/index.html')).estado === 200, 'fixture: la app sí');
  for (const ruta of ['/.env', '/.arcanveil-image-config.json', '/tools/iniciar-groq.mjs', '/.arcanveil-images/x.png', '/app/..%2f.env', '/%2Eenv']) {
    const r = await pedir(q, ruta);
    comprobar(r.estado !== 200 && !String(r.cuerpo).includes('esto-no-es') && !String(r.cuerpo).includes('PNGFALSO'), `fixture privado: ${ruta} → ${r.estado}`);
  }
  prueba.close();
  rmSync(tmp, { recursive: true, force: true });

  // Por defecto no escucha en la red: la dirección de la LAN no conecta.
  const lan = Object.values(networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  const hijo = spawn(process.execPath, [join(RAIZ, 'tools', 'servir.mjs'), '--puerto', '18765'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const local = await pedir(18765, '/app/index.html', { host: 'localhost:18765' });
  const red = lan ? await pedir(18765, '/app/index.html', { ip: lan, host: `${lan}:18765` }) : { estado: 0, error: 'sin LAN' };
  comprobar(local.estado === 200, `la línea de órdenes sirve en 127.0.0.1 (${local.estado})`);
  comprobar(red.estado === 0, `y no en la red local por defecto (${lan ?? 'sin LAN'}: ${red.error ?? red.estado})`);
  hijo.kill();
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PUENTE DE IMAGEN
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('\n── imagen-local-proxy.mjs: origen, topes y cancelación ──');
{
  const ORIGEN = 'http://localhost:8080';
  const doble = { llamadas: 0, abortadas: 0, espera: 30, colgar: false };
  const proveedor = {
    id: 'falso',
    salud: async () => ({ disponible: true, modelo: 'doble' }),
    generar: ({ texto }, signal) => new Promise((ok, no) => {
      doble.llamadas += 1;
      doble.ultimoTexto = texto;
      const t = setTimeout(() => ok({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), tipo: 'image/png' }), doble.colgar ? 60_000 : doble.espera);
      signal?.addEventListener('abort', () => { clearTimeout(t); doble.abortadas += 1; no(Object.assign(new Error('cancelada'), { codigo: 'cancelada' })); }, { once: true });
    }),
  };
  const cache = mkdtempSync(join(tmpdir(), 'arcanveil-img-'));
  const proxy = crearProxyImagen({ origen: ORIGEN, proveedor, puerto: 0, cache, limites: { porMinuto: 50, porDia: 100, esperaMs: 400 } });
  const p = await proxy.escuchar();
  const H = `127.0.0.1:${p}`;
  const cuerpo = (x = {}) => JSON.stringify({ tipo: 'enemigo', clave: 'saqueador', descripcion: 'bandido de camino con capa raída y cuchillo', ...x });
  const post = (x, extra = {}) => pedir(p, '/v1/candidata', { metodo: 'POST', host: H, cabeceras: { Origin: ORIGEN, 'Content-Type': 'application/json', ...extra.cabeceras }, cuerpo: extra.crudo ?? cuerpo(x), ...extra });

  const estado = await pedir(p, '/estado', { host: H });
  const e = JSON.parse(estado.cuerpo || '{}');
  comprobar(estado.estado === 200 && e.servicio === SERVICIO_IMAGEN, `/estado se identifica (${e.servicio})`);

  const pre = await pedir(p, '/v1/candidata', { metodo: 'OPTIONS', host: H, cabeceras: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'POST' } });
  comprobar(pre.estado === 403 && !pre.cabeceras['access-control-allow-origin'], `preflight ajeno: ${pre.estado}, sin permiso CORS`);
  const ajeno = await post({}, { cabeceras: { Origin: 'https://example.invalid' } });
  comprobar(ajeno.estado === 403 && doble.llamadas === 0, `POST de un origen ajeno: ${ajeno.estado} y nada generado`);
  const sinOrigen = await pedir(p, '/v1/candidata', { metodo: 'POST', host: H, cabeceras: { 'Content-Type': 'application/json' }, cuerpo: cuerpo() });
  comprobar(sinOrigen.estado === 403 && doble.llamadas === 0, `POST sin Origin: ${sinOrigen.estado}`);
  const host = await post({}, { host: 'evil.test' });
  comprobar(host.estado === 421 && doble.llamadas === 0, `Host ajeno: ${host.estado}`);
  const enorme = await post({}, { crudo: JSON.stringify({ tipo: 'enemigo', clave: 'x', descripcion: 'a'.repeat(50_000) }) });
  comprobar(enorme.estado === 413 && doble.llamadas === 0, `cuerpo enorme: ${enorme.estado}`);
  const larga = await post({ descripcion: 'b'.repeat(400) });
  comprobar(larga.estado === 400 && doble.llamadas === 0, `apariencia de más de 300 caracteres: ${larga.estado}`);

  const bien = await post({});
  comprobar(bien.estado === 200 && bien.cabeceras['content-type'] === 'image/png' && doble.llamadas === 1, `una candidata válida se genera (${bien.estado}, ${doble.llamadas} llamada)`);
  comprobar(!/secret|historia|lore/i.test(doble.ultimoTexto) && doble.ultimoTexto.length < 400, 'al proveedor solo va la apariencia y el estilo');
  const otra = await post({});
  comprobar(otra.estado === 200 && doble.llamadas === 1, 'repetir la misma petición sale de caché: no se genera otra vez');

  // Muchas a la vez: una en curso, dos en cola, el resto «ocupado».
  doble.espera = 150;
  const antes = doble.llamadas;
  const lote = await Promise.all(Array.from({ length: 6 }, (_, i) => post({ variante: 10 + i })));
  const codigos = lote.map((r) => r.estado);
  comprobar(codigos.filter((c) => c === 200).length === 3 && codigos.filter((c) => c === 429).length === 3 && doble.llamadas - antes === 3, `seis a la vez: ${codigos.join(',')}`);

  // Tiempo agotado.
  doble.colgar = true;
  const lenta = await post({ variante: 50 });
  comprobar(lenta.estado === 504 && doble.abortadas >= 1, `si tarda demasiado: ${lenta.estado} y se cancela`);
  doble.colgar = false;

  // Cancelación: la app se va a mitad.
  doble.colgar = true;
  const abortadasAntes = doble.abortadas;
  await new Promise((ok) => {
    const req = request({ host: '127.0.0.1', port: p, path: '/v1/candidata', method: 'POST', headers: { Host: H, Origin: ORIGEN, 'Content-Type': 'application/json' } });
    req.on('error', () => ok());
    req.end(cuerpo({ variante: 60 }));
    setTimeout(() => { req.destroy(); setTimeout(ok, 100); }, 80);
  });
  comprobar(doble.abortadas > abortadasAntes, 'si la app corta la petición, la generación se cancela');
  doble.colgar = false;
  await proxy.cerrar();

  // Topes por minuto y por día.
  const justo = crearProxyImagen({ origen: ORIGEN, proveedor, puerto: 0, cache: null, limites: { porMinuto: 2, porDia: 3 } });
  const q = await justo.escuchar();
  const HQ = `127.0.0.1:${q}`;
  const tres = [];
  for (let i = 0; i < 3; i += 1) tres.push((await pedir(q, '/v1/candidata', { metodo: 'POST', host: HQ, cabeceras: { Origin: ORIGEN, 'Content-Type': 'application/json' }, cuerpo: cuerpo({ variante: 100 + i }) })).estado);
  comprobar(tres.join(',') === '200,200,429', `por minuto: ${tres.join(',')}`);
  await justo.cerrar();
  rmSync(cache, { recursive: true, force: true });

  // Cloudflare: preparado, con un doble local; nunca la API real aquí.
  const cf = { llamadas: 0 };
  const { createServer } = await import('node:http');
  const falsoCf = createServer((req, res) => {
    cf.llamadas += 1;
    const auth = req.headers.authorization === 'Bearer token-de-prueba';
    res.writeHead(auth ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(auth ? { result: { image: Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64') } } : { errors: [] }));
  });
  const pc = await escuchar(falsoCf);
  const sinToken = proveedorCloudflare({});
  comprobar(!(await sinToken.salud()).disponible, 'Cloudflare sin cuenta ni token: no disponible, sin llamar');
  const conToken = proveedorCloudflare({ cuenta: 'cuenta-falsa', token: 'token-de-prueba', base: `http://127.0.0.1:${pc}` });
  const img = await conToken.generar({ texto: 'x', semilla: 1 });
  comprobar(img.tipo === 'image/jpeg' && img.bytes[0] === 0xff && cf.llamadas === 1, 'Cloudflare (doble): devuelve la imagen');
  const malo = proveedorCloudflare({ cuenta: 'cuenta-falsa', token: 'otro', base: `http://127.0.0.1:${pc}` });
  const err = await malo.generar({ texto: 'x', semilla: 1 }).catch((x) => x);
  comprobar(err?.codigo === 'sin_clave', `credenciales rechazadas se distinguen (${err?.codigo})`);
  let lanza = false;
  try { proveedorCloudflare({ cuenta: 'a', token: 'b', base: 'https://evil.example' }); } catch { lanza = true; }
  comprobar(lanza, 'no se puede apuntar el proveedor a otra web');
  falsoCf.close();
}

console.log('\n── gemini-proxy.mjs: host, origen, modelo y topes ──');
{
  const { crearProxyGemini, MODELOS_GEMINI } = await import('./gemini-proxy.mjs');
  // Un Gemini falso: cuenta las llamadas y comprueba que la clave llega en
  // la cabecera, no en la URL.
  const g = { llamadas: 0, claveEnUrl: false, cabecera: null };
  const { createServer: crearFalso } = await import('node:http');
  const falsoGemini = crearFalso((req, res) => {
    g.llamadas += 1;
    g.claveEnUrl ||= /clave-de-prueba/.test(req.url);
    g.cabecera = req.headers['x-goog-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"story":"ok"}' }] } }] }));
  });
  const pg = await escuchar(falsoGemini);
  const ORIGEN = 'http://localhost:8080';
  const puente = crearProxyGemini({ clave: 'clave-de-prueba', origen: ORIGEN, puerto: 0, upstream: `http://127.0.0.1:${pg}`, limites: { porMinuto: 3 } });
  const pp = await puente.escuchar();
  const cuerpo = (modelo = MODELOS_GEMINI[0]) => JSON.stringify({ model: modelo, messages: [{ role: 'user', content: 'hola' }] });
  const json = { 'Content-Type': 'application/json', Origin: ORIGEN };

  let r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: { 'Content-Type': 'text/plain', Origin: 'https://web-ajena.example' }, cuerpo: cuerpo() });
  comprobar(r.estado === 403 && g.llamadas === 0 && !r.cabeceras['access-control-allow-origin'], 'Gemini: un POST text/plain desde otra web no llega a Gemini ni recibe CORS', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: { 'Content-Type': 'text/plain' }, cuerpo: cuerpo() });
  comprobar(r.estado === 403 && g.llamadas === 0, 'Gemini: sin origen, tampoco', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', host: 'atacante.example', cabeceras: json, cuerpo: cuerpo() });
  comprobar(r.estado === 421 && g.llamadas === 0, 'Gemini: con otro Host (DNS rebinding), fuera', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: { ...json, 'Content-Type': 'text/plain' }, cuerpo: cuerpo() });
  comprobar(r.estado === 415 && g.llamadas === 0, 'Gemini: desde la app, solo JSON', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: cuerpo('gemini-ultra-caro') });
  comprobar(r.estado === 400 && g.llamadas === 0, 'Gemini: un modelo que no está en la lista no se pide', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: 'x'.repeat(600 * 1024) });
  comprobar(r.estado === 413 || r.estado === 0, 'Gemini: un cuerpo enorme se corta', r.estado);
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: cuerpo() });
  const dicho = JSON.parse(r.cuerpo.toString() || '{}');
  comprobar(r.estado === 200 && dicho.choices?.[0]?.message?.content === '{"story":"ok"}' && r.cabeceras['access-control-allow-origin'] === ORIGEN,
    'Gemini: desde la app, contesta en formato OpenAI', r.estado);
  comprobar(g.cabecera === 'clave-de-prueba' && !g.claveEnUrl, 'Gemini: la clave va en cabecera hacia Gemini, nunca en la URL');
  comprobar(!r.cuerpo.toString().includes('clave-de-prueba'), 'Gemini: la clave no vuelve al navegador');
  await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: cuerpo() });
  await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: cuerpo() });
  r = await pedir(pp, '/v1/chat/completions', { metodo: 'POST', cabeceras: json, cuerpo: cuerpo() });
  comprobar(r.estado === 429 && g.llamadas === 3, `Gemini: tope por minuto (${g.llamadas} llamadas de 4 pedidas)`, r.estado);
  let lanza = false;
  try { crearProxyGemini({ clave: 'x', origen: ORIGEN, upstream: 'https://evil.example' }); } catch { lanza = true; }
  comprobar(lanza, 'Gemini: la clave no se puede mandar a otra web');
  await puente.cerrar();
  falsoGemini.close();
}

console.log('\n── Puertos ──');
{
  const { crearProxyGroq } = await import('./groq-proxy.mjs');
  const src = (await import('node:fs')).readFileSync(join(RAIZ, 'tools', 'groq-proxy.mjs'), 'utf8');
  const puertoGroq = Number(src.match(/puerto = (\d+)/)?.[1]);
  comprobar(puertoGroq === 11436 && PUERTO_IMAGEN === 11437 && typeof crearProxyGroq === 'function', `Groq en ${puertoGroq}, imagen en ${PUERTO_IMAGEN}: no chocan`);
  const cliente = (await import('node:fs')).readFileSync(join(RAIZ, 'src', 'art', 'retrato-local.js'), 'utf8');
  comprobar(/^const ORIGEN = 'http:\/\/127\.0\.0\.1:11437';$/m.test(cliente), 'el cliente de imagen apunta al 11437');
}

console.log(`\n${casos - fallos}/${casos} comprobaciones`);
console.log(fallos ? `\n${fallos} fallos.` : '\nTodo bien.');
process.exitCode = fallos ? 1 : 0;
