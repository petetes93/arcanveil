/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/EffectApplier.js
 * ---------------------------------------------------------------------------
 * Aplicación de los efectos propuestos por el director.
 *
 * Es el cortafuegos entre la narrativa y el estado. Todo lo que el director
 * quiere cambiar pasa por aquí y se recorta contra las cotas de balance antes
 * de tocar nada.
 *
 * Sin esta capa, un modelo que alucine «+50000 de oro» arruinaría la partida.
 * Con ella, se aplica lo razonable, se registra el ajuste y el juego sigue.
 *
 * Principio de operación: TRANSACCIONAL. Se toma una instantánea antes de
 * aplicar; si algo falla a mitad, se restaura. Nunca queda un estado a medias.
 *
 * Dependencias: SystemBase, balance.config, sistemas de juego.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import { COTAS_IA, ECONOMIA } from '../config/balance.config.js';
import { saturar } from '../utils/math.js';

/** Eventos publicados al aplicar efectos. */
export const EVENTOS_EFECTOS = Object.freeze({
  APLICADOS: 'effects:applied',
  RECORTADO: 'effects:clamped',
  RECHAZADO: 'effects:rejected',
});

export class EffectApplier extends SystemBase {
  static nombre = 'effects';
  static dependencias = ['player', 'inventory'];
  static canal = 'engine';

