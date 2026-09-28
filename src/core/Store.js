/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · core/Store.js
 * ---------------------------------------------------------------------------
 * Almacén central del estado: única fuente de verdad de la partida.
 *
 * Modelo: reductores registrados por tipo de acción. Un reductor recibe el
 * estado y la acción, y devuelve un PARCHE (objeto parcial); el Store lo aplica
 * de forma inmutable, clonando sólo la rama tocada. Nadie muta el estado a
 * mano: `store.dispatch(...)` es el único camino.
 *
 * Por qué parches y no estado completo: en un motor con quince sistemas, hacer
 * que cada reductor devuelva el estado entero convierte cualquier despiste en
 * una pérdida silenciosa de datos. Un parche sólo puede añadir o cambiar.
 *
 * Extras:
 *   · Suscripción por ruta con comparación previa: sólo se notifica si cambió.
 *   · Transacciones: agrupa varias acciones en una sola notificación.
 *   · Middleware para registro y validación.
 *   · Instantáneas para deshacer un turno fallido.
 *
 * Dependencias: Logger, Errors, GameState, config.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { crearCanal } from './Logger.js';
import { ErrorNucleo, CODIGO, registrar } from './Errors.js';
import { crearEstadoInicial } from './GameState.js';
import { DEPURACION } from '../config/app.config.js';

const log = crearCanal('store');

/** Valor de parche que quita la clave del estado (ver `aplicarParche`). */
export const BORRAR = Symbol('borrar');

/* ═══════════════════════════════════════════════════════════════════════════
   AUXILIARES DE RUTA E INMUTABILIDAD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lee un valor por ruta con puntos: leer(estado, 'player.vida.actual').
 * Devuelve undefined si algún tramo no existe, sin lanzar.
 *
 * @param {Object} obj
 * @param {string} ruta
 * @returns {*}
 */
export function leerRuta(obj, ruta) {
  if (!ruta) return obj;
  let actual = obj;
  for (const tramo of ruta.split('.')) {
    if (actual === null || actual === undefined) return undefined;
    actual = actual[tramo];
  }
  return actual;
}

/**
 * Devuelve una copia del objeto con la ruta indicada asignada, clonando sólo
 * los nodos del camino. El resto del árbol conserva sus referencias, lo que
 * hace baratas las comparaciones por identidad en los suscriptores.
 *
 * @param {Object} obj
 * @param {string} ruta
 * @param {*} valor
 * @returns {Object} Objeto nuevo.
 */
export function escribirRuta(obj, ruta, valor) {
  const tramos = ruta.split('.');
  const copia = Array.isArray(obj) ? obj.slice() : { ...obj };
  let nodo = copia;

  for (let i = 0; i < tramos.length - 1; i++) {
    const t = tramos[i];
    const hijo = nodo[t];
    nodo[t] = hijo === null || typeof hijo !== 'object'
      ? {}
      : (Array.isArray(hijo) ? hijo.slice() : { ...hijo });
    nodo = nodo[t];
  }

  nodo[tramos[tramos.length - 1]] = valor;
  return copia;
}

/**
 * Aplica un parche sobre un estado, de forma inmutable y recursiva.
 *
 * Reglas:
 *   · Un objeto plano en el parche se FUNDE con el existente.
 *   · Un array REEMPLAZA por completo (fundir arrays produce sorpresas).
 *   · `undefined` en el parche significa "no tocar"; `null` deja la clave a
 *     null; `BORRAR` quita la clave.
 *
 * Quitar una clave con `delete` en una copia del objeto NO la quita: la
 * copia se funde con el original y la clave sigue ahí. Pasaba con el
 * inventario: lo que se comía, bebía o vendía desaparecía de la lista
 * (`orden`, un array) pero seguía en `porId`, pesando y ofreciéndose en
 * combate. Veinte pociones bebidas eran diez kilos más de carga.
 *
 * @param {Object} base
 * @param {Object} parche
 * @returns {Object} Objeto nuevo si algo cambió; la misma referencia si no.
 */
