/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · economy/EconomySystem.js
 * ---------------------------------------------------------------------------
 * Coordinador económico.
 *
 * `PriceModel` calcula y `Trade` valida; este sistema los conecta con el mundo
 * real de la partida. Sus responsabilidades propias:
 *
 *   · COMPONER EL CONTEXTO — reunir región, reputación, eventos y actitud en el
 *     objeto que necesitan los otros dos módulos
 *   · EJECUTAR TRANSACCIONES — de forma atómica, con instantánea y restauración
 *   · SERVICIOS — alojamiento, reparación y curación, con sus horarios
 *   · REGATEO — enlazar la tirada social con el descuento resultante
 *
 * El primero es el que más aporta. Sin él, cada punto del código que necesite
 * un precio tendría que reunir cinco fuentes distintas y acabarían divergiendo.
 *
 * Dependencias: SystemBase, PriceModel, Trade, sistemas de mundo y personajes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import * as Precios from './PriceModel.js';
import * as Comercio from './Trade.js';
import { obtenerLugar } from '../data/locations.data.js';
import { ECONOMIA } from '../config/balance.config.js';
import { GRADOS } from '../player/SkillSystem.js';

/** Eventos publicados. */
export const EVENTOS_ECONOMIA = Object.freeze({
  COMPRA: 'trade:bought',
  VENTA: 'trade:sold',
  RECHAZO: 'trade:refused',
  SERVICIO: 'trade:service',
  COMPLETADA: 'trade:completed',
});

export class EconomySystem extends SystemBase {
  static nombre = 'economy';
  static dependencias = ['inventory', 'world', 'npcs', 'reputation'];
  static canal = 'economy';

