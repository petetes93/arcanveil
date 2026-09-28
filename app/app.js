/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · app/app.js
 * ---------------------------------------------------------------------------
 * La aplicación de juego.
 *
 * Arranca el motor directamente —sin pasar por main.js ni UIManager— y dibuja
 * su propia interfaz. Tres pantallas: inicio, creación y partida.
 *
 * Todo lo que se ve sale del motor real: las tiradas, el mundo, el combate y
 * la narración del director interno.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { store } from '../src/core/Store.js';
import { bus } from '../src/core/EventBus.js';
import { Registry } from '../src/core/Registry.js';
import { GestorRNG } from '../src/core/RNG.js';

import { Clock } from '../src/core/Clock.js';
import { Player } from '../src/player/Player.js';
import { Inventory } from '../src/inventory/Inventory.js';
import { TimeSystem } from '../src/world/TimeSystem.js';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { DynamicEvents } from '../src/world/DynamicEvents.js';
import { Travel } from '../src/world/Travel.js';
import { Exploration } from '../src/world/Exploration.js';
import { World } from '../src/world/World.js';
import { RelationshipSystem } from '../src/npc/RelationshipSystem.js';
import { ReputationSystem } from '../src/npc/ReputationSystem.js';
import { FactionSystem } from '../src/npc/FactionSystem.js';
import { PartySystem } from '../src/npc/PartySystem.js';
import { SceneSystem } from '../src/world/SceneSystem.js';
import { SituationSystem } from '../src/world/SituationSystem.js';
import { DialogueSystem } from '../src/npc/DialogueSystem.js';
import { MerchantSystem } from '../src/npc/MerchantSystem.js';
import { EconomySystem } from '../src/economy/EconomySystem.js';
import { QuestSystem } from '../src/quests/QuestSystem.js';
import { StatsTracker } from '../src/progression/StatsTracker.js';
import { AchievementSystem } from '../src/progression/AchievementSystem.js';
import { Milestones } from '../src/progression/Milestones.js';
import { SaveManager } from '../src/persistence/SaveManager.js';
import { RulesEngine } from '../src/engine/RulesEngine.js';
import { EffectApplier } from '../src/engine/EffectApplier.js';
import { CombatManager } from '../src/combat/CombatManager.js';
import { DungeonMaster } from '../src/ai/DungeonMaster.js';
import { ActionRouter } from '../src/engine/ActionRouter.js';
import { ConsequenceEngine } from '../src/engine/ConsequenceEngine.js';
import { DifficultyDirector } from '../src/engine/DifficultyDirector.js';
import { TurnResolver } from '../src/engine/TurnResolver.js';

import {
  pintarLugar, pintarRetrato, pintarCriatura, cargarManifiesto,
  especieNombrada, claveRetrato,
} from '../src/art/index.js';
import { abrirGaleria, aprobar, alCambiarGaleria, urlAprobada } from '../src/art/galeria.js';
import { pedirCandidata, estadoGenerador } from '../src/art/candidata.js';
import { sujetoRetrato } from '../src/art/rasgos.js';
import { obtenerEnemigo } from '../src/data/enemies.data.js';

import { fichaAleatoria } from '../src/player/CharacterRandom.js';
import { aplicarCorreccion, resumenPersonaje, sexoDescrito, PREGUNTA_CREACION } from '../src/player/Correccion.js';
import {
  listarPersonajes, obtenerPersonaje, guardarPersonaje,
} from '../src/persistence/CharacterRoster.js';
import { RAZAS } from '../src/data/races.data.js';
import { CLASES } from '../src/data/classes.data.js';
import { TRASFONDOS } from '../src/data/backgrounds.data.js';
import { obtenerLugar } from '../src/data/locations.data.js';
import { ESTADOS } from '../src/data/statuses.data.js';
import { importarHistoria } from '../src/ai/Importar.js';
import { esGolpe } from '../src/ai/Cadencia.js';
import * as Comb from '../src/combat/Combatant.js';
import { PROVEEDORES } from '../src/config/ai.config.js';
import {
  rodarDado, numeroDano, sacudir, destello, rotuloMomento,
} from './efectos.js';

/* ═══════════════════════════════════════════════════════════════════════════
   UTILIDADES DE DOM
   ═══════════════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = String(v);
    // Sin `html`: nadie lo usaba, y una puerta a innerHTML en el ayudante de
    // todo app.js es la que acaba abriéndose con texto del narrador.
    else if (k.startsWith('on')) { if (typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v); }
    else if (k === 'dataset') Object.assign(n.dataset, v);
    // `value` va como propiedad. Como atributo, un <textarea> lo ignora: la
    // descripción y la historia salían vacías al volver a la ficha aunque el
    // borrador las guardara.
    else if (k === 'value') n.value = String(v);
    else n.setAttribute(k, String(v));
  }

  for (const h of hijos.flat()) {
    if (h === null || h === undefined || h === false) continue;
    n.append(h.nodeType ? h : document.createTextNode(String(h)));
  }

  return n;
}

function vaciar(nodo) {
  if (nodo) nodo.innerHTML = '';
}

/** Muestra un fallo en pantalla en vez de dejar la página muda. */
function avisarFallo(donde, error) {
  console.error('[arcanveil] ' + donde, error);

  let caja = $('#fallos');
  if (!caja) {
    caja = el('div', { id: 'fallos', class: 'fallos' },
      el('p', { class: 'fallos__titulo', text: 'Algo ha fallado' }));
    document.body.prepend(caja);
  }

  caja.append(el('pre', {
    class: 'fallos__linea',
    text: `${donde} → ${error?.message ?? error}\n${String(error?.stack ?? '').split('\n').slice(1, 3).join('\n')}`,
  }));
}

// Cualquier error que se escape queda escrito en pantalla.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    document.body?.classList.add('esta-listo');

    const err = e.error ?? new Error(e.message);

    // Si el motor aún no arrancó, el fallo se pinta en el rótulo, que es lo
    // único visible en ese momento.
    if (!motor.listo) arranqueFallido('error no capturado', err);
    else avisarFallo('error no capturado', err);
  });

  window.addEventListener('unhandledrejection', (e) => {
    document.body?.classList.add('esta-listo');
    avisarFallo('promesa rechazada', e.reason);
  });
}

const protegido = (donde, fn) => (...args) => {
  try { return fn(...args); } catch (e) { avisarFallo(donde, e); return null; }
};

/* ═══════════════════════════════════════════════════════════════════════════
   MOTOR
   ═══════════════════════════════════════════════════════════════════════════ */

const motor = { registry: null, rng: null, listo: false };

async function arrancarMotor() {
  motor.rng = new GestorRNG();
  store.fijar('meta.semilla', motor.rng.semillaMaestra);

  motor.registry = new Registry({ store, bus, rng: motor.rng });

  // Se informa del avance: si un sistema cuelga el arranque, su nombre queda
  // en pantalla en vez de un rótulo mudo.
  const decir = (t) => {
    const n = document.getElementById('arranque-texto');
    if (n) n.textContent = t;
  };

  bus.on?.('system:started', ({ nombre }) => decir(`Iniciando ${nombre}…`));
  decir('Registrando sistemas…');

  motor.registry.registrarTodos([
    Clock, Player, Inventory,
    TimeSystem, WeatherSystem, DynamicEvents, Travel, Exploration, World,
    RelationshipSystem, ReputationSystem, FactionSystem, DialogueSystem,
    MerchantSystem, EconomySystem, QuestSystem, PartySystem, SceneSystem, SituationSystem,
    StatsTracker, AchievementSystem, Milestones, SaveManager,
    RulesEngine, EffectApplier, CombatManager,
    DungeonMaster, ActionRouter, ConsequenceEngine, DifficultyDirector,
    TurnResolver,
  ]);

  await motor.registry.iniciar();

  if (typeof motor.registry.arrancar === 'function') {
    await motor.registry.arrancar();
  }

  motor.listo = true;

  return motor.registry;
}

const sistema = (nombre) => motor.registry?.obtener(nombre) ?? null;
const ver = (ruta, defecto) => store.select(ruta, defecto);

/* ═══════════════════════════════════════════════════════════════════════════
   PANTALLAS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A partir del arranque, ir al inicio abre el menú. */
let menuTrasArrancar = false;

function mostrar(pantalla) {
  // Se acota a las secciones a propósito. La marca del cuerpo va en OTRO
  // atributo (`data-active-screen`, el mismo que usa ui.config.js) porque con
  // el mismo nombre el body entraba en esta lista en la segunda llamada, no
  // coincidía con el destino y se ponía `hidden` a sí mismo: el juego entero
  // desaparecía al pasar de la portada a la creación.
  for (const s of $$('section[data-pantalla]')) {
    s.hidden = s.dataset.pantalla !== pantalla;
  }

  document.body.setAttribute('data-active-screen', pantalla);

  // Volver al inicio desde otra pantalla («Atrás» en la creación o en
  // cargar) es volver al menú, no a la portada vacía.
  if (pantalla === 'inicio' && menuTrasArrancar) abrirMenuInicio({ foco: false });

  const activa = document.querySelector(`section[data-pantalla="${pantalla}"]`);
  if (activa) {
    activa.classList.remove('pantalla-entrando');
    void activa.offsetWidth;
    activa.classList.add('pantalla-entrando');
  }
}

/* ── inicio ───────────────────────────────────────────────────────────── */

/**
 * Pantalla de título, como la de cualquier videojuego: Continuar solo se
 * enciende si hay algo que continuar.
 */
/**
 * La portada tiene dos estados: la marca con «Pulsa para jugar», y el menú.
 * Pulsar no carga nada por su cuenta, ni siquiera si hay partida: abre el
 * menú, y ahí «Continuar» dice qué partida es. Cargar de golpe al tocar la
 * portada podía llevar a una ranura que no era la que se quería.
 */
function abrirMenuInicio({ foco = true } = {}) {
  const seccion = document.querySelector('section[data-pantalla="inicio"]');
  if (!seccion) return;
  seccion.dataset.estado = 'menu';
  $('#inicio-menu').hidden = false;
  $('#inicio-jugar')?.setAttribute('aria-expanded', 'true');
  if (foco) ($('#inicio-acciones button:not([disabled])') ?? $('#inicio-volver'))?.focus();
}

function cerrarMenuInicio() {
  const seccion = document.querySelector('section[data-pantalla="inicio"]');
  if (!seccion) return;
  seccion.dataset.estado = 'portada';
  $('#inicio-menu').hidden = true;
  const llamada = $('#inicio-jugar');
  llamada?.setAttribute('aria-expanded', 'false');
  llamada?.focus();
}

function pintarInicio() {
  const saves = sistema('saves');
  const reciente = partidaMasReciente();

  const caja = $('#inicio-acciones');
  vaciar(caja);

  caja.append(
    el('button', {
      class: 'btn btn--grande menu-btn', id: 'menu-continuar',
      disabled: reciente ? null : 'disabled',
      title: reciente ? `${reciente.cabecera?.nombre ?? ''} · nivel ${reciente.cabecera?.nivel ?? 1}` : 'Aún no hay partidas guardadas',
      onClick: protegido('continuar', () => continuar()),
    },
      el('span', { text: 'Continuar' }),
      reciente ? el('small', { class: 'menu-btn__nota', text: `${reciente.cabecera?.nombre ?? ''} · ${reciente.cabecera?.lugar ?? ''}` }) : null,
    ),
    el('button', {
      class: 'btn menu-btn', id: 'menu-nueva',
      onClick: protegido('nueva partida', () => abrirNuevaPartida()),
    }, 'Nueva partida'),
    el('button', {
      class: 'btn menu-btn', id: 'menu-cargar',
      disabled: saves && partidasGuardadas().length ? null : 'disabled',
      onClick: protegido('cargar', () => { mostrar('cargar'); pintarCargar(); }),
    }, 'Cargar'),
    el('button', {
      class: 'btn btn--fantasma menu-btn', id: 'menu-ajustes',
      onClick: protegido('ajustes', () => abrirAjustes()),
    }, 'Ajustes'),
  );
}

/* ── partidas guardadas ───────────────────────────────────────────────── */

/** Clave de la preferencia que recuerda que el jugador quiso guardar. */
const CLAVE_PERSISTENCIA = 'arcanveil:prefs:persistencia';

/**
 * Enciende el guardado en el navegador. Se llama al empezar una partida: quien
 * pulsa «Nueva partida» en un juego con «Continuar» está pidiendo que se
 * recuerde. El autoguardado propio del motor se apaga porque aquí cada
 * partida tiene su ranura y se guarda al final de cada turno.
 */
function activarPersistencia() {
  try { localStorage.setItem(CLAVE_PERSISTENCIA, '1'); } catch { /* modo privado */ }
  store.fijar('settings.persistencia', true);
  store.fijar('settings.autoguardado', false);
  bus.emit('settings:change', { id: 'persistencia', valor: true });
}

/** Al arrancar: si antes se guardó algo, se vuelve a poder leer y guardar. */
function recuperarPersistencia() {
  let recordada = false;
  try {
    recordada = localStorage.getItem(CLAVE_PERSISTENCIA) === '1'
      || Object.keys(localStorage).some((k) => k.startsWith('arcanveil:partida:'));
  } catch { /* sin almacenamiento */ }
  if (recordada) activarPersistencia();
}

function partidasGuardadas() {
  return (sistema('saves')?.listar?.() ?? [])
    .filter((r) => !r.vacia && r.abrible !== false)
    .sort((a, b) => (b.guardadoEn ?? 0) - (a.guardadoEn ?? 0));
}

function partidaMasReciente() {
  return partidasGuardadas()[0] ?? null;
}

/** Primera ranura libre; si no queda ninguna, la más antigua. */
function ranuraParaPartidaNueva() {
  const todas = (sistema('saves')?.listar?.() ?? []).filter((r) => !r.automatica);
  const libre = todas.find((r) => r.vacia);
  if (libre) return libre.ranura;
  return [...todas].sort((a, b) => (a.guardadoEn ?? 0) - (b.guardadoEn ?? 0))[0]?.ranura ?? '1';
}

/** Guarda la partida en curso en su ranura, sin avisos. */
function guardarPartidaActual({ silencioso = true } = {}) {
  if (!ver('player.raza')) return null;
  const ranura = ver('meta.ranura') ?? ranuraParaPartidaNueva();
  store.fijar('meta.ranura', ranura);
  return sistema('saves')?.guardar(ranura, { silencioso, nota: 'crónica' }) ?? null;
}

function cargarRanura(ranura) {
  const r = sistema('saves').cargar(ranura);
  if (!r.exito) {
    avisarFallo('cargar partida', new Error(r.motivo));
    return;
  }
  store.fijar('meta.ranura', ranura);
  mostrar('juego');
  // Si se carga desde la salida de una caída, la caja seguía cerrada.
  bloquear(false);
  refrescarTodo();
  bitacoraSinAnimar();
  programarSugerencias();
}

function continuar() {
  const reciente = partidaMasReciente();
  if (reciente) cargarRanura(reciente.ranura);
}

function pintarCargar() {
  const caja = $('#cargar-lista');
  vaciar(caja);

  const partidas = partidasGuardadas();
  if (!partidas.length) {
    caja.append(el('p', { class: 'cargar__vacio', text: 'No hay partidas guardadas todavía.' }));
    return;
  }

  for (const p of partidas) {
    const c = p.cabecera ?? {};
    const cara = el('div', { class: 'tarjeta-pj__cara' });
    const fecha = p.guardadoEn ? new Date(p.guardadoEn).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '';

    caja.append(el('div', { class: 'tarjeta-pj tarjeta-pj--partida' },
      el('button', {
        class: 'tarjeta-pj__abrir', dataset: { ranura: p.ranura },
        onClick: protegido('cargar partida', () => cargarRanura(p.ranura)),
      },
        cara,
        el('span', { class: 'tarjeta-pj__texto' },
          el('strong', { class: 'tarjeta-pj__nombre', text: c.nombre ?? 'Sin nombre' }),
          el('span', { class: 'tarjeta-pj__dato', text: `Nivel ${c.nivel ?? 1} · ${RAZAS[c.raza]?.nombre ?? ''} · ${CLASES[c.clase]?.nombre ?? ''}` }),
          el('span', { class: 'tarjeta-pj__dato tarjeta-pj__dato--tenue', text: `${c.lugar ?? ''} · ${nombreIntensidad(c.intensidad)} · día ${c.dia ?? 1} · ${fecha}` }),
        ),
      ),
      el('button', {
        class: 'btn btn--pequeno btn--peligro tarjeta-pj__borrar', title: 'Borrar esta partida',
        onClick: protegido('borrar partida', () => {
          if (!confirm(`¿Borrar la partida de ${c.nombre ?? 'este personaje'}? No se puede deshacer.`)) return;
          sistema('saves').borrar(p.ranura);
          pintarCargar();
          pintarInicio();
        }),
      }, 'Borrar'),
    ));

    pintarRetrato(cara, fichaRetrato(c));
  }
}

/* ── nueva partida: personajes ────────────────────────────────────────── */

