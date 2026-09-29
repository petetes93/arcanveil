#!/usr/bin/env node
/** Regresión real de la PWA en Chrome, sin dependencias externas. */
import { spawn, spawnSync } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync, writeFileSync as escribirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sujetoRetrato as encargoRetrato } from '../src/art/rasgos.js';
import { crearProxyImagen } from './imagen-local-proxy.mjs';

const ROOT = process.cwd();
const PORT = 8765;
const DEBUG = 9228;
const URL_APP = `http://127.0.0.1:${PORT}/app/index.html`;
const out = process.argv.includes('--capturas') ? resolve('dist/regresion') : null;
const desktop = process.argv.includes('--desktop');

/**
 * `--sin-ia` bloquea el servicio de imágenes para probar el respaldo.
 *
 * La regresión tiene que valer con red y sin ella, porque las dos son
 * situaciones reales del jugador. Con la opción puesta, el retrato de IA no
 * puede cargar y el vectorial es la única salida posible: si el juego sigue
 * en pie y con cara, el respaldo funciona de verdad y no de palabra.
 */
const sinIA = process.argv.includes('--sin-ia');
const viewport = desktop ? { width: 1440, height: 900, label: '1440x900' } : { width: 390, height: 844, label: '390x844' };
// Antes de abrir el navegador: ¿el trabajador de servicio conoce el código
// actual?
//
// Tres módulos que se cargan al arrancar pasaron días fuera del cache y esta
// regresión no lo vio: su prueba sin red corre con el cache HTTP del
// navegador todavía caliente, así que el archivo aparecía aunque el
// trabajador no lo tuviera. Instalado de verdad y sin conexión, el juego no
// arrancaba. Comprobarlo aquí cuesta un instante y no depende del navegador.
{
  const sw = spawnSync(process.execPath, ['tools/generar-sw.mjs', '--revisar'], { cwd: ROOT, encoding: 'utf8' });
  if (sw.status !== 0) {
    console.error((sw.stdout || sw.stderr || '').trim() || 'sw.js está desfasado.');
    process.exit(1);
  }
}

const profile = await mkdtemp(join(tmpdir(), 'arcanveil-chrome-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const children = [];
const stop = async () => {
  for (const p of children) { try { p.kill('SIGTERM'); } catch {} }
  await wait(400);
  for (let i=0;i<5;i++){ try { await rm(profile,{recursive:true,force:true}); break; } catch { await wait(200); } }
};
process.on('SIGINT', () => stop().finally(() => process.exit(130)));
process.on('SIGTERM', () => stop().finally(() => process.exit(143)));

function launch(cmd, args) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  return p;
}
async function json(url, init) {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(url, init); if (r.ok) { const t=await r.text(); try{return JSON.parse(t)}catch{return t} } } catch {}
    await wait(100);
  }
  throw new Error(`No responde ${url}`);
}

const server = launch(process.execPath, ['tools/servir.mjs', '--puerto', String(PORT)]);
let serverErr = ''; server.stderr.on('data', d => { serverErr += d; });

// El generador de imágenes: el puente de verdad en su puerto, con un
// proveedor falso que devuelve un PNG de 1×1 (ni ComfyUI ni red). Cada
// generación apunta su semilla: dos versiones tienen que ser dos semillas.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const generadas = [];
let estudio = 'sin probar';
let puenteImagen = null;
const cacheImagen = await mkdtemp(join(tmpdir(), 'arcanveil-imagenes-'));
if (!sinIA) {
  const candidato = crearProxyImagen({
    origen: `http://127.0.0.1:${PORT}`,
    cache: cacheImagen,
    proveedor: { id: 'falso', salud: async () => ({ disponible: true }), generar: async ({ semilla }) => { generadas.push(semilla); return { bytes: PNG_1X1, tipo: 'image/png' }; } },
  });
  puenteImagen = await candidato.escuchar().then(() => candidato, () => null);
}
/** Candidatas que el puente tiene en disco (de un dueño, o todas). */
const enCache = (prefijo = '') => { try { return readdirSync(cacheImagen).filter((n) => n.endsWith('.img') && n.startsWith(prefijo)); } catch { return []; } };
async function esperarCache(cond, ms = 8000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((ok) => setTimeout(ok, 100));
  return cond();
}
/** Claves y fechas de lo que hay en la galería del navegador. */
const GALERIA = `new Promise((ok) => { const p = indexedDB.open('arcanveil-imagenes'); p.onsuccess = () => { const d = p.result; if (!d.objectStoreNames.contains('aprobadas')) { d.close(); return ok([]); } const q = d.transaction('aprobadas').objectStore('aprobadas').getAll(); q.onsuccess = () => { d.close(); ok(q.result.map((x) => ({ clave: x.clave, creada: x.creada }))); }; q.onerror = () => ok([]); }; p.onerror = () => ok([]); })`;
const pararPuenteImagen = async () => {
  if (puenteImagen) await puenteImagen.cerrar().catch(() => {});
  await rm(cacheImagen, { recursive: true, force: true }).catch(() => {});
};
/**
 * Dónde está Chrome.
 *
 * Estaba escrito `google-chrome` a secas, que solo existe en Linux: en un
 * Windows recién clonado la regresión no arrancaba y el error era un ENOENT
 * sin pistas. Se prueban los sitios de siempre de cada sistema y se puede
 * forzar con `CHROME_BIN` para los casos raros.
 */
function buscarChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

  const candidatos = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
  }[process.platform] ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

  for (const c of candidatos) {
    // En Linux los candidatos son nombres sueltos y los resuelve el PATH.
    if (!c.includes('/') && !c.includes('\\')) return c;
    if (existsSync(c)) return c;
  }

  throw new Error('No encuentro Chrome. Indícalo con CHROME_BIN=/ruta/a/chrome');
}

