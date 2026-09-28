/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · inventory/Inventory.js
 * ---------------------------------------------------------------------------
 * Sistema coordinador del inventario.
 *
 * Conecta con el Store todos los módulos puros anteriores: añade, quita, apila,
 * equipa, consume y recalcula la carga.
 *
 * Dos decisiones de diseño que atraviesan el archivo:
 *
 *   · El apilado es automático y transparente. Añadir tres pociones cuando ya
 *     llevas dos produce una pila de cinco, no dos entradas.
 *   · La carga se recalcula en un único punto (`_recalcular`), invocado tras
 *     cualquier cambio. Ningún reductor tiene que acordarse de actualizarla.
 *
 * Dependencias: SystemBase y todos los módulos de /inventory.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import { BORRAR } from '../core/Store.js';
import { LIMITES } from '../config/app.config.js';
import { ECONOMIA, COTAS_IA } from '../config/balance.config.js';

import * as Item from './Item.js';
import * as Fabrica from './ItemFactory.js';
import * as Equipo from './Equipment.js';
import * as Carga from './Encumbrance.js';
import * as Durabilidad from './Durability.js';
import { saturar } from '../utils/math.js';

/** Eventos publicados por el inventario. */
export const EVENTOS_INVENTARIO = Object.freeze({
  ANADIDO: 'inventory:added',
  RETIRADO: 'inventory:removed',
  EQUIPADO: 'inventory:equipped',
  DESEQUIPADO: 'inventory:unequipped',
  CONSUMIDO: 'inventory:consumed',
  ROTO: 'inventory:broken',
  CARGA: 'inventory:encumbrance',
  LLENO: 'inventory:full',
  ORO: 'inventory:gold',
});

export class Inventory extends SystemBase {
  static nombre = 'inventory';
  static dependencias = ['player'];
  static canal = 'inventory';

  /* ─────────────────────────────────────────────────────────────────────────
     CICLO DE VIDA
     ───────────────────────────────────────────────────────────────────────── */

  alIniciar() {
    this.reductores({
      'inventory/anadir': this._reducirAnadir,
      'inventory/anadirVarios': this._reducirAnadirVarios,
      'inventory/retirar': this._reducirRetirar,
      'inventory/soltar': this._reducirSoltar,
      'inventory/equipar': this._reducirEquipar,
      'inventory/desequipar': this._reducirDesequipar,
      'inventory/consumir': this._reducirConsumir,
      'inventory/desgastar': this._reducirDesgastar,
      'inventory/reparar': this._reducirReparar,
      'inventory/oro': this._reducirOro,
      'inventory/recalcular': this._reducirRecalcular,
    });

    // El equipo inicial llega con el personaje recién creado.
    this.escuchar('player:created', ({ inventario }) => {
      if (inventario?.length) {
        const objetos = Fabrica.equipoInicial(inventario);
        this.despachar('inventory/anadirVarios', { objetos, silencioso: true });
        queueMicrotask(() => this._equiparAutomatico());
      }
    });

    // Cualquier cambio de peso o de Vigor obliga a recalcular la impedimenta.
    this.observar('inventory.objetos', () => this._recalcular());
    this.observar('player.atributos.vigor', () => this._recalcular());
  }

