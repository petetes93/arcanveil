/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/medir-narrador.mjs
 * ---------------------------------------------------------------------------
 * ¿El narrador sin modelo cuenta una historia o baraja frases?
 *
 * Juega partidas comparables con el motor entero (ver `motor-sin-ventana.mjs`)
 * y mide lo que se nota jugando: frases que se repiten, coletillas, preguntas
 * contestadas con información de verdad, resultados genéricos y variación de
 * ritmo. Tres personajes con semillas distintas y dos maneras de jugar:
 * contemplativa e impulsiva, veintidós turnos cada una.
 *
 * Los textos llevan comodines que se resuelven con el estado de la partida
 * ({pnj}, {actor}, {cosa}, {vecino}), así que el mismo guion sirve en ramas
 * distintas y mide lo mismo.
 *
 *   node tools/medir-narrador.mjs                # resumen
 *   node tools/medir-narrador.mjs --json out.json
 *   node tools/medir-narrador.mjs --transcripciones carpeta/
 *   node tools/medir-narrador.mjs --ia-simulada   # el camino de la IA con un
 *     modelo simulado que mete contradicciones a propósito (ver
 *     narrador-simulado.mjs): mide lo que se cuela, no la calidad de un modelo
 *   node tools/medir-narrador.mjs --groq --partida 1 --pausa-ms 25000
 *     con el puente de Groq arrancado (node tools/iniciar-groq.mjs) y el
 *     consentimiento dado: partidas REALES. Gastan cuota: unas 45 peticiones
 *     por partida y hasta ~4.000 tokens cada una (menos con la política en
 *     caché). Las seis no caben en un día de la capa Free: de una en una o
 *     de dos en dos, con --partida 1..6.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearMotor } from './motor-sin-ventana.mjs';
import { obtenerEncuentro } from '../src/world/EncounterTables.js';
import { modeloAdversario, conectar, MARCAS } from './narrador-simulado.mjs';
import { atiende, pideRespuesta, soloEco } from './atencion.mjs';

const simulada = process.argv.includes('--ia-simulada');
const conGroq = process.argv.includes('--groq');
const trasArg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const soloPartida = Number(trasArg('--partida')) || null;
const pausaMs = Number(trasArg('--pausa-ms')) || 0;
let modelo = null;
let trazasIA = [];

const argumento = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