export function aplicarParche(base, parche) {
  if (!parche || typeof parche !== 'object') return base;

  let cambiado = false;
  const salida = Array.isArray(base) ? base.slice() : { ...base };

  for (const [clave, valor] of Object.entries(parche)) {
    if (valor === undefined) continue;

    if (valor === BORRAR) {
      if (Object.prototype.hasOwnProperty.call(salida, clave)) { delete salida[clave]; cambiado = true; }
      continue;
    }

    const anterior = salida[clave];

    if (
      valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
      anterior !== null && typeof anterior === 'object' && !Array.isArray(anterior)
    ) {
      const fundido = aplicarParche(anterior, valor);
      if (fundido !== anterior) { salida[clave] = fundido; cambiado = true; }
    } else if (anterior !== valor) {
      salida[clave] = valor;
      cambiado = true;
    }
  }

  return cambiado ? salida : base;
}

/**
 * Clon profundo. Usa structuredClone cuando está disponible; si no, recurre a
 * un recorrido manual. Sólo se emplea para instantáneas, nunca en el camino
 * caliente del despacho.
 *
 * @template T
 * @param {T} valor
 * @returns {T}
 */
export function clonarProfundo(valor) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(valor);
    } catch {
      // Cae al método manual si hay algo no clonable.
    }
  }
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return /** @type {any} */ (valor.map(clonarProfundo));
  const salida = {};
  for (const [k, v] of Object.entries(valor)) salida[k] = clonarProfundo(v);
  return /** @type {any} */ (salida);
}

/* ═══════════════════════════════════════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} Accion
 * @property {string} type    Identificador de la acción: 'player/danar'.
 * @property {*} [payload]    Datos de la acción.
 * @property {Object} [meta]  Información auxiliar, no usada por los reductores.
 */

/**
 * @typedef {(estado: Object, accion: Accion) => (Object|null)} Reductor
 * Devuelve un parche, o null si la acción no cambia nada.
 */

