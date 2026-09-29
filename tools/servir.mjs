#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/servir.mjs
 * ---------------------------------------------------------------------------
 * Servidor estático de desarrollo.
 *
 * Los módulos ES6 no cargan desde `file://`, así que hace falta servir por
 * HTTP. El README propone `python -m http.server`, que sirve, pero **cachea**:
 * editas un módulo, recargas, y el navegador sigue ejecutando el de antes. Se
 * pierde media hora buscando un fallo ya corregido.
 *
 * Esto es lo mismo pero con `Cache-Control: no-store`, sin dependencias y con
 * el Node que ya hace falta para empaquetar.
 *
 * ── Qué sirve y a quién ──────────────────────────────────────────────────
 *
 * Antes escuchaba en todas las interfaces y servía CUALQUIER archivo bajo la
 * raíz del repositorio: `/.gitignore` devolvía 200, y lo mismo habría hecho
 * con un `.env`, la configuración local de imágenes o sus imágenes privadas.
 * Impedir `..` evitaba salir de la raíz, no exponer lo que hay dentro.
 *
 *   · Escucha en 127.0.0.1. Para jugar desde el móvil en la misma red hay
 *     que pedirlo (`--lan`), y avisa de lo que eso abre.
 *   · Solo sirve lo público, por lista: la app, los módulos, estilos,
 *     assets, el manifiesto, el trabajador de servicio y las láminas de
 *     `dist/`. Nada que empiece por punto, nada de `tools/`, y solo tipos de
 *     archivo conocidos.
 *   · Solo atiende a los `Host` esperados (evita que una web ajena lo use
 *     con un DNS que apunte a 127.0.0.1).
 *
 * Uso:
 *   node tools/servir.mjs                  → http://localhost:8080
 *   node tools/servir.mjs --puerto 9000
 *   node tools/servir.mjs --lan            → también en la red local (opt-in)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve, dirname, extname, sep, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

/** Tipos que hacen falta aquí. Lo que no está en el mapa no se sirve. */
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Lo público. Carpetas enteras (lo de dentro, salvo lo que empiece por
 * punto) y archivos sueltos de la raíz. `dist/` solo sus páginas: sus
 * subcarpetas (capturas de regresión) no.
 */
const CARPETAS = ['app/', 'src/', 'styles/', 'assets/'];
const SUELTOS = new Set(['index.html', 'clasico.html', 'manifest.webmanifest', 'sw.js']);
const DIST = /^dist\/[^/]+\.html$/;

/**
 * ¿Se puede servir esta ruta? Recibe la ruta YA decodificada, sin la barra
 * inicial. Rechaza lo raro antes de mirar la lista: barras invertidas, NUL,
 * `..`, segmentos vacíos y cualquier segmento que empiece por punto.
 *
 * @param {string} ruta
 * @returns {boolean}
 */
