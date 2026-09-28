#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/medir-portada.mjs
 * ---------------------------------------------------------------------------
 * Cuánto cuesta la portada mientras está quieta en pantalla.
 *
 * La portada se sentía pesada en el móvil y se veían rayas. Antes de culpar a
 * nadie, se mide: con Chrome sin ventana, en la pantalla de inicio y sin
 * tocar nada durante unos segundos,
 *
 *   · fotogramas: intervalo medio, p95, máximo y cuántos pasan de 20 ms;
 *   · pintado y maquetación: cuántas veces por segundo (traza de CDP, eventos
 *     `Paint` y `Layout`) y cuánto tiempo de pintado; lo que no se mueve no
 *     debería repintarse. (LayerTree.layerPainted no emite nada sin ventana:
 *     se probó y daba 0 con la marca animando su sombra.)
 *   · qué animaciones hay en marcha y qué propiedades mueven;
 *   · trabajo del hilo principal: estilo, maquetación, script y tareas
 *     (CDP Performance.getMetrics, la diferencia en la ventana medida).
 *
 * Con la CPU frenada 4× (un móvil corriente) y otra vez pidiendo menos
 * movimiento (`prefers-reduced-motion`), que debería dejarlo casi en cero.
 *
 *   node tools/medir-portada.mjs [--segundos 6] [--desktop] [--json]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const SEGUNDOS = Number(args[args.indexOf('--segundos') + 1]) || 6;
const escritorio = args.includes('--desktop');
const PUERTO = 8766;
const DEPURACION = 9229;
const ventana = escritorio ? { width: 1440, height: 900 } : { width: 390, height: 844 };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function buscarChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidatos = {
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  }[process.platform] ?? ['google-chrome', 'chromium'];
  for (const c of candidatos) if (!c.includes('/') && !c.includes('\\') ? true : existsSync(c)) return c;
  throw new Error('No encuentro Chrome. Indícalo con CHROME_BIN.');
}

const perfil = await mkdtemp(join(tmpdir(), 'arcanveil-portada-'));
const hijos = [];
const lanzar = (cmd, a) => { const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }); hijos.push(p); return p; };
const parar = async () => { for (const p of hijos) { try { p.kill(); } catch { /* ya muerto */ } } await esperar(300); await rm(perfil, { recursive: true, force: true }).catch(() => {}); };

lanzar(process.execPath, ['tools/servir.mjs', '--puerto', String(PUERTO)]);
lanzar(buscarChrome(), ['--headless=new', '--no-sandbox', '--hide-scrollbars', `--window-size=${ventana.width},${ventana.height}`, `--remote-debugging-port=${DEPURACION}`, `--user-data-dir=${perfil}`, 'about:blank']);

async function json(url, init) {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(url, init); if (r.ok) return r.json(); } catch { /* aún no */ }
    await esperar(100);
  }
  throw new Error(`No responde ${url}`);
}

let ws;
let seq = 0;
const pendientes = new Map();
let traza = [];
let trazaLista = null;
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => pendientes.set(id, { ok, no }));
}
const evaluar = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

async function medir(etiqueta) {
  const antes = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  traza = [];
  await cdp('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  const intervalos = await evaluar(`new Promise((ok) => {
    const t = []; let ultimo = performance.now(); const fin = ultimo + ${SEGUNDOS * 1000};
    function paso(ahora) { t.push(ahora - ultimo); ultimo = ahora; if (ahora < fin) requestAnimationFrame(paso); else ok(t.slice(2)); }
    requestAnimationFrame(paso);
  })`);
  const despues = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const completa = new Promise((ok) => { trazaLista = ok; });
  await cdp('Tracing.end');
  await completa;
  const eventos = (nombre) => traza.filter((e) => e.name === nombre && (e.ph === 'X' || e.ph === 'B'));
  const pintado = eventos('Paint');
  const d = (k) => (despues[k] ?? 0) - (antes[k] ?? 0);
  const orden = [...intervalos].sort((a, b) => a - b);
  const ms = (x) => Math.round(x * 10) / 10;
  return {
    caso: etiqueta,
    fotogramas: intervalos.length,
    medioMs: ms(intervalos.reduce((s, x) => s + x, 0) / intervalos.length),
    p95Ms: ms(orden[Math.floor(orden.length * 0.95)] ?? 0),
    maxMs: ms(orden.at(-1) ?? 0),
    lentos: intervalos.filter((x) => x > 20).length,
    pintadosPorSeg: ms(pintado.length / SEGUNDOS),
    pintarMsPorSeg: ms(pintado.reduce((s, e) => s + (e.dur ?? 0), 0) / 1000 / SEGUNDOS),
    maquetasPorSeg: ms(eventos('Layout').length / SEGUNDOS),
    estiloMsPorSeg: ms(d('RecalcStyleDuration') * 1000 / SEGUNDOS),
    maquetaMsPorSeg: ms(d('LayoutDuration') * 1000 / SEGUNDOS),
    scriptMsPorSeg: ms(d('ScriptDuration') * 1000 / SEGUNDOS),
    tareasMsPorSeg: ms(d('TaskDuration') * 1000 / SEGUNDOS),
  };
}

try {
  await json(`http://127.0.0.1:${PUERTO}/app/index.html`).catch(() => null);
  const destino = await json(`http://127.0.0.1:${DEPURACION}/json/new?${encodeURIComponent(`http://127.0.0.1:${PUERTO}/app/index.html`)}`, { method: 'PUT' });
  ws = new WebSocket(destino.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pendientes.has(m.id)) { const p = pendientes.get(m.id); pendientes.delete(m.id); if (m.error) p.no(new Error(m.error.message)); else p.ok(m.result); }
    else if (m.method === 'Tracing.dataCollected') traza.push(...m.params.value);
    else if (m.method === 'Tracing.tracingComplete') trazaLista?.();
  };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Performance.enable');
  for (let i = 0; i < 150; i += 1) { if (await evaluar('document.body?.dataset.activeScreen === "inicio" && document.body.classList.contains("esta-listo")')) break; await esperar(100); }
  await esperar(1500);                       // que acaben las entradas

  // Qué se mueve, y con qué. Lo que anima algo que no sea transform u
  // opacity obliga a recalcular estilo y repintar en cada fotograma.
  const animaciones = await evaluar(`document.getAnimations().map((a) => {
    const t = a.effect?.target;
    const props = [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)))].filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p));
    const donde = t ? (t.id ? '#' + t.id : (typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : t.tagName.toLowerCase())) + (a.effect.pseudoElement ?? '') : '?';
    return { animacion: a.animationName ?? a.id, donde, props: props.join(','), soloComposicion: props.every((p) => ['transform', 'opacity'].includes(p)) };
  })`);
  if (!args.includes('--json')) console.table(animaciones);

  // `--parar a,b`: sin esas animaciones, para ver cuánto pesa cada una.
  const parar = args.includes('--parar') ? args[args.indexOf('--parar') + 1].split(',') : [];
  if (parar.length) await evaluar(`document.getAnimations().filter((a) => ${JSON.stringify(parar)}.includes(a.animationName)).forEach((a) => a.cancel())`);

  const resultados = [];
  await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
  resultados.push(await medir('portada, CPU 4×'));
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await esperar(500);
  resultados.push(await medir('portada, CPU 4×, menos movimiento'));

  if (args.includes('--json')) console.log(JSON.stringify(resultados));
  else console.table(resultados);
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  await parar();
}
