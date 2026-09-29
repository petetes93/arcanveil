/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · core/GameState.js
 * ---------------------------------------------------------------------------
 * Forma canónica del estado de la partida.
 *
 * Este archivo define QUÉ existe en el mundo, no CÓMO cambia. Todo sistema
 * escribe y lee dentro de su parcela; nadie inventa ramas nuevas sobre la
 * marcha. Si un dato no aparece aquí, no existe en la partida.
 *
 * Convenciones:
 *   · Toda colección de entidades se guarda como { porId: {}, orden: [] }.
 *     El mapa da acceso O(1); el array conserva el orden de presentación.
 *   · Ninguna rama es null: se inicializa vacía. Así ningún sistema necesita
 *     comprobar existencia antes de leer.
 *   · Las ramas `ui` y `runtime` son volátiles y NUNCA se serializan.
 *
 * Dependencias: config/app.config.js, config/balance.config.js.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { APP } from '../config/app.config.js';
import { VITALES, ECONOMIA, SOCIAL, ATRIBUTOS } from '../config/balance.config.js';

/* ═══════════════════════════════════════════════════════════════════════════
   FASES DE PARTIDA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fase en la que se encuentra la partida. Determina qué acciones son legales:
 * TurnResolver rechaza una acción de exploración durante un combate.
 * @readonly
 * @enum {string}
 */
export const FASE = Object.freeze({
  /** Sin partida cargada. */
  VACIA: 'vacia',
  /** Creando personaje. */
  CREACION: 'creacion',
  /** Turno libre: exploración, diálogo, viaje. */
  EXPLORACION: 'exploracion',
  /** Combate por turnos en curso. */
  COMBATE: 'combate',
  /** Esperando respuesta del director. */
  ESPERANDO: 'esperando',
  /** Descanso o transición temporal. */
  DESCANSO: 'descanso',
  /** Personaje caído. */
  FIN: 'fin',
});

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTRUCTORES DE RAMA
   Cada función devuelve una rama recién creada. Se separan para poder
   reinicializar una parcela concreta sin tocar el resto (por ejemplo, terminar
   un combate limpia sólo state.combat).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Colección indexada estándar.
 * @template T
 * @returns {{porId: Record<string, T>, orden: string[]}}
 */
export function coleccionVacia() {
  return { porId: {}, orden: [] };
}

/**
 * Metadatos de la partida: identidad, versión y contadores globales.
 * @returns {Object}
 */
export function crearMeta() {
  return {
    /** Identificador único de esta crónica. */
    id: null,
    /** Título mostrado en el menú de carga. */
    titulo: 'Crónica sin nombre',
    /** Versión del esquema de estado, para las migraciones. */
    versionEstado: APP.versionEstado,
    /** Versión de la app que creó la partida. */
    versionApp: APP.version,
    /** Marca de creación y de último guardado. */
    creada: null,
    modificada: null,
    /** Fase actual. @see FASE */
    fase: FASE.VACIA,
    /** Turnos jugados desde el inicio. */
    turno: 0,
    /** Semilla maestra del generador aleatorio, para reproducir la partida. */
    semilla: null,
    /** Estado serializado del GestorRNG. */
    rng: null,
    /** Tiempo real jugado, en milisegundos. */
    tiempoJugado: 0,
  };
}

/**
 * Preferencias del jugador. Se corresponden con el catálogo AJUSTES de
 * ui.config.js: cada `ruta` declarada allí apunta aquí.
 * @returns {Object}
 */
export function crearAjustes() {
  return {
    maquinaEscribir: true,
    velocidadTexto: 14,
    tamanoLectura: 'normal',
    densidad: 'normal',
    mostrarTiradas: true,
    popupOpciones: true,
    proveedorIA: 'procedural',
    urlProveedor: '',
    modeloProveedor: '',
    dificultad: 'equilibrado',
    dificultadAdaptativa: true,
    guardadoAutomatico: false,
  };
}

/**
 * Ficha del personaje. Es la rama más consultada del estado.
 * @returns {Object}
 */