/** Personajes ficticios: nada de partidas reales. */
const PERSONAJES = [
  { semilla: 7412, ficha: { nombre: 'Iselda', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante', genero: 'f', retrato: 'mujer delgada de capa gris', lore: 'Mi hermano desapareció cruzando el paso del norte. Llevo su anillo.' } },
  { semilla: 20260925, ficha: { nombre: 'Brunhilda', raza: 'ferrano', clase: 'vinculado', trasfondo: 'superviviente', genero: 'f', retrato: 'enana de barba trenzada', lore: 'Perdí la forja de mi padre en un incendio. Busco al que la quemó.' } },
  { semilla: 31337, ficha: { nombre: 'Oren', raza: 'menudo', clase: 'sombra', trasfondo: 'criminal', genero: 'm', retrato: 'menudo de ojos rápidos y capa remendada', lore: 'Debo dinero a gente que no perdona. Vine al valle a desaparecer.' } },
];

/** Lo que se toca en cada situación, para decirlo con palabras. */
const COSA = {
  carro_atascado: 'el carro', colgante_en_el_pozo: 'el pozo', encapuchado_vigila: 'el tejado',
  balanza_trucada: 'la balanza', cabra_escapada: 'la cabra', buhonero_herido: 'el fardo del buhonero',
};

/** Pregunta: qué tiene que aparecer para contar como contestada. */
const PREGUNTA = /\ble pregunto\b|\?/i;

const CONTEMPLATIVO = [
  'miro alrededor',
  'me fijo en {cosa}',
  'le pregunto a {pnj} por {vecino}',
  'escucho lo que se habla en la calle',
  'miro el río',
  'Ignoro a {actor}; observo a la gente que pasa',
  'le pregunto a {pnj} quién manda aquí',
  'le pregunto a {pnj} otra vez por {vecino}',
  'me siento a descansar y pienso en lo que dejé atrás',
  'examino el puente con calma',
  '@guardar',
  'le pregunto a {actor} qué le ha pasado',
  'me acerco a {cosa}',
  'Le digo a {pnj}: «No voy a darte nada». Luego espero',
  'si {pnj} insiste, me voy',
  'miro alrededor',
  'le pregunto a {pnj} por el camino a {vecino}',
  'espero',
  'vuelvo junto a {cosa} y miro qué ha cambiado',
  'le pregunto a {pnj} si ha visto pasar a algún forastero',
  'me propongo averiguar qué pasa en {vecino}',
  'miro alrededor',
];

const IMPULSIVO = [
  'ayudo a {actor} con {cosa}',
  'le exijo a {pnj} que me diga dónde está {vecino}',
  'empujo a {actor} a un lado',
  'corro hacia el puente',
  '@patrulla',
  'les ofrezco dos monedas para que me dejen pasar',
  'les digo que se aparten o les parto la cara',
  'ataco al primer guardia',
  '@combate',
  'le pregunto a {pnj} por {vecino}',
  '@guardar',
  'trepo al pretil del puente',
  'le grito a {actor} que se largue',
  'fuerzo la puerta de la posada',
  'le pregunto a {pnj} qué le ha pasado',
  'vuelvo a {cosa}',
  'intento partir el puente de un puñetazo',
  'Le digo a {pnj}: «Si me mientes, te arrepentirás»',
  'le pregunto a {pnj} otra vez por {vecino}',
  'bebo agua del río',
  'miro alrededor',
  'me propongo encontrar al ladrón del mercado',
];

/** Frases hechas que se aprenden a saltar en pocos turnos. */
const COLETILLAS = [
  /La decisión es tuya/i, /Algo cruje a tu espalda/i, /no te quita ojo/i, /te mira, esperando/i,
  /Ves lo principal/i, /mira alrededor antes de responder/i, /Ni idea\. Aquí cada uno/i,
  /Algo se dice/i, /Y añade algo que no esperabas/i, /y no termina la frase/i,
  /Se te ocurre que llevas más tiempo/i, /Piensas en .+ y en lo que falta por saber/i,
  /como si la palabra pesara/i, /Eso queda lejos de mis asuntos/i,
];

/** Resultados que valen para cualquier acción. */
const GENERICOS = [
  /^Ves lo principal/i, /^Nada fuera de lo corriente/i, /^Todo encaja a la primera/i,
  /^No consigues situarlo/i, /^Se te escapa/i, /^Lo consigues\.?$/i, /^No lo consigues\.?$/i,
  /^Haces lo que has decidido/i, /^Tú dirás/i,
];

const media = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
const desviacion = (l) => { const m = media(l); return Math.sqrt(media(l.map((x) => (x - m) ** 2))); };

/** ¿Dos frases distintas dicen casi lo mismo? Trigramas de palabras. */
function parecidas(a, b) {
  const tri = (t) => {
    const p = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ\s]/g, ' ').split(/\s+/).filter(Boolean);
    const s = new Set();
    for (let i = 0; i + 2 < p.length; i += 1) s.add(p.slice(i, i + 3).join(' '));
    return s;
  };
  const x = tri(a);
  const y = tri(b);
  if (x.size < 2 || y.size < 2) return false;
  let comun = 0;
  for (const t of x) if (y.has(t)) comun += 1;
  return comun / Math.min(x.size, y.size) >= 0.8;
}

function frases(texto) {
  return String(texto)
    .split('\n')
    .filter((l) => l && !l.startsWith('»'))
    .flatMap((l) => l.split(/(?<=[.!?…»])\s+(?=[A-ZÁÉÍÓÚÑ¿«])/u))
    .map((f) => f.trim())
    .filter((f) => f.length > 3 && !/^¿Qué haces\?$/.test(f));
}

