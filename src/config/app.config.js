/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · config/app.config.js
 * ---------------------------------------------------------------------------
 * Configuración global de la aplicación: identidad, versionado, límites del
 * motor, banderas de funcionalidad y ajustes de depuración.
 *
 * Regla de oro: este archivo NO importa nada. Es la raíz del grafo de
 * dependencias, de modo que cualquier módulo puede consultarlo sin riesgo de
 * ciclos.
 *
 * Todo objeto exportado se congela con Object.freeze en profundidad: la
 * configuración es de sólo lectura en tiempo de ejecución. Lo que el jugador
 * puede cambiar vive en el estado (GameState.settings), no aquí.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Congela un objeto y todos sus objetos anidados de forma recursiva.
 * Se define aquí en local (y no en /utils) precisamente para no importar nada.
 *
 * @template T
 * @param {T} obj Objeto a congelar.
 * @returns {Readonly<T>} El mismo objeto, ya inmutable.
 */
function congelar(obj) {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  for (const clave of Object.getOwnPropertyNames(obj)) congelar(obj[clave]);
  return Object.freeze(obj);
}

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTIDAD Y VERSIONADO
   ═══════════════════════════════════════════════════════════════════════════ */

export const APP = congelar({
  /** Identificador técnico. Se usa como prefijo de claves de LocalStorage. */
  id: 'arcanveil',

  /** Nombre visible en portada y cabecera. */
  nombre: 'ARCANVEIL',

  /** Subtítulo de portada. */
  lema: 'Crónicas de los Reinos Quebrados',

  /**
   * Versión semántica de la aplicación.
   * MAYOR.MENOR.PARCHE — se muestra en el menú principal.
   */
  version: '0.1.0',

  /** Nombre en clave de la fase de desarrollo actual. */
  fase: 'Fase 1 — Núcleo',

  /**
   * Versión del esquema de estado guardado. INDEPENDIENTE de APP.version.
   * Sólo se incrementa cuando la forma de GameState cambia de manera
   * incompatible; Migrations.js encadena las transformaciones entre versiones.
   * @see persistence/Migrations.js
   */
  versionEstado: 1,

  /**
   * Versión del contrato JSON que devuelve el director de juego.
   * Se envía en el prompt y se valida en la respuesta.
   * @see ai/ResponseSchema.js
   */
  versionContratoIA: 1,

  /** Idioma por defecto de la interfaz y de la narración. */
  idioma: 'es',
});

/* ═══════════════════════════════════════════════════════════════════════════
   ENTORNO
   Detección sin dependencias. Todo el juego es local, así que "producción"
   aquí significa simplemente "servido desde algo que no es localhost".
   ═══════════════════════════════════════════════════════════════════════════ */

const _host = typeof window !== 'undefined' ? window.location.hostname : '';
const _esLocal = _host === 'localhost' || _host === '127.0.0.1' || _host === '' || _host === '[::1]';