export function crearJugador() {
  return {
    id: 'jugador',
    nombre: '',

    // — Identidad —
    raza: null,          // refId de data/races.data.js
    clase: null,         // refId de data/classes.data.js
    claseAvanzada: null,
    trasfondo: null,
    /** Ejes de alineamiento: moral (bondad↔crueldad), orden (ley↔caos). */
    alineamiento: { moral: SOCIAL.alineamiento.inicialMoral, orden: SOCIAL.alineamiento.inicialOrden },

    // — Atributos —
    /** Valores base, sin modificadores temporales. */
    atributos: Object.fromEntries(ATRIBUTOS.orden.map((a) => [a, ATRIBUTOS.base])),
    /** Bonificadores temporales por objeto, estado o bendición. */
    atributosTemporales: {},

    // — Progresión —
    nivel: 1,
    xp: 0,
    /** Puntos sin gastar. */
    puntosTalento: 0,
    puntosHabilidad: 0,
    puntosAtributo: 0,
    /** refIds de talentos adquiridos. */
    talentos: [],
    /** { refIdHabilidad: gradoCompetencia }. */
    habilidades: {},

    // — Vitales —
    vida: { actual: VITALES.vida.base, max: VITALES.vida.base },
    mana: { actual: VITALES.mana.base, max: VITALES.mana.base },
    /** 100 = pleno bienestar, 0 = colapso. Convención única para todas las barras. */
    hambre: VITALES.supervivencia.max,
    sed: VITALES.supervivencia.max,
    fatiga: VITALES.supervivencia.max,
    moral: VITALES.moral.inicial,

    // — Estados alterados activos —
    /** @type {Array<{refId: string, rondas: number, acumulaciones: number, origen: string}>} */
    estados: [],

    // — Economía —
    oro: ECONOMIA.oroInicial,

    // — Banderas narrativas —
    /**
     * Interruptores que el director consulta y activa: { conoce_al_herrero: true }.
     * Es el mecanismo por el que una decisión de hace veinte turnos sigue
     * teniendo efecto hoy.
     */
    flags: {},

    // Identidad escrita por el jugador. Se conserva completa para que el
    // director personalice la campaña y el arte procedural sea reproducible.
    retrato: '',
    lore: '',
  };
}

/**
 * Inventario y equipo.
 * @returns {Object}
 */
export function crearInventario() {
  return {
    /** @type {{porId: Record<string, Object>, orden: string[]}} */
    objetos: coleccionVacia(),
    /** { ranura: idObjeto | null }. Las ranuras salen de OBJETOS.ranurasEquipo. */
    equipado: {},
    /** Peso total transportado, recalculado por Encumbrance.js. */
    carga: 0,
    /** Capacidad máxima según Vigor. */
    cargaMax: 0,
    /** Etiqueta de impedimenta vigente: 'ligero' | 'cargado' | … */
    impedimenta: 'ligero',
  };
}

/**
 * Mundo: geografía, tiempo y clima.
 * @returns {Object}
 */
export function crearMundo() {
  return {
    /** refId de la localización actual. */
    ubicacion: null,
    /** refId de la región que la contiene. */
    region: null,
    /** Tipo de terreno, usado por las tablas de encuentro. */
    terreno: 'camino',

    /** Localizaciones conocidas y su estado de exploración. */
    localizaciones: coleccionVacia(),
    /** Aristas del grafo de mapa: { desde, hasta, distancia, conocida }. */
    rutas: [],

    /** Tiempo del mundo. */
    tiempo: {
      dia: 1,
      hora: 7,
      minuto: 0,
      franja: 'manana',
      estacion: 'primavera',
      /** Días transcurridos desde el inicio de la crónica. */
      diasTotales: 0,
    },

    clima: {
      actual: 'despejado',
      /** Turnos que lleva vigente, para no cambiarlo cada dos por tres. */
      duracion: 0,
    },

    /** Turnos desde el último encuentro aleatorio (periodo de gracia). */
    turnosDesdeEncuentro: 0,
    /** Turnos sin conflicto, que vigila DifficultyDirector. */
    turnosSinTension: 0,
  };
}

/**
 * Misiones activas, completadas y fallidas.
 * @returns {Object}
 */
export function crearMisiones() {
  return {
    activas: coleccionVacia(),
    completadas: [],
    fallidas: [],
    /** refId de la misión marcada como seguimiento prioritario. */
    seguida: null,
  };
}