  /**
   * Al terminar el turno se comprueba si el estado de carga cambió, para
   * avisar solo cuando importa.
   * @param {Object} contexto
   */
  alTurno(contexto) {
    if (contexto.tipo === 'combate') return;
    this._recalcular();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     AÑADIR
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirAnadir(estado, accion) {
    const { objeto, silencioso = false } = accion.payload ?? {};
    if (!objeto) return null;
    // Una cantidad que no es un entero positivo no entra (ni -1, ni 1.5, ni NaN).
    if (objeto.cantidad !== undefined && !(Number.isInteger(objeto.cantidad) && objeto.cantidad > 0)) return null;

    const resultado = this._insertar(estado.inventory, objeto);
    if (!resultado.exito) {
      queueMicrotask(() => this.emitir(EVENTOS_INVENTARIO.LLENO, { motivo: resultado.motivo }));
      return null;
    }

    if (!silencioso) {
      queueMicrotask(() => {
        this.emitir(EVENTOS_INVENTARIO.ANADIDO, {
          objeto,
          apilado: resultado.apilado,
          mencion: Item.mencion(objeto),
        });
      });
    }

    return { inventory: { objetos: resultado.objetos } };
  }

  /** @private */
  _reducirAnadirVarios(estado, accion) {
    const { objetos = [], silencioso = false } = accion.payload ?? {};
    if (!objetos.length) return null;

    let coleccion = estado.inventory.objetos;
    const anadidos = [];
    const rechazados = [];

    for (const objeto of objetos) {
      const r = this._insertar({ ...estado.inventory, objetos: coleccion }, objeto);
      if (r.exito) {
        coleccion = r.objetos;
        anadidos.push(objeto);
      } else {
        rechazados.push({ objeto, motivo: r.motivo });
      }
    }

    if (!anadidos.length) return null;

    if (!silencioso) {
      queueMicrotask(() => {
        for (const o of anadidos) {
          this.emitir(EVENTOS_INVENTARIO.ANADIDO, { objeto: o, mencion: Item.mencion(o) });
        }
        for (const r of rechazados) {
          this.emitir(EVENTOS_INVENTARIO.LLENO, { objeto: r.objeto, motivo: r.motivo });
        }
      });
    }

    return { inventory: { objetos: coleccion } };
  }

  /**
   * Inserta un objeto en la colección, apilando si hay una pila compatible.
   *
   * @param {Object} inventario
   * @param {Object} objeto
   * @returns {{exito: boolean, objetos: Object|null, apilado: boolean, motivo: string|null}}
   * @private
   */
  _insertar(inventario, objeto) {
    const porId = { ...(inventario.objetos?.porId ?? {}) };
    const orden = [...(inventario.objetos?.orden ?? [])];

    // — Intento de apilado —
    if (Item.pilaMaxima(objeto) > 1) {
      for (const id of orden) {
        const existente = porId[id];
        if (!Item.apilables(existente, objeto)) continue;

        const maximo = Item.pilaMaxima(existente);
        const hueco = maximo - existente.cantidad;
        if (hueco <= 0) continue;

        const mueve = Math.min(hueco, objeto.cantidad);
        porId[id] = { ...existente, cantidad: existente.cantidad + mueve };

        if (mueve >= objeto.cantidad) {
          return { exito: true, objetos: { porId, orden }, apilado: true, motivo: null };
        }

        objeto = { ...objeto, cantidad: objeto.cantidad - mueve };
      }
    }

    // — Entrada nueva —
    if (orden.length >= LIMITES.inventarioRanuras) {
      return { exito: false, objetos: null, apilado: false, motivo: 'No te caben más cosas' };
    }

    porId[objeto.id] = objeto;
    orden.push(objeto.id);

    return { exito: true, objetos: { porId, orden }, apilado: false, motivo: null };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     RETIRAR
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirRetirar(estado, accion) {
    const { idObjeto, cantidad = 1, silencioso = false } = accion.payload ?? {};

    const objeto = estado.inventory.objetos?.porId?.[idObjeto];
    if (!objeto) return null;
    // Retirar -1 sumaba una unidad (`cantidad - (-1)`). Solo enteros positivos.
    if (!(Number.isInteger(cantidad) && cantidad > 0)) return null;

    const parche = { inventory: {} };
    const porId = { ...estado.inventory.objetos.porId };
    let orden = [...estado.inventory.objetos.orden];

    const retirado = Math.min(cantidad, objeto.cantidad);

    if (retirado >= objeto.cantidad) {
      // `delete` en la copia no lo quitaba del estado (ver `aplicarParche`).
      porId[idObjeto] = BORRAR;
      orden = orden.filter((id) => id !== idObjeto);

      if (objeto.equipado) {
        const equipado = { ...estado.inventory.equipado };
        for (const [ranura, id] of Object.entries(equipado)) {
          if (id === idObjeto) equipado[ranura] = null;
        }
        parche.inventory.equipado = equipado;
      }
    } else {
      porId[idObjeto] = { ...objeto, cantidad: objeto.cantidad - retirado };
    }

    parche.inventory.objetos = { porId, orden };

    if (!silencioso) {
      queueMicrotask(() => {
        this.emitir(EVENTOS_INVENTARIO.RETIRADO, { objeto, cantidad: retirado });
      });
    }

    return parche;
  }

  /** @private */
  _reducirSoltar(estado, accion) {
    const { idObjeto, cantidad = 1 } = accion.payload ?? {};
    const objeto = estado.inventory.objetos?.porId?.[idObjeto];
    if (!objeto) return null;

    // Los objetos de misión no se sueltan: son parte de la historia.
    if (objeto.esMision) {
      queueMicrotask(() => this.emitir('inventory:denied', {
        motivo: 'No puedes deshacerte de eso',
      }));
      return null;
    }

    queueMicrotask(() => {
      this.emitir('inventory:dropped', { objeto, cantidad, mencion: Item.mencion(objeto) });
    });

    return this._reducirRetirar(estado, { payload: { idObjeto, cantidad, silencioso: true } });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     EQUIPO
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirEquipar(estado, accion) {
    const { idObjeto, ranura } = accion.payload ?? {};

    const r = Equipo.equipar(estado.inventory, idObjeto, ranura);
    if (!r.exito) {
      queueMicrotask(() => this.emitir('inventory:denied', { motivo: r.motivo }));
      return null;
    }

    const porId = { ...estado.inventory.objetos.porId };

    for (const id of r.desequipados) {
      if (porId[id]) porId[id] = { ...porId[id], equipado: false };
    }
    if (porId[idObjeto]) porId[idObjeto] = { ...porId[idObjeto], equipado: true };

    queueMicrotask(() => {
      this.emitir(EVENTOS_INVENTARIO.EQUIPADO, {
        objeto: porId[idObjeto],
        ranura: r.ranura,
        aviso: r.aviso,
      });
      for (const id of r.desequipados) {
        this.emitir(EVENTOS_INVENTARIO.DESEQUIPADO, { objeto: porId[id] });
      }
    });

    return {
      inventory: {
        equipado: r.equipado,
        objetos: { ...estado.inventory.objetos, porId },
      },
    };
  }

  /** @private */
  _reducirDesequipar(estado, accion) {
    const { ranura } = accion.payload ?? {};

    const r = Equipo.desequipar(estado.inventory, ranura);
    if (!r.exito) return null;

    const porId = { ...estado.inventory.objetos.porId };
    if (porId[r.idObjeto]) porId[r.idObjeto] = { ...porId[r.idObjeto], equipado: false };

    queueMicrotask(() => {
      this.emitir(EVENTOS_INVENTARIO.DESEQUIPADO, { objeto: porId[r.idObjeto], ranura });
    });

    return {
      inventory: {
        equipado: r.equipado,
        objetos: { ...estado.inventory.objetos, porId },
      },
    };
  }

  /**
   * Equipa automáticamente lo mejor de cada ranura al crear el personaje.
   * @private
   */
  _equiparAutomatico() {
    const inventario = this.leer('inventory');
    const objetos = Object.values(inventario?.objetos?.porId ?? {});

    const porRanura = new Map();

    for (const objeto of objetos) {
      const plantilla = Item.plantilla(objeto);
      if (!plantilla?.ranura) continue;

      const actual = porRanura.get(plantilla.ranura);
      if (!actual || objeto.valor > actual.valor) porRanura.set(plantilla.ranura, objeto);
    }

    this.store.transaccion(() => {
      for (const objeto of porRanura.values()) {
        this.despachar('inventory/equipar', { idObjeto: objeto.id });
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CONSUMO
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirConsumir(estado, accion) {
    const { idObjeto } = accion.payload ?? {};

    const objeto = estado.inventory.objetos?.porId?.[idObjeto];
    if (!objeto) return null;

    const efecto = Item.efectoConsumo(objeto);
    if (!efecto) {
      queueMicrotask(() => this.emitir('inventory:denied', { motivo: 'Eso no se consume' }));
      return null;
    }

    queueMicrotask(() => {
      this._aplicarEfectoConsumo(efecto, objeto);
      this.emitir(EVENTOS_INVENTARIO.CONSUMIDO, { objeto, efecto });
    });

    return this._reducirRetirar(estado, { payload: { idObjeto, cantidad: 1, silencioso: true } });
  }

  /**
   * Traduce el efecto de un consumible a acciones sobre otros sistemas.
   * @param {Object} efecto
   * @param {Object} objeto
   * @private
   */
  _aplicarEfectoConsumo(efecto, objeto) {
    switch (efecto.tipo) {
      case 'curacion': {
        const cantidad = this._evaluar(efecto.notacion);
        this.despachar('player/curar', { cantidad, origen: objeto.nombre });
        break;
      }
      case 'mana': {
        const cantidad = this._evaluar(efecto.notacion);
        this.despachar('player/mana', { delta: cantidad });
        break;
      }
      case 'recurso': {
        this.despachar('player/recurso', { clave: efecto.clave, delta: efecto.valor });
        break;
      }
      case 'curarEstado': {
        for (const est of efecto.estados ?? []) {
          this.despachar('player/estado/quitar', { refId: est });
        }
        break;
      }
      case 'luz': {
        this.despachar('world/luz', { radio: efecto.radio, duracion: efecto.duracion });
        break;
      }
      default:
        this.log.debug(`Efecto de consumo no reconocido: ${efecto.tipo}`);
    }
  }

  /**
   * Evalúa una notación de dados con el flujo del inventario.
   * @param {string} notacion
   * @returns {number}
   * @private
   */
  _evaluar(notacion) {
    if (typeof notacion === 'number') return notacion;

    const flujo = this.rng.flujo('botin');
    const m = String(notacion).match(/^(\d*)d(\d+)([+-]\d+)?$/);
    if (!m) return Number(notacion) || 0;

    const cantidad = m[1] ? parseInt(m[1], 10) : 1;
    const caras = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(m[3], 10) : 0;

    let total = mod;
    for (let i = 0; i < cantidad; i++) total += flujo.entero(1, caras);
    return total;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     DURABILIDAD
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirDesgastar(estado, accion) {
    const { idObjeto, cantidad, tipo } = accion.payload ?? {};

    const objeto = estado.inventory.objetos?.porId?.[idObjeto];
    if (!objeto?.tieneDurabilidad) return null;

    let r;
    if (tipo === 'arma') r = Durabilidad.desgastarArma(objeto, accion.payload);
    else if (tipo === 'armadura') r = Durabilidad.desgastarArmadura(objeto, accion.payload.dano ?? 0);
    else r = Durabilidad.desgastar(objeto, cantidad ?? 1);

    if (r.cambio === 0) return null;

    const porId = { ...estado.inventory.objetos.porId, [idObjeto]: r.objeto };
    const parche = { inventory: { objetos: { ...estado.inventory.objetos, porId } } };

    // Un objeto que se rompe se desequipa solo: no sirve de nada en la ranura.
    if (r.seRompio) {
      const equipado = { ...estado.inventory.equipado };
      for (const [ranura, id] of Object.entries(equipado)) {
        if (id === idObjeto) equipado[ranura] = null;
      }
      parche.inventory.equipado = equipado;
      porId[idObjeto] = { ...r.objeto, equipado: false };
    }

    if (r.cruzoUmbral) {
      queueMicrotask(() => {
        const aviso = Durabilidad.avisoUmbral(r.objeto, r.cruzoUmbral);
        if (aviso) this.emitir(EVENTOS_INVENTARIO.ROTO, { objeto: r.objeto, ...aviso });
      });
    }

    return parche;
  }

  /** @private */
  _reducirReparar(estado, accion) {
    const { idObjeto, puntos, enCampo = false, margen = 0, coste = 0 } = accion.payload ?? {};

    const objeto = estado.inventory.objetos?.porId?.[idObjeto];
    if (!objeto?.tieneDurabilidad) return null;

    if (coste > 0 && (estado.player.oro ?? 0) < coste) {
      queueMicrotask(() => this.emitir('inventory:denied', { motivo: 'No tienes suficiente oro' }));
      return null;
    }

    const r = enCampo
      ? Durabilidad.repararEnCampo(objeto, margen)
      : Durabilidad.reparar(objeto, puntos);

    if (r.restaurado === 0) return null;

    const porId = { ...estado.inventory.objetos.porId, [idObjeto]: r.objeto };
    const parche = { inventory: { objetos: { ...estado.inventory.objetos, porId } } };

    if (coste > 0) parche.player = { oro: (estado.player.oro ?? 0) - coste };

    queueMicrotask(() => {
      this.emitir('inventory:repaired', {
        objeto: r.objeto,
        restaurado: r.restaurado,
        maxPerdido: r.maxPerdido ?? 0,
      });
    });

    return parche;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     ORO
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirOro(estado, accion) {
    const { delta = 0, motivo = '' } = accion.payload ?? {};
    // El oro se mueve en enteros finitos: NaN o Infinity dejaban el monedero
    // roto para el resto de la partida.
    if (!Number.isInteger(delta) || delta === 0) return null;

    const actual = estado.player.oro ?? 0;

    // Un gasto que no se puede pagar se rechaza entero.
    if (delta < 0 && actual + delta < 0) {
      queueMicrotask(() => this.emitir('inventory:denied', {
        motivo: `Te faltan ${Math.abs(actual + delta)} de oro`,
      }));
      return null;
    }

    const nuevo = saturar(actual + delta, 0, ECONOMIA.oroMax);

    queueMicrotask(() => {
      this.emitir(EVENTOS_INVENTARIO.ORO, { delta: nuevo - actual, total: nuevo, motivo });
    });

    const estadisticas = delta > 0
      ? { oroGanado: (estado.hazanas.estadisticas.oroGanado ?? 0) + delta }
      : { oroGastado: (estado.hazanas.estadisticas.oroGastado ?? 0) + Math.abs(delta) };

    return {
      player: { oro: nuevo },
      hazanas: { estadisticas },
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CARGA
     ───────────────────────────────────────────────────────────────────────── */

  /** @private */
  _reducirRecalcular(estado) {
    const a = Carga.analizar(estado.player, estado.inventory);

    if (a.carga === estado.inventory.carga && a.estado.clave === estado.inventory.impedimenta) {
      return null;
    }

    return {
      inventory: {
        carga: a.carga,
        cargaMax: a.maximo,
        impedimenta: a.estado.clave,
      },
    };
  }

  /** @private */
  _recalcular() {
    const anterior = this.leer('inventory.impedimenta');
    this.despachar('inventory/recalcular');
    const nuevo = this.leer('inventory.impedimenta');

    if (anterior !== nuevo && nuevo !== 'ligero') {
      const a = Carga.analizar(this.leer('player'), this.leer('inventory'));
      this.emitir(EVENTOS_INVENTARIO.CARGA, {
        estado: nuevo,
        nombre: a.estado.nombre,
        modificador: a.modificador,
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     API PÚBLICA
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Añade botín generado, tanto oro como objetos.
   * @param {{oro: number, objetos: Array<Object>}} botin
   */
  recibirBotin(botin) {
    this.store.transaccion(() => {
      if (botin.oro > 0) this.despachar('inventory/oro', { delta: botin.oro, motivo: 'botín' });
      if (botin.objetos?.length) this.despachar('inventory/anadirVarios', { objetos: botin.objetos });
    });
  }

  /**
   * Procesa los objetos que propone el director de juego.
   *
   * @param {Array<Object>} propuestas Campo `newItems` del JSON.
   * @param {Object} [contexto]
   * @returns {{anadidos: Array<Object>, ajustes: string[]}}
   */
  desdeDirector(propuestas, contexto = {}) {
    const limitadas = (propuestas ?? []).slice(0, COTAS_IA.objetosPorTurno);
    const flujo = this.rng.flujo('botin');

    const objetos = [];
    const ajustes = [];

    for (const p of limitadas) {
      const r = Fabrica.desdeDirector(p, flujo, {
        ...contexto,
        nivelJugador: this.leer('player.nivel', 1),
      });
      if (r.objeto) objetos.push(r.objeto);
      ajustes.push(...r.ajustes);
    }

    if (objetos.length) this.despachar('inventory/anadirVarios', { objetos });
    if (ajustes.length) this.log.debug('Ajustes a objetos del director', ajustes);

    return { anadidos: objetos, ajustes };
  }

  /**
   * Bonificadores del equipo actual. Lo consulta RulesEngine y CombatManager.
   * @returns {Object}
   */
  bonificadores() {
    return Equipo.bonificadores(this.leer('inventory'));
  }

  /**
   * Arma activa, con sus estadísticas ya resueltas.
   * @returns {Object}
   */
  armaActiva() {
    return Equipo.armaActiva(this.leer('inventory'));
  }

  /**
   * Penalización de carga, en formato de desglose.
   * @returns {Object}
   */
  penalizacionCarga() {
    return Carga.penalizacion(this.leer('player'), this.leer('inventory'));
  }

  /**
   * Busca un objeto por su plantilla. Devuelve la primera pila encontrada.
   * @param {string} refId
   * @returns {Object|null}
   */
  buscar(refId) {
    const objetos = Object.values(this.leer('inventory.objetos.porId', {}));
    return objetos.find((o) => o.refId === refId) ?? null;
  }

  /**
   * Cantidad total de un objeto en el inventario.
   * @param {string} refId
   * @returns {number}
   */
  cantidadDe(refId) {
    const objetos = Object.values(this.leer('inventory.objetos.porId', {}));
    return objetos
      .filter((o) => o.refId === refId)
      .reduce((total, o) => total + o.cantidad, 0);
  }

  /**
   * Comprueba si el personaje lleva provisiones para un descanso completo.
   * @returns {boolean}
   */
  tieneProvisiones() {
    return this.cantidadDe('racion_viaje') > 0 && this.cantidadDe('odre_agua') > 0;
  }

  /**
   * Comprueba la munición del arma equipada.
   * @returns {{tiene: boolean, refId: string|null, cantidad: number}}
   */
  comprobarMunicion() {
    const arma = this.armaActiva();
    const refId = arma?.stats?.municion;

    if (!refId) return { tiene: true, refId: null, cantidad: Infinity };

    const pila = this.buscar(refId);
    return {
      tiene: Boolean(pila),
      refId: pila?.id ?? null,
      cantidad: this.cantidadDe(refId),
    };
  }

  /**
   * Resumen del inventario para el prompt del director.
   *
   * Solo lo relevante: el equipo, la carga si estorba y los objetos notables.
   *
   * @returns {string}
   */
  paraDirector() {
    const inventario = this.leer('inventory');
    const jugador = this.leer('player');
    const partes = [];

    partes.push(Equipo.paraDirector(inventario));

    const carga = Carga.paraDirector(jugador, inventario);
    if (carga) partes.push(carga);

    const notables = Object.values(inventario?.objetos?.porId ?? {})
      .map((o) => Item.paraDirector(o))
      .filter(Boolean)
      .slice(0, 5);

    if (notables.length) partes.push(`Lleva encima: ${notables.join(' ')}`);

    const oro = jugador?.oro ?? 0;
    partes.push(oro === 0 ? 'No lleva dinero.' : `Lleva ${oro} de oro.`);

    return partes.join(' ');
  }

  /**
   * Estado completo del inventario, para la interfaz.
   * @returns {Object}
   */
  resumen() {
    const inventario = this.leer('inventory');
    const jugador = this.leer('player');

    return {
      objetos: (inventario.objetos?.orden ?? []).map((id) => inventario.objetos.porId[id]).filter(Boolean),
      equipado: Equipo.paraInterfaz(inventario),
      carga: Carga.paraInterfaz(jugador, inventario),
      oro: jugador.oro ?? 0,
      ranuras: { usadas: inventario.objetos?.orden?.length ?? 0, total: LIMITES.inventarioRanuras },
      bonificadores: Equipo.bonificadores(inventario),
    };
  }
}

export default Inventory;
