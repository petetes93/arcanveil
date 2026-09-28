/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · tools/motor-sin-ventana.mjs
 * ---------------------------------------------------------------------------
 * El motor de verdad, en Node y sin interfaz.
 *
 * Las auditorías prueban piezas sueltas con estados de mentira; la regresión
 * juega en un Chrome. Faltaba lo de en medio: una partida entera con todos
 * los sistemas —el mismo `registrarTodos` que `main.js`—, jugada turno a
 * turno con el narrador interno, con semilla fija y en segundos. Es lo que
 * permite comprobar que un hecho del turno 2 sigue ahí en el turno 12 y
 * después de guardar y cargar.
 *
 * Solo se sustituye lo que Node no tiene: `localStorage` y `sessionStorage`
 * (en memoria) y `window` (el propio global).
 *
 *   import { crearMotor } from './motor-sin-ventana.mjs';
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Un almacenamiento en memoria con la misma forma que el del navegador. */
function almacen() {
  const datos = new Map();
  return {
    get length() { return datos.size; },
    key: (i) => [...datos.keys()][i] ?? null,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => { datos.set(k, String(v)); },
    removeItem: (k) => { datos.delete(k); },
    clear: () => datos.clear(),
  };
}

globalThis.window ??= globalThis;
globalThis.location ??= { hostname: 'sin-ventana', protocol: 'node:', href: 'node://sin-ventana/', search: '' };
globalThis.localStorage ??= almacen();
globalThis.sessionStorage ??= almacen();

const { store } = await import('../src/core/Store.js');
const { bus } = await import('../src/core/EventBus.js');
const { GestorRNG } = await import('../src/core/RNG.js');
const { Registry } = await import('../src/core/Registry.js');
const { Logger, NIVEL } = await import('../src/core/Logger.js');

const S = (ruta, nombre) => import(ruta).then((m) => m[nombre]);
const SISTEMAS = await Promise.all([
  S('../src/core/Clock.js', 'Clock'),
  S('../src/player/Player.js', 'Player'), S('../src/inventory/Inventory.js', 'Inventory'),
  S('../src/world/TimeSystem.js', 'TimeSystem'), S('../src/world/WeatherSystem.js', 'WeatherSystem'),
  S('../src/world/DynamicEvents.js', 'DynamicEvents'), S('../src/world/Travel.js', 'Travel'),
  S('../src/world/Exploration.js', 'Exploration'), S('../src/world/World.js', 'World'),
  S('../src/npc/RelationshipSystem.js', 'RelationshipSystem'), S('../src/npc/ReputationSystem.js', 'ReputationSystem'),
  S('../src/npc/FactionSystem.js', 'FactionSystem'), S('../src/npc/DialogueSystem.js', 'DialogueSystem'),
  S('../src/npc/MerchantSystem.js', 'MerchantSystem'), S('../src/economy/EconomySystem.js', 'EconomySystem'),
  S('../src/quests/QuestSystem.js', 'QuestSystem'), S('../src/npc/PartySystem.js', 'PartySystem'),
  S('../src/world/SceneSystem.js', 'SceneSystem'), S('../src/world/SituationSystem.js', 'SituationSystem'),
  S('../src/progression/StatsTracker.js', 'StatsTracker'), S('../src/progression/AchievementSystem.js', 'AchievementSystem'),
  S('../src/progression/Milestones.js', 'Milestones'), S('../src/persistence/SaveManager.js', 'SaveManager'),
  S('../src/engine/RulesEngine.js', 'RulesEngine'), S('../src/engine/EffectApplier.js', 'EffectApplier'),
  S('../src/combat/CombatManager.js', 'CombatManager'),
  S('../src/ai/DungeonMaster.js', 'DungeonMaster'), S('../src/engine/ActionRouter.js', 'ActionRouter'),
  S('../src/engine/ConsequenceEngine.js', 'ConsequenceEngine'), S('../src/engine/DifficultyDirector.js', 'DifficultyDirector'),
  S('../src/engine/TurnResolver.js', 'TurnResolver'),
]);