/**
 * Personajes no jugadores y su relación con el protagonista.
 * @returns {Object}
 */
export function crearNPCs() {
  return {
    /** Todos los PNJ conocidos. */
    conocidos: coleccionVacia(),
    /** refIds presentes en la escena actual. */
    presentes: [],
    /** { refIdNPC: afinidad } entre -100 y 100. */
    relaciones: {},
    /** PNJ muertos, para que el director no los resucite por descuido. */
    caidos: [],
  };
}

/**
 * Facciones y reputación.
 * @returns {Object}
 */
export function crearFacciones() {
  return {
    conocidas: coleccionVacia(),
    /** { refIdFaccion: reputacion } entre -100 y 100. */
    reputacion: {},
  };
}

/**
 * Estado de combate. Se vacía por completo al terminar cada refriega.
 * @returns {Object}
 */
export function crearCombate() {
  return {
    activo: false,
    ronda: 0,
    /** Orden de iniciativa: ids de combatiente. */
    iniciativa: [],
    /** Índice dentro de `iniciativa` del combatiente que actúa. */
    turnoActual: 0,
    /** Combatientes, aliados y enemigos, indexados por id. */
    combatientes: coleccionVacia(),
    /** Terreno de la escena, que modifica las tiradas. */
    terreno: null,
    /** true si el combate admite huida. */
    escapable: true,
    /** Registro de la refriega, para el resumen final. */
    registro: [],
  };
}

/**
 * Bitácora narrativa e historial de turnos.
 * @returns {Object}
 */
export function crearNarrativa() {
  return {
    /**
     * Entradas visibles en el panel central.
     * @type {Array<{id: string, voz: string, texto: string, meta: Object, turno: number}>}
     */
    entradas: [],
    /** Opciones ofrecidas en el turno actual. */
    opciones: [],
    /**
     * Sugerencias ya usadas y la huella de la escena cuando se usaron. No se
     * vuelven a ofrecer mientras la escena no cambie.
     * @type {Array<{k: string, h: string}>}
     */
    sugerenciasUsadas: [],
    /**
     * Las que se enseñan ahora y cuántos turnos seguidos llevan a la vista:
     * a los dos sin tomarlas, descansan tres turnos.
     * @type {Array<{k: string, n: number, h: string}>}
     */
    sugerenciasVistas: [],
    /** Las que descansan unos turnos tras estar a la vista sin tomarse. @type {Array<{k: string, h: string, hasta: number}>} */
    sugerenciasPausadas: [],
    /** Última acción enviada por el jugador. */
    ultimaAccion: null,
    /** Historial de acciones escritas, para recuperarlas con Ctrl+↑. */
    historialEntrada: [],
    /** Marca de corte de escena pendiente de dibujar. */
    escenaAbierta: true,
  };
}

/**
 * Memoria y configuración viva del director de juego.
 * @returns {Object}
 */
export function crearIA() {
  return {
    /** Proveedor en uso. */
    proveedor: 'procedural',
    /**
     * Hechos permanentes que se recuerdan al director en cada turno.
     * @type {Array<{texto: string, turno: number, peso: number}>}
     */
    hechos: [],
    /** Resúmenes de capítulo que sustituyen al historial antiguo. */
    resumenes: [],
    /** Turnos recientes en formato compacto, para el contexto del prompt. */
    historial: [],
    /** Hilos abiertos que el director debería retomar. */
    hilos: [],
    /** Multiplicador de dificultad vigente, ajustado por DifficultyDirector. */
    ajusteDificultad: 1.0,
    /** Fallos consecutivos del proveedor activo. */
    fallosSeguidos: 0,
    /**
     * ATENCIÓN: aquí NUNCA se guarda una credencial. La clave vive en una
     * variable de módulo dentro del proveedor y muere con la pestaña.
     */
    ultimoPrompt: null,
  };
}

/**
 * El grupo: quien acompaña al personaje.
 *
 * Cada miembro guarda su identificador de PNJ y lo que cambia con el viaje
 * —la vida y si va herido—; la ficha de combate sale de su oficio y no hace
 * falta guardarla. Como mucho tres: más es un ejército, y el protagonista
 * deja de serlo.
 *
 * @returns {Object}
 */