async function jugarPartida(m, personaje, estilo, guion) {
  m.store.reiniciar();
  const apertura = await m.empezar(personaje.ficha);
  const npcs = m.sistema('npcs');
  const sit = m.sistema('situations').aqui()[0] ?? null;
  const suyos = new Set(Object.values(sit?.actores ?? {}).map((a) => a.refId));
  const nombre = (id) => m.ver(`npcs.conocidos.porId.${id}.nombre`);
  const pnjId = (m.ver('npcs.presentes', []) ?? []).find((id) => !suyos.has(id)) ?? m.ver('npcs.presentes', [])[0];
  const actorId = Object.values(sit?.actores ?? {})[0]?.refId ?? pnjId;
  const lugar = m.ver('world.ubicacion');
  const vecinoId = m.sistema('world')?.lugarActual?.()?.plantilla?.conexiones?.[0]?.hasta;
  const vecino = m.ver(`world.localizaciones.porId.${vecinoId}.nombre`) ?? 'el camino del norte';
  const comodin = {
    pnj: nombre(pnjId) ?? 'el herrero', actor: nombre(actorId) ?? 'el herrero',
    cosa: COSA[sit?.refId] ?? 'la plaza', vecino,
  };
  const rellenar = (t) => t.replace(/\{(\w+)\}/g, (_, k) => comodin[k] ?? k);

  const turnos = [{ entrada: '(apertura)', texto: apertura }];
  for (const plantilla of guion) {
    if (plantilla === '@guardar') { m.guardarYCargar(); turnos.push({ entrada: '(guardar y cargar)', texto: '' }); continue; }
    if (plantilla === '@patrulla') { m.sistema('exploration')._presentar(obtenerEncuentro('patrulla_hostil')); turnos.push({ entrada: '(llega una patrulla)', texto: '' }); continue; }
    if (plantilla === '@combate') {
      // Si hay pelea: se intenta parar hablando y, si no, se huye.
      const antes = m.entradas().length;
      for (let i = 0; i < 4 && m.ver('combat.activo', false); i += 1) {
        for (let k = 0; k < 60 && m.ver('combat.activo', false) && !m.sistema('combat').esperandoJugador; k += 1) await new Promise((r) => setTimeout(r, 25));
        if (!m.ver('combat.activo', false)) break;
        await m.sistema('combat').jugadaLibre(i < 2 ? 'bajad las armas, os ofrezco una tregua' : 'huyo');
      }
      const texto = m.entradas().slice(antes).map((e) => e.texto).join('\n');
      turnos.push({ entrada: '(combate)', texto, combate: true });
      continue;
    }
    const entrada = rellenar(plantilla);
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
    const texto = await m.jugar(entrada);
    // Quién había, para saber si contesta a quien se le preguntó.
    const presentes = (m.ver('npcs.presentes', []) ?? []).map((id) => m.ver(`npcs.conocidos.porId.${id}.nombre`)).filter(Boolean);
    turnos.push({ entrada, texto, presentes, pregunta: pideRespuesta(entrada), preguntaLaxa: PREGUNTA.test(entrada) && /\bpor\b|qué|quién|si ha visto/i.test(entrada) });
  }
  return { personaje: personaje.ficha.nombre, estilo, lugar, comodin, turnos };
}

/**
 * ¿Contesta a lo preguntado? Cuenta si la respuesta nombra el tema y da un
 * dato (un sitio, un camino, una cifra, un nombre) o si admite no saberlo y
 * dice a quién o dónde preguntar.
 */
function contesta(turno, comodin) {
  const cuerpo = turno.texto.split('\n').filter((l) => !l.startsWith('»')).join(' ');
  const pregunta = turno.entrada;
  const tema = pregunta.includes(comodin.vecino) ? comodin.vecino
    : /quién manda/i.test(pregunta) ? 'manda'
      : /qué le ha pasado/i.test(pregunta) ? 'pasado'
        : /forastero/i.test(pregunta) ? 'forastero' : '';
  const palabras = String(tema).toLowerCase().split(/\s+/).filter((p) => p.length > 3);
  const nombra = !palabras.length || palabras.some((p) => cuerpo.toLowerCase().includes(p))
    || (tema === 'manda' && /manda|alcald|capit|guardia|consejo|señor|gremio/i.test(cuerpo))
    || (tema === 'pasado' && /«[^»]{12,}»/.test(cuerpo))
    || (tema === 'forastero' && /forastero|viajer|pasó|nadie|vi(?:mos)? a/i.test(cuerpo));
  // «¿Qué te ha pasado?» se contesta con lo que le pasó, no con distancias.
  const dato = tema === 'pasado'
    ? /«[^»]{15,}»/.test(cuerpo)
    : /jornada|día|días|legua|hora|norte|sur|río|puente|camino|nieve|invierno|refugio|posada|guardia|\d/i.test(cuerpo)
      && /«[^»]{15,}»|te cuenta|te explica|te indica|dice que/i.test(cuerpo);
  const admite = /no (?:lo )?s[eé]|no tengo ni idea|no sabr[ií]a/i.test(cuerpo) && /pregunta|posada|quien|en (?:el|la) /i.test(cuerpo);
  const evasivaVacia = /y no termina la frase|Algo se dice|Eso queda lejos de mis asuntos|Ni idea\. Aquí cada uno/i.test(cuerpo);
  return nombra && (dato || admite) && !evasivaVacia;
}

