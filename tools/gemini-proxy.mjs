#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/gemini-proxy.mjs
 * ---------------------------------------------------------------------------
 * Puente local a Gemini: la clave vive en este proceso y el navegador habla
 * con 127.0.0.1 en formato OpenAI.
 *
 * Mismas defensas que el puente de Groq (y por las mismas razones):
 *
 *   · Host exacto (127.0.0.1 o localhost con este puerto): una web con un DNS
 *     que apunte aquí llega con su propio nombre y se queda fuera.
 *   · Origen exacto: sin él, cualquier web abierta podía mandar un POST
 *     `text/plain` (sin preflight), el puente lo parseaba igual y llamaba a
 *     Gemini con la clave del jugador. No leía la respuesta, pero gastaba.
 *   · Solo JSON, cuerpo acotado, modelos permitidos (el cliente elegía
 *     cualquiera, también los caros) y topes de uso.
 *
 *   GEMINI_API_KEY=… node tools/gemini-proxy.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SERVICIO_GEMINI = 'arcanveil-puente-gemini/1';
export const MODELOS_GEMINI = Object.freeze(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
export const LIMITES_GEMINI = Object.freeze({ maxCuerpo: 512 * 1024, enCurso: 2, porMinuto: 20, esperaMs: 60_000 });
const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * @param {Object} opciones
 * @param {string} opciones.clave
 * @param {string} opciones.origen Origen exacto de la app.
 * @param {number} [opciones.puerto=11435] 0 para uno libre (pruebas).
 * @param {string} [opciones.upstream] Base de la API (pruebas: un Gemini falso en 127.0.0.1).
 * @param {Object} [opciones.limites]
 */
export function crearProxyGemini({ clave, origen, puerto = 11435, upstream = UPSTREAM, limites = {} }) {
  // La clave solo sale hacia Google, o hacia un doble de pruebas en esta máquina.
  if (upstream !== UPSTREAM && !/^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(upstream)) throw new Error('upstream no permitido');
  const L = { ...LIMITES_GEMINI, ...limites };
  let hosts = new Set();
  let enCurso = 0;
  const minuto = [];

  const cabeceras = () => ({
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const responder = (res, estado, cuerpo) => { res.writeHead(estado, cabeceras()); res.end(JSON.stringify(cuerpo)); };
  const fallo = (res, estado, mensaje) => responder(res, estado, { servicio: SERVICIO_GEMINI, error: { message: mensaje } });
  // Un rechazo de Host u Origen no lleva cabeceras CORS: no se le da nada
  // que leer a quien no debe.
  const rechazo = (res, estado, mensaje) => {
    res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ servicio: SERVICIO_GEMINI, error: { message: mensaje } }));
  };

  const leer = (req) => new Promise((ok, no) => {
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', (b) => {
      texto += b;
      if (texto.length > L.maxCuerpo) { no(Object.assign(new Error('Petición demasiado grande.'), { estado: 413 })); req.destroy(); }
    });
    req.on('end', () => { try { ok(JSON.parse(texto || '{}')); } catch { no(Object.assign(new Error('JSON no válido.'), { estado: 400 })); } });
    req.on('error', no);
  });

  async function completar(req, res) {
    const ahora = Date.now();
    while (minuto.length && ahora - minuto[0] > 60_000) minuto.shift();
    if (minuto.length >= L.porMinuto) return fallo(res, 429, 'Tope por minuto de este puente. Espera un poco.');
    if (enCurso >= L.enCurso) return fallo(res, 429, 'Ya hay peticiones en curso.');

    let entrada;
    try { entrada = await leer(req); } catch (e) { return fallo(res, e.estado ?? 400, e.message); }

    const modelo = String(entrada.model || MODELOS_GEMINI[0]);
    if (!MODELOS_GEMINI.includes(modelo)) return fallo(res, 400, `Modelo no permitido en este puente: ${modelo.slice(0, 60)}.`);
    if (!Array.isArray(entrada.messages) || !entrada.messages.length) return fallo(res, 400, 'Faltan los mensajes.');

    minuto.push(ahora);
    enCurso += 1;
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), L.esperaMs);
    res.on('close', () => { if (!res.writableEnded) control.abort(); });
    try {
      const sistema = entrada.messages.filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n\n');
      const contents = entrada.messages.filter((m) => m?.role !== 'system')
        .map((m) => ({ role: m?.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m?.content ?? '') }] }));
      const temperatura = Number.isFinite(entrada.temperature) ? Math.min(Math.max(entrada.temperature, 0), 1.5) : 0.8;
      const maximo = Number.isInteger(entrada.max_tokens) ? Math.min(Math.max(entrada.max_tokens, 1), 4000) : 1600;
      const respuesta = await fetch(`${upstream}/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        signal: control.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
        body: JSON.stringify({
          systemInstruction: sistema ? { parts: [{ text: sistema }] } : undefined,
          contents,
          generationConfig: { temperature: temperatura, maxOutputTokens: maximo, responseMimeType: 'application/json' },
        }),
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) return fallo(res, respuesta.status, datos?.error?.message ?? 'Gemini rechazó la petición.');
      const texto = datos?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return responder(res, 200, { id: `gemini-${Date.now()}`, object: 'chat.completion', model: modelo, choices: [{ index: 0, message: { role: 'assistant', content: texto }, finish_reason: 'stop' }] });
    } catch (e) {
      const agotado = e?.name === 'AbortError';
      return fallo(res, agotado ? 504 : 502, agotado ? 'Gemini tardó demasiado.' : 'No se pudo hablar con Gemini.');
    } finally {
      clearTimeout(reloj);
      enCurso -= 1;
    }
  }

  const servidor = createServer(async (req, res) => {
    if (!hosts.has(String(req.headers.host ?? ''))) return rechazo(res, 421, 'Host no permitido.');
    if (req.headers.origin !== origen) return rechazo(res, 403, 'Origen no permitido.');
    const ruta = String(req.url ?? '').split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204, cabeceras()); return res.end(); }
    if (req.method === 'GET' && ruta === '/estado') return responder(res, 200, { servicio: SERVICIO_GEMINI, modelos: MODELOS_GEMINI });
    if (req.method === 'GET' && ruta === '/v1/models') return responder(res, 200, { object: 'list', data: MODELOS_GEMINI.map((id) => ({ id, object: 'model' })) });
    if (req.method === 'POST' && ruta === '/v1/chat/completions') {
      if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return fallo(res, 415, 'Se espera JSON.');
      return completar(req, res);
    }
    return fallo(res, 404, 'Ruta no encontrada.');
  });
  servidor.headersTimeout = 15_000;
  servidor.requestTimeout = 90_000;

  return {
    servidor,
    escuchar: () => new Promise((ok, no) => {
      servidor.once('error', no);
      servidor.listen(puerto, '127.0.0.1', () => {
        const real = servidor.address().port;
        hosts = new Set([`127.0.0.1:${real}`, `localhost:${real}`]);
        ok(real);
      });
    }),
    cerrar: () => new Promise((ok) => servidor.close(() => ok())),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) {
    console.error('Falta GEMINI_API_KEY. Define la variable antes de arrancar.');
    process.exit(1);
  }
  const puerto = Number(process.env.GEMINI_PROXY_PORT) || 11435;
  const origen = process.env.ARCANVEIL_ORIGIN?.trim() || 'http://localhost:8080';
  crearProxyGemini({ clave, origen, puerto }).escuchar().then((real) => {
    console.log(`Proxy seguro de Gemini: http://127.0.0.1:${real} (solo para ${origen})`);
    console.log('La clave solo vive en este proceso y nunca llega al navegador.');
  }, (e) => {
    console.error(e.code === 'EADDRINUSE' ? `El puerto ${puerto} ya está ocupado por otro programa.` : `No se pudo arrancar: ${e.message}`);
    process.exitCode = 1;
  });
}