  /* ═══════════════════════════════════════════════════════════════════════
     APLICACIÓN PRINCIPAL
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Aplica una respuesta completa del director.
   *
   * @param {Object} respuesta Respuesta ya validada por ResponseSchema.
   * @param {Object} [contexto]
   * @param {boolean} [contexto.hitoNarrativo=false]
   * @param {number} [contexto.turno]
   * @returns {{aplicado: Object, ajustes: string[], avisos: Array<Object>}}
   */
  aplicar(respuesta, contexto = {}) {
    const ajustes = [];
    const avisos = [];

    // Instantánea previa: si algo revienta a mitad, se restaura entera.
    this.store.instantanea('efectos');

    try {
      const aplicado = {};

      this.store.transaccion(() => {
        aplicado.jugador = this._aplicarActualizaciones(respuesta.playerUpdates, ajustes, avisos);
        aplicado.objetos = this._aplicarObjetos(respuesta.newItems, ajustes, contexto);
        aplicado.misiones = this._aplicarMisiones(respuesta.quests, ajustes);
        aplicado.eventos = this._aplicarEventos(respuesta.events, ajustes);
        aplicado.npcs = this._aplicarNPCs(respuesta.npcs, ajustes);
        aplicado.tiempo = this._aplicarTiempo(respuesta.timeAdvance, ajustes);
      });

      this.store.descartarInstantanea('efectos');

      if (ajustes.length) {
        this.log.debug(`efectos aplicados con ${ajustes.length} ajustes`, ajustes);
        this.emitir(EVENTOS_EFECTOS.RECORTADO, { ajustes });
      }

      this.emitir(EVENTOS_EFECTOS.APLICADOS, { aplicado, ajustes });

      return { aplicado, ajustes, avisos };

    } catch (e) {
      // Un fallo a mitad deja el estado peor que no haber aplicado nada.
      this.store.restaurar('efectos');
      this.log.error('fallo al aplicar efectos; estado restaurado', e);
      this.emitir(EVENTOS_EFECTOS.RECHAZADO, { motivo: e?.message });

      return { aplicado: {}, ajustes: [...ajustes, 'efectos revertidos por error'], avisos };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ACTUALIZACIONES DEL PERSONAJE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Aplica los cambios de recursos, saturados contra las cotas.
   *
   * @param {Object} updates
   * @param {string[]} ajustes
   * @param {Array<Object>} avisos
   * @returns {Object}
   * @private
   */
  _aplicarActualizaciones(updates, ajustes, avisos) {
    if (!updates || !Object.keys(updates).length) return {};

    const aplicado = {};

    // Mapa de campo del contrato a la acción del motor correspondiente.
    const rutas = {
      hp: { cota: COTAS_IA.deltaMax.hp },
      mana: { cota: COTAS_IA.deltaMax.mana },
      xp: { cota: COTAS_IA.deltaMax.xp },
      gold: { cota: COTAS_IA.deltaMax.gold },
      hunger: { recurso: 'hambre', cota: COTAS_IA.deltaMax.hunger },
      thirst: { recurso: 'sed', cota: COTAS_IA.deltaMax.thirst },
      fatigue: { recurso: 'fatiga', cota: COTAS_IA.deltaMax.fatigue },
      morale: { recurso: 'moral', cota: COTAS_IA.deltaMax.morale },
    };

    for (const [clave, valor] of Object.entries(updates)) {
      if (clave === 'flags') {
        aplicado.flags = this._aplicarBanderas(valor, ajustes);
        continue;
      }

      const ruta = rutas[clave];
      if (!ruta) {
        ajustes.push(`campo desconocido descartado: ${clave}`);
        continue;
      }

      const delta = this._extraerDelta(valor, clave, ajustes);
      if (delta === null || delta === 0) continue;

      // ─── Saturación ─────────────────────────────────────────────────────
      const recortado = saturar(delta, -ruta.cota, ruta.cota);
      if (recortado !== delta) {
        ajustes.push(`${clave}: ${delta} recortado a ${recortado}`);
      }

      // ─── Aplicación ─────────────────────────────────────────────────────
      if (clave === 'hp') {
        if (recortado < 0) this.despachar('player/danar', { cantidad: -recortado, origen: 'director' });
        else this.despachar('player/curar', { cantidad: recortado, origen: 'director' });
      } else if (ruta.recurso) {
        this.despachar('player/recurso', { clave: ruta.recurso, delta: recortado });
      } else if (clave === 'gold') {
        this.despachar('inventory/oro', { delta: recortado, motivo: 'director' });
      } else if (clave === 'xp') {
        // La experiencia negativa no existe: el director no puede quitarla.
        if (recortado > 0) this.despachar('player/xp', { cantidad: recortado, motivo: 'director' });
        else ajustes.push('xp negativa descartada');
      } else if (clave === 'mana') {
        this.despachar('player/mana', { delta: recortado });
      }

      aplicado[clave] = recortado;
    }

    return aplicado;
  }

  /**
   * Extrae el delta de un campo, admitiendo las tres formas del contrato.
   *
   * `{delta: -5}`, `{set: 40}` o simplemente `-5`. Los modelos usan las tres y
   * rechazar dos de ellas por rigidez sería perder información útil.
   *
   * @param {*} valor
   * @param {string} clave
   * @param {string[]} ajustes
   * @returns {number|null}
   * @private
   */
  _extraerDelta(valor, clave, ajustes) {
    // El validador rellena los campos ausentes con un objeto vacío: eso no es
    // un formato inválido, es que no hay nada que aplicar.
    if (valor === null || valor === undefined) return null;

    // Todo lo que llega aquí son cantidades de juego: enteros finitos. NaN o
    // Infinity se descartan (antes pasaban por `typeof 'number'` y dejaban el
    // recurso roto); un decimal se redondea.
    const entero = (x) => {
      if (!Number.isFinite(x)) { ajustes.push(`${clave}: valor no finito descartado`); return null; }
      return Math.round(x);
    };

    if (typeof valor === 'number') return entero(valor);

    if (valor && typeof valor === 'object') {
      if (typeof valor.delta === 'number') return entero(valor.delta);

      // Objeto sin delta ni set: campo vacío, se pasa por alto en silencio.
      if (valor.delta === undefined && valor.set === undefined) return null;

      if (typeof valor.set === 'number') {
        // Un `set` se convierte en delta contra el valor actual, para que la
        // saturación siga aplicándose.
        const actual = this._valorActual(clave);
        if (actual === null) {
          ajustes.push(`${clave}: "set" no admitido para este campo`);
          return null;
        }
        return entero(valor.set - actual);
      }
    }

    ajustes.push(`${clave}: formato no reconocido`);
    return null;
  }

  /**
   * Valor actual de un recurso del contrato.
   * @param {string} clave
   * @returns {number|null}
   * @private
   */
  _valorActual(clave) {
    const rutas = {
      hp: 'player.vida.actual',
      mana: 'player.mana.actual',
      xp: 'player.xp',
      gold: 'player.oro',
      hunger: 'player.hambre',
      thirst: 'player.sed',
      fatigue: 'player.fatiga',
      morale: 'player.moral',
    };

    const ruta = rutas[clave];
    return ruta ? this.leer(ruta, 0) : null;
  }

  /**
   * Aplica banderas narrativas.
   *
   * Son el mecanismo por el que una decisión sigue teniendo efecto veinte
   * turnos después. Se aceptan libremente: no pueden desequilibrar nada.
   *
   * @param {Object} flags
   * @param {string[]} ajustes
   * @returns {Object}
   * @private
   */
  _aplicarBanderas(flags, ajustes) {
    if (!flags || typeof flags !== 'object') return {};

    const aplicadas = {};
    let contador = 0;

    for (const [clave, valor] of Object.entries(flags)) {
      // Se limita el número por turno para que un modelo desbocado no llene el
      // estado de basura.
      if (contador >= 8) {
        ajustes.push('demasiadas banderas: se descartaron las sobrantes');
        break;
      }

      const claveLimpia = String(clave).slice(0, 48).replace(/[^\w:]/g, '_');
      this.despachar('player/flag', { clave: claveLimpia, valor: Boolean(valor) });
      aplicadas[claveLimpia] = Boolean(valor);
      contador++;
    }

    return aplicadas;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OBJETOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Entrega los objetos propuestos, pasando por el cortafuegos de la fábrica.
   * @param {Array<Object>} propuestas
   * @param {string[]} ajustes
   * @param {Object} contexto
   * @returns {Array<Object>}
   * @private
   */
  _aplicarObjetos(propuestas, ajustes, contexto) {
    if (!propuestas?.length) return [];

    const inventario = this.sistema('inventory');
    if (!inventario) return [];

    const r = inventario.desdeDirector(propuestas, contexto);
    ajustes.push(...r.ajustes);

    return r.anadidos;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MISIONES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Aplica las operaciones sobre misiones.
   *
   * Se publican como eventos para que `QuestSystem` las procese: así este
   * módulo no necesita conocer el modelo de misiones.
   *
   * @param {Array<Object>} misiones
   * @param {string[]} ajustes
   * @returns {Array<Object>}
   * @private
   */
  _aplicarMisiones(misiones, ajustes) {
    if (!misiones?.length) return [];

    const limitadas = misiones.slice(0, COTAS_IA.misionesPorTurno);
    if (misiones.length > limitadas.length) {
      ajustes.push(`misiones recortadas de ${misiones.length} a ${limitadas.length}`);
    }

    const aplicadas = [];

    for (const m of limitadas) {
      // Una misión ya completada no puede reabrirse: está en la lista de
      // acciones prohibidas por una razón.
      const completadas = this.leer('quests.completadas', []);
      if (completadas.includes(m.id) && m.action !== 'complete') {
        ajustes.push(`intento de reabrir misión completada: ${m.id}`);
        continue;
      }

      this.emitir('quests:operation', m);
      aplicadas.push(m);
    }

    return aplicadas;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EVENTOS Y PNJ
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Publica los eventos del mundo.
   * @param {Array<Object>} eventos
   * @param {string[]} ajustes
   * @returns {Array<Object>}
   * @private
   */
  _aplicarEventos(eventos, ajustes) {
    if (!eventos?.length) return [];

    const aplicados = [];

    for (const e of eventos.slice(0, 8)) {
      switch (e.type) {
        case 'weather':
          if (e.payload?.clima) this.despachar('world/clima', { clima: e.payload.clima });
          break;

        case 'location':
          if (e.payload?.terreno) this.despachar('world/terreno', { terreno: e.payload.terreno });
          break;

        case 'container':
          this.emitir('world:container', e.payload);
          break;

        default:
          this.emitir(`world:event:${e.type}`, e.payload);
      }

      aplicados.push(e);
    }

    return aplicados;
  }

  /**
   * Registra los PNJ que el director introduce en la escena.
   * @param {Array<Object>} npcs
   * @param {string[]} ajustes
   * @returns {Array<Object>}
   * @private
   */
  _aplicarNPCs(npcs, ajustes) {
    if (!npcs?.length) return [];

    const aplicados = [];

    for (const n of npcs.slice(0, 5)) {
      if (!n.nombre && !n.refId) {
        ajustes.push('PNJ sin identificador descartado');
        continue;
      }

      // Un PNJ que murió no vuelve. Es una de las cosas que el director no
      // puede deshacer por descuido.
      const caidos = this.leer('npcs.caidos', []);
      if (caidos.includes(n.refId)) {
        ajustes.push(`intento de resucitar a ${n.refId}`);
        continue;
      }

      this.emitir('npcs:introduce', n);
      aplicados.push(n);
    }

    return aplicados;
  }

  /**
   * Avanza el tiempo si el director lo pide.
   * @param {number} minutos
   * @param {string[]} ajustes
   * @returns {number}
   * @private
   */
  _aplicarTiempo(minutos, ajustes) {
    if (!minutos || minutos <= 0) return 0;

    // Un salto temporal enorme rompe la coherencia del mundo.
    const recortado = saturar(minutos, 0, 480);
    if (recortado !== minutos) {
      ajustes.push(`avance de tiempo recortado de ${minutos} a ${recortado} minutos`);
    }

    const clock = this.sistema('clock');
    clock?.avanzarTiempo(recortado, 'narrativa');

    return recortado;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     VERIFICACIÓN
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Comprueba si una respuesta contiene operaciones prohibidas.
   *
   * Se ejecuta ANTES de aplicar nada. Detecta los intentos que la lista
   * `COTAS_IA.prohibido` declara inaceptables.
   *
   * @param {Object} respuesta
   * @returns {{limpia: boolean, violaciones: string[]}}
   */
  verificar(respuesta) {
    const violaciones = [];

    // Matar al jugador fuera de un combate resuelto por el motor.
    const hp = respuesta.playerUpdates?.hp;
    const delta = typeof hp === 'object' ? hp.delta : hp;
    const vidaActual = this.leer('player.vida.actual', 1);

    if (typeof delta === 'number' && delta < 0) {
      const enCombate = this.leer('combat.activo', false);
      if (!enCombate && vidaActual + delta <= 0) {
        violaciones.push('matarJugadorSinCombate');
      }
    }

    // Fijar el nivel directamente.
    if (respuesta.playerUpdates?.level !== undefined) {
      violaciones.push('fijarNivel');
    }

    // Modificar atributos base.
    if (respuesta.playerUpdates?.attributes !== undefined) {
      violaciones.push('modificarAtributoBase');
    }

    // Otorgar una clase avanzada.
    if (respuesta.playerUpdates?.advancedClass !== undefined) {
      violaciones.push('otorgarClaseAvanzada');
    }

    return { limpia: violaciones.length === 0, violaciones };
  }

  /**
   * Sanea una respuesta retirando las operaciones prohibidas.
   *
   * Se prefiere sanear a rechazar: un turno con un campo retirado sigue siendo
   * un turno jugable.
   *
   * @param {Object} respuesta
   * @returns {{respuesta: Object, retirado: string[]}}
   */
  sanear(respuesta) {
    const { limpia, violaciones } = this.verificar(respuesta);
    if (limpia) return { respuesta, retirado: [] };

    const saneada = { ...respuesta, playerUpdates: { ...respuesta.playerUpdates } };

    for (const v of violaciones) {
      switch (v) {
        case 'matarJugadorSinCombate': {
          // Se deja al personaje a 1 punto de vida en vez de matarlo: el
          // director puede llevarte al límite, pero no ejecutarte por narración.
          const vidaActual = this.leer('player.vida.actual', 1);
          saneada.playerUpdates.hp = { delta: -(vidaActual - 1) };
          break;
        }
        case 'fijarNivel':
          delete saneada.playerUpdates.level;
          break;
        case 'modificarAtributoBase':
          delete saneada.playerUpdates.attributes;
          break;
        case 'otorgarClaseAvanzada':
          delete saneada.playerUpdates.advancedClass;
          break;
      }
    }

    this.log.aviso(`respuesta saneada: ${violaciones.join(', ')}`);
    return { respuesta: saneada, retirado: violaciones };
  }
}

export default EffectApplier;