/**
 * Si ya existe algún personaje, «Nueva partida» lo ofrece a nivel 1 con un
 * botón para crear otro. Si no, va directo al generador.
 */
function abrirNuevaPartida() {
  if (!listarPersonajes().length) {
    abrirCreacion();
    return;
  }
  mostrar('personajes');
  pintarPersonajes(null);
}

function pintarPersonajes(elegidoId) {
  const caja = $('#personajes-lista');
  const pie = $('#personajes-pie');
  vaciar(caja);
  vaciar(pie);

  const personajes = listarPersonajes();
  const elegido = personajes.find((p) => p.id === elegidoId) ?? null;

  // Con un personaje elegido solo queda él y «Comenzar partida».
  for (const p of elegido ? [elegido] : personajes) {
    const cara = el('div', { class: 'tarjeta-pj__cara' });
    caja.append(el('button', {
      class: 'tarjeta-pj' + (elegido ? ' es-elegida' : ''),
      dataset: { personaje: p.id },
      onClick: protegido('elegir personaje', () => pintarPersonajes(elegido ? null : p.id)),
    },
      cara,
      el('span', { class: 'tarjeta-pj__texto' },
        el('strong', { class: 'tarjeta-pj__nombre', text: p.nombre }),
        el('span', { class: 'tarjeta-pj__dato', text: `Nivel 1 · ${RAZAS[p.raza]?.nombre ?? ''} · ${CLASES[p.clase]?.nombre ?? ''}` }),
        elegido && p.lore ? el('span', { class: 'tarjeta-pj__lore', text: p.lore.slice(0, 220) + (p.lore.length > 220 ? '…' : '') }) : null,
      ),
    ));
    pintarRetrato(cara, fichaRetrato(p));
  }

  if (elegido) {
    pie.append(
      el('button', { class: 'btn btn--fantasma', id: 'personajes-otro', onClick: () => pintarPersonajes(null) }, 'Elegir otro'),
      el('button', {
        class: 'btn btn--grande', id: 'personajes-comenzar',
        onClick: protegido('comenzar partida', () => comenzarPartida(elegido)),
      }, 'Comenzar partida'),
    );
  } else {
    pie.append(
      el('button', { class: 'btn btn--fantasma', onClick: () => mostrar('inicio') }, 'Atrás'),
      el('button', {
        class: 'btn', id: 'personajes-nuevo',
        onClick: protegido('nuevo personaje', () => abrirCreacion()),
      }, 'Nuevo personaje'),
    );
  }
}

/* ── creación: generador aleatorio ────────────────────────────────────── */

const borrador = {
  nombre: '', raza: 'valdes', clase: 'rastreador', trasfondo: 'errante',
  genero: 'm', retrato: '', lore: '', intensidad: 'equilibrado',
};

/** Personaje recién creado que se enseña con su ilustración. */
let personajeCreado = null;

/**
 * Si el nombre lo ha escrito el jugador y no el dado.
 *
 * Hace falta saberlo aparte: el campo copia cada tecla a `borrador.nombre`,
 * así que comparar el campo con el borrador no distingue un nombre escrito de
 * uno tirado, y volver a tirar se llevaba por delante el nombre del jugador.
 */
let nombreEscrito = false;

function tirarFicha() {
  Object.assign(borrador, fichaAleatoria());
}

function abrirCreacion() {
  personajeCreado = null;
  tirarFicha();
  borrador.retrato = '';
  borrador.lore = '';
  // Sin esto, volver desde la revelación y luego pulsar «Crear otro»
  // sobrescribía al personaje anterior en vez de crear uno.
  delete borrador.id;
  delete borrador.creado;
  delete borrador.semillaRetrato;
  nombreEscrito = false;
  mostrar('creacion');
  pintarCreacion();
}

/**
 * Primer paso: ficha al azar y los tres textos del jugador. Aquí no hay
 * retrato a propósito: la ilustración llega cuando el jugador envía su
 * descripción, no antes.
 */
function pintarCreacion() {
  const caja = $('#creacion-cuerpo');
  vaciar(caja);
  $('#creacion-titulo').textContent = '¿Quién eres?';
  $('#creacion-nota').textContent = 'Tira los dados hasta que te guste el origen. Después escribe quién eres: tu descripción será el encargo para la ilustración.';

  caja.append(el('div', { class: 'aleatoria', id: 'ficha-aleatoria' }));
  pintarFichaAleatoria();

  // Traer una partida que ya existe.
  //
  // Va arriba del todo porque quien llega con una historia escrita no quiere
  // empezar rellenando campos: quiere pegarla y seguir jugando.
  caja.append(el('div', { class: 'campo' },
    el('button', {
      class: 'btn btn--fantasma', id: 'creacion-importar',
      onClick: protegido('importar historia', abrirImportar),
    }, 'Ya tengo una historia'),
    el('p', { class: 'campo__ayuda', text: 'Pega una partida de otro sitio y el juego la lee: personajes, lugares y lo que quedó pendiente.' }),
  ));

  caja.append(
    el('div', { class: 'campo' },
      el('label', { class: 'campo__eti', for: 'nombre', text: 'Nombre' }),
      el('input', {
        id: 'nombre', class: 'campo__entrada', type: 'text',
        maxlength: '28', value: borrador.nombre, autocomplete: 'off',
        onInput: (e) => { borrador.nombre = e.target.value; nombreEscrito = Boolean(e.target.value.trim()); },
      }),
    ),
    el('div', { class: 'campo retrato-descripcion' },
      el('label', { class: 'campo__eti', for: 'retrato-descripcion', text: 'Descripción' }),
      el('textarea', {
        id: 'retrato-descripcion', class: 'campo__entrada campo__entrada--retrato',
        placeholder: 'Ej.: exploradora de pelo plateado, cicatriz en la ceja, capa violeta y brújula de bronce…',
        maxlength: '360', value: borrador.retrato,
        onInput: (e) => { borrador.retrato = e.target.value; },
      }),
      el('p', { class: 'campo__ayuda', text: 'Es lo que la IA pintará. Aspecto, ropa, rasgos, gesto.' }),
    ),
    el('div', { class: 'campo lore-personaje' },
      el('label', { class: 'campo__eti', for: 'lore-personaje', text: 'Historia' }),
      el('textarea', {
        id: 'lore-personaje', class: 'campo__entrada campo__entrada--retrato campo__entrada--lore',
        placeholder: 'Ej.: crecí junto al Umbral, mi hermana desapareció tras cruzarlo y llevo su medallón. Quiero encontrarla, aunque tema lo que haya al otro lado…',
        maxlength: '1200', value: borrador.lore,
        onInput: (e) => { borrador.lore = e.target.value; },
      }),
      el('p', { class: 'campo__ayuda', text: 'Es el pasado de tu personaje: el mundo lo respeta, pero la partida la haces tú. Nada de esto se convierte en misión si tú no quieres.' }),
    ),
    campoIntensidad(),
  );

  const pie = $('#creacion-pie');
  vaciar(pie);
  pie.append(
    el('button', { class: 'btn btn--fantasma', id: 'creacion-volver', onClick: protegido('volver', () => (listarPersonajes().length ? abrirNuevaPartida() : mostrar('inicio'))) }, 'Atrás'),
    el('button', { class: 'btn btn--grande', id: 'creacion-crear', onClick: protegido('crear personaje', crearPersonajeNuevo) }, 'Crear personaje'),
  );
}

/**
 * Las tres intensidades que se ofrecen al crear, con texto de mesa.
 *
 * Se guardan en `settings.dificultad` con sus claves del motor. «Duro» queda
 * en Ajustes para quien lo quiera: aquí se elige entre tres, que es lo que se
 * decide bien sin conocer todavía el juego.
 */
const INTENSIDADES = Object.freeze([
  { valor: 'relato', nombre: 'Pacífica', texto: 'La historia manda y casi no hay peleas.' },
  { valor: 'equilibrado', nombre: 'Equilibrada', texto: 'Aventura con riesgo: se pelea cuando toca.' },
  { valor: 'implacable', nombre: 'Brutal', texto: 'El mundo muerde y caer tiene precio.' },
]);

/** Nombre de mesa de una intensidad, incluido «Dura», que solo está en Ajustes. */
function nombreIntensidad(valor) {
  return INTENSIDADES.find((i) => i.valor === valor)?.nombre
    ?? ({ duro: 'Dura' })[valor]
    ?? 'Equilibrada';
}

/** Selector de intensidad de la creación. */
function campoIntensidad() {
  const elegida = borrador.intensidad ?? 'equilibrado';
  const grupo = el('div', { class: 'intensidad', role: 'radiogroup', 'aria-labelledby': 'intensidad-eti', id: 'intensidad' });

  for (const i of INTENSIDADES) {
    grupo.append(el('button', {
      type: 'button', role: 'radio',
      class: `intensidad__opcion${i.valor === elegida ? ' es-activa' : ''}`,
      'aria-checked': String(i.valor === elegida),
      'data-intensidad': i.valor,
      onClick: (e) => {
        borrador.intensidad = i.valor;
        for (const b of grupo.querySelectorAll('button')) {
          const activa = b === e.currentTarget;
          b.classList.toggle('es-activa', activa);
          b.setAttribute('aria-checked', String(activa));
        }
      },
    },
    el('strong', { class: 'intensidad__nombre', text: i.nombre }),
    el('span', { class: 'intensidad__texto', text: i.texto })));
  }

  return el('div', { class: 'campo' },
    el('p', { class: 'campo__eti', id: 'intensidad-eti', text: 'Intensidad' }),
    grupo,
  );
}

function pintarFichaAleatoria() {
  const caja = $('#ficha-aleatoria');
  if (!caja) return;
  vaciar(caja);

  const raza = RAZAS[borrador.raza];
  const clase = CLASES[borrador.clase];
  const fondo = TRASFONDOS[borrador.trasfondo];
  const inicio = obtenerLugar(LUGAR_INICIAL[borrador.raza] ?? 'vado_yunque');

  caja.append(
    el('div', { class: 'aleatoria__cab' },
      el('p', { class: 'aleatoria__eti', text: 'Tu origen' }),
      el('button', {
        class: 'btn aleatoria__dado', id: 'creacion-aleatorio', type: 'button', title: 'Volver a tirar',
        onClick: protegido('aleatorio', () => {
          const nombreAnterior = borrador.nombre;
          tirarFicha();
          const campo = $('#nombre');
          // El nombre también se tira, salvo que el jugador ya haya escrito el suyo.
          if (nombreEscrito) borrador.nombre = nombreAnterior;
          else if (campo) campo.value = borrador.nombre;
          pintarFichaAleatoria();
          caja.classList.remove('se-tira'); void caja.offsetWidth; caja.classList.add('se-tira');
        }),
      }, el('span', { class: 'aleatoria__glifo', text: '⚄' }), ' Aleatorio'),
    ),
    el('div', { class: 'aleatoria__rasgos' },
      el('div', { class: 'aleatoria__rasgo' }, el('small', { text: 'Linaje' }), el('strong', { id: 'aleatoria-raza', text: raza?.nombre ?? '' }), el('span', { text: raza?.lema ?? '' })),
      el('div', { class: 'aleatoria__rasgo' }, el('small', { text: 'Oficio' }), el('strong', { text: clase?.nombre ?? '' }), el('span', { text: clase?.lema ?? (clase?.descripcion ?? '').slice(0, 80) })),
      el('div', { class: 'aleatoria__rasgo' }, el('small', { text: 'Pasado' }), el('strong', { text: fondo?.nombre ?? '' }), el('span', { text: fondo?.lema ?? (fondo?.descripcion ?? '').slice(0, 80) })),
    ),
    inicio ? el('p', { class: 'aleatoria__inicio', text: `Empiezas en ${inicio.nombre}.` }) : null,
  );
}

const LUGAR_INICIAL = {
  ferrano: 'forja_alta', brumal: 'pilotes_brumal', sombracorteza: 'arboleda_madre',
  crisol: 'oasis_sal', albar: 'umbral_albar', griscuerno: 'paso_yunque',
  valdes: 'vado_yunque', menudo: 'saucedo',
};

/**
 * Segundo paso: el personaje queda creado y la IA pinta su ilustración a
 * partir de la descripción. Si el generador local no está encendido, el
 * retrato procedural ocupa su lugar y el juego sigue igual.
 */
function crearPersonajeNuevo() {
  const nombre = ($('#nombre')?.value ?? '').trim();
  const descripcion = ($('#retrato-descripcion')?.value ?? '').trim();
  const lore = ($('#lore-personaje')?.value ?? '').trim();

  const faltan = [];
  if (!nombre) faltan.push(['#nombre', 'Ponle nombre al personaje.']);
  if (descripcion.length < 8) faltan.push(['#retrato-descripcion', 'Describe su aspecto: es lo que pintará la IA.']);
  if (lore.length < 8) faltan.push(['#lore-personaje', 'Cuenta un poco de su historia.']);
  if (faltan.length) {
    $(faltan[0][0])?.focus();
    avisar(faltan[0][1], 'aviso');
    return;
  }

  // Si la descripción dice quién es, manda sobre el dado: «enana guerrera» es
  // una mujer aunque la ficha aleatoria saliera en masculino.
  const genero = sexoDescrito(descripcion) ?? borrador.genero;

  personajeCreado = guardarPersonaje({ ...borrador, nombre, genero, retrato: descripcion, lore });
  pintarRevelacion(personajeCreado);
}

/**
 * Lo que el retrato necesita de una ficha o del jugador en partida.
 *
 * El `id` es la identidad de la imagen aprobada (`pj:<id>`): en partida el
 * jugador no lo lleva en su rama, lo lleva `meta.personajeId`.
 */
function fichaRetrato(x = {}, id = x.id ?? null) {
  return {
    id, raza: x.raza, nombre: x.nombre, descripcion: x.retrato, genero: x.genero,
  };
}

/** Ficha de retrato del jugador en partida. */
function fichaRetratoJugador() {
  return fichaRetrato(ver('player', {}) ?? {}, ver('meta.personajeId') ?? null);
}

function pintarRevelacion(p, eco = null) {
  const caja = $('#creacion-cuerpo');
  vaciar(caja);
  $('#creacion-titulo').textContent = p.nombre;
  $('#creacion-nota').textContent = `${RAZAS[p.raza]?.nombre ?? ''} · ${CLASES[p.clase]?.nombre ?? ''} · ${TRASFONDOS[p.trasfondo]?.nombre ?? ''} · nivel 1 · ${nombreIntensidad(p.intensidad)}`;

  const cara = el('div', { class: 'eleccion__cara revelacion__cara', id: 'creacion-cara' });
  const estado = el('p', { class: 'revelacion__estado', id: 'retrato-estado', text: '' });

  // Si la descripción nombra una especie, se dice en voz alta qué pasa con ella.
  //
  // «Enana guerrera» con una ficha de Griscúerno pintaba una enana con piel
  // gris azulada y cuernos, y el jugador no tenía forma de saber de dónde
  // salían. Ahora el retrato obedece a la descripción, pero el linaje sigue
  // decidiendo las reglas, y eso tiene que verse. No se cambia el linaje solo:
  // «enana» no es ningún linaje de este mundo por decreto, y el linaje
  // cambia rasgos de juego. Se le enseña y decide él.
  const especie = especieNombrada(p.retrato);
  const linaje = RAZAS[p.raza]?.nombre ?? '';

  const aviso = especie && linaje
    ? el('div', { class: 'revelacion__aviso', id: 'revelacion-especie' },
      el('p', { text: `Tu descripción dice «${especie}»; tu linaje en la ficha es ${linaje}. El retrato sigue tu descripción; las reglas, tu linaje.` }),
      el('button', {
        class: 'btn btn--fantasma', id: 'revelacion-cambiar-linaje',
        onClick: protegido('cambiar linaje', () => {
          // Se vuelve a la ficha con todo lo escrito y con el MISMO id, para
          // que al enviarla se corrija este personaje y no nazca un gemelo.
          Object.assign(borrador, { id: p.id, creado: p.creado, semillaRetrato: p.semillaRetrato });
          personajeCreado = null;
          mostrar('creacion');
          pintarCreacion();
        }),
      }, 'Cambiar linaje'),
    )
    : null;

  // El retrato solo se pinta si el jugador lo pide, y solo se queda si elige
  // una versión (ver `abrirEstudio`). Antes se pedía solo, a un servicio de
  // fuera, y se ponía sin preguntar.
  const opcionesRetrato = el('div', { class: 'revelacion__opciones' },
    el('button', {
      class: 'btn btn--pequeno', id: 'retrato-pintar', type: 'button',
      onClick: protegido('pintar retrato', () => abrirEstudio(encargoDePersonaje(p), {
        alTerminar: () => { pintarRetrato(cara, fichaRetrato(p)); contarRetrato(); },
      })),
    }, 'Pintar retrato'),
  );

  caja.append(el('div', { class: 'revelacion' },
    el('div', { class: 'revelacion__marco' }, cara, estado, opcionesRetrato),
    el('div', { class: 'revelacion__texto' },
      el('p', { class: 'revelacion__eti', text: 'Descripción' }),
      el('p', { class: 'revelacion__cita', text: p.retrato }),
      aviso,
      el('p', { class: 'revelacion__eti', text: 'Historia' }),
      el('p', { class: 'revelacion__cita', text: p.lore }),
    ),
  ));

  // El narrador lo resume y pregunta, y el jugador contesta con sus palabras.
  //
  // Antes, para cambiar una sola cosa había que rehacer el personaje entero.
  // Ahora se escribe «mejor que sea hombre» o «ponle una cicatriz en el ojo»
  // y se corrige esto y nada más. «Vale, empezamos» arranca la partida.
  const entrada = el('input', {
    id: 'revelacion-cambio', class: 'campo__entrada', type: 'text',
    maxlength: '160', autocomplete: 'off',
    'aria-label': 'Cambiar algo del personaje, o confirmar para empezar',
    placeholder: 'Un cambio, o «vale» para empezar',
  });

  caja.append(
    el('div', { class: 'revelacion__narrador', id: 'revelacion-resumen', 'aria-live': 'polite' },
      eco ? el('p', { class: 'revelacion__eco', text: eco }) : null,
      el('p', { text: resumenPersonaje(p) }),
      el('p', { class: 'revelacion__pregunta', text: PREGUNTA_CREACION }),
    ),
    el('form', {
      class: 'revelacion__cambio', id: 'revelacion-form',
      onSubmit: protegido('corregir personaje', (e) => {
        e.preventDefault();
        corregirPersonaje(p, entrada.value);
      }),
    }, entrada),
    el('p', { class: 'campo__ayuda', text: 'Por ejemplo: «que sea hombre», «ponle una cicatriz en el ojo», «que se llame Brun», «más joven». O «vale, empezamos».' }),
  );

  // Qué hay: su retrato elegido, o nada todavía (y cómo tenerlo).
  const contarRetrato = () => {
    const hay = Boolean(urlAprobada(claveRetrato(fichaRetrato(p))));
    estado.textContent = hay
      ? 'Este es el retrato que elegiste. Puedes pintar otro cuando quieras.'
      : 'Sin retrato todavía. Si tienes el generador de imágenes en este equipo, píntalo; si no, se juega igual.';
    estado.dataset.estado = hay ? 'listo' : 'sin';
  };
  pintarRetrato(cara, fichaRetrato(p));
  contarRetrato();

  const pie = $('#creacion-pie');
  vaciar(pie);
  pie.append(
    el('button', { class: 'btn btn--fantasma', id: 'creacion-otro', onClick: protegido('nuevo personaje', () => abrirCreacion()) }, 'Crear otro'),
    el('button', { class: 'btn btn--grande', id: 'creacion-empezar', onClick: protegido('comenzar partida', () => comenzarPartida(p)) }, 'Comenzar partida'),
  );
}

