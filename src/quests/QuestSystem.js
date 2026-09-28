/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · quests/QuestSystem.js
 * ---------------------------------------------------------------------------
 * Coordinador de misiones.
 *
 * Reúne el modelo, el generador y el estado, y se ocupa de lo que ninguno hace
 * por separado:
 *
 *   · SEGUIMIENTO AUTOMÁTICO — escucha los eventos del motor y los propaga a
 *     todas las misiones activas. Matar un lobo avanza cualquier misión que lo
 *     pida, sin que nadie lo declare.
 *   · PLAZOS — revisa cada día qué ha caducado y lo hace fracasar.
 *   · RECOMPENSAS — las paga al completar, con los extras de los opcionales.
 *   · OFERTA — decide cuándo proponer algo nuevo, sin saturar.
 *
 * El último punto es más delicado de lo que parece. Un juego que ofrece cinco
 * encargos en el primer pueblo abruma; uno que no ofrece ninguno en tres horas
 * aburre. El límite de misiones activas y el periodo de gracia entre ofertas
 * son las dos palancas que lo regulan.
 *
 * Dependencias: SystemBase, Quest, Objective, QuestGenerator.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import { BORRAR } from '../core/Store.js';
import * as Q from './Quest.js';
import * as Obj from './Objective.js';
import * as Generador from './QuestGenerator.js';
import { obtenerLugar } from '../data/locations.data.js';
import { obtenerClase } from '../data/classes.data.js';
import { obtenerTrasfondo } from '../data/backgrounds.data.js';
import { trasPreposicion } from '../utils/text.js';
import { LIMITES } from '../config/app.config.js';

/** Eventos publicados. */
export const EVENTOS_MISION = Object.freeze({
  OFRECIDA: 'quests:offered',
  ACEPTADA: 'quests:accepted',
  PROGRESO: 'quests:progress',
  COMPLETADA: 'quests:completed',
  FRACASADA: 'quests:failed',
  CADUCA: 'quests:expiring',
});

/** Misiones activas simultáneas como máximo. */
const ACTIVAS_MAX = 6;

/** Turnos entre ofertas espontáneas. */
const GRACIA_OFERTA = 12;

export class QuestSystem extends SystemBase {
  static nombre = 'quests';
  static dependencias = ['world', 'inventory', 'player'];
  static canal = 'quests';

  constructor(contexto) {
    super(contexto);

    /** Turno de la última oferta, para no saturar. @private */
    this._ultimaOferta = 0;

    /** Plantillas ya usadas, para variar. @private */
    this._plantillasUsadas = [];

  }

  /* ═══════════════════════════════════════════════════════════════════════
     CICLO DE VIDA
     ═══════════════════════════════════════════════════════════════════════ */

  alIniciar() {
    this.reductores({
      'quests/registrar': this._reducirRegistrar,
      'quests/actualizar': this._reducirActualizar,
      'quests/cerrar': this._reducirCerrar,
    });

    // ─── Seguimiento automático ─────────────────────────────────────────
    // Cada evento relevante se propaga a todas las misiones activas.
    const seguidos = [
      'combat:enemy:killed',
      'world:arrived',
      'npc:talked',
      'quest:deliver',
    ];

    for (const evento of seguidos) {
      this.escuchar(evento, (datos) => this._propagar(evento, datos));
    }

    // Los objetivos de recogida se sincronizan con el inventario.
    this.escuchar('inventory:added', () => this._sincronizarInventario());
    this.escuchar('inventory:removed', () => this._sincronizarInventario());

    // ─── Operaciones del director ───────────────────────────────────────
    this.escuchar('quests:operation', (operacion) => this.procesarOperacion(operacion));

    // ─── Plazos ─────────────────────────────────────────────────────────
    this.escuchar('clock:day:new', ({ diasTotales }) => this._revisarPlazos(diasTotales));
  }

