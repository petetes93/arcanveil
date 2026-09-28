/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/buscar-secretos.mjs
 * ---------------------------------------------------------------------------
 * ¿Hay alguna clave en el repositorio, ahora o en cualquier commit pasado?
 *
 * Las claves de ARCANVEIL viven fuera: la de Groq en %LOCALAPPDATA%, las de
 * Gemini y Cloudflare en variables de entorno del proceso del puente. Esto
 * comprueba que siga siendo así:
 *
 *   1. Los archivos del árbol de trabajo (versionados y nuevos no ignorados).
 *   2. Todas las líneas añadidas en toda la historia (`git log --all -p`):
 *      una clave borrada en un commit posterior sigue publicada.
 *   3. Que los archivos donde se guardarían claves estén ignorados.
 *
 * Nunca imprime una clave entera: los cuatro primeros caracteres y la
 * longitud, lo justo para encontrarla.
 *
 *   node tools/buscar-secretos.mjs [--sin-historia]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/** Formas de clave conocidas. Específicas a propósito: una alarma que salta sola no se mira. */
export const PATRONES = [
  { nombre: 'Groq', re: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { nombre: 'Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{30,}/g },
  { nombre: 'OpenAI', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/g },
  { nombre: 'Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { nombre: 'GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { nombre: 'AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nombre: 'Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { nombre: 'Hugging Face', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { nombre: 'clave privada', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // Cloudflare no tiene prefijo: solo cuenta si va asignado a un nombre que lo delata.
  { nombre: 'Cloudflare', re: /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/g },
  { nombre: 'asignación sospechosa', re: /\b(?:api[_-]?key|apikey|secret|token|password|contrasena)\s*[=:]\s*["'][A-Za-z0-9_\-+/=]{24,}["']/gi },
];

/**
 * Ejemplos que se escriben a propósito en pruebas y documentación. Una línea
 * que los lleva no cuenta.
 */
const DE_MENTIRA = /(?:FALSO|falso|fake|FAKE|ejemplo|EJEMPLO|xxxx|XXXX|0{16,}|1234567890abcdef|prueba-no-es-una-clave)/;

/** Archivos que jamás se miran (binarios o generados sin texto útil). */
const BINARIO = /\.(png|jpe?g|webp|gif|ico|ttf|otf|woff2?|mp3|ogg|wav|zip|pdf|bundle)$/i;

const ocultar = (s) => `${s.slice(0, 4)}…(${s.length})`;

/**
 * Busca claves en un texto.
 * @param {string} texto
 * @returns {Array<{nombre: string, muestra: string, linea: number}>}
 */
export function buscar(texto) {
  const hallazgos = [];
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (DE_MENTIRA.test(linea)) return;
    for (const { nombre, re } of PATRONES) {
      re.lastIndex = 0;
      for (const m of linea.matchAll(re)) hallazgos.push({ nombre, muestra: ocultar(m[0]), linea: i + 1 });
    }
  });
  return hallazgos;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('buscar-secretos.mjs')) {
  const conHistoria = !process.argv.includes('--sin-historia');
  let total = 0;

  // ─── 0. Control ─────────────────────────────────────────────────────────
  // Un «limpio» solo vale si el buscador ve lo que tiene que ver. Las
  // muestras se montan al vuelo: escritas tal cual, este archivo sería un
  // hallazgo.
  const muestra = (prefijo, n, c = 'Q') => `${prefijo}${c.repeat(n)}`;
  const controles = [
    muestra('gsk' + '_', 48), muestra('sk-' + 'ant-', 40), muestra('AI' + 'za', 35), muestra('gh' + 'p_', 36),
    muestra('AK' + 'IA', 16, 'Z'), `-----BEGIN ${'PRIVATE'} KEY-----`, `CLOUDFLARE_API_${'TOKEN'}=${muestra('', 40)}`,
  ];
  const ciegos = controles.filter((c) => !buscar(c).length);
  if (ciegos.length || buscar(`${controles[0]} // FALSO`).length) {
    console.log(`El buscador no ve lo que debe (${ciegos.map(ocultar).join(', ')}): su «limpio» no valdría.`);
    process.exit(2);
  }

  // ─── 1. Árbol de trabajo ────────────────────────────────────────────────
  const archivos = git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(Boolean);
  let mirados = 0;
  for (const rel of archivos) {
    if (BINARIO.test(rel)) continue;
    const ruta = join(RAIZ, rel);
    let texto;
    try { if (statSync(ruta).size > 5_000_000) continue; texto = readFileSync(ruta, 'utf8'); } catch { continue; }
    mirados += 1;
    for (const h of buscar(texto)) { total += 1; console.log(`CLAVE  ${rel}:${h.linea}  ${h.nombre}  ${h.muestra}`); }
  }
  console.log(`Árbol de trabajo: ${mirados} archivos de texto mirados.`);

  // ─── 2. Historia ────────────────────────────────────────────────────────
  if (conHistoria) {
    const commits = git(['rev-list', '--all']).split('\n').filter(Boolean).length;
    const parche = git(['log', '--all', '-p', '--no-color', '--unified=0', '--format=@@@commit %h']);
    let commit = '?';
    let archivo = '?';
    const vistos = new Set();
    for (const linea of parche.split('\n')) {
      if (linea.startsWith('@@@commit ')) { commit = linea.slice(10); continue; }
      if (linea.startsWith('+++ ')) { archivo = linea.slice(6); continue; }
      if (!linea.startsWith('+') || BINARIO.test(archivo)) continue;
      for (const h of buscar(linea.slice(1))) {
        const clave = `${h.nombre}${h.muestra}${archivo}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        total += 1;
        console.log(`CLAVE  historia ${commit} ${archivo}  ${h.nombre}  ${h.muestra}`);
      }
    }
    console.log(`Historia: ${commits} commits mirados (todas las ramas).`);
  }

  // ─── 3. Donde se guardarían, ignorado ───────────────────────────────────
  const deberianIgnorarse = ['.env', '.env.local', 'credenciales.json', 'groq.key', '.arcanveil-image-config.json', '.arcanveil-images/x.png'];
  const noIgnorados = deberianIgnorarse.filter((f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: RAIZ }).status !== 0);
  for (const f of noIgnorados) { total += 1; console.log(`SIN IGNORAR  ${f}: una clave guardada ahí se subiría`); }
  const versionados = git(['ls-files']).split('\n').filter((f) => /(^|\/)(\.env(\..*)?|.*\.key|credenciales\..*)$/.test(f));
  for (const f of versionados) { total += 1; console.log(`VERSIONADO  ${f}`); }

  console.log(total ? `\n${total} hallazgos.` : '\nNinguna clave en el árbol ni en la historia.');
  process.exitCode = total ? 1 : 0;
}