/**
 * Empieza una crónica nueva con un personaje del plantel, siempre a nivel 1.
 *
 * Si en esta sesión ya se jugó otra partida, se recarga la página antes: los
 * sistemas guardan estado propio (mundo, memoria del máster, eventos) y
 * empezar limpio es la única forma segura de no heredar nada de la anterior.
 */
/**
 * Aplica lo que el jugador ha escrito en la revelación.
 *
 * Lo que no se menciona se conserva, también el retrato elegido: no se
 * vuelve a pintar solo.
 *
 * @param {Object} p
 * @param {string} texto
 */
function corregirPersonaje(p, texto) {
  const r = aplicarCorreccion(p, texto);

  if (r.confirmar) { comenzarPartida(p); return; }

  if (!r.entendido) {
    pintarRevelacion(p, 'No te he entendido del todo. Prueba con «que sea hombre», «que sea elfa», «ponle una cicatriz en el ojo», «que se llame Brun» o «más joven».');
    $('#revelacion-cambio')?.focus();
    return;
  }

  // Mismo id: se corrige este personaje, no nace otro. El retrato elegido se
  // queda con él; si ya no se parece, el jugador pinta otro.
  personajeCreado = guardarPersonaje({ ...r.personaje });
  pintarRevelacion(personajeCreado, r.cambios.join(' '));
  $('#revelacion-cambio')?.focus();
}

async function comenzarPartida(p) {
  if (ver('player.raza')) {
    try { sessionStorage.setItem('arcanveil:comenzar', p.id); } catch { /* sin sesión */ }
    guardarPartidaActual();
    location.reload();
    return;
  }

  activarPersistencia();
  store.fijar('meta.ranura', ranuraParaPartidaNueva());
  store.fijar('meta.personajeId', p.id);
  // La intensidad elegida al crear es de esta partida: la leen los encuentros,
  // el tamaño de los grupos, la caída y el tono del narrador.
  store.fijar('settings.dificultad', p.intensidad ?? 'equilibrado');

  store.dispatch('player/crear', {
    borrador: {
      nombre: p.nombre, raza: p.raza, clase: p.clase, trasfondo: p.trasfondo,
      retrato: p.retrato ?? '', lore: p.lore ?? '',
      genero: p.genero, semillaRetrato: p.semillaRetrato,
    },
  });

  await new Promise((r) => setTimeout(r, 0));

  mostrar('juego');
  refrescarTodo();

  const turns = sistema('turns');
  await turns?.abrirCronica?.();

  refrescarTodo();
  guardarPartidaActual();
  programarSugerencias();
}

/** Tras la recarga de `comenzarPartida`, arranca directamente la crónica. */
function comenzarPendiente() {
  let id = null;
  try { id = sessionStorage.getItem('arcanveil:comenzar'); sessionStorage.removeItem('arcanveil:comenzar'); } catch { /* sin sesión */ }
  const p = id ? obtenerPersonaje(id) : null;
  if (!p) return false;
  comenzarPartida(p);
  return true;
}

/* ── ajustes ──────────────────────────────────────────────────────────── */

const AJUSTES_DEFECTO = { velocidadTexto: 'normal', esperaSugerencias: 7 };

function leerAjustes() {
  try { return { ...AJUSTES_DEFECTO, ...JSON.parse(localStorage.getItem('arcanveil:prefs:juego') ?? '{}') }; } catch { return { ...AJUSTES_DEFECTO }; }
}

function guardarAjustes(cambios) {
  const nuevos = { ...leerAjustes(), ...cambios };
  try { localStorage.setItem('arcanveil:prefs:juego', JSON.stringify(nuevos)); } catch { /* sin almacenamiento */ }
  return nuevos;
}