export const ENTORNO = congelar({
  /** true si se ejecuta desde localhost o desde el sistema de archivos. */
  esLocal: _esLocal,

  /** true si el protocolo es file:// (los módulos ES6 fallarán: ver index.html). */
  esFile: typeof window !== 'undefined' && window.location.protocol === 'file:',

  /**
   * Modo desarrollo. Activa registro detallado, panel de depuración y
   * validaciones costosas. Se puede forzar con ?dev=1 en la URL.
   */
  desarrollo: _esLocal || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev')),

  /** Marca de tiempo del arranque, útil para medir tiempos de carga. */
  arranque: Date.now(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRO (LOGGING)
   ═══════════════════════════════════════════════════════════════════════════ */

export const LOG = congelar({
  /**
   * Nivel mínimo que se imprime en consola.
   * 0=silencio 1=error 2=aviso 3=info 4=depuración 5=traza
   */
  nivel: ENTORNO.desarrollo ? 4 : 2,

  /** Prefijo con color por canal en la consola del navegador. */
  colores: true,

  /** Número máximo de entradas conservadas en el búfer circular en memoria. */
  bufferMax: 500,

  /**
   * Canales activos. Poner a false silencia ese canal sin tocar el nivel.
   * Logger.js consulta este mapa antes de imprimir.
   */
  canales: {
    core: true,
    store: ENTORNO.desarrollo,
    bus: false,          // muy ruidoso: se activa a mano al depurar eventos
    engine: true,
    ai: true,
    combat: true,
    world: true,
    ui: ENTORNO.desarrollo,
    save: true,
    rng: false,
  },
});

/* ═══════════════════════════════════════════════════════════════════════════
   LÍMITES DEL MOTOR
   Cotas duras que protegen la memoria y el rendimiento. Ninguna es una regla
   de juego: el equilibrio vive en balance.config.js.
   ═══════════════════════════════════════════════════════════════════════════ */

export const LIMITES = congelar({
  /** Entradas conservadas en la bitácora narrativa antes de podar las viejas. */
  narrativaMax: 400,

  /** Entradas que se eliminan de golpe al superar narrativaMax (poda por lotes). */
  narrativaPoda: 60,

  /** Longitud máxima de la acción escrita por el jugador (coincide con maxlength del textarea). */
  entradaMax: 600,

  /** Longitud mínima aceptada; por debajo se ignora el envío. */
  entradaMin: 1,

  /** Turnos conservados en el historial completo de la partida. */
  historialTurnosMax: 200,

  /** Hechos de memoria a largo plazo que se le recuerdan al director. */
  memoriaHechosMax: 120,

  /** Turnos recientes que se envían íntegros en el contexto del prompt. */
  contextoTurnosRecientes: 6,

  /** Opciones simultáneas que puede ofrecer el director en un popup. */
  opcionesMax: 8,

  /** Objetos distintos que caben en el inventario (pilas independientes). */
  inventarioRanuras: 40,

  /** Misiones activas simultáneas. */
  misionesActivasMax: 12,

  /** PNJ conservados en memoria del mundo antes de archivar los menos relevantes. */
  npcsMax: 150,

  /** Combatientes por bando en un combate. */
  combatientesMax: 8,

  /** Rondas antes de forzar el final de un combate (red de seguridad anti-bucle). */
  rondasMax: 50,

  /** Avisos flotantes simultáneos en pantalla. */
  toastsMax: 4,

  /** Tamaño máximo estimado de una partida guardada, en bytes (~2 MB). */
  guardadoBytesMax: 2 * 1024 * 1024,
});

/* ═══════════════════════════════════════════════════════════════════════════
   TIEMPOS
   Valores de interfaz y de flujo de turno, en milisegundos.
   ═══════════════════════════════════════════════════════════════════════════ */

export const TIEMPOS = congelar({
  /** Duración de la pantalla de arranque como mínimo (evita un parpadeo feo). */
  arranqueMin: 700,

  /** Espera antes de mostrar "el director medita" (evita el flash en respuestas rápidas). */
  pensandoUmbral: 350,

  /** Tiempo máximo de espera de una respuesta del director antes de abortar. */
  timeoutIA: 90_000,

  /** Duración por defecto de un aviso flotante. */
  toast: 4200,

  /** Duración de un aviso importante (subida de nivel, botín legendario). */
  toastLargo: 6500,

  /** Retardo antes de abrir el popup de opciones tras terminar la narración. */
  popupRetardo: 260,

  /** Antirrebote del guardado automático tras un cambio de estado. */
  /** Pausa entre turnos enemigos, para que se puedan leer. */
  pausaTurnoEnemigo: 750,

  autoguardadoDebounce: 1500,

  /** Intervalo del guardado automático periódico. */
  autoguardadoIntervalo: 60_000,

  /** Antirrebote genérico para redimensionados y reflujos de la interfaz. */
  resizeDebounce: 120,
});

/* ═══════════════════════════════════════════════════════════════════════════
   PERSISTENCIA
   Recuerda: por decisión explícita del proyecto, el guardado está DESACTIVADO
   por defecto. El jugador debe activarlo a conciencia en Ajustes.
   ═══════════════════════════════════════════════════════════════════════════ */

export const PERSISTENCIA = congelar({
  /**
   * Guardado automático en LocalStorage.
   * false = la partida vive sólo en memoria y desaparece al cerrar la pestaña.
   */
  activadaPorDefecto: false,

  /** Prefijo de todas las claves escritas en LocalStorage. */
  prefijo: 'arcanveil:',

  /** Clave de la ranura de guardado rápido. */
  claveAuto: 'arcanveil:save:auto',

  /** Clave del índice de ranuras manuales. */
  claveIndice: 'arcanveil:save:index',

  /** Clave de las preferencias de interfaz (tema, densidad, tamaño de lectura). */
  clavePreferencias: 'arcanveil:prefs',

  /** Número de ranuras manuales disponibles. */
  /**
   * Versión del formato de guardado. Se sube al cambiar la forma del estado y
   * Migrations.js se encarga de convertir los guardados antiguos.
   */
  versionFormato: 8,

  /** Turnos entre autoguardados. */
  turnosEntreAutoguardados: 12,

  /** Tamaño máximo de una ranura, en bytes. */
  tamanoMaxRanura: 900_000,

  /**
   * Un archivo importado se mira antes de leerlo. Una exportación real, con
   * sangría, ronda un tercio de esto; lo que pasa de aquí no es una partida.
   */
  importacionMaxBytes: 3_000_000,

  /**
   * Anidamiento máximo de un guardado. El estado real no pasa de 12; un
   * archivo con miles de niveles reventaba la pila al fundirlo o clonarlo.
   */
  profundidadMax: 48,

  ranuras: 8,

  /**
   * NUNCA se persiste ninguna clave de API ni credencial, bajo ninguna
   * circunstancia. Esta bandera existe para que quede documentado y para que
   * SaveManager pueda afirmarlo en una comprobación de seguridad.
   */
  persistirCredenciales: false,

  /** Rutas del estado que se excluyen del serializado (volátiles o sensibles). */
  camposExcluidos: [
    'ui',            // estado transitorio de la interfaz
    'runtime',       // referencias vivas, temporizadores
    'ai.credencial', // jamás se guarda
    'ai.ultimoPrompt',
  ],
});

/* ═══════════════════════════════════════════════════════════════════════════
   BANDERAS DE FUNCIONALIDAD
   Permiten desarrollar por fases sin romper la aplicación: un sistema aún no
   implementado se declara aquí en false y el motor lo omite limpiamente.
   ═══════════════════════════════════════════════════════════════════════════ */

export const FUNCIONES = congelar({
  // — Sistemas de juego —
  combate: true,
  inventario: true,
  misiones: true,
  economia: true,
  npcs: true,
  facciones: true,
  reputacion: true,
  relaciones: true,
  clima: true,
  cicloDiaNoche: true,
  hambreYSed: true,
  fatiga: true,
  moral: true,
  durabilidad: true,
  carga: true,            // peso e impedimenta
  arbolTalentos: true,
  clasesAvanzadas: true,
  logros: true,
  exploracion: true,
  eventosDinamicos: true,

  // — Dirección de juego —
  dificultadAdaptativa: true,
  memoriaLargoPlazo: true,
  consecuenciasDiferidas: true,

  // — Interfaz —
  maquinaDeEscribir: true,
  popupOpciones: true,
  atajosNumericos: true,   // teclas 1-9 para elegir opción
  mapaVisual: true,
  sonido: false,           // reservado para una fase posterior

  // — Herramientas —
  panelDepuracion: ENTORNO.desarrollo,
  consolaComandos: ENTORNO.desarrollo,  // comandos /dado, /estado, /dar…
});

/* ═══════════════════════════════════════════════════════════════════════════
   ATAJOS DE TECLADO
   Declarados como datos para que SettingsScreen pueda mostrarlos y, más
   adelante, permitir su reasignación.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ATAJOS = congelar({
  enviar: 'Enter',
  nuevaLinea: 'Shift+Enter',
  cerrarCapa: 'Escape',
  panelIzquierdo: 'KeyI',
  panelDerecho: 'KeyM',
  inventario: 'KeyB',
  personaje: 'KeyC',
  misiones: 'KeyQ',
  ajustes: 'F1',
  guardar: 'Ctrl+S',
  foco: 'Slash',           // "/" enfoca la caja de acción
  opcion1a9: 'Digit1..Digit9',
});

/* ═══════════════════════════════════════════════════════════════════════════
   DEPURACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

export const DEPURACION = congelar({
  /** Expone el motor en window.ARCANVEIL para inspección desde la consola. */
  exponerGlobal: ENTORNO.desarrollo,

  /** Registra en consola cada acción despachada al Store. */
  trazarAcciones: false,

  /** Registra cada evento publicado en el bus. */
  trazarEventos: false,

  /** Muestra el prompt completo enviado al director antes de cada llamada. */
  trazarPrompts: ENTORNO.desarrollo,

  /** Valida el esquema del estado tras cada mutación (costoso: sólo en desarrollo). */
  validarEstado: ENTORNO.desarrollo,

  /**
   * Semilla fija del generador aleatorio. null = semilla aleatoria por partida.
   * Fijarla hace las partidas reproducibles, imprescindible para depurar combate.
   */
  semillaFija: null,

  /** Salta la creación de personaje y arranca con una ficha de prueba. */
  personajeRapido: false,
});

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTACIÓN AGRUPADA
   Permite `import CONFIG from './config/app.config.js'` cuando se necesitan
   varios bloques a la vez, sin renunciar a las importaciones nominales.
   ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG = congelar({
  APP,
  ENTORNO,
  LOG,
  LIMITES,
  TIEMPOS,
  PERSISTENCIA,
  FUNCIONES,
  ATAJOS,
  DEPURACION,
});

export default CONFIG;