function medir(partida) {
  const cuenta = new Map();
  const porTurno = partida.turnos.map((t) => frases(t.texto));
  for (const lista of porTurno) for (const f of new Set(lista)) cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
  const repetidas = [...cuenta.entries()].filter(([, n]) => n > 1);
  const total = porTurno.flat().length;
  const repeticiones = repetidas.reduce((a, [, n]) => a + (n - 1), 0);
  // Casi repetidas: la misma frase con otra palabra (80 % de trigramas en
  // común con alguna anterior de la partida). Es lo que se nota sin ser
  // literal.
  const vistas = [];
  let casi = 0;
  for (const f of porTurno.flat()) {
    if (f.length >= 24 && vistas.some((v) => v !== f && parecidas(v, f))) casi += 1;
    vistas.push(f);
  }

  const texto = partida.turnos.map((t) => t.texto).join('\n');
  const coletillas = COLETILLAS.reduce((a, re) => a + (texto.match(new RegExp(re.source, 'gi'))?.length ?? 0), 0);
  const genericos = porTurno.flat().filter((f) => GENERICOS.some((re) => re.test(f))).length;
  // Estricto: atiende tema y destinatario (ver `atencion.mjs`). El criterio
  // anterior (laxo) se sigue calculando para comparar: daba por contestada
  // una pregunta sin tema reconocido y cualquier «pregunta a otro».
  const juicio = new Map(partida.turnos.filter((t) => t.pregunta).map((t) => [t, atiende(t)]));
  const preguntas = [...juicio.keys()].filter((t) => juicio.get(t).aplica);
  const contestadas = preguntas.filter((t) => juicio.get(t).atiende);
  const laxas = partida.turnos.filter((t) => t.preguntaLaxa);
  const contestadasLaxo = laxas.filter((t) => contesta(t, partida.comodin));
  const palabras = partida.turnos.filter((t) => t.texto && !t.combate).map((t) => t.texto.split(/\s+/).length);
  // Turnos que solo repiten la acción y devuelven la palabra (ver `soloEco`).
  // Medida nueva y aparte: `genericos` sigue contando lo mismo que antes.
  const ecos = partida.turnos.filter((t) => t.entrada && !t.combate && soloEco(t));

  return {
    soloEco: ecos.length,
    ecos: ecos.map((t) => t.entrada),
    frases: total,
    repeticiones,
    tasaRepeticion: total ? repeticiones / total : 0,
    casiRepetidas: casi,
    repetidas: repetidas.sort((a, b) => b[1] - a[1]).slice(0, 8),
    coletillas,
    genericos,
    preguntas: preguntas.length,
    contestadas: contestadas.length,
    informadas: preguntas.filter((t) => juicio.get(t).informa).length,
    preguntasLaxo: laxas.length,
    contestadasLaxo: contestadasLaxo.length,
    noAtendidas: preguntas.filter((t) => !juicio.get(t).atiende).map((t) => ({ entrada: t.entrada, motivo: juicio.get(t).motivo })),
    palabrasMedia: media(palabras),
    palabrasDesviacion: desviacion(palabras),
    contestadasEntradas: new Set(contestadas.map((t) => t.entrada)),
    motivos: new Map([...juicio].map(([t, j]) => [t.entrada, j.motivo])),
  };
}