function abrirAjustes() {
  const a = leerAjustes();
  const caja = $('#ajustes-cuerpo');
  vaciar(caja);

  const grupo = (titulo, clave, opciones) => el('div', { class: 'ajuste' },
    el('p', { class: 'sub-eti', text: titulo }),
    el('div', { class: 'ajuste__opciones' }, ...opciones.map(([valor, eti]) => el('button', {
      class: 'ficha ajuste__opcion' + (String(a[clave]) === String(valor) ? ' es-elegida' : ''),
      dataset: { ajuste: clave, valor: String(valor) },
      onClick: () => { guardarAjustes({ [clave]: valor }); abrirAjustes(); },
    }, eti))),
  );

  // La intensidad es de la partida en curso, no una preferencia del
  // navegador: se guarda con ella. Aquí están las cuatro, «Dura» incluida,
  // que en la creación no se ofrece.
  const enPartida = Boolean(ver('player.raza'));
  const actual = ver('settings.dificultad', 'equilibrado');
  const intensidad = enPartida
    ? el('div', { class: 'ajuste' },
      el('p', { class: 'sub-eti', text: 'Intensidad de esta partida' }),
      el('div', { class: 'ajuste__opciones', id: 'ajuste-intensidad' },
        ...['relato', 'equilibrado', 'duro', 'implacable'].map((valor) => el('button', {
          class: `ficha ajuste__opcion${valor === actual ? ' es-elegida' : ''}`,
          dataset: { intensidad: valor },
          onClick: protegido('cambiar intensidad', () => {
            store.fijar('settings.dificultad', valor);
            guardarPartidaActual();
            abrirAjustes();
          }),
        }, nombreIntensidad(valor)))),
    )
    : null;

  caja.append(
    intensidad,
    grupo('Aparición del texto', 'velocidadTexto', [['lenta', 'Pausada'], ['normal', 'Normal'], ['rapida', 'Rápida'], ['instantanea', 'Instantánea']]),
    grupo('Sugerencias si no escribes', 'esperaSugerencias', [[5, 'A los 5 s'], [7, 'A los 7 s'], [10, 'A los 10 s'], [0, 'Nunca']]),
    el('div', { class: 'ajuste' },
      el('p', { class: 'sub-eti', text: 'Máster' }),
      el('button', { class: 'btn', onClick: () => { $('#ajustes-modal').hidden = true; abrirNarrador(); } }, 'Elegir narrador e IA'),
    ),
    el('div', { class: 'ajuste' },
      el('p', { class: 'sub-eti', text: 'Datos' }),
      el('button', {
        class: 'btn btn--peligro',
        onClick: protegido('borrar datos', () => {
          if (!confirm('¿Borrar todas las partidas y personajes guardados en este navegador?')) return;
          sistema('saves')?.borrarTodo?.();
          try { Object.keys(localStorage).filter((k) => k.startsWith('arcanveil:')).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
          $('#ajustes-modal').hidden = true;
          pintarInicio();
        }),
      }, 'Borrar partidas y personajes'),
    ),
  );

  $('#ajustes-modal').hidden = false;
}

function abrirNarrador() {
  pintarDirectores();
  $('#ia-url').value = ver('settings.urlLocal', '') || 'http://127.0.0.1:11434';
  $('#ia-modelo').value = ver('settings.modeloLocal', '') || '';
  $('#groq-url').value = ver('settings.urlGroq', '') || 'http://127.0.0.1:11436';
  // El permiso es de esta sesión: se ve marcado solo si se dio en ella.
  $('#groq-consiento').checked = sistema('dungeonmaster')?.proveedor(PROVEEDORES.GROQ)?.inspeccionar?.().consentido === true;
  $('#groq-activar').disabled = true;
  $('#groq-estado').textContent = '';
  mostrarPanelNarrador(null);
  $('#director-modal').hidden = false;
}

/** Enseña el panel de configuración de un narrador (o ninguno). */
function mostrarPanelNarrador(id) {
  $('#ia-groq').hidden = id !== PROVEEDORES.GROQ;
  $('#ia-local').hidden = id !== PROVEEDORES.LOCAL;
}

/**
 * Probar Groq: pide al puente la lista de modelos. No genera nada ni envía
 * la partida. Sin el consentimiento marcado no se prueba.
 */
async function probarGroq() {
  const estado = $('#groq-estado');
  const activar = $('#groq-activar');
  activar.disabled = true;
  // Probar no necesita el permiso de enviar la historia: solo pide la lista
  // de modelos. Ese permiso hace falta para «Usar IA Groq».
  const groq = sistema('dungeonmaster')?.proveedor(PROVEEDORES.GROQ);
  groq?.configurar({ url: ($('#groq-url').value ?? '').trim() });
  estado.textContent = 'Comprobando el puente…';
  const r = await groq.probar();
  if (!r.ok) {
    estado.textContent = r.motivo + (/Origen/.test(r.motivo ?? '') ? ' Abre el juego en http://localhost:8080.' : '');
    return;
  }
  const uso = r.estado?.usoHoy;
  estado.textContent = 'Conectado al puente y a openai/gpt-oss-120b (no se ha enviado nada de tu partida).' + (uso ? ' Hoy: ' + uso.peticiones + ' peticiones y ' + uso.tokens + ' tokens de este puente.' : '')
    + (r.estado?.pausa ? ' En pausa: ' + r.estado.pausa.motivo + '.' : '')
    + ($('#groq-consiento').checked ? '' : ' Para usarla, marca antes la casilla de envío.');
  activar.disabled = !$('#groq-consiento').checked;
}

function activarGroq() {
  if (!$('#groq-consiento').checked) return;
  const dm = sistema('dungeonmaster');
  const url = ($('#groq-url').value ?? '').trim();
  dm?.proveedor(PROVEEDORES.GROQ)?.configurar({ url, consentido: true });
  store.fijar('settings.urlGroq', url);
  const r = dm?.cambiar(PROVEEDORES.GROQ);
  if (!r?.exito || r.motivo) { avisar(r?.motivo ?? 'No se pudo activar Groq', 'aviso'); return; }
  store.fijar('settings.proveedor', PROVEEDORES.GROQ);
  avisar('Narra la IA Groq. Si falla o se agota la cuota, sigue el procedural.', 'exito');
  $('#director-modal').hidden = true;
  pintarNarrador();
}

/** Retirar el consentimiento: deja de enviarse nada desde ya. */
function retirarConsentimientoGroq() {
  const dm = sistema('dungeonmaster');
  const groq = dm?.proveedor(PROVEEDORES.GROQ);
  // Marcar solo habilita «Usar» si ya se probó en esta sesión; el permiso se
  // da al pulsar «Usar IA Groq», no al marcar.
  if ($('#groq-consiento').checked) {
    $('#groq-activar').disabled = !groq?.inspeccionar?.().verificado;
    $('#groq-estado').textContent = $('#groq-estado').textContent.replace(' Para usarla, marca antes la casilla de envío.', '');
    return;
  }
  groq?.configurar({ consentido: false });
  $('#groq-activar').disabled = true;
  if (dm?.inspeccionar?.()?.elegido === PROVEEDORES.GROQ) {
    dm.cambiar(PROVEEDORES.PROCEDURAL);
    store.fijar('settings.proveedor', PROVEEDORES.PROCEDURAL);
    avisar('Groq desactivado: no se envía nada más. Narra el procedural.', 'info');
    pintarDirectores();
    pintarNarrador();
  }
}

/**
 * Quién narra ahora, siempre a la vista: en el botón del narrador. Si la IA
 * elegida ha fallado y narra el respaldo, se ve.
 */
function pintarNarrador() {
  const boton = $('#director');
  if (!boton) return;
  const dm = sistema('dungeonmaster');
  const elegido = dm?.inspeccionar?.()?.elegido ?? PROVEEDORES.PROCEDURAL;
  const meta = ver('meta.narrador', null);
  const groq = dm?.proveedor?.(PROVEEDORES.GROQ)?.inspeccionar?.();
  const sinConfirmar = elegido === PROVEEDORES.GROQ && !(groq?.consentido && groq?.verificado);
  const respaldo = !sinConfirmar && (Boolean(meta?.respaldo) || (elegido !== PROVEEDORES.PROCEDURAL && dm?.proveedorId === PROVEEDORES.PROCEDURAL));
  const corto = { [PROVEEDORES.GROQ]: 'IA Groq', [PROVEEDORES.LOCAL]: 'IA local', [PROVEEDORES.PUENTE]: 'Puente', [PROVEEDORES.PROCEDURAL]: 'Procedural' };
  boton.textContent = sinConfirmar ? 'Narrador: Groq sin confirmar' : respaldo ? 'Narrador: respaldo' : 'Narrador: ' + (corto[elegido] ?? 'Procedural');
  boton.title = sinConfirmar ? 'No se envía nada a Groq hasta que lo confirmes en esta sesión; narra el procedural.'
    : respaldo ? 'La IA elegida no responde; narra el procedural hasta que vuelva.' : 'Quién narra la aventura';
  boton.classList.toggle('es-respaldo', respaldo);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANTALLA DE JUEGO
   ═══════════════════════════════════════════════════════════════════════════ */

function refrescarTodo() {
  pintarEscena();
  pintarBitacora();
  pintarPersonaje();
  pintarLateral();
  pintarOpciones();
  pintarCabecera();
  pintarCombate();
}

/* ── escena ───────────────────────────────────────────────────────────── */

/** Nombres legibles de las franjas horarias. */
const FRANJAS_TEXTO = {
  madrugada: 'madrugada', alba: 'al alba', manana: 'por la mañana',
  mediodia: 'a mediodía', tarde: 'por la tarde', ocaso: 'al ocaso',
  noche: 'de noche',
};

/**
 * Pinta la ilustración del lugar y su rótulo.
 *
 * El arte depende del lugar, de la franja y del clima, así que esto se llama
 * en cada refresco. `pintarLugar` compara una firma y no repinta si nada ha
 * cambiado, que es lo que evita el parpadeo turno a turno.
 */
function pintarEscena() {
  const lugar = obtenerLugar(ver('world.ubicacion'));
  if (!lugar) return;

  const t = ver('world.tiempo', {}) ?? {};
  const clima = ver('world.clima.actual', 'despejado');
  // Las entradas de región son ilustraciones clave. El resto del viaje usa
  // paisaje 100% procedural; en estas seis, el raster recibe encima la misma
  // hora, clima y partículas del mundo vivo.
  const hitosRegion = new Set([
    'vado_yunque', 'arboleda_madre', 'forja_alta',
    'pilotes_brumal', 'umbral_albar', 'oasis_sal',
  ]);
  const momentoClave = hitosRegion.has(lugar.refId);

  // El paisaje del sitio (procedural, o la ilustración que trae el juego en
  // los hitos). Ya no se pide una ilustración a un servicio de fuera en cada
  // cambio de escena: `pintarLugar` no repinta si nada ha cambiado.
  pintarLugar($('#escena-lienzo'), lugar, { franja: t.franja, clima, momentoClave });

  const rotulo = $('#escena-rotulo');
  if (!rotulo) return;

  vaciar(rotulo);

  const plegada = escenaPlegada();
  $('#escena')?.classList.toggle('escena--plegada', plegada);

  rotulo.append(
    el('span', { class: 'escena__lugar', text: lugar.nombre }),
    el('span', { class: 'escena__dato', text: `día ${t.dia ?? 1}` }),
    el('span', { class: 'escena__sep', text: '·' }),
    el('span', { class: 'escena__dato', text: FRANJAS_TEXTO[t.franja] ?? '' }),
    el('span', { class: 'escena__sep', text: '·' }),
    el('span', { class: 'escena__dato', text: clima }),
    el('button', {
      class: 'escena__plegar', id: 'escena-plegar', type: 'button',
      'aria-expanded': String(!plegada),
      'aria-label': plegada ? 'Desplegar la ilustración' : 'Plegar la ilustración',
      title: plegada ? 'Desplegar' : 'Plegar',
      onClick: protegido('plegar escena', () => {
        guardarAjustes({ escenaPlegada: !plegada });
        pintarEscena();
      }),
    }, plegada ? '▾' : '▴'),
  );
}

/**
 * ¿La cabecera de escena va plegada?
 *
 * Es una preferencia del jugador y se recuerda. Si nunca la ha tocado, en
 * pantallas bajas —un móvil tumbado, uno pequeño— empieza plegada: la
 * ilustración se comería media pantalla y no quedaría sitio para leer.
 */
function escenaPlegada() {
  const guardada = leerAjustes().escenaPlegada;
  return typeof guardada === 'boolean' ? guardada : window.innerHeight < 700;
}

/* ── estudio de retratos ──────────────────────────────────────────────── */

/**
 * Lo que se le pide al generador para un personaje del jugador: el sujeto
 * en inglés (ver `src/art/rasgos.js`), su clave estable y su nombre.
 */
function encargoDePersonaje(p, id = p.id) {
  return {
    tipo: 'personaje',
    clave: claveRetrato({ id }),
    nombre: p.nombre ?? '',
    descripcion: sujetoRetrato({ raza: p.raza, descripcion: p.retrato ?? p.descripcion, genero: p.genero }) ?? '',
  };
}

/** Lo mismo para un compañero o personaje con nombre. */
function encargoDePnj(f) {
  return {
    tipo: 'pnj',
    clave: claveRetrato({ refId: f.refId }),
    nombre: f.nombre ?? '',
    rol: f.rol,
    descripcion: sujetoRetrato({ raza: f.linaje, descripcion: f.descripcion ?? `${f.rol ?? ''} ${f.nombre ?? ''}`, genero: f.genero }) ?? '',
  };
}

/** Por dónde va cada clave: «Otra versión» sigue contando al volver a abrir. */
const variantes = new Map();

/**
 * El estudio: pintar, ver la candidata en privado, pedir otra versión y,
 * solo si el jugador quiere, quedársela.
 *
 * Nada se pinta sin que el jugador lo pida. La candidata vive en esta
 * ventana y se tira al cerrarla; solo «Usar esta versión» la guarda en la
 * galería del navegador (ver `src/art/galeria.js`). Nunca en combate.
 *
 * @param {{tipo: string, clave: string, nombre: string, descripcion: string, rol?: string}} encargo
 * @param {{alTerminar?: Function}} [op]
 */
function abrirEstudio(encargo, { alTerminar } = {}) {
  if (ver('combat.activo', false)) {
    avisar('En combate no se pinta: termina la pelea primero.', 'aviso');
    return;
  }
  if (!encargo?.clave) {
    avisar('Este personaje no tiene identidad guardada: no se le puede asignar un retrato.', 'aviso');
    return;
  }
  document.getElementById('estudio')?.remove();

  const control = new AbortController();
  let peticion = 0;
  let candidata = null;          // { blob, url, variante }
  let estilo = null;

  const lienzo = el('div', { class: 'estudio__lienzo eleccion__cara', 'aria-live': 'polite' });
  const estado = el('p', { class: 'estudio__estado', role: 'status' });
  const pintar = el('button', { class: 'btn', id: 'estudio-pintar', type: 'button' }, 'Pintar');
  const otra = el('button', { class: 'btn btn--fantasma', id: 'estudio-otra', type: 'button', hidden: true }, 'Otra versión');
  const usar = el('button', { class: 'btn', id: 'estudio-usar', type: 'button', hidden: true }, 'Usar esta versión');
  const cerrar = el('button', { class: 'btn btn--fantasma', id: 'estudio-cerrar', type: 'button' }, 'Cerrar');

  const dialogo = el('dialog', { class: 'estudio', id: 'estudio', 'aria-labelledby': 'estudio-titulo' },
    el('h2', { class: 'estudio__titulo', id: 'estudio-titulo', text: `Retrato de ${encargo.nombre || 'tu personaje'}` }),
    el('p', { class: 'estudio__nota', text: 'Se pinta en tu equipo. Lo que salga es privado: no se guarda ni se envía a ningún sitio hasta que elijas una versión.' }),
    lienzo, estado,
    el('div', { class: 'estudio__acciones' }, pintar, otra, usar, cerrar),
  );

  const soltar = () => { if (candidata?.url) URL.revokeObjectURL(candidata.url); candidata = null; };
  const ocupado = (si) => { for (const b of [pintar, otra, usar]) b.disabled = si; };
  const actual = () => {
    // Lo que hay ahora: su retrato elegido, o el marcador.
    pintarRetrato(lienzo, { claveImagen: encargo.clave, nombre: encargo.nombre });
  };

  async function pedir(variante) {
    const esta = ++peticion;
    ocupado(true);
    estado.textContent = 'Pintando en tu equipo… puede tardar un minuto.';
    lienzo.dataset.estado = 'generando';
    try {
      const r = await pedirCandidata(encargo, { variante, signal: control.signal });
      if (esta !== peticion || !dialogo.isConnected) return;   // llegó tarde: ya se pidió otra
      soltar();
      candidata = { blob: r.blob, url: URL.createObjectURL(r.blob), variante };
      variantes.set(encargo.clave, variante);
      const img = el('img', { class: 'arte arte--imagen estudio__candidata', alt: `Versión ${variante + 1} del retrato de ${encargo.nombre}` });
      img.src = candidata.url;
      lienzo.dataset.firmaArte = '';
      lienzo.replaceChildren(img);
      estado.textContent = `Versión ${variante + 1}. ¿Te la quedas o pides otra?`;
      pintar.hidden = true; otra.hidden = false; usar.hidden = false;
    } catch (e) {
      if (esta !== peticion || !dialogo.isConnected) return;
      estado.textContent = e.message;
    } finally {
      if (esta === peticion) { ocupado(false); delete lienzo.dataset.estado; }
    }
  }

  pintar.addEventListener('click', protegido('pintar candidata', () => pedir((variantes.get(encargo.clave) ?? -1) + 1)));
  otra.addEventListener('click', protegido('otra versión', () => pedir((candidata?.variante ?? variantes.get(encargo.clave) ?? 0) + 1)));
  usar.addEventListener('click', protegido('usar versión', async () => {
    if (!candidata) return;
    ocupado(true);
    const r = await aprobar(encargo.clave, candidata.blob, { estilo: estilo ?? 'desconocido', tipo: encargo.tipo, nombre: encargo.nombre });
    if (!r.ok) { estado.textContent = r.motivo; ocupado(false); return; }
    if (!r.persistente) avisar('Retrato elegido, pero este navegador no deja guardarlo: se perderá al cerrar.', 'aviso');
    dialogo.close();
    alTerminar?.();
    refrescarTodo();
  }));
  cerrar.addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('close', () => { control.abort(); soltar(); dialogo.remove(); });

  document.body.append(dialogo);
  actual();
  dialogo.showModal();

  // Abrir el estudio es pedirlo: se mira si hay generador, sin pintar nada.
  estado.textContent = 'Buscando el generador de imágenes de este equipo…';
  ocupado(true);
  estadoGenerador().then((g) => {
    if (!dialogo.isConnected) return;
    estilo = g.estilo ?? null;
    if (!g.ok) { estado.textContent = g.motivo; pintar.disabled = true; return; }
    if ((encargo.descripcion ?? '').length < 8) { estado.textContent = 'Hace falta una descripción de su aspecto para pintarlo.'; pintar.disabled = true; return; }
    estado.textContent = urlAprobada(encargo.clave) ? 'Este es el que elegiste. Pinta otro si quieres cambiarlo.' : 'Listo para pintar.';
    ocupado(false);
  });
}

/* ── sugerencias ──────────────────────────────────────────────────────── */

/**
 * La interfaz base es una caja de texto libre. Las sugerencias solo aparecen
 * si el jugador lleva unos segundos sin escribir, en un pop-up discreto con
 * tres frases que encajan con lo que está pasando.
 */
let temporizadorSugerencias = null;

function ocultarSugerencias() {
  clearTimeout(temporizadorSugerencias);
  const capa = $('#sugerencias');
  if (capa) capa.hidden = true;
}

function programarSugerencias() {
  ocultarSugerencias();
  const espera = Number(leerAjustes().esperaSugerencias) || 0;
  if (!espera) return;
  temporizadorSugerencias = setTimeout(mostrarSugerencias, espera * 1000);
}

function mostrarSugerencias() {
  const capa = $('#sugerencias');
  const campo = $('#entrada');
  if (!capa || document.body.dataset.activeScreen !== 'juego') return;
  // Si el jugador escribe o pelea, no se le interrumpe. Si el máster aún
  // narra, se espera a que termine y se vuelve a mirar.
  if (campo?.value.trim() || ver('combat.activo', false)) return;
  if (campo?.disabled || escribiendo) {
    temporizadorSugerencias = setTimeout(mostrarSugerencias, 1000);
    return;
  }

  const opciones = (ver('narrative.opciones', []) ?? []).slice(0, 3);
  if (!opciones.length) return;

  const lista = $('#sugerencias-lista');
  vaciar(lista);
  for (const o of opciones) {
    lista.append(el('button', {
      class: 'sugerencia',
      dataset: { intent: String(o.intent ?? o.intencion ?? 'accion').toLowerCase() },
      onClick: protegido('sugerencia', () => enviar(o.label, o.intent)),
    }, o.label));
  }
  capa.hidden = false;
}

/* Compatibilidad: el motor sigue llamando a pintarOpciones al refrescar. */
function pintarOpciones() {
  const caja = $('#opciones');
  if (caja) { vaciar(caja); caja.hidden = true; }
}

/* ── aparición del texto ──────────────────────────────────────────────── */

/** Caracteres por segundo de cada velocidad. */
const VELOCIDADES = { lenta: 40, normal: 85, rapida: 170, instantanea: Infinity };

/** Entradas de la bitácora que ya se han enseñado enteras. */
let entradasVistas = 0;
let firmaBitacora = '';

/**
 * Id de la última tirada cuyo dado ya rodó.
 *
 * La bitácora se repinta entera en cada refresco, así que sin recordar esto
 * los dados ya vistos volverían a rodar turno tras turno.
 */
let ultimaTiradaAnimada = null;
/** Cola de párrafos pendientes de escribirse. */
const colaEscritura = [];
let escribiendo = false;

/**
 * La tarea que YA tiene un bucle de escritura propio, y los temporizadores en
 * vuelo.
 *
 * Existen porque la máquina de escribir se corrompía sola. La cadena era:
 * un párrafo termina y encola `escribirSiguiente` a 140ms; antes de que salte,
 * llega un turno nuevo, `pintarBitacora` vacía la cola y arranca la escritura
 * de los párrafos nuevos; entonces salta el temporizador VIEJO y arranca un
 * SEGUNDO bucle sobre el párrafo que ya se estaba escribiendo. Los dos bucles
 * terminaban y los dos hacían `shift()`, así que la cola se consumía del doble
 * de rápido: por cada párrafo escrito, uno se perdía sin escribir y su `<p>`
 * se quedaba vacío para siempre en la pantalla.
 *
 * Se veía como líneas en blanco en mitad de la narración. Con la cola vacía y
 * el estado lleno: el texto SÍ estaba generado y guardado, solo que nunca se
 * pintó.
 *
 * La regla ahora: un solo dueño. `tareaActiva` marca quién tiene bucle, y los
 * temporizadores se cancelan siempre que la cola se toca.
 */
let tareaActiva = null;
let relojEscritura = 0;
let cuadroEscritura = 0;

/** Corta en seco cualquier escritura en vuelo. No toca el texto ya puesto. */
function detenerEscritura() {
  if (relojEscritura) { clearTimeout(relojEscritura); relojEscritura = 0; }
  if (cuadroEscritura) { cancelAnimationFrame(cuadroEscritura); cuadroEscritura = 0; }
  tareaActiva = null;
  escribiendo = false;
}

/** Al cargar una partida, lo ya jugado aparece entero, sin efecto. */
function bitacoraSinAnimar() {
  entradasVistas = (ver('narrative.entradas', []) ?? []).length;
  firmaBitacora = '';
  colaEscritura.length = 0;
  detenerEscritura();
  pintarBitacora();
}

/** Termina de golpe todo lo que se estaba escribiendo. */
function completarEscritura() {
  const pendientes = colaEscritura.splice(0);
  detenerEscritura();

  for (const t of pendientes) {
    t.nodo.textContent = t.texto;
    t.nodo.classList.remove('se-escribe');
  }

  const caja = $('#bitacora');
  if (caja) caja.scrollTop = caja.scrollHeight;
}

function escribirSiguiente() {
  relojEscritura = 0;

  const tarea = colaEscritura[0];
  const caja = $('#bitacora');
  if (!tarea) { detenerEscritura(); programarSugerencias(); return; }

  // Ya hay un bucle sobre este párrafo. Entrar otra vez lo escribiría dos
  // veces y, peor, consumiría la cola por duplicado.
  if (tarea === tareaActiva && cuadroEscritura) return;

  tareaActiva = tarea;
  escribiendo = true;

  const cps = VELOCIDADES[leerAjustes().velocidadTexto] ?? VELOCIDADES.normal;

  // Con la pestaña oculta, el navegador congela `requestAnimationFrame`. El
  // texto se quedaba a medias —párrafos vacíos en pantalla, el relato entero
  // guardado en el estado— hasta que el jugador volvía, y si volvía tras un
  // repintado ya no se recuperaba. Escribir despacio solo tiene sentido si
  // hay alguien mirando: si no lo hay, el texto aparece entero y ya está.
  if (!Number.isFinite(cps) || document.hidden
      || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    completarEscritura();
    programarSugerencias();
    return;
  }

  const inicio = performance.now();
  tarea.nodo.classList.add('se-escribe');

  const paso = (ahora) => {
    cuadroEscritura = 0;
    if (colaEscritura[0] !== tarea) return;          // se completó de golpe
    const n = Math.min(tarea.texto.length, Math.floor(((ahora - inicio) / 1000) * cps) + 1);
    tarea.nodo.textContent = tarea.texto.slice(0, n);
    if (caja) caja.scrollTop = caja.scrollHeight;
    if (n < tarea.texto.length) { cuadroEscritura = requestAnimationFrame(paso); return; }
    tarea.nodo.classList.remove('se-escribe');
    colaEscritura.shift();
    tareaActiva = null;
    relojEscritura = setTimeout(escribirSiguiente, 140);
  };

  cuadroEscritura = requestAnimationFrame(paso);
}

/* ── bitácora ─────────────────────────────────────────────────────────── */

/* ── has caído ─────────────────────────────────────────────────────────── */

/**
 * Abre la bifurcación de la caída.
 *
 * Antes esto era un aviso flotante que decía «la crónica termina aquí» y no
 * terminaba nada: la caja seguía activa, cada «ataco» abría un combate nuevo
 * con el personaje a cero de vida y el juego contestaba «las piernas te
 * fallan» sin parar. Decirle al jugador que ha muerto y dejarle seguir jugando
 * es la peor de las dos opciones posibles.
 *
 * La fase la pone el motor (`Player._alCaer`), así que el turno ya está
 * bloqueado de verdad antes de que esto se pinte. Aquí solo se ofrece la
 * salida.
 *
 * @param {string} motivo Lo que le ha pasado, en una frase.
 */
function abrirCaida(motivo) {
  const modal = $('#caida-modal');
  if (!modal) return;

  bloquear(true);

  const dificultad = ver('settings.dificultad', 'equilibrado');
  const implacable = dificultad === 'implacable';

  $('#caida-nota').textContent = implacable
    ? `${motivo} En esta intensidad no hay vuelta atrás: la crónica de ${ver('player.nombre', 'tu personaje')} termina aquí.`
    : `${motivo} Puedes volver en ti, pero no sales de esta de gratis.`;

  const acciones = $('#caida-acciones');
  vaciar(acciones);

  if (!implacable) {
    acciones.append(el('button', {
      class: 'btn btn--grande', onClick: protegido('volver en ti', volverEnTi),
    }, 'Volver en ti'));
  }

  acciones.append(
    el('button', { class: 'btn', onClick: protegido('cargar partida', () => { modal.hidden = true; mostrar('cargar'); pintarCargar(); }) }, 'Cargar partida'),
    el('button', { class: 'btn btn--fantasma', onClick: protegido('nueva crónica', () => { modal.hidden = true; abrirCreacion(); }) }, 'Nueva crónica'),
  );

  modal.hidden = false;
}

/**
 * Te levantas, pero pagando.
 *
 * El precio no es simbólico: si no cuesta nada, caer deja de importar y el
 * combate pierde su tensión. Se cobra en oro porque es lo que menos rompe una
 * partida en marcha —perder el arma equipada a mitad de una misión frustra más
 * de lo que enseña— y se van horas del reloj, que es lo que justifica que
 * alguien te haya encontrado.
 */
async function volverEnTi() {
  const oro = ver('player.oro', 0);
  const perdido = Math.max(1, Math.round(oro * 0.4));

  store.transaccion(() => {
    store.dispatch('player/revivir', { vida: 1 });
    if (oro > 0) store.dispatch('inventory/oro', { delta: -perdido });
  });

  sistema('clock')?.avanzarTiempo(360, 'inconsciencia');

  bus.emit('narrative:direct', {
    texto: oro > 0
      ? `Despiertas horas después, con la boca seca y ${perdido} monedas menos. Alguien te encontró, te arrastró a cubierto y se cobró la molestia.`
      : 'Despiertas horas después, con la boca seca. Alguien te encontró y te arrastró a cubierto. No llevabas nada que valiera la pena robar.',
    voz: 'system',
  });

  $('#caida-modal').hidden = true;
  bloquear(false);
  refrescarTodo();
}

/* ── traer una historia de fuera ───────────────────────────────────────── */

/** Lo último que se leyó, para no reanalizar al confirmar. */
let historiaLeida = null;

/** Abre el modal de importación, vacío. */
function abrirImportar() {
  historiaLeida = null;
  const texto = $('#importar-texto');
  if (texto) texto.value = '';
  vaciar($('#importar-resultado'));
  $('#importar-modal').hidden = false;
}

/**
 * Lee lo pegado y enseña lo que ha entendido, sin aplicar nada todavía.
 *
 * La vista previa no es un adorno. El jugador acaba de pegar meses de partida
 * y tiene que ver que el juego ha entendido a SU gente antes de dejarle tocar
 * nada. Si se equivoca de protagonista, que lo vea aquí y no tres turnos
 * después, con la partida ya empezada.
 */
function leerHistoriaPegada() {
  const bruto = $('#importar-texto')?.value ?? '';
  const caja = $('#importar-resultado');
  vaciar(caja);

  const r = importarHistoria(bruto);
  historiaLeida = r;

  if (r.vacio) {
    caja.append(el('p', { class: 'modal__error', text: 'Hace falta algo más de texto: con menos de cuarenta palabras no hay historia que leer.' }));
    return;
  }

  const personas = r.personajes.filter((p) => p.tipo === 'persona');

  if (!personas.length) {
    caja.append(el('p', { class: 'modal__error', text: 'No he encontrado personajes. Si el texto los marca con guiones de diálogo («Nombre:»), se reconocen mejor.' }));
    return;
  }

  caja.append(el('p', { class: 'sub-eti', text: `He leído ${r.palabras} palabras. ¿Quién eres tú?` }));

  // Elegir protagonista: el juego propone, decide el jugador. Acertar casi
  // siempre significa equivocarse a veces con el personaje de alguien, y eso
  // es lo único que no se puede fallar aquí.
  const lista = el('div', { class: 'etiquetas', id: 'importar-quien' });
  const pie = el('p', { class: 'campo__ayuda', id: 'importar-otros' });

  // El pie se recalcula al elegir: decía «los demás» y los listaba a todos,
  // incluido el que acabas de marcar como tú mismo.
  const refrescarOtros = (elegido) => {
    const otros = personas.filter((p) => p.nombre !== elegido).map((p) => p.nombre);
    pie.textContent = otros.length
      ? `Los demás entran como gente que ya conoces: ${otros.slice(0, 6).join(', ')}.`
      : 'No hay nadie más en la historia.';
  };

  for (const [i, p] of personas.entries()) {
    const marcado = p.protagonistaProbable || (i === 0 && !personas.some((x) => x.protagonistaProbable));

    lista.append(el('button', {
      class: `btn btn--pequeno${marcado ? ' es-activo' : ''}`,
      'data-quien': p.nombre,
      onClick: (e) => {
        for (const b of lista.querySelectorAll('button')) b.classList.remove('es-activo');
        e.currentTarget.classList.add('es-activo');
        refrescarOtros(p.nombre);
      },
    }, p.nombre));
  }

  caja.append(lista, pie);
  refrescarOtros(personas.find((p) => p.protagonistaProbable)?.nombre ?? personas[0].nombre);

  if (r.hilos.length) {
    caja.append(el('p', { class: 'sub-eti', text: 'Quedó pendiente' }));
    for (const h of r.hilos) caja.append(el('p', { class: 'campo__ayuda', text: `· ${h}` }));
  }

  caja.append(el('div', { class: 'modal__acciones' },
    el('button', { class: 'btn btn--grande', id: 'importar-aplicar', onClick: protegido('aplicar historia', aplicarHistoria) }, 'Continuar desde aquí'),
  ));
}

/**
 * Vuelca lo leído en la ficha y en el canon.
 *
 * El protagonista rellena el nombre y la historia; los demás entran al canon
 * como gente conocida, para que el director pueda nombrarlos desde el primer
 * turno diciendo de ellos lo que el propio jugador escribió.
 *
 * La descripción física NO se toca: de un texto narrativo no se saca el
 * aspecto de forma fiable, y lo que se pinte tiene que ser lo que él quiera
 * ver. Ese campo lo sigue escribiendo él.
 */
function aplicarHistoria() {
  if (!historiaLeida) return;

  const elegido = $('#importar-quien button.es-activo')?.dataset.quien;
  if (!elegido) { avisar('Elige quién eres tú.', 'aviso'); return; }

  const yo = historiaLeida.personajes.find((p) => p.nombre === elegido);
  const otros = historiaLeida.personajes.filter((p) => p.nombre !== elegido);

  // Ficha del protagonista.
  const nombre = $('#nombre');
  if (nombre) { nombre.value = elegido.slice(0, 28); nombre.dispatchEvent(new Event('input', { bubbles: true })); }

  const lore = $('#lore-personaje');
  if (lore) {
    const partes = [...(yo?.notas ?? [])];

    const compas = otros.filter((p) => p.tipo === 'persona').slice(0, 4).map((p) => p.nombre);
    if (compas.length) partes.push(`Viaja con ${compas.join(', ')}.`);
    if (historiaLeida.hilos.length) partes.push(`Quedó pendiente: ${historiaLeida.hilos[0]}.`);

    lore.value = partes.join(' ').slice(0, 1200);
    lore.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // El resto de la gente y los sitios, al canon. Se hace por el bus para no
  // atarse a cómo guarda la memoria por dentro.
  for (const p of otros) {
    bus.emit('canon:registrar', {
      nombre: p.nombre,
      tipo: p.tipo,
      rasgos: [],
      nota: p.notas[0] ?? '',
    });
  }

  for (const h of historiaLeida.hilos) {
    bus.emit('memory:thread', { tipo: 'misterio', texto: h, relacionadoCon: 'historia_importada' });
  }

  $('#importar-modal').hidden = true;
  avisar(`Historia leída: ${elegido} y ${otros.length} más.`, 'exito');
}

/* ── modales: Escape, foco atrapado y foco devuelto ────────────────────── */

/**
 * Da a los cuatro modales el comportamiento que se espera de un modal.
 *
 * Antes no tenían ninguno: Escape no hacía nada, el tabulador se escapaba del
 * panel y recorría la partida que había detrás —visible por debajo del velo,
 * pero inalcanzable con el ratón— y al cerrar, el foco caía en el `<body>`, o
 * sea que había que tabular desde el principio del documento para volver a
 * donde estabas.
 *
 * Se resuelve con dos piezas globales en vez de tocar los veinte sitios que
 * abren o cierran un modal. El observador reacciona al atributo `hidden`, que
 * es lo que todos ellos cambian, así que funciona para los cuatro de hoy y
 * para el que se añada mañana sin acordarse de nada.
 */
function conectarModales() {
  const modales = [...document.querySelectorAll('.modal')];
  if (!modales.length) return;

  /** Dónde estaba el foco antes de abrir, para devolverlo al cerrar. */
  let focoPrevio = null;

  const abierto = () => modales.find((m) => !m.hidden) ?? null;

  const focusables = (m) => [...m.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((n) => n.offsetParent !== null);

  // Escape cierra; el tabulador da la vuelta dentro del panel.
  document.addEventListener('keydown', (ev) => {
    const m = abierto();
    if (!m) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      // Un modal fijo no se cierra con Escape: la pantalla de caída deja la
      // partida detenida y la caja de texto bloqueada, y cerrarla sin elegir
      // una salida dejaba al jugador sin nada que pulsar.
      if (m.dataset.fijo === undefined) m.hidden = true;
      return;
    }

    if (ev.key !== 'Tab') return;

    const lista = focusables(m);
    if (!lista.length) return;

    const primero = lista[0];
    const ultimo = lista[lista.length - 1];

    if (ev.shiftKey && document.activeElement === primero) {
      ev.preventDefault(); ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault(); primero.focus();
    }
  });

  const observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      const m = c.target;
      if (m.hidden) {
        // Se devuelve el foco solo si sigue dentro del modal que se cierra:
        // si el jugador ya se ha ido a otro sitio, no se le mueve.
        if (m.contains(document.activeElement) || document.activeElement === document.body) {
          focoPrevio?.focus?.();
        }
        focoPrevio = null;
      } else {
        focoPrevio = document.activeElement;
        focusables(m)[0]?.focus();
      }
    }
  });

  for (const m of modales) observador.observe(m, { attributes: true, attributeFilter: ['hidden'] });
}

