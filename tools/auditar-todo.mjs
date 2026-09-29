#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/auditar-todo.mjs
 * ---------------------------------------------------------------------------
 * Todas las auditorías, juzgadas por su CÓDIGO DE SALIDA.
 *
 * Se hacía con un bucle que miraba las últimas líneas buscando «fallos»:
 * una suite que reventaba (ENOENT en auditar-servidores, tras borrar el
 * archivo que leía) terminaba con «Node.js v24…» y pasaba por buena. Aquí
 * cuenta que TERMINE con 0; lo demás es fallo, se caiga o no.
 *
 *   node tools/auditar-todo.mjs [--json]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const auditorias = readdirSync(join(RAIZ, 'tools')).filter((n) => /^auditar-.+\.mjs$/.test(n) && n !== 'auditar-todo.mjs').sort();

const filas = [];
for (const nombre of auditorias) {
  const inicio = Date.now();
  const r = spawnSync(process.execPath, [join('tools', nombre)], { cwd: RAIZ, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/);
  const codigo = r.status ?? (r.signal ? `señal ${r.signal}` : 'sin código');
  // El resumen que da cada una («68/68 comprobaciones», «Todo bien.»…).
  const resumen = [...salida].reverse().find((l) => /\d+\/\d+|Todo|Sin |correctos|problemas|fallos|Error/.test(l)) ?? salida.at(-1) ?? '';
  filas.push({ auditoria: nombre, codigo, segundos: Math.round((Date.now() - inicio) / 100) / 10, resumen: resumen.trim().slice(0, 70) });
}

const malas = filas.filter((f) => f.codigo !== 0);
if (process.argv.includes('--json')) console.log(JSON.stringify(filas));
else console.table(filas);
console.log(`\n${filas.length - malas.length}/${filas.length} terminadas con código 0.`);
if (malas.length) console.log(`Fallan: ${malas.map((f) => `${f.auditoria} (${f.codigo})`).join(', ')}`);
process.exitCode = malas.length ? 1 : 0;
