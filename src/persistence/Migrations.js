/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · persistence/Migrations.js
 * ---------------------------------------------------------------------------
 * Migraciones de guardados.
 *
 * El proyecto va a seguir cambiando, y cada cambio de estructura convierte los
 * guardados anteriores en basura si nadie se ocupa. Este módulo se ocupa.
 *
 * Cómo funciona: cada migración lleva de una versión a la siguiente. Un guardado
 * de la versión 1 en un juego que va por la 4 pasa por tres migraciones en
 * cadena. Eso evita tener que escribir una conversión directa de cada versión
 * antigua a la actual, que es lo que hace inmantenible este tipo de código.
 *
 * Regla de oro: **una migración nunca se borra**. Aunque parezca que nadie
 * tiene guardados tan viejos, alguien los tiene. El coste de conservarla es
 * treinta líneas; el de borrarla es una partida perdida.
 *
 * Segunda regla: **una migración nunca falla en silencio**. Si no puede
 * convertir algo, lo dice y devuelve el guardado sin tocar, para que el
 * llamante decida.
 *
 * Funciones puras.
 *
 * Dependencias: config, Logger, utils.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { PERSISTENCIA } from '../config/app.config.js';
import { crearCanal } from '../core/Logger.js';
import { clonar } from '../utils/clone.js';

const log = crearCanal('persistencia');

/* ═══════════════════════════════════════════════════════════════════════════
   MIGRACIONES
   ---------------------------------------------------------------------------
   `desde` es la versión que acepta; produce la versión `desde + 1`.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} Migracion
 * @property {number} desde Versión de entrada.
 * @property {string} descripcion Qué cambia.
 * @property {Function} aplicar (guardado) → {guardado, avisos}
 */