export class Store {
  /**
   * @param {Object} [estadoInicial] Si se omite, se crea uno vacío.
   */
  constructor(estadoInicial) {
    /** @private */
    this._estado = estadoInicial ?? crearEstadoInicial();

    /** @type {Map<string, Reductor[]>} @private */
    this._reductores = new Map();

    /**
     * Suscriptores. Cada uno vigila una ruta y guarda el último valor visto.
     * @type {Set<{ruta: string, fn: Function, ultimo: *, id: string}>}
     * @private
     */
    this._suscriptores = new Set();

    /** @type {Function[]} @private */
    this._middleware = [];

    /** Profundidad de transacción; >0 aplaza las notificaciones. @private */
    this._transaccion = 0;

    /** true si hubo cambios durante la transacción. @private */
    this._pendiente = false;

    /** Instantáneas guardadas por etiqueta. @private */
    this._instantaneas = new Map();

    /** Contador de acciones despachadas. @private */
    this._contador = 0;

    /** Secuencia para identificar suscriptores. @private */
    this._seq = 0;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     LECTURA
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Estado completo. Es de sólo lectura por contrato: mutarlo rompe el motor.
   * @returns {Object}
   */
  getState() {
    return this._estado;
  }

  /**
   * Lee una rama por ruta.
   * @param {string} ruta 'player.vida.actual'
   * @param {*} [defecto] Valor devuelto si la ruta no existe.
   * @returns {*}
   */
  select(ruta, defecto = undefined) {
    const v = leerRuta(this._estado, ruta);
    return v === undefined ? defecto : v;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     REDUCTORES
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Registra un reductor para un tipo de acción.
   * Varios reductores pueden atender el mismo tipo: se ejecutan en orden de
   * registro y sus parches se acumulan. Es lo que permite que, por ejemplo,
   * tanto Progression como AchievementSystem reaccionen a 'combat/victoria'.
   *
   * @param {string} tipo
   * @param {Reductor} reductor
   * @returns {() => void} Función de baja.
   */
  registrar(tipo, reductor) {
    if (typeof reductor !== 'function') {
      throw new ErrorNucleo(`El reductor de "${tipo}" no es una función`, { code: CODIGO.ACCION_DESCONOCIDA });
    }
    const lista = this._reductores.get(tipo) ?? [];
    lista.push(reductor);
    this._reductores.set(tipo, lista);
    log.traza(`+ reductor → ${tipo}`);

    return () => {
      const actual = this._reductores.get(tipo) ?? [];
      const restantes = actual.filter((r) => r !== reductor);
      if (restantes.length) this._reductores.set(tipo, restantes);
      else this._reductores.delete(tipo);
    };
  }

  /**
   * Registra de golpe un mapa { tipo: reductor }.
   * @param {Record<string, Reductor>} mapa
   * @returns {() => void} Da de baja todos.
   */
  registrarMuchos(mapa) {
    const bajas = Object.entries(mapa).map(([tipo, r]) => this.registrar(tipo, r));
    return () => bajas.forEach((b) => b());
  }

  /**
   * Añade middleware. Recibe (accion, estado) y devuelve la acción, quizá
   * modificada, o null para abortarla.
   * @param {(accion: Accion, estado: Object) => (Accion|null)} fn
   */
  usar(fn) {
    this._middleware.push(fn);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     ESCRITURA
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Despacha una acción.
   *
   * @param {Accion|string} accion Acción completa, o su tipo si no lleva datos.
   * @param {*} [payload] Datos, si el primer argumento fue una cadena.
   * @returns {Object} El estado resultante.
   *
   * @example
   * store.dispatch('player/danar', { cantidad: 7, origen: 'goblin_1' });
   */
  dispatch(accion, payload) {
    let acc = typeof accion === 'string' ? { type: accion, payload } : accion;

    if (!acc || typeof acc.type !== 'string') {
      registrar(new ErrorNucleo('Acción sin tipo', { code: CODIGO.ACCION_DESCONOCIDA }), 'store');
      return this._estado;
    }

    // — Middleware —
    for (const mw of this._middleware) {
      try {
        const resultado = mw(acc, this._estado);
        if (resultado === null) {
          log.traza(`✕ acción abortada por middleware: ${acc.type}`);
          return this._estado;
        }
        if (resultado) acc = resultado;
      } catch (e) {
        registrar(e, 'store');
      }
    }

    const reductores = this._reductores.get(acc.type);
    if (!reductores || reductores.length === 0) {
      // No es un error: muchas acciones son puramente informativas y sólo
      // interesan al bus de eventos.
      log.traza(`· sin reductor: ${acc.type}`);
      return this._estado;
    }

    const anterior = this._estado;
    let siguiente = anterior;

    for (const reductor of reductores) {
      try {
        const parche = reductor(siguiente, acc);
        if (parche) siguiente = aplicarParche(siguiente, parche);
      } catch (e) {
        registrar(e, 'store');
      }
    }

    this._contador++;

    if (DEPURACION.trazarAcciones) {
      log.debug(`→ ${acc.type}`, { payload: acc.payload, cambio: siguiente !== anterior });
    }

    if (siguiente === anterior) return anterior;

    this._estado = siguiente;

    if (this._transaccion > 0) this._pendiente = true;
    else this._notificar();

    return siguiente;
  }

  /**
   * Escribe directamente una ruta, sin pasar por un reductor.
   * Reservado para el estado volátil de la interfaz (`ui.*`), donde declarar un
   * reductor por cada interruptor sería ceremonia sin beneficio.
   *
   * @param {string} ruta
   * @param {*} valor
   */
  fijar(ruta, valor) {
    const actual = leerRuta(this._estado, ruta);
    if (actual === valor) return;
    this._estado = escribirRuta(this._estado, ruta, valor);
    if (this._transaccion > 0) this._pendiente = true;
    else this._notificar();
  }

  /**
   * Agrupa varias escrituras en una sola notificación.
   * Imprescindible al aplicar un turno completo del director: veinte cambios
   * deben repintar la interfaz una vez, no veinte.
   *
   * @template T
   * @param {() => T} fn
   * @returns {T}
   *
   * @example
   * store.transaccion(() => {
   *   store.dispatch('player/danar', { cantidad: 5 });
   *   store.dispatch('inventory/anadir', { refId: 'pocion' });
   * });
   */
  transaccion(fn) {
    this._transaccion++;
    try {
      return fn();
    } finally {
      this._transaccion--;
      if (this._transaccion === 0 && this._pendiente) {
        this._pendiente = false;
        this._notificar();
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SUSCRIPCIÓN
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Se suscribe a los cambios de una rama.
   * La función sólo se invoca si el valor de esa ruta cambia por identidad, así
   * que un componente de inventario no se repinta porque haya llovido.
   *
   * @param {string} ruta Ruta vigilada. Cadena vacía = estado completo.
   * @param {(valor: *, anterior: *, estado: Object) => void} fn
   * @param {Object} [opciones]
   * @param {boolean} [opciones.inmediato=false] Invocar ya con el valor actual.
   * @returns {() => void} Función de baja.
   */
  subscribe(ruta, fn, opciones = {}) {
    const sub = {
      ruta,
      fn,
      ultimo: leerRuta(this._estado, ruta),
      id: `sub${++this._seq}`,
    };
    this._suscriptores.add(sub);

    if (opciones.inmediato) {
      try {
        fn(sub.ultimo, undefined, this._estado);
      } catch (e) {
        registrar(e, 'store');
      }
    }

    return () => this._suscriptores.delete(sub);
  }

  /**
   * Notifica a los suscriptores cuya rama vigilada haya cambiado.
   * @private
   */
  _notificar() {
    for (const sub of this._suscriptores) {
      const valor = leerRuta(this._estado, sub.ruta);
      if (valor === sub.ultimo) continue;
      const anterior = sub.ultimo;
      sub.ultimo = valor;
      try {
        sub.fn(valor, anterior, this._estado);
      } catch (e) {
        registrar(e, 'store');
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     INSTANTÁNEAS Y REEMPLAZO
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Guarda una copia profunda del estado bajo una etiqueta.
   * Se usa antes de aplicar un turno del director: si la respuesta resulta
   * inaplicable a mitad de camino, se restaura y no queda un estado a medias.
   *
   * @param {string} [etiqueta='turno']
   */
  instantanea(etiqueta = 'turno') {
    this._instantaneas.set(etiqueta, clonarProfundo(this._estado));
    log.traza(`instantánea "${etiqueta}" guardada`);
  }

  /**
   * Restaura una instantánea previa.
   * @param {string} [etiqueta='turno']
   * @returns {boolean} true si existía.
   */
  restaurar(etiqueta = 'turno') {
    const copia = this._instantaneas.get(etiqueta);
    if (!copia) return false;
    this._estado = copia;
    this._instantaneas.delete(etiqueta);
    this._notificar();
    log.aviso(`Estado restaurado desde la instantánea "${etiqueta}"`);
    return true;
  }

  /** Descarta una instantánea sin restaurarla. @param {string} [etiqueta] */
  descartarInstantanea(etiqueta = 'turno') {
    this._instantaneas.delete(etiqueta);
  }

  /**
   * Sustituye el estado por completo. Se usa al cargar una partida o al
   * empezar una nueva; nunca durante el juego normal.
   * @param {Object} nuevo
   */
  reemplazar(nuevo) {
    this._estado = nuevo;
    // Se recalculan los valores vigilados para que la próxima comparación sea
    // correcta, y se notifica a todos.
    for (const sub of this._suscriptores) sub.ultimo = undefined;
    this._notificar();
    log.info('Estado reemplazado por completo');
  }

  /** Reinicia a un estado vacío, conservando los ajustes del jugador. */
  reiniciar() {
    const ajustes = this._estado.settings;
    const nuevo = crearEstadoInicial();
    nuevo.settings = ajustes;
    this.reemplazar(nuevo);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     DIAGNÓSTICO
     ───────────────────────────────────────────────────────────────────────── */

  /** Número de acciones despachadas desde el arranque. */
  get contador() {
    return this._contador;
  }

  /** Radiografía del store, para depurar. */
  inspeccionar() {
    return {
      acciones: this._contador,
      tiposRegistrados: [...this._reductores.keys()].sort(),
      suscriptores: this._suscriptores.size,
      rutasVigiladas: [...this._suscriptores].map((s) => s.ruta),
      middleware: this._middleware.length,
      instantaneas: [...this._instantaneas.keys()],
    };
  }
}

/** Instancia compartida por toda la aplicación. */
export const store = new Store();

export default store;