function transcripcion(partida, metrica) {
  const repetidas = new Set(metrica.repetidas.map(([f]) => f));
  const lineas = [`# ${partida.personaje} · ${partida.estilo}`, '', `Comodines: ${JSON.stringify(partida.comodin)}`, ''];
  for (const [i, t] of partida.turnos.entries()) {
    lineas.push(`### ${i === 0 ? 'Apertura' : `Turno ${i}`}${t.pregunta ? (metrica.contestadasEntradas.has(t.entrada) ? ' · ✅ atiende tema y destinatario' : ` · ❌ no atiende: ${metrica.motivos.get(t.entrada)}`) : ''}`, '');
    lineas.push(`» ${t.entrada}`);
    for (const l of String(t.texto).split('\n').filter((x) => x && !x.startsWith('»'))) {
      const marca = frases(l).some((f) => repetidas.has(f)) ? ' ⟲' : '';
      lineas.push(`${l}${marca}`);
    }
    lineas.push('');
  }
  return lineas.join('\n');
}

const partidas = [];
let saltadas = 0;
const trazasTodas = [];
for (const p of PERSONAJES) {
  for (const [k, [estilo, guion]] of [['contemplativo', CONTEMPLATIVO], ['impulsivo', IMPULSIVO]].entries()) {
    const indice = partidas.length + saltadas + 1;
    if (soloPartida && indice !== soloPartida) { saltadas += 1; continue; }
    // Cada partida en un motor nuevo con su semilla (ver `crearMotor`).
    const m = await crearMotor({ semilla: p.semilla + k });
    if (simulada) { modelo ??= modeloAdversario(); trazasIA = await conectar(m, modelo); }
    if (conGroq) {
      // El puente exige el Origin de la app: se pone aquí como lo pondría el
      // navegador. La clave sigue sin salir del puente.
      modelo ??= { stats: { peticiones: 0, reparaciones: 0, inyectadas: {}, tokens: [], caracteres: [] } };
      m.sistema('dungeonmaster').proveedor('groq').configurar({ url: 'http://127.0.0.1:11436' });
      trazasIA = await conectar(m, { fetch: (url, op = {}) => fetch(url, { ...op, headers: { ...(op.headers ?? {}), Origin: 'http://localhost:8080' } }) });
      if (!m.sistema('dungeonmaster').proveedor('groq').inspeccionar().verificado) throw new Error('El puente no contesta en http://127.0.0.1:11436: arráncalo con node tools/iniciar-groq.mjs');
    }
    const partida = await jugarPartida(m, p, estilo, guion);
    partidas.push({ partida, metrica: medir(partida) });
    trazasTodas.push(...trazasIA);
  }
}

trazasIA = trazasTodas;

const carpeta = argumento('--transcripciones');
if (carpeta) {
  mkdirSync(carpeta, { recursive: true });
  for (const { partida, metrica } of partidas) {
    writeFileSync(join(carpeta, `${partida.personaje}-${partida.estilo}.md`), transcripcion(partida, metrica));
  }
}

const suma = (k) => partidas.reduce((a, x) => a + x.metrica[k], 0);
const resumen = {
  partidas: partidas.length,
  turnos: partidas.reduce((a, x) => a + x.partida.turnos.length - 1, 0),
  frases: suma('frases'),
  repeticiones: suma('repeticiones'),
  tasaRepeticion: suma('repeticiones') / Math.max(1, suma('frases')),
  coletillas: suma('coletillas'),
  genericos: suma('genericos'),
  soloEco: suma('soloEco'),
  preguntas: suma('preguntas'),
  contestadas: suma('contestadas'),
  informadas: suma('informadas'),
  preguntasLaxo: suma('preguntasLaxo'),
  contestadasLaxo: suma('contestadasLaxo'),
  palabrasMedia: media(partidas.map((x) => x.metrica.palabrasMedia)),
  palabrasDesviacion: media(partidas.map((x) => x.metrica.palabrasDesviacion)),
};

