/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/generar-sw.mjs
 * ---------------------------------------------------------------------------
 * Escribe `sw.js`, el trabajador que deja el juego instalable y jugable sin
 * conexión.
 *
 * Existe porque la lista se mantenía a mano y se quedó atrás sin que nada
 * avisara: `app/efectos.js` y `src/art/retrato-ia.js` llevaban días fuera del
 * cache y el juego instalado se habría quedado sin efectos y sin retrato en
 * cuanto perdiera la red. Un archivo nuevo no debería exigir acordarse de
 * nada. Ahora se recorre el árbol y se escribe la lista entera.
 *
 *   node tools/generar-sw.mjs            escribe sw.js
 *   node tools/generar-sw.mjs --revisar  no escribe; falla si está desfasado
 *
 * La segunda forma es la que vale para una comprobación automática: devuelve
 * código 1 si el `sw.js` del repositorio no coincide con lo que hay en disco.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, posix } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Qué entra en el cache.
 *
 * Se listan carpetas en vez de extensiones sueltas para que un tipo de archivo
 * nuevo (un `.woff2`, un `.ogg`) entre solo. Lo que no está aquí es porque no
 * lo pide el juego al arrancar.
 */
const CARPETAS = ['app', 'src', 'assets', 'styles'];

/** Archivos sueltos de la raíz. */
const SUELTOS = ['./manifest.webmanifest'];

/**
 * Lo que NO se guarda.
 *
 * `release/` son compilados de otro momento y pesan más que el juego entero.
 * Los `.map` solo sirven para depurar. Y el propio `sw.js` no se cachea a sí
 * mismo: si lo hiciera, una versión rota no se podría reemplazar nunca.
 */
const FUERA = [
  /(^|\/)release\//,
  /(^|\/)node_modules\//,
  /(^|\/)\./,
  /\.map$/,
  /\.md$/,
  /(^|\/)sw\.js$/,
];

/**
 * Recorre una carpeta y devuelve todas las rutas de archivo, en orden.
 *
 * @param {string} carpeta Relativa a la raíz del proyecto.
 * @returns {Promise<string[]>}
 */
async function recorrer(carpeta) {
  const absoluta = join(RAIZ, carpeta);

  let entradas;
  try {
    entradas = await readdir(absoluta, { withFileTypes: true });
  } catch {
    // Una carpeta declarada que no existe no es un error: el proyecto puede
    // no tener `styles/` y el juego funciona igual.
    return [];
  }

  const rutas = [];

  for (const e of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
    const sub = posix.join(carpeta, e.name);
    if (e.isDirectory()) rutas.push(...await recorrer(sub));
    else rutas.push(sub);
  }

  return rutas;
}

/** Construye el texto completo de `sw.js`. */
async function componer() {
  const encontradas = [];
  for (const c of CARPETAS) encontradas.push(...await recorrer(c));

  const rutas = [
    ...SUELTOS,
    ...encontradas
      .filter((r) => !FUERA.some((p) => p.test(r)))
      .map((r) => `./${r}`),
  ];

  // La versión sale del contenido, no de un número que alguien tiene que
  // acordarse de subir. Si cambia un solo archivo de la lista, cambia el
  // nombre del cache y el navegador se trae todo de nuevo.
  const huella = await huellaDe(rutas);

  const lista = rutas.map((r) => `  '${r}'`).join(',\n');

  return `// Generado por tools/generar-sw.mjs. No editar a mano.
// La lista se recorre del disco: un archivo nuevo entra solo al regenerar.
const CACHE = 'arcanveil-${huella}';
const SHELL = [
${lista}
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
// Solo lo propio pasa por la caché: los puentes locales (Groq, imágenes) y
// cualquier otro origen van directos, o su estado se quedaba congelado en la
// primera respuesta. La página del juego, de respaldo, solo al navegar.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(req, copy)); }
    return response;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./app/index.html') : Response.error()))));
});
`;
}

/** Extensiones que Git puede convertir entre LF y CRLF al sacar el archivo. */
const DE_TEXTO = /\.(m?js|html|css|json|webmanifest|svg|txt|md)$/i;

/**
 * Tamaño de un archivo sin contar los retornos de carro.
 *
 * Con `core.autocrlf` un mismo commit sale en Windows con CRLF y en Linux o en
 * GitHub Pages con LF: tamaños distintos, huella distinta, y `--revisar`
 * decía que `sw.js` estaba desfasado en cualquier copia que no fuera la que lo
 * generó. Los de texto se miden sin `\r`; las fuentes y las imágenes, que
 * Git no toca y son casi todo el peso, siguen sin leerse.
 *
 * @param {string} ruta
 * @returns {Promise<number>}
 */
async function tamanoSinRetornos(ruta) {
  if (!DE_TEXTO.test(ruta)) return (await stat(ruta)).size;

  const datos = await readFile(ruta);
  let n = datos.length;
  for (const b of datos) if (b === 13) n -= 1;
  return n;
}

/**
 * Huella corta de la lista y del tamaño de cada archivo.
 *
 * Con la ruta y el tamaño basta para detectar que algo cambió. Solo se leen
 * los archivos de texto, para medirlos sin `\r` (ver `tamanoSinRetornos`):
 * leer 40MB de fuentes e imágenes para calcular un nombre de cache sería
 * pagar mucho por poco.
 *
 * @param {string[]} rutas
 * @returns {Promise<string>}
 */
async function huellaDe(rutas) {
  let h = 2166136261;

  for (const r of rutas) {
    let marca = r;
    try {
      marca += `:${await tamanoSinRetornos(join(RAIZ, r.replace(/^\.\//, '')))}`;
    } catch {
      // Un archivo declarado que falta también cambia la huella, que es justo
      // lo que interesa: el cache anterior ya no sirve.
      marca += ':ausente';
    }

    for (let i = 0; i < marca.length; i += 1) {
      h ^= marca.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }

  return (h >>> 0).toString(36);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENTRADA
   ═══════════════════════════════════════════════════════════════════════════ */

const nuevo = await componer();
const destino = join(RAIZ, 'sw.js');
const revisar = process.argv.includes('--revisar');

const actual = await readFile(destino, 'utf-8').catch(() => '');

// Se compara sin retornos de carro por lo mismo que la huella: el `sw.js` que
// Git saca en Windows lleva CRLF y el que se genera, LF.
const sinCR = (t) => t.replace(/\r\n/g, '\n');

if (sinCR(nuevo) === sinCR(actual)) {
  console.log('sw.js al día.');
  process.exit(0);
}

if (revisar) {
  console.error('sw.js está desfasado. Ejecuta: node tools/generar-sw.mjs');
  process.exit(1);
}

await writeFile(destino, nuevo);

const antes = actual.split('\n').filter((l) => l.trim().startsWith("'./")).length;
const ahora = nuevo.split('\n').filter((l) => l.trim().startsWith("'./")).length;

console.log(`sw.js escrito: ${ahora} archivos (antes ${antes}).`);