/** @type {Migracion[]} */
export const MIGRACIONES = Object.freeze([

  /* ─────────────────────────────────────────────────────────────────────────
     1 → 2 · Mundo con grafo de lugares
     ---------------------------------------------------------------------
     La versión 1 guardaba solo el terreno actual. La 2 introdujo el grafo de
     localizaciones con lugares conocidos.
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 1,
    descripcion: 'añade el grafo de localizaciones y la ubicación',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      if (!estado.world) {
        estado.world = {};
        avisos.push('rama world ausente: se creó vacía');
      }

      // El terreno suelto pasa a ser una ubicación real.
      if (!estado.world.localizaciones) {
        estado.world.localizaciones = { porId: {}, orden: [] };
        estado.world.ubicacion = 'vado_yunque';
        estado.world.region = 'valle_central';
        estado.world.sublugar = null;

        estado.world.localizaciones.porId.vado_yunque = {
          refId: 'vado_yunque',
          nombre: 'Vado del Yunque',
          visitado: true,
          ganchosUsados: [],
        };
        estado.world.localizaciones.orden = ['vado_yunque'];

        avisos.push('sin mapa guardado: el personaje aparece en Vado del Yunque');
      }

      return { guardado: { ...g, estado, version: 2 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     2 → 3 · Personas y facciones
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 2,
    descripcion: 'añade las ramas de personas y facciones',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      if (!estado.npcs) {
        estado.npcs = {
          conocidos: { porId: {}, orden: [] },
          presentes: [],
          relaciones: {},
          caidos: [],
        };
        avisos.push('sin personas guardadas: se empieza de cero');
      }

      // Los caídos se separaron de los conocidos en esta versión.
      if (!estado.npcs.caidos) estado.npcs.caidos = [];

      if (!estado.factions) {
        estado.factions = {
          conocidas: { porId: {}, orden: [] },
          reputacion: {},
        };
        avisos.push('sin facciones guardadas: la reputación empieza neutral');
      }

      return { guardado: { ...g, estado, version: 3 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     3 → 4 · Misiones con historial y hazañas
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 3,
    descripcion: 'añade el historial de misiones y el registro de hazañas',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      // ─── Misiones ─────────────────────────────────────────────────────
      if (!estado.quests) {
        estado.quests = {
          activas: { porId: {}, orden: [] },
          completadas: [],
          fracasadas: [],
          historial: {},
        };
      } else {
        // El historial y las fracasadas se añadieron aquí.
        estado.quests.historial ??= {};
        estado.quests.fracasadas ??= [];
        estado.quests.completadas ??= [];
      }

      // ─── Hazañas ──────────────────────────────────────────────────────
      if (!estado.hazanas) {
        estado.hazanas = { conseguidas: [], estadisticas: {} };
        avisos.push('sin hazañas guardadas: el registro empieza vacío');
      } else {
        estado.hazanas.conseguidas ??= [];
        estado.hazanas.estadisticas ??= {};
      }

      // Las estadísticas de la versión anterior usaban otros nombres.
      const renombres = {
        kills: 'enemigosDerrotados',
        quests: 'misionesCompletadas',
        gold: 'oroGanado',
        places: 'lugaresDescubiertos',
      };

      for (const [viejo, nuevo] of Object.entries(renombres)) {
        if (estado.hazanas.estadisticas[viejo] !== undefined) {
          estado.hazanas.estadisticas[nuevo] = estado.hazanas.estadisticas[viejo];
          delete estado.hazanas.estadisticas[viejo];
          avisos.push(`estadística renombrada: ${viejo} → ${nuevo}`);
        }
      }

      return { guardado: { ...g, estado, version: 4 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     4 → 5 · Sublugares y usos de rasgos
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 4,
    descripcion: 'añade sublugares, usos de rasgos y campos narrativos del personaje',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      if (estado.world) estado.world.sublugar ??= null;

      if (estado.player) {
        estado.player.usosRasgos ??= {};
        estado.player.retrato ??= '';
        estado.player.motivacion ??= null;
        estado.player.gancho ??= null;
        estado.player.detalle ??= null;
        estado.player.principio ??= null;
        estado.player.estados ??= [];
      }

      // El oro pasó de la rama de inventario a la del jugador.
      if (estado.inventory?.oro !== undefined && estado.player) {
        estado.player.oro ??= estado.inventory.oro;
        delete estado.inventory.oro;
        avisos.push('el oro se movió de inventory a player');
      }

      return { guardado: { ...g, estado, version: 5 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     5 → 6 · Grupo de compañeros, sexo y semilla del retrato
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 5,
    descripcion: 'añade el grupo de compañeros y el sexo y la semilla del retrato del personaje',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      estado.party ??= { miembros: [] };

      if (estado.player) {
        // Las partidas anteriores no guardaban el sexo: sin dato, el parte
        // habla en masculino, que es lo que ya hacía.
        estado.player.genero ??= 'm';
        estado.player.semillaRetrato ??= null;
      }

      return { guardado: { ...g, estado, version: 6 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     6 → 7 · El pasado del personaje deja de ser una lista de hilos
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 6,
    descripcion: 'cierra los hilos de memoria que se abrían desde la historia del personaje',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      // Cada frase de la historia se abría como hilo, y su urgencia crecía al
      // ignorarla hasta que el director la retomaba por su cuenta. Se cierran
      // sin resolución: no se borra nada (la historia sigue en la ficha, que
      // es donde vive ahora) y no se convierten en hechos cumplidos. Las
      // misiones guardadas no se tocan: su progreso sigue donde estaba.
      const hilos = estado.ai?.memoria?.hilos;
      if (Array.isArray(hilos)) {
        let cerrados = 0;
        for (const h of hilos) {
          if (!h.cerrado && /^player_lore/.test(h.relacionadoCon ?? '')) {
            h.cerrado = true;
            h.resolucion = null;
            h.motivoCierre = 'trasfondo';
            cerrados += 1;
          }
        }
        if (cerrados) avisos.push(`${cerrados} hilos del pasado del personaje pasan a ser trasfondo`);
      }

      return { guardado: { ...g, estado, version: 7 }, avisos };
    },
  },

  /* ─────────────────────────────────────────────────────────────────────────
     7 → 8 · Fuera lo que ya no estaba
     ---------------------------------------------------------------------
     Retirar un objeto o cerrar una misión los quitaba de la lista (`orden`)
     pero no de `porId` (ver `aplicarParche` y `BORRAR` en core/Store.js):
     lo comido, bebido o vendido seguía pesando y ofreciéndose en combate, y
     las misiones cerradas seguían entre las activas. Se quita lo que no está
     en la lista ni equipado. Lo que sí está no se toca.
     ───────────────────────────────────────────────────────────────────────── */
  {
    desde: 7,
    descripcion: 'quita los objetos gastados y las misiones cerradas que seguían guardados',
    aplicar: (g) => {
      const avisos = [];
      const estado = clonar(g.estado);

      const objetos = estado.inventory?.objetos;
      if (objetos?.porId && Array.isArray(objetos.orden)) {
        const quedan = new Set([...objetos.orden, ...Object.values(estado.inventory.equipado ?? {}).filter(Boolean)]);
        const fantasmas = Object.keys(objetos.porId).filter((id) => !quedan.has(id));
        for (const id of fantasmas) delete objetos.porId[id];
        if (fantasmas.length) avisos.push(`${fantasmas.length} objetos ya gastados dejan de pesar`);
      }

      const activas = estado.quests?.activas;
      if (activas?.porId && Array.isArray(activas.orden)) {
        const siguen = new Set(activas.orden);
        const cerradas = Object.keys(activas.porId).filter((id) => !siguen.has(id));
        for (const id of cerradas) delete activas.porId[id];
        if (cerradas.length) avisos.push(`${cerradas.length} misiones cerradas dejan de figurar como activas`);
      }

      return { guardado: { ...g, estado, version: 8 }, avisos };
    },
  },
]);