console.log('partida                      frases  repet  colet  genér   eco  preg  contest  palabras±');
for (const { partida, metrica } of partidas) {
  console.log(`${`${partida.personaje} · ${partida.estilo}`.padEnd(28)} ${String(metrica.frases).padStart(6)} ${String(metrica.repeticiones).padStart(6)} ${String(metrica.coletillas).padStart(6)} ${String(metrica.genericos).padStart(6)} ${String(metrica.soloEco).padStart(5)} ${String(metrica.preguntas).padStart(5)} ${String(metrica.contestadas).padStart(8)}  ${metrica.palabrasMedia.toFixed(0)}±${metrica.palabrasDesviacion.toFixed(0)}`);
}
console.log(`\nTOTAL: ${resumen.turnos} turnos · ${(resumen.tasaRepeticion * 100).toFixed(1)} % de frases repetidas · ${suma('casiRepetidas')} casi repetidas · ${resumen.coletillas} coletillas · ${resumen.genericos} resultados genéricos · ${resumen.soloEco} turnos solo eco + pregunta · ${resumen.contestadas}/${resumen.preguntas} preguntas atendidas (tema y destinatario), ${resumen.informadas}/${resumen.preguntas} con dato o a quién preguntar (con el criterio laxo anterior: ${resumen.contestadasLaxo}/${resumen.preguntasLaxo})`);
for (const { partida, metrica } of partidas) for (const x of metrica.noAtendidas) console.log(`  ❌ ${partida.personaje}: «${x.entrada}» — ${x.motivo}`);
for (const { partida, metrica } of partidas) for (const e of metrica.ecos) console.log(`  ∅ ${partida.personaje}: «${e}» — solo eco y pregunta`);
console.log('\nLo que más se repite:');
const todas = new Map();
for (const { metrica } of partidas) for (const [f, n] of metrica.repetidas) todas.set(f, (todas.get(f) ?? 0) + n);
for (const [f, n] of [...todas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}× ${f.slice(0, 100)}`);

if (simulada) {
  const texto = partidas.map(({ partida }) => partida.turnos.map((t) => t.texto).join('\n')).join('\n');
  const fugas = Object.fromEntries(Object.entries(MARCAS).map(([k, marca]) => [k, texto.split(marca).length - 1]));
  const cuenta = (lista) => lista.reduce((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {});
  const problemas = cuenta(trazasIA.flatMap((t) => t.problemas ?? []));
  const rechazados = cuenta(trazasIA.flatMap((t) => (t.rechazados ?? []).map((r) => r.tipo)));
  const aplicado = cuenta(trazasIA.flatMap((t) => (t.aplicado ?? []).map((a) => a.split(/[ :]/)[0])));
  const caidas = trazasIA.filter((t) => t.final === 'procedural').length;
  const reparados = cuenta(trazasIA.map((t) => t.reparado));
  const tokens = modelo.stats.tokens;
  console.log('\n── Camino de la IA con un modelo simulado malintencionado ──');
  console.log(`peticiones: ${modelo.stats.peticiones} (de ellas, correcciones: ${modelo.stats.reparaciones}) en ${trazasIA.length} turnos narrados por la IA`);
  console.log(`inyectado a propósito: ${JSON.stringify(modelo.stats.inyectadas)}`);
  console.log(`detectado por el verificador: ${JSON.stringify(problemas)}`);
  console.log(`reparación: ${JSON.stringify(reparados)} · turnos que acabó narrando el procedural: ${caidas}`);
  console.log(`efectos rechazados: ${JSON.stringify(rechazados)}`);
  console.log(`efectos aplicados (solo narrativos): ${JSON.stringify(aplicado)}`);
  console.log(`FUGAS a la bitácora (tiene que ser 0): ${JSON.stringify(fugas)}`);
  console.log(`instantánea: media ${Math.round(media(tokens))} tokens, máx. ${Math.max(...tokens)} · petición entera: media ${Math.round(media(modelo.stats.caracteres) / 3.5)} tokens aprox.`);
}

const salida = argumento('--json');
if (salida) writeFileSync(salida, JSON.stringify({ resumen, partidas: partidas.map(({ partida, metrica }) => ({ personaje: partida.personaje, estilo: partida.estilo, ...metrica, contestadasEntradas: [...metrica.contestadasEntradas], motivos: Object.fromEntries(metrica.motivos) })) }, null, 2));