/**
 * Dicta las entradas nuevas a la región viva del lector de pantalla.
 *
 * La tirada se convierte en frase. Un `<span>` con «d20 14» y otro con «vs 12»
 * se leen como dos números sueltos sin relación; dicho entero se entiende:
 * «d20 14, total 17 contra dificultad 12: éxito».
 *
 * @param {Array<Object>} nuevas
 */
function anunciarRelato(nuevas) {
  const region = $('#relato-vivo');
  if (!region || !nuevas?.length) return;

  const VOZ = { player: 'Tú', jugador: 'Tú', dm: 'Narrador', combat: 'Combate', combate: 'Combate', system: 'Aviso', sistema: 'Aviso', escena: 'Ilustración' };

  const partes = nuevas.map((e) => {
    if (e.voz === 'roll' || e.voz === 'tirada') {
      const t = e.meta?.tirada;
      if (!t) return '';
      // La dificultad se llama `umbral`, y el nombre bonito de la habilidad ya
      // viene hecho en `nombreHabilidad`; `habilidad` es el identificador
      // interno y se leería «percepcion», sin tilde.
      const veredicto = t.critico ? 'crítico' : t.pifia ? 'pifia' : t.exito ? 'éxito' : 'fracaso';
      const hab = t.nombreHabilidad ?? t.habilidad ?? 'habilidad';
      return `Tirada de ${hab}: d20 ${t.natural ?? '?'}, total ${t.total ?? '?'} contra dificultad ${t.umbral ?? '?'}. ${capitalizarTexto(veredicto)}.`;
    }
    const texto = String(e.texto ?? '').replace(/\n+/g, ' ').trim();
    if (!texto) return '';
    return `${VOZ[e.voz] ?? ''}: ${texto}`.replace(/^:\s*/, '');
  }).filter(Boolean);

  if (partes.length) region.textContent = partes.join(' ');
}

