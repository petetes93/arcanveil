#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/iniciar-groq.mjs
 * ---------------------------------------------------------------------------
 * Arranca la app y el puente de Groq con un solo comando:
 *
 *   node tools/iniciar-groq.mjs
 *
 * La clave se pide aquí, sin eco: no se ve al teclearla ni al pegarla, no
 * queda en el historial de la terminal (no va en la línea de comandos ni en
 * una variable de entorno) y no se escribe en disco. Vive en la memoria de
 * este proceso y muere con Ctrl+C. El servidor de la app corre en un proceso
 * hijo que NO la hereda.
 *
 * Antes de pedirla, se pide confirmar que la cuenta está en la capa Free
 * sin método de pago. Este programa no puede comprobarlo por ti: la API de
 * Groq no expone la facturación. Lo compruebas tú en console.groq.com.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { crearProxyGroq, carpetaDatos, trazadorArchivo, MODELO_PERMITIDO, LIMITES_LOCALES } from './groq-proxy.mjs';

/**
 * ¿Se puede escuchar en este puerto de 127.0.0.1?
 *
 * Se mira antes de pedir nada: con el puerto ocupado, el puente reventaba
 * con un EADDRINUSE después de haber pegado la clave.
 *
 * @param {number} puerto
 * @returns {Promise<boolean>}
 */
export function puertoLibre(puerto) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(puerto, '127.0.0.1', () => s.close(() => ok(true)));
  });
}

/**
 * Lee una línea sin mostrarla. Admite pegar de golpe, borrar y Ctrl+C.
 *
 * @param {NodeJS.ReadStream} entrada
 * @param {NodeJS.WriteStream} salida
 * @param {string} pregunta
 * @returns {Promise<string>}
 */
export function leerOculto(entrada, salida, pregunta) {
  return new Promise((ok, no) => {
    if (!entrada.isTTY || typeof entrada.setRawMode !== 'function') {
      no(new Error('La clave solo se puede escribir en una terminal interactiva (no por tubería ni por archivo).'));
      return;
    }
    salida.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let valor = '';
    const terminar = (error) => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', alTeclear);
      salida.write('\n');
      if (error) no(error); else ok(valor);
    };
    function alTeclear(trozo) {
      const r = procesarTeclas(valor, trozo);
      valor = r.valor;
      if (r.cancelado) terminar(new Error('Cancelado.'));
      else if (r.hecho) terminar(null);
    }
    entrada.on('data', alTeclear);
  });
}

/**
 * Aplica un trozo de teclas a lo escrito. Pura, para poder probarla.
 *
 * @param {string} valor
 * @param {string} trozo
 * @returns {{valor: string, hecho: boolean, cancelado: boolean}}
 */