  /**
   * Cada turno se evalúa si conviene ofrecer algo.
   * @param {Object} contexto
   */
  alTurno(contexto) {
    if (contexto.tipo === 'combate') return;
    this._evaluarOferta(contexto.turno);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SEGUIMIENTO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Propaga un evento a todas las misiones aceptadas.
   *
   * @param {string} tipoEvento
   * @param {Object} datos
   * @private
   */
  _propagar(tipoEvento, datos) {
    const activas = this.activas();
    if (!activas.length) return;

    for (const mision of activas) {
      const r = Q.propagarEvento(mision, tipoEvento, datos);
      if (!r.avanzados.length) continue;

      this.despachar('quests/actualizar', { mision: r.mision });

      // ─── Aviso de progreso ────────────────────────────────────────────
      for (const a of r.avanzados) {
        this.emitir(EVENTOS_MISION.PROGRESO, {
          refId: mision.refId,
          titulo: mision.titulo,
          objetivo: a.texto,
          completado: a.completado,
          progreso: a.progreso,
          cantidad: a.cantidad,
        });

        if (a.completado) {
          this.emitir('ui:notice', {
            mensaje: `${mision.titulo}: ${a.texto}`,
            tipo: 'exito',
            icono: 'mision',
          });
        }
      }

      // ─── ¿Lista para cobrar? ──────────────────────────────────────────
      // Una principal se cierra sola: su último paso es hablar con quien da
      // la pista, así que no hay a quién volver a «cobrársela».
      if (r.listaParaCerrar && r.mision.tipo === 'principal') this.completar(r.mision.refId);
      else if (r.listaParaCerrar) this._avisarCompletable(r.mision);
    }
  }

  /**
   * Sincroniza los objetivos de recogida con el inventario real.
   *
   * No se cuentan altas porque el jugador puede tirar o vender lo recogido.
   * Se consulta el estado, que es la única fuente fiable.
   *
   * @private
   */
  _sincronizarInventario() {
    const activas = this.activas();
    if (!activas.length) return;

    const inventario = this.sistema('inventory');
    const contar = (refId) => inventario?.cantidadDe(refId) ?? 0;

    for (const mision of activas) {
      const tieneRecogida = mision.objetivos.some((o) => o.clase === 'recoger');
      if (!tieneRecogida) continue;

      const r = Q.sincronizarInventario(mision, contar);
      if (!r.cambio) continue;

      this.despachar('quests/actualizar', { mision: r.mision });

      if (r.listaParaCerrar) this._avisarCompletable(r.mision);
    }
  }

  /**
   * Avisa de que una misión puede cobrarse.
   * @private
   */
  _avisarCompletable(mision) {
    this.emitir('ui:notice', {
      mensaje: mision.nombreOrigen
        ? `«${mision.titulo}» está lista. Habla con ${mision.nombreOrigen}.`
        : `«${mision.titulo}» está lista.`,
      tipo: 'exito',
      icono: 'mision',
    });

    // El director lo sabe, para que pueda cerrarla si el jugador vuelve.
    this.emitir('memory:context', {
      texto: `«${mision.titulo}» tiene todos los objetivos cumplidos: falta cobrarla${mision.nombreOrigen ? ` a ${mision.nombreOrigen}` : ''}.`,
      temporal: true,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OPERACIONES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Procesa una operación declarada por el director.
   *
   * @param {Object} operacion Entrada del campo `quests` del JSON.
   * @returns {{aplicada: boolean, motivo: string|null}}
   */
  procesarOperacion(operacion) {
    switch (operacion.action) {
      case 'offer': return this.ofrecer(operacion);
      case 'accept': return this.aceptar(operacion.id);
      case 'progress': return this._progresoManual(operacion);
      case 'complete': return this.completar(operacion.id, { forzar: true });
      case 'fail': return this.fracasar(operacion.id, 'el director lo declaró');
      default: return { aplicada: false, motivo: 'operación desconocida' };
    }
  }

  /**
   * Ofrece una misión al jugador.
   *
   * @param {Object} propuesta
   * @returns {{aplicada: boolean, motivo: string|null, mision: Object|null}}
   */
  ofrecer(propuesta) {
    // ─── Cota de misiones activas ───────────────────────────────────────
    if (this.activas().length >= ACTIVAS_MAX) {
      return {
        aplicada: false,
        motivo: 'Ya tienes demasiados asuntos entre manos.',
        mision: null,
      };
    }

    // ─── ¿Ya existe? ────────────────────────────────────────────────────
    if (propuesta.id && this.obtener(propuesta.id)) {
      return { aplicada: false, motivo: 'Esa misión ya existe.', mision: null };
    }

    const npcs = this.sistema('npcs');
    const origen = npcs?.presentes()[0];

    const { mision, ajustes } = Generador.normalizar(propuesta, {
      origen: origen?.refId,
      nombreOrigen: origen?.nombre,
      faccion: origen?.faccion,
      lugar: this.leer('world.ubicacion'),
      turno: this.leer('meta.turno', 0),
    });

    if (ajustes.length) this.log.debug('misión normalizada', ajustes);

    this.despachar('quests/registrar', { mision });
    this._ultimaOferta = this.leer('meta.turno', 0);

    this.emitir(EVENTOS_MISION.OFRECIDA, {
      refId: mision.refId,
      titulo: mision.titulo,
      tipo: mision.tipo,
      recompensa: Q.recompensaEfectiva(mision),
    });

    return { aplicada: true, motivo: null, mision };
  }

  /**
   * Rechaza una misión ofrecida.
   *
   * Queda rechazada y fuera de las ofrecidas; no se vuelve a proponer sola.
   * Quien la ofrecía lo recuerda.
   *
   * @param {string} refId
   * @returns {{aplicada: boolean, motivo: string|null}}
   */
  rechazar(refId) {
    const mision = this.obtener(refId);
    if (!mision) return { aplicada: false, motivo: 'No hay tal misión.' };

    const r = Q.rechazar(mision);
    if (!r.rechazada) return { aplicada: false, motivo: 'Esa misión no está sobre la mesa.' };

    this.despachar('quests/cerrar', { mision: { ...r.mision, turnoCierre: this.leer('meta.turno', 0) }, estado: Q.ESTADO.RECHAZADA });
    this.emitir('memory:remember', {
      texto: `Rechazó el encargo «${mision.titulo}»${mision.nombreOrigen ? ` de ${mision.nombreOrigen}` : ''}.`,
      peso: 2,
    });
    if (mision.origen) this.sistema('npcs')?.recordar?.(mision.origen, `Le rechazó el encargo «${mision.titulo}».`, { tipo: 'encargo', peso: 2 });

    return { aplicada: true, motivo: null };
  }

  /**
   * Apunta algo que el jugador se propone por su cuenta.
   *
   * No lo encarga nadie ni lo inventa el juego: son sus palabras. Nace
   * aceptada, porque es él quien la decide, y no paga nada.
   *
   * @param {string} texto Lo que se propone, en su voz.
   * @returns {Object|null} La misión creada.
   */
  adoptarMeta(texto) {
    const limpio = String(texto ?? '').replace(/[.\s]+$/u, '').trim();
    if (limpio.length < 4) return null;
    const titulo = limpio.charAt(0).toUpperCase() + limpio.slice(1);

    const mision = Q.crear({
      tipo: 'meta',
      titulo,
      resumen: titulo,
      estado: Q.ESTADO.ACEPTADA,
      origen: 'jugador',
      objetivos: [{ clase: 'libre', texto: titulo }],
      recompensa: { xp: 0, oro: 0, actitud: 0 },
      turnoOferta: this.leer('meta.turno', 0),
      turnoAceptada: this.leer('meta.turno', 0),
      promptDirector: `Objetivo que se ha marcado el jugador: ${titulo}. Es suyo; el mundo puede ofrecerle caminos, no imponérselos.`,
    });

    this.despachar('quests/registrar', { mision });
    this.emitir('memory:remember', { texto: `Se propuso: ${titulo}.`, peso: 3 });
    return mision;
  }

  /**
   * Acepta una misión ofrecida.
   *
   * @param {string} refId
   * @returns {{aplicada: boolean, motivo: string|null}}
   */
  aceptar(refId) {
    const mision = this.obtener(refId);
    if (!mision) return { aplicada: false, motivo: 'No hay tal misión.' };

    const r = Q.aceptar(mision, {
      turno: this.leer('meta.turno', 0),
      dia: this.leer('world.tiempo.diasTotales', 0),
    });

    if (!r.aceptada) return { aplicada: false, motivo: r.motivo };

    this.despachar('quests/actualizar', { mision: r.mision });

    this.emitir(EVENTOS_MISION.ACEPTADA, {
      refId, titulo: mision.titulo, plazo: r.mision.diaLimite,
    });

    this.emitir('ui:notice', {
      mensaje: `Has aceptado: ${mision.titulo}`,
      tipo: 'info',
      icono: 'mision',
    });

    // Como hilo abierto, para que el director la retome si se olvida.
    this.emitir('memory:thread', {
      tipo: 'promesa',
      texto: `Aceptó el encargo «${mision.titulo}»`,
      relacionadoCon: refId,
    });

    // Un objetivo de recogida puede estar ya cumplido al aceptar.
    queueMicrotask(() => this._sincronizarInventario());

    return { aplicada: true, motivo: null };
  }

  /**
   * Completa una misión y paga la recompensa.
   *
   * @param {string} refId
   * @param {Object} [opciones]
   * @returns {{aplicada: boolean, motivo: string|null}}
   */
  completar(refId, opciones = {}) {
    const mision = this.obtener(refId);
    if (!mision) return { aplicada: false, motivo: 'No hay tal misión.' };

    const r = Q.completar(mision, {
      forzar: opciones.forzar,
      turno: this.leer('meta.turno', 0),
    });

    if (!r.completada) return { aplicada: false, motivo: r.motivo };

    this.despachar('quests/cerrar', { mision: r.mision, estado: Q.ESTADO.COMPLETADA });

    // ─── Recompensa ─────────────────────────────────────────────────────
    const recompensa = Q.recompensaEfectiva(r.mision);
    this._pagar(recompensa, r.mision);

    this.emitir(EVENTOS_MISION.COMPLETADA, {
      refId,
      titulo: mision.titulo,
      tipo: mision.tipo,
      faccion: mision.faccion,
      refIdNPC: mision.origen,
      recompensa,
    });

    this.emitir('memory:remember', {
      texto: `Completó «${mision.titulo}»${mision.nombreOrigen ? ` para ${mision.nombreOrigen}` : ''}.`,
      peso: 3,
    });

    this.despachar('hazanas/registrar', { clave: 'misionesCompletadas', delta: 1 });

    // Una principal cumplida ya no abre la siguiente. Lo hacía, enlazando
    // cada parte del pasado del personaje con la próxima: la campaña entera
    // quedaba escrita desde su biografía. Las partidas guardadas con una
    // principal la conservan y la pueden cumplir; después, lo que venga lo
    // decide el juego.

    return { aplicada: true, motivo: null };
  }

  /**
   * Hace fracasar una misión.
   *
   * @param {string} refId
   * @param {string} motivo
   * @returns {{aplicada: boolean, motivo: string|null}}
   */
  fracasar(refId, motivo) {
    const mision = this.obtener(refId);
    if (!mision) return { aplicada: false, motivo: 'No hay tal misión.' };

    const r = Q.fracasar(mision, motivo, { turno: this.leer('meta.turno', 0) });
    if (!r.fracasada) return { aplicada: false, motivo: 'Esa misión no está en curso.' };

    this.despachar('quests/cerrar', { mision: r.mision, estado: Q.ESTADO.FRACASADA });

    // ─── Consecuencias ──────────────────────────────────────────────────
    // Fallar no es un callejón sin salida, pero tampoco es gratis.
    if (mision.origen) {
      this.sistema('relationships')?.aplicarAccion(mision.origen, 'romper_promesa', {
        detalle: mision.titulo,
      });
    }

    if (mision.faccion) {
      this.sistema('reputation')?.ajustar(mision.faccion, -10, {
        motivo: `falló «${mision.titulo}»`,
      });
    }

    this.emitir(EVENTOS_MISION.FRACASADA, {
      refId, titulo: mision.titulo, motivo,
    });

    this.emitir('ui:notice', {
      mensaje: `Has fallado: ${mision.titulo}`,
      tipo: 'aviso',
      icono: 'mision',
    });

    this.emitir('memory:remember', {
      texto: `Falló «${mision.titulo}»: ${motivo}.`,
      peso: 3,
    });

    return { aplicada: true, motivo: null };
  }

  /**
   * Marca progreso manualmente, cuando lo declara el director.
   *
   * Es la vía para los objetivos `libre`, que el motor no puede seguir solo.
   *
   * @private
   */
  _progresoManual(operacion) {
    const mision = this.obtener(operacion.id);
    if (!mision) return { aplicada: false, motivo: 'No hay tal misión.' };

    if (mision.estado !== Q.ESTADO.ACEPTADA) {
      return { aplicada: false, motivo: 'Esa misión no está en curso.' };
    }

    // El director declara qué objetivos están cumplidos.
    const declarados = new Set(
      (operacion.objectives ?? []).filter((o) => o.hecho).map((o) => o.id ?? o.texto),
    );

    if (!declarados.size) return { aplicada: false, motivo: 'nada que marcar' };

    let cambio = false;

    const objetivos = mision.objetivos.map((o) => {
      if (o.hecho) return o;
      if (!declarados.has(o.id) && !declarados.has(o.texto)) return o;

      cambio = true;
      return Obj.completar(o);
    });

    if (!cambio) return { aplicada: false, motivo: 'nada que marcar' };

    const actualizada = { ...mision, objetivos };
    this.despachar('quests/actualizar', { mision: actualizada });

    if (Obj.todosCumplidos(objetivos)) this._avisarCompletable(actualizada);

    return { aplicada: true, motivo: null };
  }

  /**
   * Paga la recompensa de una misión.
   * @private
   */
  _pagar(recompensa, mision) {
    this.store.transaccion(() => {
      if (recompensa.xp > 0) {
        this.despachar('player/xp', { cantidad: recompensa.xp, motivo: 'misión' });
      }

      if (recompensa.oro > 0) {
        this.despachar('inventory/oro', { delta: recompensa.oro, motivo: 'recompensa' });
      }
    });

    // Los objetos van por la fábrica: pueden venir declarados por el director.
    if (recompensa.objetos?.length) {
      this.sistema('inventory')?.desdeDirector(recompensa.objetos, {
        hitoNarrativo: true,
      });
    }

    // Reputación con la facción interesada.
    if (recompensa.reputacion) {
      this.sistema('reputation')?.ajustar(
        recompensa.reputacion.faccion,
        recompensa.reputacion.cantidad,
        { motivo: `completó «${mision.titulo}»` },
      );
    }

    // Y el aprecio de quien la encargó.
    if (mision.origen && recompensa.actitud) {
      this.sistema('relationships')?.aplicarAccion(mision.origen, 'cumplir_encargo', {
        detalle: mision.titulo,
      });
    }

    if (recompensa.extra) {
      this.emitir('ui:notice', {
        mensaje: `Recompensa aumentada: cumpliste ${recompensa.opcionalesCumplidos} de ${recompensa.opcionalesTotales} objetivos opcionales.`,
        tipo: 'exito',
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PLAZOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Revisa qué misiones vencen o han vencido.
   * @param {number} dia
   * @private
   */
  _revisarPlazos(dia) {
    for (const mision of this.activas()) {
      const plazo = Q.estadoPlazo(mision, dia);
      if (!plazo.tienePlazo) continue;

      if (plazo.vencido) {
        this.fracasar(mision.refId, 'se agotó el plazo');
        continue;
      }

      // Aviso al entrar en los dos últimos días.
      if (plazo.urgente && plazo.diasRestantes === 2) {
        this.emitir(EVENTOS_MISION.CADUCA, {
          refId: mision.refId,
          titulo: mision.titulo,
          diasRestantes: plazo.diasRestantes,
        });

        this.emitir('ui:notice', {
          mensaje: `«${mision.titulo}» vence en ${plazo.diasRestantes} días.`,
          tipo: 'aviso',
          icono: 'mision',
        });
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OFERTA ESPONTÁNEA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Evalúa si conviene ofrecer una misión nueva.
   *
   * Las dos palancas: el tope de activas y el periodo de gracia. Un juego que
   * ofrece cinco encargos en el primer pueblo abruma; uno que no ofrece
   * ninguno en tres horas aburre.
   *
   * @param {number} turno
   * @private
   */
  _evaluarOferta(turno) {
    if (turno - this._ultimaOferta < GRACIA_OFERTA) return;
    if (this.activas().length >= ACTIVAS_MAX - 2) return;

    // Solo donde hay con quién hablar.
    const npcs = this.sistema('npcs');
    const presentes = npcs?.presentes() ?? [];
    if (!presentes.length) return;

    if (!this.rng.flujo('narrativa').oportunidad(0.2)) return;

    this.generarOferta();
  }

  /**
   * Genera y ofrece una misión.
   *
   * Prioriza los ganchos del mundo sobre las plantillas: tienen más contexto y
   * encajan mejor con el sitio.
   *
   * @param {Object} [opciones]
   * @returns {Object|null}
   */
  generarOferta(opciones = {}) {
    const flujo = this.rng.flujo('narrativa');
    const npcs = this.sistema('npcs');

    const npc = opciones.npc ?? npcs?.presentes()[0];
    const lugar = this.leer('world.ubicacion');

    // ─── Gancho del mundo, si lo hay ────────────────────────────────────
    const gancho = this.sistema('events')?.ganchoDisponible()
      ?? this._ganchoDelLugar(lugar, flujo);

    let mision;

    if (gancho) {
      mision = Generador.desdeGancho(flujo, gancho, {
        lugar,
        origen: npc?.refId,
        nombreOrigen: npc?.nombre,
        turno: this.leer('meta.turno', 0),
      });
    } else {
      // ─── Plantilla ────────────────────────────────────────────────────
      mision = Generador.generar(flujo, {
        lugar,
        npc,
        nivelJugador: this.leer('player.nivel', 1),
        lugaresConocidos: new Set(this.leer('world.localizaciones.orden', [])),
        plantillasUsadas: this._plantillasUsadas.slice(-3),
        turno: this.leer('meta.turno', 0),
      });
    }

    if (!mision) return null;

    if (mision.plantilla) this._plantillasUsadas.push(mision.plantilla);

    this.despachar('quests/registrar', { mision });
    this._ultimaOferta = this.leer('meta.turno', 0);

    this.emitir(EVENTOS_MISION.OFRECIDA, {
      refId: mision.refId,
      titulo: mision.titulo,
      tipo: mision.tipo,
      recompensa: Q.recompensaEfectiva(mision),
    });

    // Se cuenta en el mundo: quien lo da se acerca y lo dice, y queda claro
    // que es una oferta. La nota iba escrita para el modelo («Desarróllala
    // como te parezca… márcalos cumplidos») y el narrador interno se la
    // leía tal cual al jugador. El modelo recibe el detalle en MISIONES.
    const quien = npc?.nombre ? `${npc.nombre} se te acerca` : 'Alguien se te acerca';
    const asunto = String(mision.resumen || mision.titulo).replace(/[.\s]+$/u, '');
    this.emitir('memory:context', {
      texto: `EN ESCENA: ${quien} con algo entre manos: «${asunto.charAt(0).toUpperCase()}${asunto.slice(1)}. Si quieres encargarte, dímelo.»`,
      temporal: true,
    });

    return mision;
  }

  /**
   * Toma un gancho del lugar actual y lo marca como usado.
   * @private
   */
  _ganchoDelLugar(refIdLugar, flujo) {
    const lugar = obtenerLugar(refIdLugar);
    if (!lugar?.ganchos?.length) return null;

    const usados = this.leer(`world.localizaciones.porId.${refIdLugar}.ganchosUsados`, []);
    const disponibles = lugar.ganchos.filter((g) => !usados.includes(g));

    if (!disponibles.length) return null;

    const gancho = flujo.elegir(disponibles);
    this.sistema('world')?.usarGancho(gancho);

    return gancho;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REDUCTORES
     ═══════════════════════════════════════════════════════════════════════ */

  /** @private */
  _reducirRegistrar(estado, accion) {
    const { mision } = accion.payload ?? {};
    if (!mision?.refId) return null;

    const activas = estado.quests.activas;

    return {
      quests: {
        activas: {
          porId: { ...activas.porId, [mision.refId]: mision },
          orden: activas.orden.includes(mision.refId)
            ? activas.orden
            : [...activas.orden, mision.refId],
        },
      },
    };
  }

  /** @private */
  _reducirActualizar(estado, accion) {
    const { mision } = accion.payload ?? {};
    if (!mision?.refId) return null;

    return {
      quests: {
        activas: {
          ...estado.quests.activas,
          porId: { ...estado.quests.activas.porId, [mision.refId]: mision },
        },
      },
    };
  }

  /** @private */
  _reducirCerrar(estado, accion) {
    const { mision, estado: nuevoEstado } = accion.payload ?? {};
    if (!mision?.refId) return null;

    const activas = estado.quests.activas;
    const porId = { ...activas.porId };
    // `delete` en la copia no la quitaba del estado (ver `aplicarParche`):
    // cerrada, seguía entre las activas.
    porId[mision.refId] = BORRAR;

    const parche = {
      quests: {
        activas: {
          porId,
          orden: activas.orden.filter((id) => id !== mision.refId),
        },
      },
    };

    // Las cerradas se archivan: el historial importa para el director. Un
    // rechazo no es un fracaso: tiene su propia lista.
    if (nuevoEstado === Q.ESTADO.COMPLETADA) {
      parche.quests.completadas = [...(estado.quests.completadas ?? []), mision.refId];
    } else if (nuevoEstado === Q.ESTADO.RECHAZADA) {
      parche.quests.rechazadas = [...(estado.quests.rechazadas ?? []), mision.refId];
    } else {
      parche.quests.fracasadas = [...(estado.quests.fracasadas ?? []), mision.refId];
    }

    parche.quests.historial = {
      ...(estado.quests.historial ?? {}),
      [mision.refId]: mision,
    };

    return parche;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSULTAS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * @param {string} refId
   * @returns {Object|null}
   */
  obtener(refId) {
    return this.leer(`quests.activas.porId.${refId}`) ?? null;
  }

  /**
   * Misiones aceptadas y en curso.
   * @returns {Array<Object>}
   */
  activas() {
    const activas = this.leer('quests.activas', { porId: {}, orden: [] });

    return activas.orden
      .map((id) => activas.porId[id])
      .filter((m) => m?.estado === Q.ESTADO.ACEPTADA);
  }

  /**
   * Misiones ofrecidas pendientes de aceptar.
   * @returns {Array<Object>}
   */
  ofrecidas() {
    const activas = this.leer('quests.activas', { porId: {}, orden: [] });

    return activas.orden
      .map((id) => activas.porId[id])
      .filter((m) => m?.estado === Q.ESTADO.OFRECIDA);
  }

  /**
   * Todo el registro para la interfaz.
   * @returns {{activas: Array<Object>, ofrecidas: Array<Object>, cerradas: Array<Object>}}
   */
  paraInterfaz() {
    const dia = this.leer('world.tiempo.diasTotales', 0);
    const historial = this.leer('quests.historial', {});

    return {
      activas: this.activas().map((m) => Q.paraInterfaz(m, dia)),
      ofrecidas: this.ofrecidas().map((m) => Q.paraInterfaz(m, dia)),
      cerradas: Object.values(historial).map((m) => Q.paraInterfaz(m, dia)),
    };
  }

  /**
   * Contexto de misiones para el director.
   * @returns {string}
   */
  paraDirector() {
    const dia = this.leer('world.tiempo.diasTotales', 0);
    const activas = this.activas();
    const ofrecidas = this.ofrecidas();

    const bloques = [];

    if (activas.length) {
      const lineas = activas.map((m) => `· ${Q.paraDirector(m, dia)}`);
      bloques.push(`MISIONES EN CURSO:\n${lineas.join('\n')}`);
    }

    if (ofrecidas.length) {
      const lineas = ofrecidas.map((m) => `· «${m.titulo}»: ${m.resumen}`);
      bloques.push(`OFRECIDAS, SIN ACEPTAR:\n${lineas.join('\n')}`);
    }

    return bloques.join('\n\n');
  }

  /** @returns {Object} */
  inspeccionar() {
    return {
      activas: this.activas().length,
      ofrecidas: this.ofrecidas().length,
      completadas: this.leer('quests.completadas', []).length,
      fracasadas: this.leer('quests.fracasadas', []).length,
      ultimaOferta: this._ultimaOferta,
    };
  }
}

export default QuestSystem;