/** Primera letra en mayúscula, sin traerse una dependencia por una línea. */
function capitalizarTexto(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function pintarBitacora() {
  const caja = $('#bitacora');
  if (!caja) return;

  const entradas = ver('narrative.entradas', []) ?? [];

  // Refrescar sin cambios no repinta: así no se corta lo que se está escribiendo.
  const firma = `${entradas.length}|${entradas.at(-1)?.texto ?? ''}`;
  if (firma === firmaBitacora) return;
  firmaBitacora = firma;

  // Lo que se estaba escribiendo se da por leído antes de repintar, y el
  // escritor se para SIEMPRE, haya cola o no.
  //
  // El `if (colaEscritura.length)` que había aquí dejaba una ventana de 140ms
  // —entre que el último párrafo termina y salta el temporizador del
  // siguiente— en la que la cola está vacía pero `escribiendo` sigue en
  // cierto. Un repintado en ese hueco se saltaba la limpieza, encolaba
  // párrafos nuevos y luego no los arrancaba, porque la línea del final exige
  // `!escribiendo`. Resultado: la cola se quedaba parada para siempre con sus
  // `<p>` en blanco, y ni los turnos siguientes la desatascaban.
  //
  // Cada repintado es el único dueño del escritor. Nada sobrevive al anterior.
  completarEscritura();
  vaciar(caja);
  const primeraNueva = Math.max(0, entradas.length - 60);

  const visibles = entradas.slice(-60);
  const desdeReciente = Math.max(0, visibles.length - 3);

  for (const [indice, e] of visibles.entries()) {
    // El motor etiqueta esta voz como `roll`, no como `tirada`. Al buscar solo
    // `tirada` no coincidía nunca y las fichas de dados NO SE DIBUJABAN: el
    // juego resolvía las tiradas y no enseñaba ni una, que es justo lo que el
    // proyecto promete («el motor tira los dados y el director narra lo que ya
    // está decidido»). Se aceptan los dos nombres para no depender de cuál
    // emita cada sistema.
    if (e.voz === 'roll' || e.voz === 'tirada') {
      // El dado solo rueda para la tirada que acaba de ocurrir, y una sola
      // vez. La bitácora se repinta entera en cada refresco: sin este
      // candado, cada turno harían rodar de nuevo todos los dados visibles.
      const esNueva = Boolean(e.id) && e.id !== ultimaTiradaAnimada;

      const ficha = fichaTirada(e.meta?.tirada, {
        animar: esNueva && indice >= desdeReciente,
      });

      if (esNueva && indice >= desdeReciente) ultimaTiradaAnimada = e.id;

      if (indice >= desdeReciente) ficha.classList.add('es-reciente');
      caja.append(ficha);
      continue;
    }

    // Partidas antiguas guardaban aquí la dirección de una ilustración de un
    // servicio de fuera. Ya no se carga: pedirla filtraba que se estaba
    // jugando, y en un guardado manipulado podía apuntar a cualquier sitio.
    // Queda el pie, que es la parte de la historia.
    if (e.voz === 'escena') {
      if (e.texto) caja.append(el('p', { class: 'linea linea--escena', text: e.texto }));
      continue;
    }

    // Mismo desajuste con la voz del jugador: el motor dice `player` y aquí
    // solo estaba `jugador`, así que sus líneas perdían su estilo y salían
    // como texto corriente, indistinguibles de la narración.
    const clase = {
      dm: 'linea linea--dm',
      player: 'linea linea--jugador',
      jugador: 'linea linea--jugador',
      system: 'linea linea--sistema',
      sistema: 'linea linea--sistema',
      combat: 'linea linea--combate',
      combate: 'linea linea--combate',
    }[e.voz] ?? 'linea';

    // Solo la voz del máster se escribe; la acción del jugador aparece ya.
    const esNueva = primeraNueva + indice >= entradasVistas;
    const seEscribe = esNueva && (e.voz === 'dm' || e.voz === 'narrador');

    // La letra capital solo abre el turno, no cada línea.
    //
    // La narración va ahora por golpes —una frase por línea— y con la regla
    // anterior cada una llevaba su capitular de dos cuerpos: diez capitulares
    // seguidas no son una página iluminada, son un sarpullido. La capital
    // marca dónde empieza a hablar el máster, y eso ocurre una vez.
    let primeraDelTurno = true;

    for (const parrafo of String(e.texto ?? '').split('\n')) {
      if (!parrafo.trim()) continue;

      const clases = [clase];
      if (indice >= desdeReciente) clases.push('es-reciente');

      if (e.voz === 'dm' || e.voz === 'narrador') {
        // Los golpes —«CLANG.», «Y entonces...»— piden su propio peso: van
        // centrados, espaciados y sin capitular. Es la línea que el ojo tiene
        // que ver sola.
        if (esGolpe(parrafo)) clases.push('linea--golpe');
        else if (!primeraDelTurno) clases.push('linea--seguida');
        primeraDelTurno = false;
      }

      const nodo = el('p', { class: clases.join(' '), text: seEscribe ? '' : parrafo });
      caja.append(nodo);
      if (seEscribe) colaEscritura.push({ nodo, texto: parrafo });
    }
  }

  // Lo nuevo se dicta una sola vez y ya montado, para quien no ve la pantalla.
  // Va aquí y no en la bitácora porque la bitácora se reconstruye entera en
  // cada refresco: marcarla como región viva haría releer las sesenta
  // entradas cada turno.
  anunciarRelato(entradas.slice(entradasVistas));

  entradasVistas = entradas.length;
  caja.scrollTop = caja.scrollHeight;

  // Sin comprobar `escribiendo`: `completarEscritura` acaba de dejarlo en
  // falso unas líneas más arriba, y consultarlo aquí solo servía para no
  // arrancar cuando alguna bandera se había quedado colgada.
  if (colaEscritura.length) escribirSiguiente();
}

function fichaTirada(t, { animar = false } = {}) {
  if (!t) return el('span');

  const clase = t.pifia ? 'pifia' : t.critico ? 'critico' : t.exito ? 'exito' : 'fracaso';
  const etiqueta = t.pifia ? 'pifia' : t.critico ? 'crítico' : t.exito ? 'éxito' : 'fracaso';

  const dado = el('span', { class: 'tirada__dado', text: `d20 ${t.natural}` });

  const ficha = el('div', { class: `tirada tirada--${clase}` },
    dado,
    el('span', { class: 'tirada__cuenta', text: `${t.total} vs ${t.umbral}` }),
    el('span', { class: 'tirada__veredicto', text: etiqueta }),
    t.nombreHabilidad ? el('span', { class: 'tirada__hab', text: t.nombreHabilidad }) : null,
  );

  // Solo rueda la tirada recién ocurrida. Repintar la bitácora vuelve a crear
  // las fichas viejas, y verlas rodar todas de golpe cada turno sería absurdo.
  if (animar) {
    rodarDado(dado, t.natural, () => {
      // El crítico y la pifia son los dos momentos en que la tirada deja de
      // ser un trámite. Se subrayan al asentarse el dado, no antes.
      if (t.critico) sacudir(ficha, 'suave');
      if (t.pifia) sacudir(ficha, 'fuerte');
    });
  }

  return ficha;
}

/* ── cabecera ─────────────────────────────────────────────────────────── */

function pintarCabecera() {
  pintarNarrador();
  const caja = $('#cabecera-info');
  if (!caja) return;

  const lugar = obtenerLugar(ver('world.ubicacion'));
  const j = ver('player', {}) ?? {};

  vaciar(caja);

  // El lugar, el día y el clima viven ahora en el rótulo de la escena, encima
  // de la ilustración. Repetirlos aquí era ruido; la cabecera lleva lo que la
  // escena no dice: en qué región estás y quién eres.
  caja.append(
    el('span', { class: 'cab__lugar', text: j.nombre ?? 'ARCANVEIL' }),
    el('span', { class: 'cab__sep', text: '·' }),
    el('span', { text: `nivel ${j.nivel ?? 1}` }),
    lugar?.region ? el('span', { class: 'cab__sep', text: '·' }) : null,
    lugar?.region ? el('span', { text: String(lugar.region).replace(/_/g, ' ') }) : null,
  );
}

/* ── personaje ────────────────────────────────────────────────────────── */

function pintarPersonaje() {
  const caja = $('#panel-personaje');
  if (!caja) return;

  const j = ver('player', {}) ?? {};
  vaciar(caja);

  // Su retrato elegido, o el marcador. Pintar es cosa del jugador, y nunca
  // en combate.
  const ficha = fichaRetratoJugador();
  pintarRetrato($('#retrato-pj'), ficha);

  caja.append(
    el('div', { class: 'ficha-pj' },
      el('span', { class: 'ficha-pj__nombre', text: j.nombre ?? '—' }),
      el('span', { class: 'ficha-pj__clase', text: `nivel ${j.nivel ?? 1}` }),
      ficha.id && !ver('combat.activo', false) ? el('button', {
        class: 'btn btn--pequeno btn--fantasma', id: 'pj-pintar', type: 'button',
        onClick: protegido('pintar retrato', () => abrirEstudio(encargoDePersonaje(j, ficha.id))),
      }, urlAprobada(claveRetrato(ficha)) ? 'Cambiar retrato' : 'Pintar retrato') : null,
    ),
  );

  const atributos = j.atributos ?? {};
  const nombresAtributo = { fuerza:'FUE', destreza:'DES', constitucion:'CON', inteligencia:'INT', sabiduria:'SAB', carisma:'CAR' };
  caja.append(el('div', { class: 'medallones-atributos' },
    ...Object.entries(nombresAtributo).map(([clave, eti]) => {
      const valor = atributos[clave] ?? 10;
      const mod = Math.floor((valor - 10) / 2);
      return el('div', { class: 'medallon-atributo' },
        el('span', { class: 'medallon-atributo__eti', text: eti }),
        el('strong', { text: String(valor) }),
        el('span', { class: 'medallon-atributo__mod', text: mod >= 0 ? `+${mod}` : String(mod) }),
      );
    }),
  ));

  const barras = [
    ['Vida', j.vida?.actual ?? 0, j.vida?.max ?? 1, 'vida'],
    j.mana?.max ? ['Ánima', j.mana.actual, j.mana.max, 'mana'] : null,
    ['Hambre', j.hambre ?? 100, 100, 'hambre'],
    ['Sed', j.sed ?? 100, 100, 'sed'],
    ['Vigor', j.fatiga ?? 100, 100, 'fatiga'],
  ].filter(Boolean);

  for (const [eti, actual, max, clave] of barras) {
    const frac = Math.max(0, Math.min(1, actual / Math.max(1, max)));

    caja.append(el('div', { class: 'barra-caja' },
      el('div', { class: 'barra-caja__fila' },
        el('span', { text: eti }),
        el('span', { class: 'barra-caja__cifra', text: `${Math.round(actual)}/${max}` }),
      ),
      el('div', { class: 'barra' },
        el('div', {
          class: `barra__relleno barra__relleno--${clave}`,
          style: `width:${Math.round(frac * 100)}%`,
        }),
      ),
    ));
  }

  caja.append(el('div', { class: 'oro' },
    el('span', { text: 'Oro' }),
    el('span', { class: 'oro__cifra', text: String(j.oro ?? 0) }),
  ));

  // Estados alterados.
  const estados = j.estados ?? [];
  if (estados.length) {
    caja.append(el('div', { class: 'etiquetas' },
      // Dos mentiras vivían en esta línea. Pintaba el identificador interno
      // («sangrado») en vez del nombre del catálogo («Sangrando»), y marcaba
      // TODO como daño: los seis estados beneficiosos —Bendecido, Protegido,
      // Acelerado, Regenerando, Invisible, Concentrado— salían en rosa de
      // herida, así que una bendición se leía como una desgracia.
      //
      // La flecha va además del color porque el color solo no vale: quien no
      // distingue rojo de verde necesita algo más que un tono para saber si lo
      // que le acaba de pasar es bueno o malo.
      ...estados.map((e) => {
        const est = ESTADOS[e.refId];
        const bueno = est?.categoria === 'beneficio';
        return el('span', {
          class: `etiqueta etiqueta--${bueno ? 'bien' : 'mal'}`,
          text: `${bueno ? '▲' : '▼'} ${est?.nombre ?? String(e.refId).replace(/_/g, ' ')}`,
        });
      }),
    ));
  }

  // El grupo, bajo el personaje. En pantallas estrechas se esconde por CSS y
  // se ve en su pestaña del lateral.
  if ((ver('party.miembros', []) ?? []).length) {
    const grupo = el('div', { class: 'grupo', id: 'grupo-pj' }, el('p', { class: 'sub-eti', text: 'Grupo' }));
    caja.append(grupo);
    pintarGrupo(grupo);
  }
}

/* ── lateral: inventario, mapa, misiones ──────────────────────────────── */

let pestanaActiva = 'inventario';
let mercaderActivo = null;

function pintarLateral() {
  const caja = $('#panel-lateral');
  if (!caja) return;

  vaciar(caja);

  // El grupo tiene pestaña propia cuando hay alguien: en móvil es donde se
  // ve, porque el bloque bajo el personaje no cabe.
  const hayGrupo = (ver('party.miembros', []) ?? []).length > 0;
  const pestanas = [
    ['inventario', 'Bolsa'],
    ['mapa', 'Mapa'],
    ['misiones', 'Encargos'],
    ['gente', 'Gente'],
    hayGrupo ? ['grupo', 'Grupo'] : null,
  ].filter(Boolean);
  if (pestanaActiva === 'grupo' && !hayGrupo) pestanaActiva = 'inventario';

  caja.append(el('div', { class: 'pestanas' },
    ...pestanas.map(([clave, eti]) => el('button', {
      class: 'pestana' + (pestanaActiva === clave ? ' es-activa' : ''),
      onClick: protegido('pestaña', () => { pestanaActiva = clave; pintarLateral(); }),
      text: eti,
    })),
  ));

  const cuerpo = el('div', { class: 'lateral__cuerpo' });
  caja.append(cuerpo);

  try {
    if (pestanaActiva === 'inventario') pintarInventario(cuerpo);
    else if (pestanaActiva === 'mapa') pintarMapa(cuerpo);
    else if (pestanaActiva === 'misiones') pintarMisiones(cuerpo);
    else if (pestanaActiva === 'grupo') pintarGrupo(cuerpo);
    else pintarGente(cuerpo);
  } catch (e) {
    avisarFallo('panel ' + pestanaActiva, e);
  }
}

/**
 * Quien viaja con el personaje: su cara, su vida y con qué pelea.
 *
 * Se pinta bajo la ficha del personaje y en la pestaña «Grupo», con la misma
 * función, para que las dos vistas no se contradigan nunca.
 */
function pintarGrupo(caja) {
  const miembros = sistema('party')?.miembros?.() ?? [];
  if (!miembros.length) {
    caja.append(el('p', { class: 'lateral__vacio', text: 'Viajas solo. Pregúntale a alguien si viene contigo.' }));
    return;
  }

  for (const m of miembros) {
    const f = m.ficha;
    const cara = el('div', { class: 'grupo__cara' });
    const vida = m.vida ?? { actual: f.vidaMax, max: f.vidaMax };

    caja.append(el('div', { class: `grupo__miembro${m.herido ? ' es-herido' : ''}`, 'data-companero': f.refId },
      cara,
      el('div', { class: 'grupo__datos' },
        el('strong', { class: 'grupo__nombre', text: f.nombre }),
        el('span', { class: 'grupo__rol', text: `${f.rol} · ${f.especialidad}` }),
        el('span', { class: 'grupo__vida', text: m.herido ? `Herido · ${vida.actual}/${vida.max}` : `Vida ${vida.actual}/${vida.max}` }),
        el('span', { class: 'grupo__ataque', text: `${f.ataque.nombre} ${f.ataque.dano} · ${f.rasgo}` }),
        ver('combat.activo', false) ? null : el('button', {
          class: 'btn btn--pequeno btn--fantasma grupo__pintar', type: 'button', 'data-pintar': f.refId,
          onClick: protegido('pintar compañero', () => abrirEstudio(encargoDePnj(f))),
        }, urlAprobada(claveRetrato({ refId: f.refId })) ? 'Cambiar retrato' : 'Pintar retrato'),
      ),
    ));

    // Su retrato sale con las mismas reglas que el del jugador: el elegido,
    // o el marcador con su nombre. Por su identidad, no por su linaje.
    pintarRetrato(cara, { refId: f.refId, nombre: f.nombre });
  }
}

function pintarInventario(caja) {
  const objetos = Object.values(ver('inventory.objetos.porId', {}) ?? {});

  if (!objetos.length) {
    caja.append(el('p', { class: 'vacio', text: 'No llevas nada.' }));
    return;
  }

  for (const o of objetos) {
    caja.append(el('button', {
      class: 'objeto' + (o.equipado ? ' es-equipado' : ''),
      onClick: protegido('usar objeto', () => usarObjeto(o)),
    },
      el('span', { class: 'objeto__nombre', text: o.nombre }),
      o.cantidad > 1 ? el('span', { class: 'objeto__cant', text: `×${o.cantidad}` }) : null,
      o.equipado ? el('span', { class: 'objeto__marca', text: 'puesto' }) : null,
    ));
  }
}

function usarObjeto(o) {
  if (o.categoria === 'consumible') {
    store.dispatch('inventory/consumir', { idObjeto: o.id });
  } else if (['arma', 'armadura', 'escudo'].includes(o.categoria)) {
    store.dispatch(o.equipado ? 'inventory/desequipar' : 'inventory/equipar', {
      idObjeto: o.id,
      ranura: o.equipado ? Object.keys(ver('inventory.equipado', {}) ?? {})
        .find((r) => ver('inventory.equipado')[r] === o.id) : undefined,
    });
  }

  refrescarTodo();
}

function pintarMapa(caja) {
  const world = sistema('world');
  const destinos = world?.destinos() ?? [];

  const lugar = obtenerLugar(ver('world.ubicacion'));

  caja.append(el('p', { class: 'lugar-actual', text: lugar?.nombre ?? '—' }));

  if (lugar?.descripcion) {
    caja.append(el('p', { class: 'vacio', text: lugar.descripcion }));
  }

  if (!destinos.length) {
    caja.append(el('p', { class: 'vacio', text: 'No hay adónde ir desde aquí.' }));
    return;
  }

  caja.append(el('p', { class: 'sub-eti', text: 'Puedes ir a' }));

  for (const d of destinos) {
    // El peligro se decía SOLO con el color del número de horas: naranja para
    // arriesgado, rosa para peligroso. Un daltónico rojo-verde —uno de cada
    // doce hombres— elegía ruta a ciegas. Ahora lo pone la palabra, y el color
    // acompaña en vez de cargar con todo el mensaje.
    const nivel = d.peligro >= 3 ? ' · peligroso' : d.peligro >= 2 ? ' · arriesgado' : '';

    caja.append(el('button', {
      class: 'destino',
      onClick: protegido('viajar', () => viajar(d.refId)),
    },
      el('span', { text: d.nombre }),
      el('span', {
        class: 'destino__dato' + (d.peligro >= 3 ? ' es-peligro' : d.peligro >= 2 ? ' es-aviso' : ''),
        text: `${d.distancia} h${nivel}`,
      }),
    ));
  }
}

async function viajar(refId) {
  const travel = sistema('travel');
  if (!travel) return;

  const plan = travel.planificar(refId);

  if (!plan.viable) {
    bus.emit('narrative:direct', { texto: plan.motivo, voz: 'system' });
    refrescarTodo();
    return;
  }

  if (plan.sinProvisiones
    && !confirm(`No llevas provisiones para el camino a ${obtenerLugar(refId)?.nombre}. ¿Salir igualmente?`)) {
    return;
  }

  bloquear(true);
  await travel.viajar(refId, { forzar: true });
  bloquear(false);

  refrescarTodo();
}

function pintarMisiones(caja) {
  const quests = sistema('quests');
  const datos = quests?.paraInterfaz() ?? { activas: [], ofrecidas: [] };

  if (!datos.ofrecidas.length && !datos.activas.length) {
    caja.append(el('p', { class: 'vacio', text: 'Nadie te ha encargado nada todavía.' }));
    return;
  }

  for (const m of datos.ofrecidas) {
    caja.append(el('div', { class: 'mision mision--oferta' },
      el('p', { class: 'mision__titulo', text: m.titulo }),
      el('p', { class: 'mision__texto', text: m.resumen }),
      el('button', {
        class: 'btn btn--pequeno',
        onClick: protegido('aceptar misión', () => { quests.aceptar(m.refId); pintarLateral(); }),
        text: 'Aceptar',
      }),
      // Antes no se podía decir que no: el encargo se quedaba ofrecido para
      // siempre. También se puede escribir «no me interesa».
      el('button', {
        class: 'btn btn--pequeno btn--fantasma',
        onClick: protegido('rechazar misión', () => { quests.rechazar(m.refId); pintarLateral(); }),
        text: 'Rechazar',
      }),
    ));
  }

  for (const m of datos.activas) {
    caja.append(el('div', { class: 'mision' },
      el('p', { class: 'mision__titulo', text: m.titulo }),
      ...m.objetivos.map((o) => el('p', {
        class: 'mision__obj' + (o.hecho ? ' es-hecho' : ''),
        text: (o.hecho ? '✓ ' : '· ') + o.texto,
      })),
      // Un objetivo propio no paga nada ni lo cierra el juego: lo da por
      // cumplido el jugador cuando lo considera.
      m.tipo === 'meta'
        ? el('p', { class: 'mision__recompensa', text: 'Objetivo propio' })
        : el('p', { class: 'mision__recompensa', text: `${m.recompensa?.xp ?? 0} XP · ${m.recompensa?.oro ?? 0} oro` }),
      m.tipo === 'meta' ? el('button', {
        class: 'btn btn--pequeno btn--fantasma', text: 'Dar por cumplido',
        onClick: protegido('cumplir objetivo', () => {
          const r = quests.completar(m.refId, { forzar: true });
          avisar(r.aplicada ? 'Objetivo cumplido' : r.motivo, r.aplicada ? 'exito' : 'aviso');
          refrescarTodo();
        }),
      }) : null,
      m.tipo !== 'meta' && m.objetivos.every((o) => o.hecho) ? el('button', {
        class: 'btn btn--pequeno', text: 'Entregar encargo',
        onClick: protegido('entregar misión', () => {
          const r = quests.completar(m.refId);
          avisar(r.aplicada ? 'Encargo completado' : r.motivo, r.aplicada ? 'exito' : 'aviso');
          refrescarTodo();
        }),
      }) : null,
    ));
  }
}

function pintarGente(caja) {
  const npcs = sistema('npcs');
  const presentes = npcs?.paraInterfaz() ?? [];

  if (!presentes.length) {
    caja.append(el('p', { class: 'vacio', text: 'No hay nadie cerca.' }));
    return;
  }

  for (const n of presentes) {
    caja.append(el('div', { class: 'persona' },
      el('p', { class: 'persona__nombre', text: n.nombre }),
      el('p', { class: 'persona__rol', text: `${n.rol} · ${n.etiquetaActitud}` }),
      el('div', { class: 'persona__acciones' },
        el('button', {
          class: 'btn btn--pequeno',
          onClick: protegido('hablar', () => enviar(`Hablo con ${n.nombre}`)),
          text: 'Hablar',
        }),
        n.esMercader ? el('button', {
          class: 'btn btn--pequeno',
          onClick: protegido('comerciar', () => abrirComercio(n.refId)),
          text: 'Comerciar',
        }) : null,
      ),
    ));
  }
}

/* ── opciones sugeridas ───────────────────────────────────────────────── */

function abrirComercio(refId) {
  mercaderActivo = refId;
  sistema('merchants')?.abrir(refId);
  pintarComercio();
  $('#comercio-modal').hidden = false;
}

function pintarComercio() {
  const caja = $('#comercio-cuerpo');
  const mercado = sistema('merchants');
  const economia = sistema('economy');
  const catalogo = mercado?.catalogoParaInterfaz(mercaderActivo);
  if (!caja || !catalogo) return;
  vaciar(caja);
  $('#comercio-titulo').textContent = catalogo.mercader.nombre;
  $('#comercio-nota').textContent = `Tu oro: ${ver('player.oro', 0)} · Su oro: ${catalogo.oro}`;
  const compra = el('section', { class: 'comercio__seccion' }, el('h3', { text: 'Comprar' }));
  for (const o of catalogo.objetos) compra.append(el('div', { class: 'comercio__fila' },
    el('span', { class: 'comercio__nombre', text: `${o.nombre}${o.stock > 1 ? ` ×${o.stock}` : ''}` }),
    el('span', { class: 'comercio__precio', text: `${o.precio} oro` }),
    el('button', { class: 'btn btn--pequeno', text: 'Comprar', onClick: protegido('comprar', () => {
      const r = economia.comprar({ refIdMercader: mercaderActivo, objeto: o, cantidad: 1, stock: o.stock });
      avisar(r.exito ? `Comprado: ${o.nombre}` : r.mensaje, r.exito ? 'exito' : 'aviso'); pintarComercio(); refrescarTodo();
    }) })));
  caja.append(compra);
  const vendibles = mercado.vendibleA(mercaderActivo);
  if (vendibles.length) {
    const venta = el('section', { class: 'comercio__seccion' }, el('h3', { text: 'Vender' }));
    for (const o of vendibles) venta.append(el('div', { class: 'comercio__fila' },
      el('span', { class: 'comercio__nombre', text: `${o.nombre}${o.cantidad > 1 ? ` ×${o.cantidad}` : ''}` }),
      el('span', { class: 'comercio__precio', text: `${o.precio} oro` }),
      el('button', { class: 'btn btn--pequeno', text: 'Vender', onClick: protegido('vender', () => {
        const r = economia.vender({ refIdMercader: mercaderActivo, idObjeto: o.id, cantidad: 1 });
        avisar(r.exito ? `Vendido: ${o.nombre}` : r.mensaje, r.exito ? 'exito' : 'aviso'); pintarComercio(); refrescarTodo();
      }) })));
    caja.append(venta);
  }
}

/* ── entrada ──────────────────────────────────────────────────────────── */

function bloquear(si) {
  const campo = $('#entrada');
  const boton = $('#enviar');

  // Si el jugador ha caído, nada reabre la caja: la acción o el turno que
  // estaba en marcha cuando cayó termina después y llamaba a `bloquear(false)`.
  // Solo `volverEnTi`, que antes devuelve la fase a exploración, la reabre.
  const cerrada = !si && ver('meta.fase') === 'fin';

  if (campo) campo.disabled = si || cerrada;
  if (boton) boton.disabled = si || cerrada;

  $('#pensando').hidden = !si;
}

async function enviar(texto, intencion) {
  const campo = $('#entrada');
  const accion = (texto ?? campo?.value ?? '').trim();

  if (!accion) return;
  if (campo) { campo.value = ''; ajustarAltoEntrada(); }
  ocultarSugerencias();
  completarEscritura();

  // En combate, la caja principal ES la caja de combate.
  //
  // Había dos sitios donde escribir, y el de abajo —el que tiene el foco y el
  // que la mano busca— no hacía nada: mandaba el texto al turno normal, que
  // con un combate en curso devolvía «el momento pasa sin que ocurra nada
  // digno de mención». El jugador describía su jugada, leía una frase de
  // relleno y ningún punto de vida se movía.
  //
  // Una sola caja acaba con el problema de raíz: no se puede escribir en el
  // sitio equivocado si solo hay un sitio.
  if (ver('combat.activo', false)) {
    await accionCombateLibre(accion);
    return;
  }

  const turns = sistema('turns');
  if (!turns) return;

  bloquear(true);

  try {
    await turns.procesar(accion, { intencionSugerida: intencion });
  } catch (e) {
    avisarFallo('turno', e);
  } finally {
    bloquear(false);
  }

  refrescarTodo();
  guardarPartidaActual();
  $('#entrada')?.focus();
  if (!escribiendo) programarSugerencias();
}

/** La caja crece con el texto hasta un tope, como un chat. */
function ajustarAltoEntrada() {
  const campo = $('#entrada');
  if (!campo || campo.tagName !== 'TEXTAREA') return;
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 180)}px`;
}

/* ── combate ──────────────────────────────────────────────────────────── */

/**
 * A quién apunta el jugador. Se queda entre repintados.
 *
 * Vive fuera de `pintarCombate` porque la función reconstruye el panel entero
 * en cada golpe: guardarlo dentro significaría perder la puntería cada vez que
 * alguien pega.
 */
let objetivoCombate = null;

/**
 * El parte del combate: una línea por golpe.
 *
 * El motor las emite por `combat:log` desde el principio. Lo que faltaba era
 * alguien que las guardara.
 */
const registroCombate = [];

function pintarCombate() {
  const capa = $('#combate');
  if (!capa) return;

  const activo = ver('combat.activo', false);
  capa.hidden = !activo;

  // La caja de abajo cambia de sombrero. Es la misma caja, pero durante el
  // combate lo que se escriba ahí va al combate, y conviene que lo diga.
  const entrada = $('#entrada');
  if (entrada) {
    entrada.placeholder = activo
      ? 'Describe tu jugada: «le lanzo arena a los ojos»…'
      : 'Escribe lo que haces o dices…';
  }

  if (!activo) return;

  const manager = sistema('combat');
  const datos = manager?.paraInterfaz();
  if (!datos) return;

  vaciar(capa);

  capa.append(el('p', { class: 'combate__eti', text: `Combate · ronda ${datos.ronda}` }));

  // Retrato del enemigo vivo más amenazante. Si hay varios, manda el de más
  // nivel: es el que decide cómo va el combate y el que conviene mirar.
  // Solo se mira al otro bando: un compañero de más nivel se quedaba el
  // hueco y, sin ficha de enemigo, la del rival desaparecía.
  const esEnemigo = (c) => c.bando === 'enemigo';
  const rival = datos.combatientes
    .filter((c) => esEnemigo(c) && c.vivo)
    .sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0))[0];

  if (rival?.refId) {
    const plantilla = obtenerEnemigo(rival.refId);

    if (plantilla) {
      const marco = el('div', { class: 'combate__criatura' });

      // Cuántos quedan en pie de esa misma plantilla: en un combate contra
      // cuatro lobos importa más «×3 en pie» que cualquier otra cifra.
      const enPie = datos.combatientes
        .filter((c) => !c.esJugador && c.vivo && c.refId === rival.refId).length;

      // Su ficha: con qué pega y cómo se comporta. Saber que el saqueador
      // tira piedras de lejos o que huye si pierde cambia lo que conviene
      // escribir, y para eso hay que verlo.
      const habilidades = [
        ...(plantilla.ataques ?? []).map((a) => `${a.nombre} ${a.dano}${a.alcance === 'distancia' ? ' a distancia' : ''}`),
        plantilla.huye ? 'huye si pierde' : null,
        plantilla.negociable ? 'se puede negociar' : null,
      ].filter(Boolean).slice(0, 3);

      capa.append(el('div', { class: 'combate__rival' },
        marco,
        el('div', { class: 'combate__quien' },
          el('span', { class: 'combate__nombre', text: plantilla.nombre }),
          el('span', {
            class: 'combate__rasgo',
            text: `${plantilla.tipo} · ${plantilla.tamano}`
              + (enPie > 1 ? ` · ${enPie} en pie` : ''),
          }),
          habilidades.length
            ? el('span', { class: 'combate__habilidades', id: 'combate-habilidades', text: habilidades.join(' · ') })
            : null,
        ),
      ));

      const jefes = new Set(['devorador_de_brumas', 'guardian_de_la_puerta', 'senora_del_pantano']);
      pintarCriatura(marco, { ...plantilla, momentoClave: jefes.has(plantilla.refId) });
    }
  }

  // El objetivo deja de valer cuando cae: se pasa al siguiente en pie en vez
  // de dejar al jugador apuntando a un cadáver.
  //
  // Solo se apunta al otro bando. Con «no es el jugador» bastaba mientras
  // se peleaba solo; con compañeros, el primero de la lista era el compañero
  // y el botón decía «Atacar a Cornis».
  const enemigosVivos = datos.combatientes.filter((c) => esEnemigo(c) && c.vivo);
  if (!enemigosVivos.some((c) => c.id === objetivoCombate)) {
    objetivoCombate = enemigosVivos[0]?.id ?? null;
  }

  const lista = el('div', { class: 'combate__lista' });

  for (const c of datos.combatientes) {
    const frac = Math.round(c.fraccionVida * 100);
    const esObjetivo = c.id === objetivoCombate;
    const elegible = esEnemigo(c) && c.vivo;

    // Se puede elegir a quién pegar.
    //
    // El motor siempre aceptó un objetivo —`accionJugador({tipo, objetivo})`—
    // pero la interfaz no lo ofrecía, así que el golpe iba siempre al primero
    // de la lista. Con tres saqueadores delante, rematar al que está tocado es
    // una decisión de combate, y tomarla es media gracia del asunto.
    const atributos = {
      class: 'luchador'
        + (c.vivo ? '' : ' es-caido')
        + (esObjetivo ? ' es-objetivo' : '')
        + (elegible ? ' luchador--elegible' : ''),
      // El id permite que un golpe encuentre a SU objetivo en pantalla y le
      // lance el número encima. Sin esto, el daño saldría en un sitio genérico
      // y el jugador no vería a quién le pasó, que es media información.
      dataset: { luchador: c.id },
    };

    if (elegible) {
      atributos['aria-pressed'] = String(esObjetivo);
      atributos.onClick = () => { objetivoCombate = c.id; pintarCombate(); };
    }

    // Cada luchador con su cara.
    //
    // Estaba solo el retrato del rival principal, arriba y en grande. Con tres
    // saqueadores y un jugador, la lista era cuatro barras con nombre: hay que
    // leer para saber a quién estás apuntando. Una miniatura se reconoce de un
    // vistazo, que es lo que se necesita cuando lo que decides es a cuál
    // rematas.
    const cara = el('div', { class: 'luchador__cara' });

    lista.append(el(elegible ? 'button' : 'div', atributos,
      cara,
      el('div', { class: 'luchador__fila' },
        el('span', { text: c.nombre }),
        // La vida en números, no solo en palabras. «Tocado» no dice si aguanta
        // otro golpe; «7/22» sí, y esa es la cuenta que se hace en una mesa
        // antes de decidir si rematas o te cubres.
        el('span', {
          class: 'luchador__cond',
          text: c.vivo ? `${c.vida?.actual ?? '?'}/${c.vida?.max ?? '?'} · ${c.condicion}` : c.condicion,
        }),
      ),
      el('div', { class: 'barra' },
        el('div', {
          class: 'barra__relleno ' + (c.esJugador ? 'barra__relleno--vida' : 'barra__relleno--enemigo'),
          style: `width:${frac}%`,
        }),
      ),
      c.estados?.length
        ? el('div', { class: 'luchador__estados', text: c.estados.map((s) => s.nombre).join(' · ') })
        : null,
    ));

    // El retrato se pinta después de montar la fila: `pintarCriatura` compara
    // una firma contra el nodo y necesita que ya esté en su sitio.
    if (c.esJugador) pintarRetrato(cara, fichaRetratoJugador());
    else if (c.bando === 'aliado') {
      // Un compañero, con la misma cara que en la pestaña Grupo.
      const f = (sistema('party')?.miembros?.() ?? []).find((m) => m.ficha?.refId === c.refId)?.ficha;
      if (f) pintarRetrato(cara, { refId: f.refId, nombre: f.nombre });
    } else {
      const plantilla = obtenerEnemigo(c.refId);
      if (plantilla) pintarCriatura(cara, plantilla);
    }
  }

  capa.append(lista);

  // El parte del combate, golpe a golpe.
  //
  // El motor lleva desde siempre emitiendo `combat:log` con la línea de cada
  // ataque —quién pega a quién, cuánto saca, cuánto quita— y no lo recogía
  // nadie. El combate resolvía bien y el jugador solo veía barras moviéndose:
  // ganaba o perdía sin saber por qué, que en un juego de dados es lo único
  // que no puede pasar.
  if (registroCombate.length) {
    const parte = el('div', { class: 'combate__parte', id: 'combate-parte' });
    for (const linea of registroCombate.slice(-10)) {
      parte.append(el('p', { class: 'combate__linea', text: linea }));
    }
    capa.append(parte);
  }

  if (manager.esperandoJugador) {
    const objetivo = datos.combatientes.find((c) => c.id === objetivoCombate);

    capa.append(el('div', { class: 'combate__acciones' },
      el('button', {
        class: 'btn btn--peligro',
        // El nombre solo cabe si es corto. «Atacar a Lobo ceniciento C» parte
        // el botón en tres líneas y lo deja más alto que los otros dos; quién
        // es el objetivo ya lo dice la cuña de la lista.
        title: objetivo ? `Atacar a ${objetivo.nombre}` : 'Atacar',
        onClick: protegido('atacar', () => accionCombate('atacar', objetivoCombate)),
      }, objetivo && objetivo.nombre.length <= 12 ? `Atacar a ${objetivo.nombre}` : 'Atacar'),
      el('button', { class: 'btn', onClick: protegido('defender', () => accionCombate('defender')) }, 'Defender'),
      el('button', { class: 'btn btn--fantasma', onClick: protegido('huir', () => accionCombate('huir')) }, 'Huir'),
    ));

    // Ya no hay segunda caja.
    //
    // La había, y era la equivocada: el jugador escribía abajo —donde está el
    // foco y donde la mano busca— y aquel texto se iba al turno normal, que
    // devolvía una frase de relleno sin tocar un solo punto de vida. Dos
    // sitios para escribir lo mismo es una trampa, no una comodidad.
    capa.append(el('p', { class: 'combate__ayuda', text: 'O describe tu jugada abajo, con tus palabras.' }));
  } else {
    capa.append(el('p', { class: 'combate__espera', text: 'El enemigo actúa…' }));
  }

  // El parte se lee como cualquier registro: lo último es lo que acaba de
  // pasar, así que la vista se queda abajo.
  const parte = $('#combate-parte');
  if (parte) parte.scrollTop = parte.scrollHeight;
}

async function accionCombateLibre(desdeFuera) {
  const texto = String(desdeFuera ?? $('#combate-entrada')?.value ?? '').trim();
  if (!texto) return;

  const manager = sistema('combat');
  if (!manager?.esperandoJugador) return;

  bus.emit('narrative:direct', { texto, voz: 'player' });

  // La jugada escrita la lee el motor: qué es, a quién, con qué y cuánto
  // premia (ver `combat/Jugada.js`). Antes tres expresiones regulares la
  // reducían a atacar, defender o huir, y lo escrito no contaba. El objetivo
  // marcado vale si la frase no nombra otro: quien ha marcado al saqueador
  // tocado y escribe «le doy en la pierna» quiere decir a ÉSE.
  bloquear(true);
  await manager.jugadaLibre(texto, { marcado: objetivoCombate });
  bloquear(false);
  refrescarTodo();

  const campo = $('#combate-entrada');
  if (campo) campo.value = '';
}

async function accionCombate(tipo, objetivo = null) {
  const manager = sistema('combat');
  if (!manager?.esperandoJugador) return;

  bloquear(true);
  // El objetivo viaja al motor. Sin él, `accionJugador` cae en su objetivo por
  // defecto y la elección del jugador no servía de nada.
  await manager.accionJugador(objetivo ? { tipo, objetivo } : { tipo });
  bloquear(false);

  refrescarTodo();
}

/* ═══════════════════════════════════════════════════════════════════════════
   AVISOS
   ═══════════════════════════════════════════════════════════════════════════ */

function avisar(mensaje, tipo = 'info') {
  const caja = $('#avisos');
  if (!caja) return;

  const nodo = el('div', { class: `aviso aviso--${tipo}`, text: mensaje });
  caja.append(nodo);

  setTimeout(() => nodo.remove(), 4200);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ═══════════════════════════════════════════════════════════════════════════ */


async function probarIALocal() {
  const url = ($('#ia-url')?.value ?? '').trim();
  const modelo = ($('#ia-modelo')?.value ?? '').trim();
  const estado = $('#ia-estado'); const activar = $('#ia-activar');
  const dm = sistema('dungeonmaster'); const local = dm?.proveedor(PROVEEDORES.LOCAL);
  local?.configurar({ url, modelo });
  if (!url || !modelo) { estado.textContent = 'Indica la dirección y el modelo instalados.'; activar.disabled = true; return; }
  estado.textContent = 'Comprobando el modelo local…'; activar.disabled = true;
  const r = await local.probar();
  if (!r.ok) { estado.textContent = r.motivo; return; }
  estado.textContent = r.modelos.includes(modelo) ? `Conectado a ${modelo}.` : `Servidor conectado. Modelos: ${r.modelos.join(', ') || 'ninguno'}`;
  activar.disabled = !r.modelos.includes(modelo);
}

function activarIALocal() {
  const dm = sistema('dungeonmaster');
  const url = ($('#ia-url')?.value ?? '').trim(); const modelo = ($('#ia-modelo')?.value ?? '').trim();
  dm?.proveedor(PROVEEDORES.LOCAL)?.configurar({ url, modelo });
  const r = dm?.cambiar(PROVEEDORES.LOCAL);
  if (!r?.exito || r.motivo) { avisar(r?.motivo ?? 'No se pudo activar la IA local', 'aviso'); return; }
  store.fijar('settings.urlLocal', url); store.fijar('settings.modeloLocal', modelo); store.fijar('settings.proveedor', PROVEEDORES.LOCAL);
  avisar('Narra el modelo instalado en este PC. Si falla, sigue el procedural.', 'exito'); $('#director-modal').hidden = true;
  pintarNarrador();
}

function pintarDirectores() {
  const dm = sistema('dungeonmaster');
  const caja = $('#director-opciones');
  if (!dm || !caja) return;
  vaciar(caja);
  for (const opcion of dm.catalogo()) {
    const id = opcion.id ?? opcion.refId;
    caja.append(el('button', {
      class: 'director-opcion' + (dm.inspeccionar().elegido === id ? ' es-activo' : ''),
      onClick: protegido('cambiar narrador', () => {
        // Groq y el modelo local se configuran antes: Groq, además, no manda
        // nada hasta que el jugador acepta qué se envía.
        if (id === PROVEEDORES.GROQ || id === PROVEEDORES.LOCAL) { mostrarPanelNarrador(id); return; }
        const r = dm.cambiar(id);
        store.fijar('settings.proveedor', id);
        avisar(r.motivo ?? `Narrador: ${opcion.nombre}`, r.motivo ? 'aviso' : 'exito');
        pintarDirectores();
        pintarNarrador();
        $('#director-modal').hidden = true;
      }),
    // El catálogo trae `descripcion`; se leía `resumen`, que no existe, y
    // cada opción salía solo con su nombre. Y el límite, si lo tiene: el
    // director interno no improvisa como un modelo, y se dice aquí.
    }, el('strong', { text: opcion.nombre }), el('span', { text: opcion.descripcion ?? '' }),
    opcion.limite ? el('small', { class: 'director-opcion__limite', text: opcion.limite }) : null))
  }
}

function abrirPuente({ prompt }) {
  $('#puente-prompt').value = prompt ?? '';
  $('#puente-respuesta').value = '';
  $('#puente-error').hidden = true;
  $('#puente-modal').hidden = false;
}

function aplicarPuente() {
  const dm = sistema('dungeonmaster');
  const puente = dm?.proveedor(PROVEEDORES.PUENTE);
  const r = puente?.recibir($('#puente-respuesta')?.value ?? '');
  if (!r?.aceptada) {
    const error = $('#puente-error'); error.textContent = r?.motivo ?? 'La respuesta no es válida.'; error.hidden = false;
    return;
  }
  $('#puente-modal').hidden = true;
}

function conectarEventos() {
  $('#comercio-cerrar')?.addEventListener('click', () => { $('#comercio-modal').hidden = true; mercaderActivo = null; });
  $('#director')?.addEventListener('click', () => abrirNarrador());
  $('#ia-probar')?.addEventListener('click', protegido('probar IA local', probarIALocal));
  $('#ia-activar')?.addEventListener('click', protegido('activar IA local', activarIALocal));
  $('#groq-probar')?.addEventListener('click', protegido('probar Groq', probarGroq));
  $('#groq-activar')?.addEventListener('click', protegido('activar Groq', activarGroq));
  $('#groq-consiento')?.addEventListener('change', protegido('consentimiento Groq', retirarConsentimientoGroq));
  bus.on('turn:end', () => pintarNarrador());
  bus.on('dm:degraded', () => pintarNarrador());
  bus.on('dm:recovered', () => pintarNarrador());
  $('#director-cerrar')?.addEventListener('click', () => { $('#director-modal').hidden = true; });
  $('#puente-copiar')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('#puente-prompt').value); avisar('Encargo copiado', 'exito'); });
  $('#puente-aplicar')?.addEventListener('click', protegido('respuesta del puente', aplicarPuente));
  $('#puente-cancelar')?.addEventListener('click', () => sistema('dungeonmaster')?.proveedor(PROVEEDORES.PUENTE)?.cancelar());
  bus.on('bridge:open', abrirPuente);
  bus.on('bridge:close', () => { $('#puente-modal').hidden = true; });

  // Entrada de texto.
  $('#enviar')?.addEventListener('click', protegido('enviar', () => enviar()));

  $('#entrada')?.addEventListener('input', () => { ajustarAltoEntrada(); ocultarSugerencias(); if (!$('#entrada').value.trim()) programarSugerencias(); });
  $('#bitacora')?.addEventListener('click', () => { if (escribiendo) { completarEscritura(); programarSugerencias(); } });

  // Al irse a otra pestaña se vuelca lo que quedara por escribir. Nadie lo
  // está viendo aparecer, y así al volver está el texto entero en vez de
  // párrafos en blanco esperando un fotograma que no llegó.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && escribiendo) { completarEscritura(); programarSugerencias(); }
  });

  conectarModales();

  $('#importar-cerrar')?.addEventListener('click', () => { $('#importar-modal').hidden = true; });
  $('#importar-leer')?.addEventListener('click', protegido('leer historia', leerHistoriaPegada));

  $('#sugerencias-cerrar')?.addEventListener('click', () => ocultarSugerencias());
  bus.on('combat:start', () => ocultarSugerencias());
  bus.on('combat:end', () => { guardarPartidaActual(); programarSugerencias(); });
  $('#entrada')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  });

  $('#cargar-volver')?.addEventListener('click', () => { mostrar('inicio'); pintarInicio(); });
  $('#inicio-jugar')?.addEventListener('click', () => abrirMenuInicio());
  $('#inicio-volver')?.addEventListener('click', () => cerrarMenuInicio());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const seccion = document.querySelector('section[data-pantalla="inicio"]');
    if (seccion && !seccion.hidden && seccion.dataset.estado === 'menu') cerrarMenuInicio();
  });
  $('#ajustes-cerrar')?.addEventListener('click', () => { $('#ajustes-modal').hidden = true; });
  $('#menu')?.addEventListener('click', protegido('menú', () => {
    guardarPartidaActual();
    // Tras recargar, directamente al menú: quien pulsa «Menú» no quiere ver
    // otra vez la portada.
    try { sessionStorage.setItem('arcanveil:abrir-menu', '1'); } catch { /* sin sesión, portada */ }
    // Volver al título recargando deja el motor limpio para la próxima partida.
    location.reload();
  }));

  $('#guardar')?.addEventListener('click', protegido('guardar', () => {
    const saves = sistema('saves');
    store.fijar('settings.persistencia', true);
    bus.emit('settings:change', { id: 'persistencia', valor: true });

    const r = guardarPartidaActual({ silencioso: true });
    avisar(r?.exito ? 'Partida guardada' : (r?.motivo ?? 'No se pudo guardar'),
      r?.exito ? 'exito' : 'aviso');
  }));

  // El motor avisa; la interfaz lo muestra.
  bus.on('ui:notice', ({ mensaje, tipo }) => avisar(mensaje, tipo));
  bus.on('achievement:unlocked', ({ nombre }) => avisar(`Hazaña: ${nombre}`, 'exito'));
  // Subir de nivel merece más que un aviso en la esquina: es de las pocas
  // cosas que cambian lo que puedes intentar.
  bus.on('player:levelup', ({ nivel }) => {
    rotuloMomento(`NIVEL ${nivel}`, 'oro');
    avisar(`Has subido a nivel ${nivel}`, 'exito');
  });

  // El parte de cada golpe, recogido.
  //
  // `combat:log` se emitía y se escuchaba solo para repintar; su texto —que es
  // justo lo que cuenta lo ocurrido— se tiraba. Aquí se guarda.
  bus.on('combat:log', ({ texto }) => {
    if (texto) registroCombate.push(texto);
    // Techo generoso: el panel enseña las diez últimas, pero el combate entero
    // cabe sin problema y un día puede querer leerse completo.
    if (registroCombate.length > 200) registroCombate.splice(0, registroCombate.length - 200);
  });

  // Cada combate empieza con el parte en blanco y sin puntería heredada.
  bus.on('combat:start', () => { registroCombate.length = 0; objetivoCombate = null; });

  // Cualquier cambio del mundo redibuja lo que corresponda.
  for (const evento of ['combat:start', 'combat:end', 'combat:turn', 'combat:awaiting', 'combat:log']) {
    bus.on(evento, () => { pintarCombate(); pintarBitacora(); });
  }

  // El golpe, en pantalla. Una barra que baja dice que pasó algo; esto dice
  // cuánto y a quién. Se engancha a `combat:attack`, que ya trae el daño
  // resuelto por el motor: aquí no se calcula nada, solo se enseña.
  bus.on('combat:attack', (golpe) => {
    if (!golpe?.dano?.total) return;

    // El repintado del panel ocurre en el mismo tic; se espera a que el
    // objetivo exista en el DOM o el número saldría sobre un nodo muerto.
    setTimeout(() => {
      const objetivo = $(`[data-luchador="${golpe.objetivo?.id}"]`);
      if (!objetivo) return;

      const critico = Boolean(golpe.tirada?.critico);

      numeroDano(objetivo, golpe.dano.total, {
        critico,
        esJugador: golpe.objetivo?.esJugador,
      });

      destello(objetivo, 'dano');

      // La sacudida se reserva: el crítico y el golpe que derriba. Si todo
      // tiembla, el temblor deja de significar nada.
      if (critico || golpe.cayo) {
        sacudir($('#combate'), golpe.cayo ? 'fuerte' : 'suave');
      }
    }, 30);
  });

  bus.on('narrative:direct', () => setTimeout(pintarBitacora, 10));
  bus.on('world:arrived', () => refrescarTodo());
  // Se escuchan los DOS avisos de caída. `player:defeated` lo emite el
  // combate; `player:down` lo emite el jugador cuando cae fuera de combate,
  // por hambre, sed o agotamiento. Solo se escuchaba el primero, así que morir
  // de hambre no sacaba rótulo, ni aviso, ni nada: el personaje llegaba a cero
  // de vida y la partida seguía como si tal cosa.
  //
  // Los dos pueden llegar juntos. Si la pantalla de caída ya está abierta,
  // basta con asegurar la caja cerrada. Se mira la pantalla y no una marca:
  // la marca solo se rearmaba al crear personaje, así que tras «Volver en ti»
  // o cargar partida la segunda caída de la sesión dejaba la fase en `fin`
  // sin pantalla y con la caja abierta.
  const caer = (motivo) => {
    const modal = $('#caida-modal');
    if (modal && !modal.hidden) { bloquear(true); return; }
    rotuloMomento('HAS CAÍDO', 'sangre');
    abrirCaida(motivo);
  };

  bus.on('player:defeated', () => caer('El combate te ha podido.'));
  bus.on('player:down', ({ causa } = {}) => caer(causa ? `Te ha podido ${causa}.` : 'No has aguantado más.'));

  // Un retrato elegido (o la galería recién cargada) se ve en todas partes:
  // la galería llega después de pintar la primera pantalla, que suele ser la
  // de inicio con los personajes guardados.
  alCambiarGaleria(() => {
    const pantalla = document.body.getAttribute('data-active-screen');
    if (pantalla === 'juego') refrescarTodo();
    else if (pantalla === 'inicio') pintarInicio();
  });
}

/** Retira la pantalla de arranque y muestra el juego. */
function arranqueListo() {
  const capa = document.getElementById('arranque');

  if (capa) {
    capa.hidden = true;
    // El rótulo trae `display:flex` en línea para verse antes que la hoja de
    // estilos, y eso gana a cualquier regla: hay que apagarlo en línea también
    // o se queda tapando el juego con el motor ya en marcha.
    capa.style.display = 'none';
  }

  document.body.classList.add('esta-listo');
}

/** Deja el fallo escrito en la pantalla de arranque, que sí se ve. */
function arranqueFallido(donde, error) {
  const capa = document.getElementById('arranque');
  if (capa) capa.hidden = false;

  const texto = document.getElementById('arranque-texto');
  if (texto) {
    texto.style.color = '#E5A08C';
    texto.textContent = `No se pudo arrancar · ${donde}`;
  }

  // La traza completa, a la vista: es lo que hace falta para arreglarlo.
  const detalle = document.getElementById('arranque-detalle');
  if (detalle) {
    detalle.style.display = 'block';
    detalle.textContent = `${error?.name ?? 'Error'}: ${error?.message ?? error}\n\n`
      + String(error?.stack ?? '(sin traza)').split('\n').slice(0, 8).join('\n');
  }

  avisarFallo(donde, error);
}

async function arrancar() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js').catch((e) => console.warn('[arcanveil] modo offline no disponible', e));
  }
  // Si algo se cuelga, a los ocho segundos se dice en pantalla en vez de
  // dejar al jugador mirando un rótulo eterno.
  const vigilante = setTimeout(() => {
    if (!motor.listo) {
      arranqueFallido('tiempo agotado', new Error('el motor tardó demasiado en arrancar'));
    }
  }, 8000);

  try {
    await arrancarMotor();
  } catch (e) {
    clearTimeout(vigilante);
    arranqueFallido('motor', e);
    return;
  }

  clearTimeout(vigilante);

  // Si hay imágenes declaradas en assets/, sustituirán al arte vectorial. No
  // se espera a que termine: sin manifiesto el juego funciona igual, y hacer
  // que el arranque dependa de una petición que casi siempre falla sería
  // pagar un retraso por nada.
  // La ruta es relativa a `app/index.html`, que es el documento que la pide.
  cargarManifiesto('../assets/manifest.json').then((hubo) => {
    if (!hubo) return;

    // Llega después de que la pantalla ya esté pintada, así que hay que
    // repintar la que esté a la vista para que las imágenes releven al vector.
    const pantalla = document.body.getAttribute('data-active-screen');

    if (pantalla === 'juego') refrescarTodo();
  });

  // Los retratos elegidos viven en el navegador (IndexedDB): se cargan sin
  // esperar, y al llegar se repinta lo que esté a la vista.
  abrirGaleria();

  try {
    recuperarPersistencia();
    conectarEventos();
    pintarInicio();
    mostrar('inicio');
    let alMenu = false;
    try { alMenu = sessionStorage.getItem('arcanveil:abrir-menu') === '1'; sessionStorage.removeItem('arcanveil:abrir-menu'); } catch { /* sin sesión */ }
    if (alMenu) abrirMenuInicio({ foco: false });
    menuTrasArrancar = true;
    arranqueListo();
    comenzarPendiente();
  } catch (e) {
    // Aunque la interfaz falle, la pantalla se descubre: es mejor ver el
    // error que un vacío.
    arranqueListo();
    arranqueFallido('interfaz', e);
  }

  // Para inspeccionar desde la consola del navegador.
  window.ARCANVEIL = {
    motor, store, bus, ver,
    sistema,
    jugar: (t) => enviar(t),
    interfaz: { mostrarSugerencias, completarEscritura, estado: () => ({ escribiendo, cola: colaEscritura.length, temporizador: Boolean(temporizadorSugerencias) }) },
    inspeccionar: (n) => (n ? sistema(n)?.inspeccionar?.() : motor.registry?.inspeccionar?.()),
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancar);
} else {
  arrancar();
}