export function esPublica(ruta) {
  if (!ruta || /[\\\0]/.test(ruta) || /^[a-z]:/i.test(ruta)) return false;
  const segmentos = ruta.split('/');
  if (segmentos.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false;
  if (!TIPOS[extname(ruta).toLowerCase()]) return false;
  return SUELTOS.has(ruta) || DIST.test(ruta) || CARPETAS.some((c) => ruta.startsWith(c));
}

/** Direcciones IPv4 de la red local, para el modo `--lan`. */
function direccionesLan() {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * Crea el servidor (sin escuchar todavía).
 *
 * @param {Object} [op]
 * @param {string} [op.raiz] Por defecto, la del repositorio.
 * @param {boolean} [op.lan=false] Aceptar `Host` de la red local.
 * @returns {import('node:http').Server & {hostsPermitidos: Set<string>}}
 */
export function crearServidorEstatico({ raiz = RAIZ, lan = false } = {}) {
  const hostsPermitidos = new Set(['localhost', '127.0.0.1', '[::1]', ...(lan ? direccionesLan() : [])]);
  // La raíz de verdad, por si el propio repositorio está detrás de un enlace.
  const raizReal = realpathSync(raiz);
  const mismo = process.platform === 'win32' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;

  const servidor = createServer(async (peticion, respuesta) => {
    const texto = (codigo, cuerpo) => {
      respuesta.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      respuesta.end(cuerpo);
    };

    if (!['GET', 'HEAD'].includes(peticion.method)) return texto(405, 'solo lectura');

    // El Host sin puerto. Uno que no esperamos no se atiende.
    const host = String(peticion.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!hostsPermitidos.has(host)) return texto(421, 'host no permitido');

    let ruta;
    try {
      ruta = decodeURIComponent(new URL(peticion.url, 'http://localhost').pathname);
    } catch {
      return texto(400, 'ruta mal formada');
    }
    if (ruta === '/' || ruta.endsWith('/')) ruta += 'index.html';
    ruta = ruta.replace(/^\/+/, '');

    if (!esPublica(ruta)) return texto(404, 'no encontrado');

    const destino = resolve(raiz, ...ruta.split('/'));
    if (!destino.startsWith(raiz + sep)) return texto(404, 'no encontrado');

    try {
      // Ningún enlace: la ruta canónica tiene que ser la pedida, bajo la raíz
      // canónica. Comprobar la cadena no bastaba: `stat` y `readFile` siguen
      // enlaces, y `assets/linked` apuntando fuera servía lo de fuera (200 con
      // los bytes). Se lee la ruta canónica, no la pedida: para colar otra
      // cosa entre la comprobación y la lectura haría falta poder escribir en
      // las carpetas públicas de este equipo.
      const real = await realpath(destino);
      const rel = relative(raizReal, real);
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || !mismo(rel.split(sep).join('/'), ruta)) return texto(404, 'no encontrado');
      const info = await stat(real);
      if (!info.isFile()) return texto(404, 'no encontrado');
      const cuerpo = peticion.method === 'HEAD' ? null : await readFile(real);

      // El trabajador de servicio es la única excepción al `no-store`. Chrome
      // se niega a registrar un `sw.js` servido con `no-store` y falla con un
      // «unknown error» que no dice nada, así que sin esta rendija la
      // instalación como aplicación no se puede probar en local. `max-age=0`
      // conserva lo que importa —nunca se sirve una versión vieja— sin
      // prohibir el registro.
      const esTrabajador = ruta === 'sw.js';
      respuesta.writeHead(200, {
        'Content-Type': TIPOS[extname(destino).toLowerCase()],
        'Cache-Control': esTrabajador ? 'max-age=0, must-revalidate' : 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      });
      respuesta.end(cuerpo ?? undefined);
    } catch {
      texto(404, 'no encontrado');
    }
  });
  servidor.hostsPermitidos = hostsPermitidos;
  return servidor;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LÍNEA DE ÓRDENES
   ═══════════════════════════════════════════════════════════════════════════ */

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--puerto');
  const PUERTO = Number(i >= 0 ? argv[i + 1] : '') || 8080;
  const lan = argv.includes('--lan');
  const servidor = crearServidorEstatico({ lan });

  servidor.listen(PUERTO, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`ARCANVEIL servido en http://localhost:${PUERTO}`);
    console.log('  sin caché: recargar basta para ver los cambios');
    console.log('\n  app:    /app/index.html');
    console.log('  lámina: /dist/lamina-arte.html');
    if (lan) {
      console.log('\n  ⚠ Modo red local: cualquiera en tu red puede abrir la app (solo lo público:');
      console.log('    app, módulos, estilos y assets; nunca configuración, herramientas ni imágenes privadas).');
      for (const ip of direccionesLan()) console.log(`    http://${ip}:${PUERTO}/app/index.html`);
      console.log('    Si el móvil no carga, el cortafuegos de Windows bloquea el puerto: abrirlo es decisión tuya.');
    }
  });
}