const chrome = launch(buscarChrome(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--window-size=${viewport.width},${viewport.height}`, `--remote-debugging-port=${DEBUG}`,
  `--user-data-dir=${profile}`, 'about:blank',
]);
let chromeErr = ''; chrome.stderr.on('data', d => { chromeErr += d; });

let ws;
let seq = 0;
const pending = new Map();
const exceptions = [];
/**
 * Peticiones de la página a cualquier sitio que no sea esta máquina. El
 * juego no pide nada fuera: ni retratos ni ilustraciones (antes, a
 * Pollinations en cada escena). Tiene que quedar vacío.
 */
const externos = [];
function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression, awaitPromise = true) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await wait(100);
  }
  throw new Error(`Tiempo agotado esperando: ${expression}`);
}
async function shot(name) {
  if (!out) return;
  await import('node:fs/promises').then(m => m.mkdir(out, { recursive: true }));
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(out, name), Buffer.from(r.data, 'base64'));
}

try {
  await json(`http://127.0.0.1:${PORT}/app/index.html`);
  const target = await json(`http://127.0.0.1:${DEBUG}/json/new?${encodeURIComponent(URL_APP)}`, { method: 'PUT' });
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails?.text ?? 'excepción');
    } else if (m.method === 'Network.requestWillBeSent') {
      const url = m.params.request.url;
      if (/^(?:https?|wss?):/.test(url) && !/^(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(url)) externos.push(url.slice(0, 120));
    }
  };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');

  // `--sin-ia`: sin generador de imágenes en el equipo. El juego tiene que
  // seguir igual, con marcadores, y el estudio decir por qué no pinta.
  if (sinIA) {
    await cdp('Network.setBlockedURLs', { urls: ['*127.0.0.1:11437*', '*localhost:11437*'] });
    await cdp('Page.reload', { ignoreCache: true });
    await until('window.ARCANVEIL?.motor?.listo && document.body.classList.contains("esta-listo")');
  }

  await until('window.ARCANVEIL?.motor?.listo && document.body.classList.contains("esta-listo")');
  const boot = await evaluate(`({screen:document.body.dataset.activeScreen, systems:ARCANVEIL.inspeccionar().total, failures:document.querySelectorAll('#fallos').length})`);
  if (boot.screen !== 'inicio' || boot.failures) throw new Error(`arranque inválido ${JSON.stringify(boot)}`);
  await shot(`01-inicio-${viewport.label}.png`);

  // La portada es la marca y «Pulsa para jugar»; el menú aún no se ve.
  const visibles = () => evaluate(`[...document.querySelectorAll('.menu-btn')].filter(b=>b.offsetParent!==null).map(b=>b.id)`);
  if ((await visibles()).length) throw new Error(`el menú se ve antes de pulsar: ${await visibles()}`);

  // La tinta del título, medida sobre los píxeles de la captura: dentro de la
  // pantalla y centrada. La caja del texto no sirve: el trazo de la última
  // ele sobra de ella, y en escritorio salía 80 px fuera con la caja «dentro».
  {
    await evaluate(`document.getAnimations().forEach((a) => { try { a.finish(); } catch { try { a.cancel(); } catch {} } })`);
    await wait(300);
    const foto = await cdp('Page.captureScreenshot', { format: 'png' });
    const tinta = await evaluate(`(async () => {
      const h = document.querySelector('.inicio__marca').getBoundingClientRect();
      const img = new Image(); img.src = 'data:image/png;base64,${foto.data}'; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const y0 = Math.max(0, Math.floor((h.top - 10) * k)), y1 = Math.min(img.height, Math.ceil((h.bottom + 25) * k));
      const d = cx.getImageData(0, y0, img.width, y1 - y0).data;
      let min = Infinity, max = -1;
      for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (d[i] > 170 && d[i + 1] > 130 && d[i + 2] < 170 && d[i] - d[i + 2] > 45) { if (x < min) min = x; if (x > max) max = x; }
      }
      return { izq: min / k, der: innerWidth - max / k, ancho: innerWidth };
    })()`);
    if (!(tinta.izq > 0 && tinta.der > 0)) throw new Error(`la tinta del título se sale: ${JSON.stringify(tinta)}`);
    if (Math.abs(tinta.izq - tinta.der) > 8) throw new Error(`el título no está centrado: ${JSON.stringify(tinta)}`);
  }

  // Pulsar abre el menú y lleva el foco dentro; Escape lo cierra y vuelve.
  await evaluate(`document.querySelector('#inicio-jugar').click()`);
  const menu = await visibles();
  for (const id of ['menu-nueva', 'menu-cargar', 'menu-ajustes']) if (!menu.includes(id)) throw new Error(`falta ${id} en el menú: ${menu}`);
  const foco = await evaluate(`document.activeElement?.id`);
  if (!/^menu-/.test(foco ?? '')) throw new Error(`al abrir el menú el foco no entra: ${foco}`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  if ((await visibles()).length || (await evaluate(`document.activeElement?.id`)) !== 'inicio-jugar') throw new Error('Escape no cierra el menú o no devuelve el foco');
  await evaluate(`document.querySelector('#inicio-jugar').click()`);
  await shot(`01b-menu-${viewport.label}.png`);

  await evaluate(`document.querySelector('#menu-nueva').click()`);
  await until('document.body.dataset.activeScreen === "creacion" && document.querySelector("#aleatoria-raza")');
  // El dado vuelve a tirar raza y nombre en cada pulsación.
  const tiradas = new Set();
  for (let i = 0; i < 6; i++) {
    tiradas.add(await evaluate(`document.querySelector('#aleatoria-raza').textContent + '|' + document.querySelector('#nombre').value`));
    await evaluate(`document.querySelector('#creacion-aleatorio').click()`);
  }
  if (tiradas.size < 3) throw new Error(`el generador aleatorio no varía: ${[...tiradas]}`);
  await evaluate(`(()=>{const fill=(q,v)=>{const n=document.querySelector(q);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}))};fill('#nombre','Lyra');fill('#retrato-descripcion','elfa exploradora de pelo plateado, ojos azul brillante, cicatriz en la ceja y armadura de cuero negro');fill('#lore-personaje','Mi hermana cruzó el Umbral con nuestro medallón. La busco desde entonces.');})()`);
  await shot(`02a-creacion-${viewport.label}.png`);
  // Intensidad elegida en la creación: Pacífica. Se comprueba al empezar que
  // llega a la partida y, tras 30 turnos, que casi no ha habido encuentros.
  await evaluate(`document.querySelector('[data-intensidad="relato"]').click()`);
  await evaluate(`document.querySelector('#creacion-crear').click()`);
  await until('document.querySelector("#creacion-empezar") && document.querySelector("#creacion-cara .arte")');
  // Sin pedirlo, no se pinta nada: el marcador con el nombre y el botón
  // para pintar. Ni cara vectorial ni petición a ningún generador.
  const retrato = await evaluate(`(() => ({
    marcador: document.querySelector('#creacion-cara .marcador-arte')?.textContent ?? '',
    vector: Boolean(document.querySelector('#creacion-cara svg')),
    pintar: Boolean(document.querySelector('#retrato-pintar')),
  }))()`);
  if (!/Lyra/.test(retrato.marcador) || retrato.vector || !retrato.pintar) throw new Error(`la revelación no enseña el marcador con el nombre y el botón de pintar: ${JSON.stringify(retrato)}`);

  // «Elfa» en la descripción y un linaje cualquiera en la ficha: la revelación
  // tiene que decirlo, y volver a la ficha no puede crear un gemelo.
  const aviso = await evaluate(`document.querySelector('#revelacion-especie')?.textContent ?? ''`);
  if (!/«elfa»/.test(aviso)) throw new Error(`la revelación no avisa de la especie escrita: «${aviso}»`);

  const contarPjs = `JSON.parse(localStorage.getItem('arcanveil:personajes') ?? '[]').length`;
  const pjsAntes = await evaluate(contarPjs);

  await evaluate(`document.querySelector('#revelacion-cambiar-linaje').click()`);
  await until('document.querySelector("#creacion-crear") && document.querySelector("#retrato-descripcion")');
  const conservado = await evaluate(`document.querySelector('#retrato-descripcion').value`);
  if (!conservado.startsWith('elfa exploradora')) throw new Error(`volver a la ficha perdió la descripción: «${conservado}»`);

  await evaluate(`document.querySelector('#creacion-aleatorio').click()`);
  const nombreTrasTirar = await evaluate(`document.querySelector('#nombre').value`);
  if (nombreTrasTirar !== 'Lyra') throw new Error(`volver a tirar borró el nombre escrito: «${nombreTrasTirar}»`);

  await evaluate(`document.querySelector('#creacion-crear').click()`);
  await until('document.querySelector("#creacion-empezar") && document.querySelector("#creacion-cara .arte")');

  const pjsDespues = await evaluate(contarPjs);
  if (pjsDespues !== pjsAntes) throw new Error(`cambiar de linaje creó un personaje gemelo: ${pjsAntes} → ${pjsDespues}`);

  // Corregir con palabras en la revelación: cambia el sexo, conserva el
  // nombre y el retrato pide un hombre.
  const leerPj = `JSON.parse(localStorage.getItem('arcanveil:personajes'))[0]`;
  const pjAntes = await evaluate(leerPj);
  const escribirCambio = (texto) => evaluate(`(() => {
    const i = document.querySelector('#revelacion-cambio');
    i.value = ${JSON.stringify(texto)};
    document.querySelector('#revelacion-form').requestSubmit();
  })()`);

  await escribirCambio('mejor que sea hombre');
  await until('document.querySelector("#revelacion-resumen")?.textContent.includes("Ahora es un hombre")');
  const pjHombre = await evaluate(leerPj);
  if (pjHombre.genero !== 'm') throw new Error(`«mejor que sea hombre» dejó el sexo en ${pjHombre.genero}`);
  if (pjHombre.nombre !== pjAntes.nombre) throw new Error(`«mejor que sea hombre» cambió el nombre: ${pjAntes.nombre} → ${pjHombre.nombre}`);
  if (pjHombre.id !== pjAntes.id) throw new Error('la corrección creó otro personaje');
  const encargo = encargoRetrato({ raza: pjHombre.raza, descripcion: pjHombre.retrato, genero: pjHombre.genero });
  // «a man» o, con especie, «an elf man»: sexo y especie van juntos.
  if (!/\ban? (?:\w+ )?man\b/.test(encargo) || /\bwoman\b/.test(encargo)) throw new Error(`tras «mejor que sea hombre» el retrato pide: ${encargo}`);

  // La forja visual dura 720 ms; la captura valida el estado final nítido.
  await new Promise(resolve => setTimeout(resolve, 850));
  await shot(`02-creacion-${viewport.label}.png`);

  // Y se empieza escribiendo, sin buscar el botón.
  await escribirCambio('vale, empezamos');
  await until('document.body.dataset.activeScreen === "juego" && !document.querySelector("#entrada").disabled && ARCANVEIL.sistema("turns").inspeccionar().ocupado === false && ARCANVEIL.ver("narrative.entradas",[]).length > 0 && ARCANVEIL.ver("player.lore","").includes("hermana")', 15000);
  const intensidad = await evaluate(`ARCANVEIL.ver('settings.dificultad')`);
  if (intensidad !== 'relato') throw new Error(`la partida empezó en ${intensidad}, no en Pacífica`);
  await evaluate(`window.__encuentros = 0; ARCANVEIL.bus.on('exploration:encounter', () => { window.__encuentros += 1; })`);
  await evaluate(`window.__escenas = []; ARCANVEIL.bus.on('scene:changed', (e) => { window.__escenas.push(e.motivo); })`);
  // El pasado del personaje es canon, no guion. Se conserva en la ficha,
  // pero la partida NO empieza con una misión sacada de él, la apertura no
  // lo vuelca y no se abre como hilos de memoria. Antes esta prueba exigía lo
  // contrario —«hermana» en la apertura y una principal aceptada en el turno
  // 1—, que es justo lo que el autor rechazó.
  const apertura = await evaluate(`(() => {
    const a = ARCANVEIL.ver('quests.activas', { porId: {}, orden: [] });
    return {
      lore: ARCANVEIL.ver('player.lore', ''),
      misiones: a.orden.map((id) => a.porId[id]).filter(Boolean).map((m) => m.tipo + ':' + m.estado),
      hilosDelPasado: ARCANVEIL.ver('ai.memoria.hilos', []).filter((h) => /^player_lore/.test(h.relacionadoCon ?? '')).length,
      texto: ARCANVEIL.ver('narrative.entradas', []).filter((e) => e.voz === 'dm').at(-1)?.texto ?? '',
    };
  })()`);
  if (!apertura.lore.includes('hermana')) throw new Error('la historia del personaje no se conservó en la ficha');
  if (apertura.misiones.length) throw new Error(`la partida empezó con misiones impuestas: ${apertura.misiones.join(', ')}`);
  if (apertura.hilosDelPasado) throw new Error(`el pasado se abrió como ${apertura.hilosDelPasado} hilos de memoria`);
  if (/hermana|medallón|Umbral/i.test(apertura.texto)) throw new Error(`la apertura vuelca el pasado del personaje: «${apertura.texto.slice(0, 160)}»`);
  if (!/\?$/.test(apertura.texto.trim().split('\n').at(-1))) throw new Error(`la apertura no pregunta: «${apertura.texto.split('\n').at(-1)}»`);

  const acciones = [
    'miro alrededor','escucho tras la puerta','exploro con cuidado','examino las huellas',
    'pregunto por rumores','busco un camino seguro','registro el lugar','observo el cielo',
    'recuerdo viejas historias','compruebo mi equipo','avanzo en silencio','busco agua',
    'inspecciono las piedras','dejo una marca en el camino','vigilo los tejados','sigo las luces',
    'investigo el ruido','anoto lo descubierto','descanso un momento','decido el siguiente paso',
  ];
  const turns = [];
  for (const a of acciones) {
    const result = await evaluate(`ARCANVEIL.jugar(${JSON.stringify(a)}).then(()=>({disabled:document.querySelector('#entrada').disabled, lines:ARCANVEIL.ver('narrative.entradas',[]).length, failures:document.querySelectorAll('#fallos .fallos__linea').length}))`);
    turns.push(result);
    if (result.disabled || result.failures) throw new Error(`turno fallido: ${a}`);
  }

  // Cada turno del máster termina devolviendo la palabra.
  const sinPregunta = await evaluate(`ARCANVEIL.ver('narrative.entradas', [])
    .filter(e => e.voz === 'dm' && (e.texto ?? '').trim())
    .map(e => e.texto.trim().split('\\n').at(-1))
    .filter(ultima => !/\\?[»"]?$/.test(ultima))`);
  if (sinPregunta.length) throw new Error(`turnos que no terminan en pregunta: ${sinPregunta.slice(0, 3).join(' | ')}`);

  // Ninguna frase de las que abrían desde el pasado del personaje: ni en la
  // apertura ni en los turnos siguientes.
  const aperturas = await evaluate(`ARCANVEIL.ver('narrative.entradas', [])
    .map(e => e.texto ?? '')
    .filter(t => /Tu pasado no te ha dejado llegar|Hay una razón personal detrás|Lo que dejaste atrás sigue viajando/.test(t))
    .length`);
  if (aperturas !== 0) throw new Error(`el narrador abrió desde el pasado del personaje ${aperturas} veces`);

  // Pacífica: en los treinta primeros turnos, como mucho un encuentro.
  for (let i = 0; i < 10; i += 1) {
    await evaluate(`ARCANVEIL.jugar('exploro los alrededores con calma')`);
  }
  const encuentros = await evaluate('window.__encuentros');
  const turnosJugados = await evaluate(`ARCANVEIL.ver('meta.turno', 0)`);
  if (turnosJugados < 30) throw new Error(`solo se jugaron ${turnosJugados} turnos`);
  if (encuentros > 1) throw new Error(`en Pacífica hubo ${encuentros} encuentros en ${turnosJugados} turnos`);

  // Guardar un arma no se tira ni suena, y se narra con lo que se lleva.
  const gesto = await evaluate(`(async () => {
    const antes = ARCANVEIL.ver('narrative.entradas', []).length;
    await ARCANVEIL.jugar('guardo la espada');
    const nuevas = ARCANVEIL.ver('narrative.entradas', []).slice(antes);
    return {
      tiradas: nuevas.filter(e => e.voz === 'roll').length,
      texto: nuevas.map(e => e.texto ?? '').join(' '),
      voces: nuevas.map(e => e.voz),
    };
  })()`);
  if (gesto.tiradas) throw new Error('guardar la espada tiró dados');
  if (!/guardas|no llevas/i.test(gesto.texto)) throw new Error(`guardar la espada narró otra cosa: «${gesto.texto}»`);
  if (/[A-Z]{4,}\.?$/.test(gesto.texto.trim())) throw new Error(`guardar la espada acabó en sonido: «${gesto.texto}»`);
  if (turns.at(-1).lines < 20) throw new Error(`la bitácora no avanzó: ${turns.at(-1).lines}`);
  await shot(`03-partida-20-turnos-${viewport.label}.png`);

  // Texto hostil por todas las puertas que acaban en pantalla: el nombre y el
  // oficio de un PNJ (y su retrato), lo que escribe el jugador, una línea
  // narrada, un aviso y un objeto. Nada de eso puede ejecutarse ni volverse
  // etiqueta: todo va como texto (ver auditar-xss.mjs para el código).
  const CEBO = '<img src=x onerror="window.__xss=(window.__xss||0)+1"><svg onload="window.__xss=(window.__xss||0)+1"></svg>';
  await evaluate(`(async () => {
    window.__xss = 0;
    const cebo = ${JSON.stringify(CEBO)};
    ARCANVEIL.sistema('npcs').introducir({ nombre: 'Cebo' + cebo, rol: 'mercader' + cebo, actitud: 'amable' });
    ARCANVEIL.bus.emit('narrative:direct', { texto: 'Narrado ' + cebo, voz: 'dm' });
    ARCANVEIL.bus.emit('narrative:direct', { texto: cebo, voz: 'system' });
    ARCANVEIL.bus.emit('ui:notice', { mensaje: 'Aviso ' + cebo, tipo: 'info' });
    ARCANVEIL.store.dispatch('inventory/anadir', { silencioso: true, objeto: {
      id: 'itm_cebo', refId: 'pocion_curacion', nombre: 'Cebo' + cebo, categoria: 'consumible', subtipo: 'pocion',
      rareza: 'comun', cantidad: 1, peso: 0.5, valor: 1, afijos: [], equipado: false, ranura: null, origen: { tipo: 'desconocido' } } });
    await ARCANVEIL.jugar('le digo al mercader: ' + cebo);
  })()`);
  await wait(900);
  const xss = await evaluate(`({ ejecutado: window.__xss, etiquetas: document.querySelectorAll('img[src="x"], svg[onload], [onerror]').length, visible: document.body.textContent.includes('onerror') })`);
  if (xss.ejecutado || xss.etiquetas) throw new Error(`texto hostil convertido en HTML: ${JSON.stringify(xss)}`);
  if (!xss.visible) throw new Error('el texto hostil no aparece como texto en ninguna parte: la prueba no ha llegado a pintarlo');
  // Control: el mismo cebo metido como HTML sí se dispara. Si no, la prueba
  // de arriba no demostraba nada.
  await evaluate(`(() => { const d = document.createElement('div'); d.id = 'control-xss'; d.hidden = true; d.innerHTML = ${JSON.stringify(CEBO)}; document.body.append(d); })()`);
  await wait(400);
  const control = await evaluate(`(() => { const n = window.__xss; document.getElementById('control-xss')?.remove(); window.__xss = 0; return n; })()`);
  if (!control) throw new Error('el cebo no se dispara ni metido como HTML: la prueba de XSS no mide nada');
  await evaluate(`(() => { const n = ARCANVEIL.sistema('npcs'); const id = ARCANVEIL.ver('npcs.presentes', []).find((i) => /Cebo/.test(ARCANVEIL.ver('npcs.conocidos.porId.' + i + '.nombre') ?? '')); if (id) n.retirar?.(id); ARCANVEIL.store.dispatch('inventory/retirar', { idObjeto: 'itm_cebo' }); })()`);

  // ─── El estudio de retratos ─────────────────────────────────────────
  // Pintar solo cuando se pide; la candidata, privada; «Otra versión» pide
  // otra; «Usar esta versión» la guarda y se ve en la ficha. Con el
  // generador de verdad (el puente) y un proveedor falso: ni ComfyUI ni red.
  await evaluate(`document.querySelector('#pj-pintar').click()`);
  await until('document.querySelector("#estudio[open]")');
  if (sinIA) {
    await until('/No hay generador|no deja leer/.test(document.querySelector(".estudio__estado")?.textContent ?? "")', 8000);
    const sinGenerador = await evaluate(`({ pintar: document.querySelector('#estudio-pintar').disabled, estado: document.querySelector('.estudio__estado').textContent })`);
    if (!sinGenerador.pintar) throw new Error(`sin generador, el estudio deja pulsar Pintar: ${sinGenerador.estado}`);
    await evaluate(`document.querySelector('#estudio-cerrar').click()`);
    estudio = 'sin generador: lo dice y no pinta';
  } else if (puenteImagen) {
    await until('/Listo para pintar/.test(document.querySelector(".estudio__estado")?.textContent ?? "")', 8000);
    // Lo que dice antes de pintar es lo que pasa: con el generador local la
    // descripción no sale del PC, y las versiones quedan en una caché del
    // puente hasta cerrar. Antes decía «no se guarda ni se envía».
    const nota = await evaluate(`document.querySelector('#estudio-nota').textContent`);
    if (!/no sale del equipo/.test(nota) || !/caché temporal/.test(nota) || /no se guarda ni se envía/.test(nota)) throw new Error(`la nota del estudio no dice lo que pasa: «${nota}»`);
    await evaluate(`document.querySelector('#estudio-pintar').click()`);
    await until('document.querySelector("#estudio .estudio__candidata")?.complete', 10000);
    const primera = await evaluate(`(async () => ({ enFicha: Boolean(document.querySelector('#retrato-pj img.arte--aprobada')), galeria: await ${GALERIA} }))()`);
    if (primera.enFicha || primera.galeria.length) throw new Error(`la candidata salió antes de elegirla: ${JSON.stringify(primera)}`);
    if (enCache('pj_').length !== 1) throw new Error(`tras pintar, el puente tendría que tener una candidata en su caché: ${enCache().join(' ')}`);
    await evaluate(`document.querySelector('#estudio-otra').click()`);
    await until('/Versión 2/.test(document.querySelector(".estudio__estado")?.textContent ?? "")', 10000);
    if (enCache('pj_').length !== 2 || (await evaluate(GALERIA)).length) throw new Error('«Otra versión»: dos candidatas en caché y nada en la galería');
    await shot(`05-estudio-${viewport.label}.png`);
    await evaluate(`document.querySelector('#estudio-usar').click()`);
    await until('!document.querySelector("#estudio") && document.querySelector("#retrato-pj img.arte--aprobada")?.complete', 8000);
    if (generadas.length !== 2 || generadas[0] === generadas[1]) throw new Error(`el estudio no pidió dos versiones distintas: ${JSON.stringify(generadas)}`);
    if (!(await esperarCache(() => enCache().length === 0))) throw new Error(`al cerrar el estudio, las candidatas siguen en la caché del puente: ${enCache().join(' ')}`);
    const elegida = await evaluate(GALERIA);
    if (elegida.length !== 1 || !/^pj:/.test(elegida[0].clave)) throw new Error(`la versión elegida no está sola en la galería: ${JSON.stringify(elegida)}`);
    const srcElegida = await evaluate(`document.querySelector('#retrato-pj img.arte--aprobada').src`);

    // Otra vez al estudio: pintar y cerrar sin elegir no toca lo elegido.
    await evaluate(`document.querySelector('#pj-pintar').click()`);
    await until('/elegiste/.test(document.querySelector(".estudio__estado")?.textContent ?? "")', 8000);
    await evaluate(`document.querySelector('#estudio-pintar').click()`);
    await until('document.querySelector("#estudio .estudio__candidata")?.complete', 10000);
    await evaluate(`document.querySelector('#estudio-cerrar').click()`);
    await until('!document.querySelector("#estudio")', 5000);
    if (!(await esperarCache(() => enCache().length === 0))) throw new Error('cerrar sin elegir dejó la candidata en la caché del puente');
    const despues = await evaluate(GALERIA);
    const srcDespues = await evaluate(`document.querySelector('#retrato-pj img.arte--aprobada')?.src`);
    if (JSON.stringify(despues) !== JSON.stringify(elegida) || srcDespues !== srcElegida) throw new Error('una versión rechazada cambió el retrato elegido');

    // Con un proveedor en la nube, el estudio dice que el encargo sale del PC
    // y no pinta sin permiso. (Un doble con el nombre del proveedor: nada real.)
    await puenteImagen.cerrar();
    const nube = crearProxyImagen({ origen: `http://127.0.0.1:${PORT}`, cache: cacheImagen, proveedor: { id: 'cloudflare', salud: async () => ({ disponible: true }), generar: async ({ semilla }) => { generadas.push(semilla); return { bytes: PNG_1X1, tipo: 'image/png' }; } } });
    puenteImagen = await nube.escuchar().then(() => nube, () => null);
    if (!puenteImagen) throw new Error('no se pudo levantar el doble de nube en 11437');
    const antesNube = generadas.length;
    await evaluate(`document.querySelector('#pj-pintar').click()`);
    await until('/sale de tu equipo/.test(document.querySelector("#estudio-nota")?.textContent ?? "") && !document.querySelector("#estudio-permiso").closest("label").hidden', 8000);
    const sinPermiso = await evaluate(`document.querySelector('#estudio-pintar').disabled`);
    await evaluate(`document.querySelector('#estudio-permiso').click()`);
    const conPermiso = await evaluate(`document.querySelector('#estudio-pintar').disabled`);
    const textoPermiso = await evaluate(`document.querySelector('#estudio-permiso-texto').textContent`);
    await shot(`05b-estudio-nube-${viewport.label}.png`);
    await evaluate(`document.querySelector('#estudio-cerrar').click()`);
    if (!sinPermiso || conPermiso || !/cloudflare/.test(textoPermiso) || generadas.length !== antesNube) throw new Error(`con la nube, pintar sin permiso: ${JSON.stringify({ sinPermiso, conPermiso, textoPermiso })}`);
    estudio = 'pintar, otra versión y usar: en la ficha; cerrar olvida; nube con permiso';
  } else {
    await evaluate(`document.querySelector('#estudio-cerrar').click()`);
    estudio = 'omitido: el puerto 11437 lo usa otro programa';
  }

  // El grupo: reclutar a alguien de la escena, viajar con él, pelear juntos
  // y verlo en el parte.
  await evaluate(`(() => {
    const npcs = ARCANVEIL.sistema('npcs');
    if (!ARCANVEIL.ver('npcs.presentes', []).length) npcs.introducir({ nombre: 'Grom', rol: 'herrero', actitud: 'amable' });
    const id = ARCANVEIL.ver('npcs.presentes', [])[0];
    npcs.actualizar(id, { actitud: 100 });
  })()`);
  // La tirada de reclutar ya la fija la auditoría de coherencia; aquí se
  // prueba el recorrido (reclutar, viajar, pelear). Con seis intentos y el
  // dado de verdad fallaba una de cada quince veces: los personajes de
  // partida van cargados (−3) y la suerte decidía. Se fuerza el éxito solo
  // durante este paso y se devuelve el motor como estaba.
  const reclutado = await evaluate(`(async () => {
    const reglas = ARCANVEIL.sistema('rules');
    const resolver = reglas.resolver;
    reglas.resolver = (t) => ({ ...resolver.call(reglas, t), exito: true });
    try {
      const id = ARCANVEIL.ver('npcs.presentes', [])[0];
      const nombre = ARCANVEIL.ver('npcs.conocidos.porId.' + id + '.nombre');
      await ARCANVEIL.jugar(nombre + ', ¿vienes conmigo?');
      return { nombre, miembros: (ARCANVEIL.ver('party.miembros', []) ?? []).map((m) => m.refId), presentes: ARCANVEIL.ver('npcs.presentes', []) };
    } finally {
      reglas.resolver = resolver;
    }
  })()`);
  if (!reclutado.miembros.length) throw new Error(`nadie se unió al grupo: ${JSON.stringify(reclutado)}`);
  const panelGrupo = await evaluate(`document.querySelector('#grupo-pj, .grupo__miembro')?.textContent ?? ''`);
  if (!panelGrupo.includes(reclutado.nombre)) throw new Error('el compañero no sale en el lateral');

  const viajeGrupo = await evaluate(`(async () => {
    const destino = ARCANVEIL.sistema('world').lugarActual()?.plantilla?.conexiones?.[0]?.hasta;
    const antes = ARCANVEIL.ver('narrative.entradas', []).length;
    await ARCANVEIL.sistema('travel').viajar(destino, { forzar: true });
    return ARCANVEIL.ver('narrative.entradas', []).slice(antes).map((e) => e.texto ?? '').join(' ');
  })()`);
  if (!viajeGrupo.includes(`con ${reclutado.nombre}`)) throw new Error(`el viaje no lleva al compañero: «${viajeGrupo.slice(0, 160)}»`);

  await until('!ARCANVEIL.ver("combat.activo", false)', 8000);
  await evaluate(`window.__ataquesGrupo = []; ARCANVEIL.bus.on('combat:attack', (e) => window.__ataquesGrupo.push(e))`);
  await evaluate(`ARCANVEIL.bus.emit('combat:request', { enemies: [{ refId: 'saqueador', count: 2 }], playerAmbush: true })`);
  await until('ARCANVEIL.ver("combat.activo", false) && ARCANVEIL.sistema("combat").esperandoJugador', 8000);

  // Al compañero no se le apunta: ni el panel lo ofrece ni el motor acepta
  // un ataque contra él. El botón llegó a decir «Atacar a Cornis».
  const apuntado = await evaluate(`({
    elegibles: [...document.querySelectorAll('.luchador--elegible')].map((b) => b.dataset.luchador),
    marcado: document.querySelector('.luchador.es-objetivo')?.dataset.luchador ?? null,
    cara: Boolean(document.querySelector('[data-luchador^="companero_"] .luchador__cara .arte')),
  })`);
  if (apuntado.elegibles.some((id) => id.startsWith('companero_')) || apuntado.marcado?.startsWith('companero_')) {
    throw new Error(`el panel deja apuntar al compañero: ${JSON.stringify(apuntado)}`);
  }
  if (!apuntado.cara) throw new Error('el compañero sale sin cara en el combate');
  const golpeAlAliado = await evaluate(`(async () => {
    const id = Object.keys(ARCANVEIL.sistema('combat')._combatientes).find((k) => k.startsWith('companero_'));
    const antes = window.__ataquesGrupo.length;
    await ARCANVEIL.sistema('combat').accionJugador({ tipo: 'atacar', objetivo: id });
    return window.__ataquesGrupo.slice(antes).filter((e) => e.atacante?.esJugador).map((e) => e.objetivo?.id ?? e.objetivo);
  })()`);
  if (golpeAlAliado.some((id) => String(id).startsWith('companero_'))) {
    throw new Error(`el motor dejó al jugador atacar a su compañero: ${golpeAlAliado}`);
  }

  const peleaGrupo = await evaluate(`(async () => {
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25 && ARCANVEIL.ver('combat.activo', false); i += 1) {
      for (let k = 0; k < 40 && ARCANVEIL.ver('combat.activo', false) && !ARCANVEIL.sistema('combat').esperandoJugador; k += 1) await espera(100);
      if (!ARCANVEIL.ver('combat.activo', false)) break;
      await ARCANVEIL.jugar('le golpeo');
    }
    const { paraJugador } = await import('/src/combat/CombatLog.js');
    const suyos = window.__ataquesGrupo.filter((e) => e.atacante?.nombre === ${JSON.stringify(reclutado.nombre)});
    return { lineas: suyos.map(paraJugador), activo: ARCANVEIL.ver('combat.activo', false) };
  })()`);
  if (!peleaGrupo.lineas.length) throw new Error(`${reclutado.nombre} no actuó en el combate`);
  // Si el enemigo esquiva, el parte lo cuenta desde el enemigo («Saqueador A
  // esquiva el ataque de Bregard»): también es su acción, dicha con su
  // nombre. Exigir solo «ataca a» hacía fallar la prueba según el dado.
  const suyo = peleaGrupo.lineas[0];
  if (!(suyo.startsWith(`${reclutado.nombre} ataca a`) || suyo.includes(`el ataque de ${reclutado.nombre}`))) throw new Error(`el parte no cuenta al compañero: «${suyo}»`);
  if (peleaGrupo.activo) throw new Error('el combate del grupo no terminó');

  // La escena cambia al llegar y al pelear, y solo entonces se pide imagen.
  // Los treinta turnos anteriores no la cambiaron.
  const escenas = await evaluate('window.__escenas');
  for (const motivo of ['llegada', 'combate', 'fin_combate']) {
    if (!escenas.includes(motivo)) throw new Error(`no hubo cambio de escena por «${motivo}»: ${escenas.join(', ')}`);
  }

  // La cabecera se pliega a una franja, y se recuerda.
  const pliegue = await evaluate(`(async () => {
    const esc = document.getElementById('escena');
    const antes = esc.classList.contains('escena--plegada');
    document.getElementById('escena-plegar').click();
    await new Promise((r) => setTimeout(r, 50));
    const despues = document.getElementById('escena').classList.contains('escena--plegada');
    const guardado = JSON.parse(localStorage.getItem('arcanveil:prefs:juego') ?? '{}').escenaPlegada;
    document.getElementById('escena-plegar').click();
    return { antes, despues, guardado };
  })()`);
  if (pliegue.antes === pliegue.despues || pliegue.guardado !== pliegue.despues) throw new Error(`plegar la escena no funciona: ${JSON.stringify(pliegue)}`);

  // Ninguna ilustración pedida por su cuenta: la cabecera es el paisaje.
  const cabecera = await evaluate(`({
    miniaturas: ARCANVEIL.ver('narrative.entradas', []).filter((e) => e.voz === 'escena').length,
    paisaje: Boolean(document.querySelector('#escena-lienzo svg, #escena-lienzo .arte')),
  })`);
  if (cabecera.miniaturas) throw new Error('apareció una ilustración de escena sin pedirla');
  if (!cabecera.paisaje) throw new Error('la cabecera se quedó sin paisaje');

  // El retrato vale por cualquiera de sus dos vías.
  //
  // Esto buscaba `.retrato-rasgo--cicatriz`, que solo existe en el retrato
  // vectorial. Con el retrato de IA cargado ese nodo no está —la imagen
  // sustituye al SVG entero— y la prueba fallaba con «el rasgo visual no llegó
  // a la partida» teniendo el retrato delante. El juego no estaba roto: la
  // prueba se había quedado atrás.
  //
  // Lo que importa es que la cara del personaje esté puesta, por la vía que
  // sea. Se aceptan las dos y el informe dice cuál fue.
  const libre = await evaluate(`(() => ({
    texto: ARCANVEIL.ver('narrative.entradas', []).map(e => e.texto ?? '').join(' '),
    marcador: Boolean(document.querySelector('#retrato-pj .marcador-arte')),
    aprobado: Boolean(document.querySelector('#retrato-pj img.arte--aprobada')),
  }))()`);

  if (/intentas\s+anoto/i.test(libre.texto)) throw new Error('acción libre mal integrada');
  if (!libre.marcador && !libre.aprobado) throw new Error('en la partida no hay ni retrato elegido ni marcador');

  // ─── Caer detiene la partida de verdad ──────────────────────────────
  //
  // El fallo que esto sujeta: la caída pintaba «la crónica termina aquí» y la
  // crónica seguía. La fase volvía a `exploracion`, la caja quedaba activa y
  // cada «ataco» abría un combate nuevo con el personaje a cero de vida.
  //
  // Se golpea hasta tres veces: algunos linajes y oficios tienen un rasgo que
  // salva de la primera caída y deja al personaje a 1 de vida. Es un rasgo de
  // juego, no un fallo; lo que se comprueba es que, gastado el salvavidas,
  // caer sí termina la partida. Con un solo golpe la prueba dependía de lo
  // que hubiera salido en el dado de la ficha.
  for (let golpe = 0; golpe < 3; golpe += 1) {
    await evaluate(`ARCANVEIL.store.dispatch('player/danar', { cantidad: 999, origen: 'regresion' })`);
    await wait(300);
    if (await evaluate(`ARCANVEIL.store.select('meta.fase')`) === 'fin') break;
  }
  await wait(600);

  const caida = await evaluate(`({
    fase: ARCANVEIL.store.select('meta.fase'),
    modal: !document.getElementById('caida-modal').hidden,
    entrada: document.getElementById('entrada').disabled,
    salidas: [...document.querySelectorAll('#caida-acciones button')].length,
  })`);

  if (caida.fase !== 'fin') {
    const diag = await evaluate(`({
      vida: ARCANVEIL.store.select('player.vida'), estados: ARCANVEIL.store.select('player.estados'),
      usos: ARCANVEIL.store.select('player.usosRasgos'), combate: ARCANVEIL.store.select('combat.activo'),
      clase: ARCANVEIL.store.select('player.clase'), raza: ARCANVEIL.store.select('player.raza'),
      ultimas: ARCANVEIL.ver('narrative.entradas', []).slice(-5).map((e) => e.voz + ': ' + e.texto),
    })`);
    throw new Error(`al caer, la fase quedó en ${caida.fase}: ${JSON.stringify(diag)}`);
  }
  if (!caida.modal) throw new Error('al caer no se abrió la salida');
  if (!caida.entrada) throw new Error('al caer, la caja de texto siguió activa');
  if (caida.salidas < 2) throw new Error(`al caer solo había ${caida.salidas} salidas`);

  // Escape no la cierra: sin elegir salida, el jugador se quedaba sin nada
  // que pulsar y con la caja bloqueada.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const trasEscape = await evaluate(`!document.getElementById('caida-modal').hidden`);
  if (!trasEscape) throw new Error('Escape cerró la pantalla de caída');

  // Y el turno tiene que estar cerrado: nada de abrir combates desde el suelo.
  const desdeElSuelo = await evaluate(`ARCANVEIL.jugar('ataco al primer bandido que vea').then(() => ({
    combate: ARCANVEIL.store.select('combat.activo'),
    fase: ARCANVEIL.store.select('meta.fase'),
  }))`);
  if (desdeElSuelo.combate) throw new Error('caído, «ataco» abrió un combate');
  // El turno que acaba de terminar no reabre la caja: al acabar llamaba a
  // `bloquear(false)` y la caída quedaba con la caja activa detrás.
  if (!await evaluate(`document.getElementById('entrada').disabled`)) {
    throw new Error('caído, un turno terminado volvió a abrir la caja de texto');
  }

  await evaluate(`[...document.querySelectorAll('#caida-acciones button')].find(b => /volver/i.test(b.textContent))?.click()`);
  await wait(1200);

  const revivido = await evaluate(`({
    fase: ARCANVEIL.store.select('meta.fase'),
    vida: ARCANVEIL.store.select('player.vida.actual'),
    entrada: document.getElementById('entrada').disabled,
  })`);

  if (revivido.fase !== 'exploracion' || revivido.vida !== 1 || revivido.entrada) {
    throw new Error(`«Volver en ti» dejó ${JSON.stringify(revivido)}`);
  }

  // La segunda caída de la sesión también detiene la partida. El aviso se
  // guardaba con una marca que solo se rearmaba al crear personaje: tras
  // volver en ti, caer otra vez dejaba la fase en `fin` sin pantalla y con
  // la caja abierta.
  for (let golpe = 0; golpe < 3; golpe += 1) {
    await evaluate(`ARCANVEIL.store.dispatch('player/danar', { cantidad: 999, origen: 'regresion' })`);
    await wait(300);
    if (await evaluate(`ARCANVEIL.store.select('meta.fase')`) === 'fin') break;
  }
  await wait(400);
  const segunda = await evaluate(`({
    fase: ARCANVEIL.store.select('meta.fase'),
    modal: !document.getElementById('caida-modal').hidden,
    entrada: document.getElementById('entrada').disabled,
  })`);
  if (segunda.fase !== 'fin' || !segunda.modal || !segunda.entrada) {
    throw new Error(`la segunda caída no detuvo la partida: ${JSON.stringify(segunda)}`);
  }
  await evaluate(`[...document.querySelectorAll('#caida-acciones button')].find(b => /volver/i.test(b.textContent))?.click()`);
  await wait(1200);

  // La jugada escrita cuenta en combate: «le lanzo arena a los ojos y le
  // golpeo» es un ataque con +1 por usar la escena, y el enemigo enseña su
  // ficha. Va al final porque el combate se queda abierto: la recarga sin red
  // de después lo descarta, que no se guarda.
  // Si el saqueador esquiva, no hay tirada donde se vea el +1 (y, cobarde,
  // huye después): no es un fallo de la jugada, es el dado. Pasaba en 2 de
  // cada 40 combates y tumbaba la regresión. Se repite con otro combate.
  let jugada = null;
  for (let intento = 0; intento < 4; intento += 1) {
    await evaluate(`ARCANVEIL.store.dispatch('player/curar', { cantidad: 99, origen: 'regresion' })`);
    await evaluate(`ARCANVEIL.bus.emit('combat:request', { enemies: [{ refId: 'saqueador', count: 1 }], playerAmbush: true })`);
    await until('ARCANVEIL.ver("combat.activo", false) && ARCANVEIL.sistema("combat").esperandoJugador', 8000);
    const fichaRival = await evaluate(`document.querySelector('#combate-habilidades')?.textContent ?? ''`);
    if (!/Machete/.test(fichaRival)) throw new Error(`la ficha del enemigo no enseña sus armas: «${fichaRival}»`);

    // Se escucha el ataque al vuelo: si el saqueador huye tras el golpe (es
    // cobarde), el combate termina y su registro se vacía antes de poder leerlo.
    await evaluate(`window.__ataques = []; ARCANVEIL.bus.on('combat:attack', (e) => window.__ataques.push(e))`);
    await evaluate(`ARCANVEIL.jugar('le lanzo arena a los ojos y le golpeo')`);
    jugada = await evaluate(`(() => {
      const e = window.__ataques.find((x) => x.atacante?.esJugador);
      return e ? { creativo: e.tirada?.creativo ?? null, resultado: e.resultado } : null;
    })()`);
    if (!(jugada?.resultado === 'esquivado' && jugada.creativo === null)) break;
    await until('!ARCANVEIL.ver("combat.activo", false)', 8000).catch(() => {});
  }
  if (!jugada) {
    const diag = await evaluate(`(() => { const cm = ARCANVEIL.sistema('combat'); return {
      activo: ARCANVEIL.ver('combat.activo', false), esperando: cm.esperandoJugador,
      registro: cm._registro.map((x) => x.tipo + ':' + (x.atacante?.nombre ?? x.nombre ?? '')),
      entrada: document.getElementById('entrada').disabled, fase: ARCANVEIL.ver('meta.fase'),
      ultimas: ARCANVEIL.ver('narrative.entradas', []).slice(-4).map((e) => e.voz + ': ' + e.texto),
    }; })()`);
    throw new Error(`la jugada escrita no llegó a atacar: ${JSON.stringify(diag)}`);
  }
  if (jugada.creativo !== 1) throw new Error(`«le lanzo arena a los ojos y le golpeo» dio ${jugada.creativo} en vez de +1`);

  const beforeOffline = await evaluate(`navigator.serviceWorker.ready.then(()=>({controlled:Boolean(navigator.serviceWorker.controller),lines:ARCANVEIL.ver('narrative.entradas',[]).length}))`);
  await wait(700);
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp('Page.reload', { ignoreCache: false });
  await until('window.ARCANVEIL?.motor?.listo && document.body.classList.contains("esta-listo")', 15000);
  const offline = await evaluate(`({screen:document.body.dataset.activeScreen, title:document.title, failures:document.querySelectorAll('#fallos .fallos__linea').length})`);
  await shot(`04-offline-${viewport.label}.png`);
  if (offline.title !== 'ARCANVEIL' || offline.failures) throw new Error(`offline inválido ${JSON.stringify(offline)}`);

  // El retrato elegido sigue ahí sin red y tras recargar: vive en el
  // navegador (IndexedDB), no en una dirección de fuera ni en un blob muerto.
  if (estudio.startsWith('pintar')) {
    const guardadas = await evaluate(`new Promise((ok) => { const p = indexedDB.open('arcanveil-imagenes'); p.onsuccess = () => { const q = p.result.transaction('aprobadas').objectStore('aprobadas').getAllKeys(); q.onsuccess = () => ok(q.result); q.onerror = () => ok([]); }; p.onerror = () => ok([]); })`);
    if (!guardadas.some((k) => /^pj:/.test(k))) throw new Error(`sin red y tras recargar, el retrato elegido no está en el navegador: ${JSON.stringify(guardadas)}`);
    // Y se ve: en la lista de personajes, con su imagen y no con el marcador.
    await evaluate(`document.querySelector('#menu-nueva').click()`);
    await until('document.querySelector("img.arte--aprobada")?.complete && document.querySelector("img.arte--aprobada").naturalWidth > 0', 8000);
    await shot(`06-retrato-sin-red-${viewport.label}.png`);
  }

  if (externos.length) throw new Error(`la página pidió cosas fuera de este equipo: ${[...new Set(externos)].slice(0, 5).join(' · ')}`);

  const report = {
    viewport: viewport.label, systems: boot.systems, turns: turns.length,
    maxLogLines: Math.max(...turns.map(t => t.lines)),
    exceptions: exceptions.length, serviceWorkerControlled: beforeOffline.controlled,
    offlineScreen: offline.screen, failures: offline.failures,
    retrato: libre.aprobado ? 'elegido' : 'marcador',
    estudio,
    externos: externos.length,
    sinIA,
  };
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e.stack || e);
  if (serverErr) console.error('server:', serverErr.slice(-1000));
  if (chromeErr) console.error('chrome:', chromeErr.slice(-1000));
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  await pararPuenteImagen();
  await stop();
}