export function crearGrupo() {
  return {
    /** @type {Array<{refId: string, vida: {actual: number, max: number}, herido: boolean, desde: string|null}>} */
    miembros: [],
  };
}

/**
 * Estadísticas de partida y logros.
 * @returns {Object}
 */
export function crearRegistroHazanas() {
  return {
    /** refIds de logros desbloqueados. */
    logros: [],
    estadisticas: {
      turnos: 0,
      combates: 0,
      victorias: 0,
      huidas: 0,
      enemigosDerrotados: 0,
      danoInfligido: 0,
      danoRecibido: 0,
      criticos: 0,
      pifias: 0,
      oroGanado: 0,
      oroGastado: 0,
      objetosEncontrados: 0,
      misionesCompletadas: 0,
      npcsConocidos: 0,
      lugaresDescubiertos: 0,
      diasSobrevividos: 0,
      conflictosResueltosSinViolencia: 0,
    },
  };
}

/**
 * Estado volátil de la interfaz. NO se serializa: al recargar, la interfaz se
 * reconstruye desde cero a partir del resto del estado.
 * @returns {Object}
 */
export function crearUI() {
  return {
    pantalla: 'boot',
    cajonIzquierdo: false,
    cajonDerecho: false,
    popupAbierto: false,
    modalAbierto: null,
    entradaBloqueada: false,
    pensando: false,
    /** Paso actual del asistente de creación de personaje. */
    pasoCreacion: 0,
    /** Borrador del personaje mientras se crea. */
    borrador: null,
  };
}

/**
 * Referencias vivas y temporizadores. Tampoco se serializa.
 * @returns {Object}
 */
export function crearRuntime() {
  return {
    /** Promesa del turno en curso, para impedir turnos solapados. */
    turnoEnCurso: null,
    /** Marca de tiempo del último guardado automático. */
    ultimoGuardado: 0,
    /** Identificadores de temporizadores activos, para cancelarlos al salir. */
    temporizadores: [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ESTADO COMPLETO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Construye un estado inicial completo y vacío.
 *
 * @returns {Object} Estado listo para el Store.
 */
export function crearEstadoInicial() {
  return {
    meta: crearMeta(),
    settings: crearAjustes(),
    player: crearJugador(),
    inventory: crearInventario(),
    world: crearMundo(),
    quests: crearMisiones(),
    npcs: crearNPCs(),
    factions: crearFacciones(),
    combat: crearCombate(),
    narrative: crearNarrativa(),
    ai: crearIA(),
    hazanas: crearRegistroHazanas(),
    party: crearGrupo(),
    ui: crearUI(),
    runtime: crearRuntime(),
  };
}

/**
 * Ramas volátiles, excluidas del guardado. Serializer.js consulta esta lista.
 * @type {readonly string[]}
 */
export const RAMAS_VOLATILES = Object.freeze(['ui', 'runtime']);

/**
 * Ramas que SÍ se persisten, en el orden en que se serializan.
 * @type {readonly string[]}
 */
export const RAMAS_PERSISTENTES = Object.freeze([
  'meta', 'settings', 'player', 'inventory', 'world',
  'quests', 'npcs', 'factions', 'combat', 'narrative', 'ai', 'hazanas', 'party',
]);

/**
 * Comprueba que un objeto tiene la forma mínima de un estado válido.
 * Se usa al cargar un guardado, antes de dárselo al Store.
 *
 * @param {*} estado
 * @returns {{valido: boolean, faltan: string[]}}
 */
export function verificarForma(estado) {
  if (!estado || typeof estado !== 'object') return { valido: false, faltan: ['<raíz>'] };
  const faltan = RAMAS_PERSISTENTES.filter((rama) => !(rama in estado));
  return { valido: faltan.length === 0, faltan };
}

export default {
  FASE,
  crearEstadoInicial,
  coleccionVacia,
  crearMeta,
  crearAjustes,
  crearJugador,
  crearInventario,
  crearMundo,
  crearMisiones,
  crearNPCs,
  crearFacciones,
  crearCombate,
  crearNarrativa,
  crearIA,
  crearRegistroHazanas,
  crearUI,
  crearRuntime,
  RAMAS_VOLATILES,
  RAMAS_PERSISTENTES,
  verificarForma,
};