/* ═══════════════════════════════════════════════════════════════════════════
   APLICACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Migra un guardado hasta la versión actual.
 *
 * Aplica las migraciones en cadena. Si alguna falla, se detiene y devuelve lo
 * conseguido hasta ese punto, informando de dónde se quedó.
 *
 * @param {Object} guardado
 * @returns {{
 *   migrado: boolean, guardado: Object,
 *   desde: number, hasta: number,
 *   aplicadas: string[], avisos: string[], error: string|null
 * }}
 */
export function migrar(guardado) {
  const objetivo = PERSISTENCIA.versionFormato;
  const original = guardado?.version ?? 1;

  const resultado = {
    migrado: false,
    guardado,
    desde: original,
    hasta: original,
    aplicadas: [],
    avisos: [],
    error: null,
  };

  // ─── Ya está al día ─────────────────────────────────────────────────────
  if (original === objetivo) return resultado;

  // ─── Del futuro: no se puede hacer nada ─────────────────────────────────
  // Un guardado de una versión posterior puede contener estructuras que este
  // código no entiende. Intentar cargarlo es peor que negarse.
  if (original > objetivo) {
    resultado.error =
      `Este guardado es de una versión más reciente del juego (formato ${original}, ` +
      `este soporta hasta ${objetivo}). Actualiza para abrirlo.`;
    return resultado;
  }

  // ─── Cadena de migraciones ──────────────────────────────────────────────
  let actual = clonar(guardado);

  while (actual.version < objetivo) {
    const migracion = MIGRACIONES.find((m) => m.desde === actual.version);

    if (!migracion) {
      resultado.error =
        `No hay forma de migrar del formato ${actual.version} al ${actual.version + 1}. ` +
        `El guardado se ha quedado a medias.`;
      resultado.guardado = actual;
      resultado.hasta = actual.version;
      return resultado;
    }

    try {
      const paso = migracion.aplicar(actual);

      actual = paso.guardado;
      resultado.aplicadas.push(`${migracion.desde}→${actual.version}: ${migracion.descripcion}`);
      resultado.avisos.push(...(paso.avisos ?? []));

      log.info(`migración ${migracion.desde}→${actual.version} aplicada`);

    } catch (e) {
      resultado.error = `La migración ${migracion.desde}→${migracion.desde + 1} ha fallado: ${e.message}`;
      resultado.guardado = actual;
      resultado.hasta = actual.version;
      return resultado;
    }
  }

  // ─── Éxito ──────────────────────────────────────────────────────────────
  // La firma ya no vale: el contenido ha cambiado. Se retira para que el
  // deserializador no avise de una discrepancia que él mismo ha causado.
  delete actual.firma;

  resultado.migrado = true;
  resultado.guardado = actual;
  resultado.hasta = actual.version;

  return resultado;
}

/**
 * Comprueba si un guardado necesita migración, sin aplicarla.
 *
 * @param {Object} guardado
 * @returns {{necesita: boolean, desde: number, hasta: number, pasos: number, posible: boolean}}
 */
export function comprobar(guardado) {
  const original = guardado?.version ?? 1;
  const objetivo = PERSISTENCIA.versionFormato;

  if (original === objetivo) {
    return { necesita: false, desde: original, hasta: objetivo, pasos: 0, posible: true };
  }

  if (original > objetivo) {
    return { necesita: true, desde: original, hasta: objetivo, pasos: 0, posible: false };
  }

  // Se cuenta si la cadena está completa.
  let version = original;
  let pasos = 0;

  while (version < objetivo) {
    if (!MIGRACIONES.some((m) => m.desde === version)) {
      return { necesita: true, desde: original, hasta: objetivo, pasos, posible: false };
    }
    version++;
    pasos++;
  }

  return { necesita: true, desde: original, hasta: objetivo, pasos, posible: true };
}

/**
 * Describe en lenguaje natural qué le pasa a un guardado.
 *
 * Se muestra en la pantalla de partidas: el jugador debería saber si su
 * guardado antiguo va a poder abrirse antes de intentarlo.
 *
 * @param {Object} guardado
 * @returns {string}
 */
export function describir(guardado) {
  const c = comprobar(guardado);

  if (!c.necesita) return '';

  if (!c.posible) {
    return c.desde > c.hasta
      ? 'Guardado de una versión más reciente. No se puede abrir.'
      : 'Guardado demasiado antiguo. No se puede convertir.';
  }

  return c.pasos === 1
    ? 'Guardado de una versión anterior. Se convertirá al abrirlo.'
    : `Guardado antiguo. Se aplicarán ${c.pasos} conversiones al abrirlo.`;
}

/**
 * Versiones de formato que este código sabe leer.
 * @returns {{minima: number, actual: number}}
 */
export function versionesSoportadas() {
  const minima = MIGRACIONES.length
    ? Math.min(...MIGRACIONES.map((m) => m.desde))
    : PERSISTENCIA.versionFormato;

  return { minima, actual: PERSISTENCIA.versionFormato };
}

export default { MIGRACIONES, migrar, comprobar, describir, versionesSoportadas };