let motor = null;

/**
 * Arranca un motor con SU semilla. `store` y `bus` son únicos por proceso,
 * así que si ya había uno se detiene (sus sistemas se dan de baja del bus) y
 * el estado se vacía antes de arrancar el nuevo.
 *
 * Antes devolvía siempre el primero: una segunda partida en el mismo proceso
 * ignoraba su semilla y heredaba lo que los sistemas guardan por dentro (un
 * encuentro en curso, lo que el narrador ya había descrito). Las
 * herramientas que juegan varias partidas seguidas no medían partidas
 * independientes.
 *
 * @param {Object} [opciones]
 * @param {number} [opciones.semilla=20260925]
 * @param {boolean} [opciones.silencio=true] Sin el registro del motor en consola.
 */
export async function crearMotor({ semilla = 20260925, silencio = true } = {}) {
  if (silencio) Logger.nivel(NIVEL.SILENCIO);
  if (motor) {
    await motor.registry.detener();
    store.reiniciar();
    motor = null;
  }

  const rng = new GestorRNG(semilla);
  store.fijar('meta.semilla', rng.semillaMaestra);
  const registry = new Registry({ store, bus, rng });
  registry.registrarTodos(SISTEMAS);
  await registry.iniciar();

  const sistema = (n) => registry.obtener(n);
  const ver = (ruta, d) => store.select(ruta, d);
  const entradas = () => ver('narrative.entradas', []) ?? [];

  motor = {
    store, bus, rng, registry, sistema, ver, entradas,

    /**
     * Empieza una partida como lo hace la app: crear personaje y abrir.
     * @param {Object} borrador nombre, raza, clase, trasfondo, retrato, lore…
     */
    async empezar(borrador, { dificultad = 'equilibrado' } = {}) {
      store.fijar('settings.persistencia', true);
      store.fijar('settings.autoguardado', false);
      bus.emit('settings:change', { id: 'persistencia', valor: true });
      store.fijar('settings.dificultad', dificultad);
      store.dispatch('player/crear', { borrador });
      await new Promise((r) => setTimeout(r, 0));
      await sistema('turns').abrirCronica();
      return textoDesde(0);
    },

    /**
     * Juega un turno y devuelve lo narrado en él.
     * @param {string} texto
     * @returns {Promise<string>}
     */
    async jugar(texto) {
      const antes = entradas().length;
      await sistema('turns').procesar(texto);
      return textoDesde(antes);
    },

    /** Las sugerencias que la app enseñaría ahora (las tres primeras). */
    opciones() {
      return (ver('narrative.opciones', []) ?? []).slice(0, 3);
    },

    /**
     * Pulsa una sugerencia como lo hace la app: su texto y su intención.
     * @param {{label: string, intent?: string}} opcion
     */
    async pulsar(opcion) {
      const antes = entradas().length;
      await sistema('turns').procesar(opcion.label, { intencionSugerida: opcion.intent });
      return textoDesde(antes);
    },

    /** Guarda y vuelve a cargar la partida, como al cerrar y abrir. */
    guardarYCargar(ranura = '9') {
      const g = sistema('saves').guardar(ranura, { silencioso: true });
      if (!g.exito) throw new Error(`no se pudo guardar: ${g.motivo}`);
      store.reiniciar();
      const c = sistema('saves').cargar(ranura);
      if (!c.exito) throw new Error(`no se pudo cargar: ${c.motivo}`);
      return c;
    },
  };

  /** Lo narrado desde la entrada n, sin las fichas de tirada. */
  function textoDesde(n) {
    return entradas().slice(n)
      .filter((e) => e.voz !== 'roll' && e.voz !== 'tirada')
      .map((e) => (e.voz === 'player' || e.voz === 'jugador' ? `» ${e.texto}` : e.texto))
      .join('\n');
  }

  return motor;
}

export default { crearMotor };