export function procesarTeclas(valor, trozo) {
  let v = valor;
  // Las terminales envuelven lo pegado en marcas (ESC[200~ … ESC[201~) y
  // las flechas son secuencias de escape: nada de eso es parte de la clave.
  const limpio = String(trozo).replace(/\u001b\[[0-9;]*[~A-Za-z]/g, '').replace(/\u001b./g, '');
  for (const c of limpio) {
    if (c === '\u0003') return { valor: '', hecho: false, cancelado: true };   // Ctrl+C
    if (c === '\r' || c === '\n') return { valor: v, hecho: true, cancelado: false };
    if (c === '\u0008' || c === '\u007f') { v = v.slice(0, -1); continue; }  // borrar
    if (c === '\u0015') { v = ''; continue; }                                 // Ctrl+U
    if (c < ' ') continue;                                                    // otros controles
    v += c;
  }
  return { valor: v, hecho: false, cancelado: false };
}

/** Pregunta visible de sí o no. */
function preguntar(entrada, salida, texto) {
  return new Promise((ok) => {
    salida.write(texto);
    entrada.resume();
    entrada.setEncoding('utf8');
    entrada.once('data', (d) => { entrada.pause(); ok(String(d).trim().toLowerCase()); });
  });
}

async function principal() {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const puertoApp = Number(process.env.ARCANVEIL_PORT) || 8080;
  const puertoPuente = Number(process.env.GROQ_PROXY_PORT) || 11436;
  const origen = `http://localhost:${puertoApp}`;
  const datos = carpetaDatos();

  for (const [puerto, quien, variable] of [[puertoPuente, 'el puente de Groq', 'GROQ_PROXY_PORT'], [puertoApp, 'la app', 'ARCANVEIL_PORT']]) {
    if (!(await puertoLibre(puerto))) {
      console.error(`\nEl puerto ${puerto} (${quien}) ya lo usa otro programa: ¿otro puente o la app ya abiertos en otra ventana?`);
      console.error(`Ciérralo, o elige otro puerto con la variable ${variable}. No se ha pedido ni enviado nada.`);
      process.exit(1);
    }
  }

  console.log(`
ARCANVEIL · narrador con IA Groq (${MODELO_PERMITIDO})

Qué sale de tu equipo: en cada turno, el contexto narrativo (el lugar, quién
está, lo que ha pasado y lo que escribes). No se envían claves, partidas
guardadas ni datos de tu equipo. Groq no entrena con ello; puede guardarlo
hasta 30 días por fiabilidad o abuso salvo que actives «Zero Data Retention»
en Data Controls de tu cuenta. Recomendado: actívalo.

Topes de este puente (por debajo de la capa Free): ${LIMITES_LOCALES.porMinuto}/min,
${LIMITES_LOCALES.porDia}/día, ${LIMITES_LOCALES.tokensDia.toLocaleString('es-ES')} tokens/día. Si se agotan, el juego sigue
con el narrador procedural.
`);

  const confirmado = await preguntar(process.stdin, process.stdout,
    '¿Has comprobado en console.groq.com que tu cuenta está en el plan Free,\nsin método de pago y sin facturación activa? Escribe «si» para seguir: ');
  if (!['si', 'sí'].includes(confirmado)) {
    console.log('\nSin esa comprobación no se arranca. Nada se ha enviado.');
    process.exit(1);
  }

  let clave;
  try {
    clave = (await leerOculto(process.stdin, process.stdout, 'Pega la clave de Groq (no se verá) y pulsa Intro: ')).trim();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  let puente;
  try {
    puente = crearProxyGroq({
      clave,
      puerto: puertoPuente,
      origen,
      rutaUso: join(datos, 'groq-uso.json'),
      trazar: trazadorArchivo(join(datos, 'groq-trazas.jsonl')),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  clave = null;

  try {
    await puente.escuchar();
  } catch (e) {
    // Alguien lo ocupó entre la comprobación y ahora.
    console.error(e.code === 'EADDRINUSE' ? `\nEl puerto ${puertoPuente} se ha ocupado mientras tanto. Vuelve a intentarlo.` : `\nNo se pudo arrancar el puente: ${e.message}`);
    process.exit(1);
  }
  console.log(`\nPuente de Groq en http://127.0.0.1:${puertoPuente} (la clave no sale de este proceso).`);
  console.log(`Juega en ${origen}/app/index.html o en http://127.0.0.1:${puertoApp}/app/index.html: el puente acepta las dos.`);
  console.log(`Trazas sin contenido en ${join(datos, 'groq-trazas.jsonl')}`);

  // La app, en un proceso aparte que no ve nada de Groq.
  const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/GROQ|API_KEY|TOKEN|SECRET/i.test(k)));
  const app = spawn(process.execPath, ['tools/servir.mjs', '--puerto', String(puertoApp)], { cwd: raiz, env: entorno, stdio: 'inherit' });
  console.log(`ARCANVEIL en ${origen}/app/index.html · Ctrl+C para cerrar todo.`);

  const cerrar = async (codigo = 0) => {
    app.kill();
    await puente.cerrar();
    process.exit(codigo);
  };
  app.on('exit', (c) => { if (c) cerrar(c); });
  process.on('SIGINT', () => cerrar(0));
  process.on('SIGTERM', () => cerrar(0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