  constructor(contexto) {
    super(contexto);

    /**
     * Descuentos negociados en la sesión actual de comercio.
     * Se pierden al cambiar de mercader: no se acumulan entre visitas.
     * @type {Map<string, number>}
     * @private
     */
    this._descuentos = new Map();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CICLO DE VIDA
     ═══════════════════════════════════════════════════════════════════════ */

  alIniciar() {
    // El descuento conseguido con una tirada social llega por aquí.
    this.escuchar('trade:discount', ({ refId, rebaja }) => {
      this._descuentos.set(refId, rebaja);

      this.log.debug(`descuento del ${Math.round(rebaja * 100)} % con ${refId}`);
    });

    // Salir del lugar cierra las negociaciones abiertas.
    this.escuchar('world:arrived', () => this._descuentos.clear());
    this.escuchar('travel:start', () => this._descuentos.clear());

    // Las acciones de comercio llegan desde la interfaz o el enrutador.
    this.escuchar('economy:buy', (datos) => this.comprar(datos));
    this.escuchar('economy:sell', (datos) => this.vender(datos));
    this.escuchar('economy:service', (datos) => this.contratarServicio(datos));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONTEXTO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Compone el contexto de precios para un mercader.
   *
   * Punto único donde se reúnen todas las fuentes. Si mañana se añade un factor
   * nuevo, se añade aquí y lo ven todos los cálculos a la vez.
   *
   * @param {Object} [mercader]
   * @returns {import('./PriceModel.js').ContextoPrecio}
   */
  contexto(mercader) {
    const lugar = obtenerLugar(this.leer('world.ubicacion'));

    // La reputación que cuenta es la de la facción del mercader.
    const reputacion = this.sistema('reputation');
    const multiplicador = mercader?.faccion
      ? reputacion?.multiplicadorPrecio(mercader.faccion) ?? 1
      : 1;

    return {
      region: lugar?.region,
      tamanoLugar: lugar?.tamano ?? 0,
      mercader,
      reputacionFaccion: multiplicador,
      efectosEventos: this.sistema('events')?.efectos(),
      descuento: mercader ? this._descuentos.get(mercader.refId) ?? 0 : 0,
      tieneTasacion: this._tieneTasacion(),
    };
  }

  /**
   * Comprueba si el personaje sabe tasar.
   *
   * Es lo que decide si ve la valoración de los precios o compra a ciegas.
   *
   * @returns {boolean}
   * @private
   */
  _tieneTasacion() {
    // Dos fallos en tres líneas, y por eso la habilidad no hacía nada.
    //
    // Leía `player.competencias`, que no existe: el mapa de competencias vive
    // en `player.habilidades`. Y comparaba con `>= 1` cuando los grados son
    // cadenas —inepto, lego, practicado, experto, maestro, legendario—, así
    // que incluso con la ruta correcta, `'maestro' >= 1` es falso.
    //
    // Se podía subir Tasación hasta Maestro y seguir comprando a ciegas.
    const habilidades = this.leer('player.habilidades', {}) ?? {};
    const grado = habilidades.tasacion;

    // Desde «practicado»: lego es lo que sabe cualquiera y no da ventaja.
    return GRADOS.indexOf(grado) >= GRADOS.indexOf('practicado');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPRA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Compra un objeto a un mercader.
   *
   * @param {Object} datos
   * @param {string} datos.refIdMercader
   * @param {Object} datos.objeto
   * @param {number} [datos.cantidad=1]
   * @returns {{exito: boolean, mensaje: string|null, total: number}}
   */
  comprar(datos) {
    const mercader = this.sistema('npcs')?.obtener(datos.refIdMercader);
    const contexto = this.contexto(mercader);

    const calculo = Comercio.cotizar(datos.objeto, 'compra', contexto);

    const resultado = Comercio.ejecutarCompra({
      objeto: datos.objeto,
      cantidad: datos.cantidad === undefined ? 1 : datos.cantidad,
      precioUnitario: calculo.precio,
      jugador: this.leer('player'),
      inventario: this.leer('inventory'),
      stock: datos.stock,
    });

    if (!resultado.exito) {
      this.emitir(EVENTOS_ECONOMIA.RECHAZO, {
        motivo: resultado.motivo,
        mensaje: resultado.mensaje,
      });

      this.emitir('narrative:direct', { texto: resultado.mensaje, voz: 'system' });

      return { exito: false, mensaje: resultado.mensaje, total: resultado.total };
    }

    // ─── Transacción atómica ────────────────────────────────────────────
    if (!this._despacharAtomico(resultado.acciones, 'compra')) {
      const mensaje = 'No se ha podido completar la compra: no te ha cobrado nada.';
      this.emitir(EVENTOS_ECONOMIA.RECHAZO, { motivo: 'revertida', mensaje });
      this.emitir('narrative:direct', { texto: mensaje, voz: 'system' });
      return { exito: false, mensaje, total: 0 };
    }

    // El mercader gana el oro y pierde la mercancía.
    if (mercader) {
      this._ajustarOroMercader(mercader, resultado.total);
    }

    this.emitir(EVENTOS_ECONOMIA.COMPRA, {
      objeto: datos.objeto.nombre,
      cantidad: datos.cantidad === undefined ? 1 : datos.cantidad,
      total: resultado.total,
      refIdMercader: datos.refIdMercader,
    });

    this.emitir(EVENTOS_ECONOMIA.COMPLETADA, {
      refIdNPC: datos.refIdMercader,
      direccion: 'compra',
      total: resultado.total,
      margenRegateo: contexto.descuento,
    });

    this.despachar('hazanas/registrar', { clave: 'objetosComprados', delta: datos.cantidad ?? 1 });

    return { exito: true, mensaje: null, total: resultado.total };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     VENTA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Vende un objeto a un mercader.
   *
   * @param {Object} datos
   * @param {string} datos.refIdMercader
   * @param {string} datos.idObjeto
   * @param {number} [datos.cantidad=1]
   * @returns {{exito: boolean, mensaje: string|null, total: number}}
   */
  vender(datos) {
    const objeto = this.leer(`inventory.objetos.porId.${datos.idObjeto}`);

    if (!objeto) {
      return { exito: false, mensaje: 'No llevas eso.', total: 0 };
    }

    const mercader = this.sistema('npcs')?.obtener(datos.refIdMercader);
    const contexto = this.contexto(mercader);

    const calculo = Comercio.cotizar(objeto, 'venta', contexto);

    const resultado = Comercio.ejecutarVenta({
      objeto,
      // Sin recortar: vender más de lo que se lleva se rechaza (ver Trade).
      cantidad: datos.cantidad === undefined ? 1 : datos.cantidad,
      precioUnitario: calculo.precio,
      mercader,
    });

    if (!resultado.exito) {
      this.emitir(EVENTOS_ECONOMIA.RECHAZO, {
        motivo: resultado.motivo,
        mensaje: resultado.mensaje,
      });

      this.emitir('narrative:direct', { texto: resultado.mensaje, voz: 'system' });

      return {
        exito: false,
        mensaje: resultado.mensaje,
        total: resultado.total,
        maximoPagable: resultado.maximoPagable,
      };
    }

    if (!this._despacharAtomico(resultado.acciones, 'venta')) {
      const mensaje = 'No se ha podido completar la venta: sigues con lo tuyo.';
      this.emitir(EVENTOS_ECONOMIA.RECHAZO, { motivo: 'revertida', mensaje });
      this.emitir('narrative:direct', { texto: mensaje, voz: 'system' });
      return { exito: false, mensaje, total: 0 };
    }

    // El mercader se queda sin ese oro.
    if (mercader) {
      this._ajustarOroMercader(mercader, -resultado.total);
    }

    this.emitir(EVENTOS_ECONOMIA.VENTA, {
      objeto: objeto.nombre,
      cantidad: datos.cantidad === undefined ? 1 : datos.cantidad,
      total: resultado.total,
      refIdMercader: datos.refIdMercader,
    });

    this.emitir(EVENTOS_ECONOMIA.COMPLETADA, {
      refIdNPC: datos.refIdMercader,
      direccion: 'venta',
      total: resultado.total,
      margenRegateo: contexto.descuento,
    });

    return { exito: true, mensaje: null, total: resultado.total };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SERVICIOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Contrata un servicio: dormir, curarse, reparar.
   *
   * @param {Object} datos
   * @param {string} datos.servicio
   * @param {string} [datos.idObjeto] Para la reparación.
   * @returns {{exito: boolean, mensaje: string|null, precio: number}}
   */
  contratarServicio(datos) {
    // ─── ¿Está disponible aquí y ahora? ─────────────────────────────────
    const time = this.sistema('time');
    const disponibilidad = time?.puedeUsar(this._servicioAServicioLugar(datos.servicio));

    if (disponibilidad && !disponibilidad.disponible) {
      this.emitir('narrative:direct', { texto: disponibilidad.motivo, voz: 'system' });
      return { exito: false, mensaje: disponibilidad.motivo, precio: 0 };
    }

    // Un evento puede haber cerrado el servicio.
    const eventos = this.sistema('events');
    if (eventos?.servicioCerradoPorEvento(this._servicioAServicioLugar(datos.servicio))) {
      const mensaje = 'Está cerrado por lo que está pasando en el lugar.';
      this.emitir('narrative:direct', { texto: mensaje, voz: 'system' });
      return { exito: false, mensaje, precio: 0 };
    }

    const contexto = this.contexto(this._mercaderDelServicio(datos.servicio));

    // ─── Reparación: precio por objeto ──────────────────────────────────
    if (datos.servicio === 'reparacion') {
      return this._repararEnTaller(datos.idObjeto, contexto);
    }

    // ─── Servicios de precio fijo ───────────────────────────────────────
    const { precio, descripcion } = Comercio.precioServicio(datos.servicio, contexto);

    const oro = this.leer('player.oro', 0);
    if (oro < precio) {
      const mensaje = `Te faltan ${precio - oro} de oro para ${descripcion}.`;
      this.emitir('narrative:direct', { texto: mensaje, voz: 'system' });
      return { exito: false, mensaje, precio };
    }

    this.despachar('inventory/oro', { delta: -precio, motivo: datos.servicio });

    // ─── Efecto del servicio ────────────────────────────────────────────
    this._aplicarServicio(datos.servicio);

    this.emitir(EVENTOS_ECONOMIA.SERVICIO, { servicio: datos.servicio, precio });

    return { exito: true, mensaje: null, precio };
  }

  /**
   * Aplica el efecto de un servicio contratado.
   * @param {string} servicio
   * @private
   */
  _aplicarServicio(servicio) {
    switch (servicio) {
      case 'posada':
        // Dormir en cama con comida: descanso completo.
        this.despachar('player/descansar', {
          tipo: 'largo',
          conProvisiones: true,
          enPosada: true,
        });
        this.sistema('clock')?.avanzarTiempo(480, 'descanso');
        break;

      case 'curacion': {
        const max = this.leer('player.vida.max', 1);
        const actual = this.leer('player.vida.actual', 1);
        this.despachar('player/curar', { cantidad: max - actual, origen: 'sanador' });

        // Un sanador también retira los estados que puede tratar.
        this.despachar('player/estado/quitar', { refId: 'sangrado' });
        this.despachar('player/estado/quitar', { refId: 'envenenado' });
        break;
      }

      case 'informacion':
        // La información la da el sistema de diálogo, no este.
        this.emitir('dialogue:request', { tipo: 'rumor', bonoExtra: 4 });
        break;
    }
  }

  /**
   * Repara un objeto en un taller.
   * @private
   */
  _repararEnTaller(idObjeto, contexto) {
    const objeto = this.leer(`inventory.objetos.porId.${idObjeto}`);

    if (!objeto) {
      return { exito: false, mensaje: 'No llevas eso.', precio: 0 };
    }

    const calculo = Comercio.precioReparacion(objeto, contexto);

    if (!calculo.posible) {
      return { exito: false, mensaje: calculo.motivo, precio: 0 };
    }

    const oro = this.leer('player.oro', 0);
    if (oro < calculo.precio) {
      return {
        exito: false,
        mensaje: `Repararlo cuesta ${calculo.precio} de oro y te faltan ${calculo.precio - oro}.`,
        precio: calculo.precio,
      };
    }

    // El inventario se encarga del oro y de la reparación en una sola acción.
    this.despachar('inventory/reparar', {
      idObjeto,
      puntos: calculo.puntos,
      coste: calculo.precio,
    });

    this.emitir(EVENTOS_ECONOMIA.SERVICIO, {
      servicio: 'reparacion',
      precio: calculo.precio,
      objeto: objeto.nombre,
    });

    return { exito: true, mensaje: null, precio: calculo.precio };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REGATEO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Intenta negociar un descuento con un mercader.
   *
   * La tirada la resuelve `DialogueSystem`; aquí se traduce el margen en una
   * rebaja concreta y se guarda para la sesión.
   *
   * @param {string} refIdMercader
   * @returns {{exito: boolean, rebaja: number, mensaje: string|null}}
   */
  regatear(refIdMercader) {
    const mercader = this.sistema('npcs')?.obtener(refIdMercader);

    if (!mercader) {
      return { exito: false, rebaja: 0, mensaje: 'No hay con quién negociar.' };
    }

    // Solo se regatea una vez por sesión: insistir molesta.
    if (this._descuentos.has(refIdMercader)) {
      return {
        exito: false,
        rebaja: this._descuentos.get(refIdMercader),
        mensaje: 'Ya has negociado el precio. No va a bajar más.',
      };
    }

    const dialogo = this.sistema('dialogue');
    const resultado = dialogo?.resolver({
      refId: refIdMercader,
      tipo: 'descuento',
      intencion: { tipo: 'negotiate' },
    });

    if (!resultado?.exito) {
      // Fallar el regateo lo cierra: no se puede insistir hasta acertar.
      this._descuentos.set(refIdMercader, 0);

      return {
        exito: false,
        rebaja: 0,
        mensaje: resultado?.motivo ?? 'No hay rebaja.',
      };
    }

    const rebaja = resultado.resultado?.rebaja ?? 0.05;
    this._descuentos.set(refIdMercader, rebaja);

    return { exito: true, rebaja, mensaje: null };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUXILIARES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Despacha una lista de acciones dentro de una transacción.
   *
   * Si algo falla a mitad, el estado vuelve atrás. No puede ocurrir que el oro
   * salga y el objeto no entre.
   *
   * @param {Array<Object>} acciones
   * @param {string} etiqueta
   * @private
   */
  _despacharAtomico(acciones, etiqueta) {
    this.store.instantanea(`comercio_${etiqueta}`);

    // Un reductor que rechaza (mochila llena, oro que no alcanza) no lanza:
    // devuelve el estado sin tocar y el `dispatch` sigue. Sin mirar eso, el
    // oro podía salir y el objeto no entrar. Cada acción TIENE que cambiar el
    // estado; si una no lo hace, se deshace todo.
    try {
      this.store.transaccion(() => {
        for (const a of acciones) {
          const antes = this.store.getState();
          const despues = this.despachar(a.tipo, a.payload);
          if (despues === antes) throw new Error(`acción rechazada: ${a.tipo}`);
        }
      });

      this.store.descartarInstantanea(`comercio_${etiqueta}`);
      return true;
    } catch (e) {
      this.store.restaurar(`comercio_${etiqueta}`);
      this.log.error(`transacción de ${etiqueta} revertida`, e);
      return false;
    }
  }

  /**
   * Ajusta el oro de un mercader tras una transacción.
   * @private
   */
  _ajustarOroMercader(mercader, delta) {
    const nuevo = Math.max(0, (mercader.oro ?? 0) + delta);

    this.despachar('npc/registrar', {
      npc: { ...mercader, oro: nuevo },
    });
  }

  /**
   * Traduce un servicio económico al servicio de lugar correspondiente.
   * @private
   */
  _servicioAServicioLugar(servicio) {
    const mapa = {
      posada: 'posada',
      curacion: 'templo',
      reparacion: 'herrero',
      informacion: 'posada',
      transporte: 'mercado',
    };
    return mapa[servicio] ?? servicio;
  }

  /**
   * Encuentra al PNJ que presta un servicio, si está presente.
   * @private
   */
  _mercaderDelServicio(servicio) {
    const npcs = this.sistema('npcs');
    if (!npcs) return null;

    const roles = {
      posada: ['posadero', 'posadera'],
      curacion: ['sanadora', 'oficiante'],
      reparacion: ['herrero', 'herrera'],
    };

    const buscados = roles[servicio] ?? [];

    return npcs.presentes().find((n) => buscados.includes(n.rol)) ?? null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSULTAS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Precio de un objeto sin ejecutar nada, para mostrarlo.
   *
   * @param {Object} objeto
   * @param {'compra'|'venta'} direccion
   * @param {string} [refIdMercader]
   * @returns {Object}
   */
  cotizar(objeto, direccion, refIdMercader) {
    const mercader = refIdMercader ? this.sistema('npcs')?.obtener(refIdMercader) : null;
    return Comercio.cotizar(objeto, direccion, this.contexto(mercader));
  }

  /**
   * Servicios disponibles aquí con su precio.
   * @returns {Array<Object>}
   */
  serviciosDisponibles() {
    const time = this.sistema('time');
    const disponibles = time?.serviciosDisponibles() ?? [];

    const mapa = {
      posada: 'posada',
      templo: 'curacion',
      herrero: 'reparacion',
    };

    return disponibles
      .filter((s) => mapa[s.servicio])
      .map((s) => {
        const servicio = mapa[s.servicio];
        const contexto = this.contexto(this._mercaderDelServicio(servicio));
        const { precio, descripcion } = Comercio.precioServicio(servicio, contexto);

        return {
          servicio,
          nombre: descripcion,
          precio,
          abierto: s.abierto,
          nota: s.nota,
          asequible: this.leer('player.oro', 0) >= precio,
        };
      });
  }

  /**
   * Contexto económico para el director.
   * @returns {string}
   */
  paraDirector() {
    const lugar = obtenerLugar(this.leer('world.ubicacion'));
    const partes = [];

    const precios = Precios.paraDirector(lugar?.region, this.sistema('events')?.efectos());
    if (precios) partes.push(precios);

    const oro = this.leer('player.oro', 0);
    if (oro === 0) partes.push('El personaje no tiene un solo oro encima.');
    else if (oro < 20) partes.push('Va justo de dinero.');

    return partes.join(' ');
  }

  /** @returns {Object} */
  inspeccionar() {
    const lugar = obtenerLugar(this.leer('world.ubicacion'));

    return {
      region: lugar?.region,
      oro: this.leer('player.oro', 0),
      tasacion: this._tieneTasacion(),
      descuentosActivos: [...this._descuentos.entries()],
      servicios: this.serviciosDisponibles(),
      efectosEventos: this.sistema('events')?.efectos()?.precios ?? 1,
    };
  }
}

export default EconomySystem;
