/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · combat/CombatManager.js
 * ---------------------------------------------------------------------------
 * Orquestador del combate.
 *
 * Coordina todos los módulos anteriores en un bucle de rondas. Su
 * responsabilidad es el ORDEN de las cosas, que en combate importa mucho:
 *
 *   Al empezar el turno de alguien:
 *     1. Efectos periódicos (el veneno actúa ANTES de que pueda moverse)
 *     2. Los jefes intentan sacudirse los estados incapacitantes
 *     3. Revisión de fase
 *     4. ¿Pierde el turno?
 *     5. Acción
 *     6. Salvaciones y decremento de duraciones
 *
 * El paso 1 antes del 4 es deliberado: el veneno puede matarte antes de que
 * llegues a actuar, y eso es coherente.
 *
 * La vida del jugador se sincroniza en ambas direcciones: el combatiente es una
 * proyección, no una copia. Recibir daño en combate baja la vida de verdad.
 *
 * Dependencias: SystemBase y todos los módulos de /combat.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import * as Comb from './Combatant.js';
import * as Estados from './StatusEffects.js';
import * as Ataques from './AttackResolver.js';
import * as Iniciativa from './InitiativeTracker.js';
import * as IA from './EnemyAI.js';
import * as Jefes from './BossPatterns.js';
import * as Registro from './CombatLog.js';
import { narrarBotin } from './CombatLog.js';
import { buscarPorNombre } from '../data/enemies.data.js';
import { deEnemigo as botinDeEnemigo } from '../inventory/LootGenerator.js';
import { leerJugada } from './Jugada.js';
import { curarConTexto } from '../player/Curacion.js';
import { obtenerEstado } from '../data/statuses.data.js';
import { concordar } from '../utils/text.js';
import { xpPorEnemigo } from '../player/Progression.js';
import { COMBATE } from '../config/balance.config.js';
import { TIEMPOS } from '../config/app.config.js';

/** Eventos del combate. */
export const EVENTOS_COMBATE = Object.freeze({
  INICIO: 'combat:start',
  RONDA: 'combat:round',
  TURNO: 'combat:turn',
  ATAQUE: 'combat:attack',
  MUERTE: 'combat:enemy:killed',
  FASE: 'combat:boss:phase',
  FIN: 'combat:end',
  ESPERANDO: 'combat:awaiting',
});

export class CombatManager extends SystemBase {
  static nombre = 'combat';
  static dependencias = ['player', 'inventory', 'rules'];
  static canal = 'combat';

  constructor(contexto) {
    super(contexto);

    /** Combatientes por identificador. @private */
    this._combatientes = {};
    /** Registro de la refriega. @private */
    this._registro = [];
    /** Entradas de la ronda en curso, para el director. @private */
    this._rondaActual = [];
    /** Cargas legendarias disponibles. @private */
    this._cargasLegendarias = 0;
    /** Estado del jugador al empezar, para el resumen. @private */
    this._jugadorInicial = null;
    /** true mientras se espera la acción del jugador. @private */
    this._esperando = false;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CICLO DE VIDA
     ═══════════════════════════════════════════════════════════════════════ */

  alIniciar() {
    this.reductores({
      'combat/iniciar': this._reducirIniciar,
      'combat/actualizar': this._reducirActualizar,
      'combat/turno': this._reducirTurno,
      'combat/terminar': this._reducirTerminar,
    });

    this.escuchar('combat:request', (peticion) => this.empezarCombate(peticion));
    this.escuchar('combat:action', (accion) => this.accionJugador(accion));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INICIO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Empieza un combate.
   *
   * No se llama `iniciar` porque ese nombre pertenece al ciclo de vida de
   * SystemBase: el Registry lo invoca al arrancar y se llevaría por delante
   * cualquier partida.
   *
   * @param {Object} peticion
   * @param {Array<Object>} peticion.enemies Declaración de enemigos.
   * @param {boolean} [peticion.ambush] Emboscada enemiga.
   * @param {boolean} [peticion.playerAmbush] Emboscada del jugador.
   * @returns {Promise<void>}
   */
  async empezarCombate(peticion) {
    if (this.leer('combat.activo', false)) {
      this.log.aviso('ya hay un combate en curso');
      return;
    }

    const flujo = this.rng.combate;

    // ─── Enemigos ───────────────────────────────────────────────────────
    const declaracion = this._normalizarEnemigos(peticion.enemies);

    if (!declaracion.length) {
      this.log.aviso('combate solicitado sin enemigos reconocibles');
      return;
    }

    const enemigos = Comb.crearGrupo(declaracion, { flujo });

    if (!enemigos.length) {
      this.log.aviso('no se pudo crear ningún enemigo');
      return;
    }

    // ─── Jugador ────────────────────────────────────────────────────────
    const inventario = this.sistema('inventory');
    const jugador = Comb.desdeJugador(this.leer('player'), inventario?.bonificadores() ?? {});

    this._jugadorInicial = { vida: { ...jugador.vida } };

    // ─── El grupo ───────────────────────────────────────────────────────
    // Los compañeros pelean a su lado; los heridos se quedan atrás hasta que
    // descansen.
    const companeros = (this.sistema('party')?.miembros?.() ?? [])
      .filter((m) => !m.herido)
      .map((m) => Comb.desdeCompanero(m.ficha, m));

    // ─── Iniciativa ─────────────────────────────────────────────────────
    const todos = [jugador, ...companeros, ...enemigos];

    const tirada = Iniciativa.tirarIniciativa(flujo, todos, {
      emboscadaJugador: Boolean(peticion.playerAmbush),
      emboscadaEnemiga: Boolean(peticion.ambush),
    });

    this._combatientes = Object.fromEntries(tirada.combatientes.map((c) => [c.id, c]));
    // Cada combate empieza sin caídos apuntados ni órdenes dadas.
    this._caidos = new Set();
    this._ordenes = {};
    this._registro = [];
    this._rondaActual = [];

    // Los jefes empiezan con sus cargas.
    const jefe = enemigos.find((e) => Jefes.esJefe(e));
    this._cargasLegendarias = jefe ? Jefes.cargasPorRonda(jefe) : 0;

    // ─── Estado ─────────────────────────────────────────────────────────
    this.despachar('combat/iniciar', {
      combatientes: this._combatientes,
      orden: tirada.orden,
      emboscada: peticion.ambush ? 'enemiga' : peticion.playerAmbush ? 'jugador' : null,
    });

    // ─── Narración de apertura ──────────────────────────────────────────
    this.emitir('narrative:direct', {
      texto: Registro.apertura(flujo, enemigos, {
        emboscadaEnemiga: peticion.ambush,
        emboscadaJugador: peticion.playerAmbush,
        teVen: peticion.teVen,
        contra: peticion.contra,
      }),
      voz: 'system',
    });

    if (companeros.length) {
      const nombres = companeros.map((c) => c.nombre);
      const quienes = nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres[0];
      this.emitir('narrative:direct', {
        texto: `${quienes} ${nombres.length > 1 ? 'se ponen' : 'se pone'} a tu lado.`,
        voz: 'system',
      });
    }

    this.emitir(EVENTOS_COMBATE.INICIO, {
      enemigos: enemigos.map((e) => ({ id: e.id, nombre: e.nombre, amenaza: e.amenaza })),
      iniciativa: tirada.tiradas,
      hayJefe: Boolean(jefe),
    });

    this.log.info(`combate iniciado: ${enemigos.length} enemigos`);

    // ─── Primer turno ───────────────────────────────────────────────────
    // El índice arranca en -1 para que siguienteTurno lo lleve al 0.
    this.despachar('combat/turno', { indice: -1, ronda: 1 });
    await this._avanzar();
  }

  /**
   * Traduce la declaración del director a referencias del bestiario.
   * @private
   */
  _normalizarEnemigos(declaracion) {
    const salida = [];

    for (const entrada of declaracion ?? []) {
      // El director puede dar el refId exacto o un nombre aproximado.
      const enemigo = buscarPorNombre(entrada.refId ?? entrada.name ?? entrada.nombre);

      if (!enemigo) {
        this.log.aviso(`enemigo no reconocido: ${entrada.refId ?? entrada.name}`);
        continue;
      }

      salida.push({
        refId: enemigo.refId,
        count: Math.min(entrada.count ?? 1, COMBATE.enemigosMax),
        level: entrada.level,
      });
    }

    return salida;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BUCLE DE TURNOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Avanza hasta el siguiente turno que requiera decisión del jugador.
   *
   * Los turnos enemigos se encadenan solos con una pausa entre ellos, para que
   * se puedan leer sin pulsar nada.
   *
   * @private
   */
  async _avanzar() {
    // El tope evita un bucle infinito si algo va mal en la lógica de turnos.
    for (let vueltas = 0; vueltas < 200; vueltas++) {
      const estado = this.leer('combat');

      // ─── ¿Ha terminado? ───────────────────────────────────────────────
      const fin = Iniciativa.comprobarFin(this._combatientes);
      if (fin.terminado) {
        await this._terminar(fin.resultado);
        return;
      }

      // ─── Siguiente ────────────────────────────────────────────────────
      const siguiente = Iniciativa.siguienteTurno(estado, this._combatientes);

      if (!siguiente.siguiente) {
        await this._terminar('tablas');
        return;
      }

      const ronda = siguiente.nuevaRonda ? (estado.ronda ?? 1) + 1 : (estado.ronda ?? 1);

      if (siguiente.nuevaRonda) {
        await this._iniciarRonda(ronda);

        // Un límite de rondas evita combates eternos.
        if (ronda > COMBATE.rondasMax) {
          await this._terminar('tablas');
          return;
        }
      }

      this.despachar('combat/turno', { indice: siguiente.indice, ronda });

      const actor = this._combatientes[siguiente.siguiente];
      if (!actor) continue;

      // ─── Inicio del turno del actor ───────────────────────────────────
      const puedeActuar = await this._iniciarTurnoDe(actor, ronda);

      // El actor puede haber caído por daño periódico.
      if (!this._combatientes[actor.id]?.vivo) continue;

      if (!puedeActuar) {
        await this._terminarTurnoDe(this._combatientes[actor.id]);
        continue;
      }

      // ─── Acción ───────────────────────────────────────────────────────
      if (actor.esJugador) {
        // Se cede el control y se espera la acción.
        this._esperando = true;
        this.emitir(EVENTOS_COMBATE.ESPERANDO, {
          ronda,
          acciones: Iniciativa.accionesDisponibles(this._combatientes[actor.id]),
        });
        return;
      }

      if (actor.esCompanero) await this._turnoCompanero(this._combatientes[actor.id], ronda);
      else await this._turnoEnemigo(this._combatientes[actor.id], ronda);
      await this._terminarTurnoDe(this._combatientes[actor.id]);

      // Pausa para que los turnos enemigos se puedan leer.
      await this._pausa(TIEMPOS.pausaTurnoEnemigo);
    }

    this.log.error('el bucle de combate excedió el límite de vueltas');
    await this._terminar('tablas');
  }

  /**
   * Tareas de inicio de ronda.
   * @param {number} ronda
   * @private
   */
  async _iniciarRonda(ronda) {
    // El resumen de la ronda anterior va al director.
    if (this._rondaActual.length) {
      const texto = Registro.paraDirector(this._rondaActual);
      if (texto) this.emitir('memory:context', { texto, temporal: true });
    }

    this._rondaActual = [];

    // Los jefes recuperan cargas legendarias.
    const jefe = Object.values(this._combatientes).find((c) => c.vivo && Jefes.esJefe(c));
    if (jefe) this._cargasLegendarias = Jefes.cargasPorRonda(jefe);

    // Invocaciones periódicas.
    if (jefe?.invoca) {
      const fase = Jefes.faseActual(jefe);
      const decision = IA.decidir(this.rng.combate, {
        actor: jefe,
        combatientes: this._combatientes,
        ronda,
      });

      if (decision.accion === 'invocar') {
        await this._invocar(jefe, Boolean(fase?.invocaExtra));
      }
    }

    this.emitir(EVENTOS_COMBATE.RONDA, { ronda });
  }

  /**
   * Tareas de inicio del turno de un combatiente.
   *
   * @param {Object} actor
   * @param {number} ronda
   * @returns {Promise<boolean>} true si puede actuar.
   * @private
   */
  async _iniciarTurnoDe(actor, ronda) {
    let actual = actor;

    // ─── 1. Efectos periódicos ──────────────────────────────────────────
    // Antes de comprobar si puede actuar: el veneno puede matarlo primero.
    const periodicos = Estados.alIniciarTurno(actual);
    actual = periodicos.combatiente;

    for (const evento of periodicos.eventos) {
      const entrada = Registro.entradaPeriodico(evento, actual, ronda);
      this._anotar(entrada);
    }

    this._guardar(actual);

    if (periodicos.cayo) {
      await this._registrarCaida(actual);
      return false;
    }

    // ─── 2. Los jefes se sacuden los estados ────────────────────────────
    if (Jefes.esJefe(actual)) {
      const sacudida = Jefes.sacudirseEstados(this.rng.combate, actual);
      actual = sacudida.jefe;

      if (sacudida.narracion) {
        this.emitir('narrative:direct', { texto: sacudida.narracion, voz: 'system' });
        this._anotar(Registro.entradaSuceso('liberacion', {
          nombre: actual.nombre,
          estados: sacudida.liberado,
        }, ronda));
      }

      this._guardar(actual);
    }

    // ─── 3. Revisión de fase ────────────────────────────────────────────
    if (Jefes.esJefe(actual)) {
      const revision = Jefes.revisarFase(actual);

      if (revision.cambio) {
        actual = revision.jefe;
        this._guardar(actual);

        this.emitir('narrative:direct', { texto: revision.narracion, voz: 'system' });

        this.emitir(EVENTOS_COMBATE.FASE, {
          jefe: actual.nombre,
          fase: revision.fase.nombre,
          indice: actual.faseActual,
        });

        this._anotar(Registro.entradaSuceso('fase', {
          jefe: actual.nombre,
          narracion: revision.narracion,
        }, ronda));

        await this._pausa(600);
      }
    }

    // ─── 4. ¿Pierde el turno? ───────────────────────────────────────────
    const perdida = Iniciativa.pierdeTurno(actual);

    if (perdida.pierde) {
      this.emitir('narrative:direct', {
        texto: `${actual.nombre} no puede actuar.`,
        voz: 'system',
      });
      return false;
    }

    this.emitir(EVENTOS_COMBATE.TURNO, {
      id: actual.id,
      nombre: actual.nombre,
      esJugador: actual.esJugador,
      ronda,
    });

    return true;
  }

  /**
   * Tareas de fin de turno.
   * @param {Object} actor
   * @private
   */
  async _terminarTurnoDe(actor) {
    if (!actor) return;

    const flujo = this.rng.combate;

    const resultado = Estados.alTerminarTurno(actor, (atributo, umbral) =>
      Ataques.salvacion(flujo, actor, atributo, umbral));

    this._guardar(resultado.combatiente);

    for (const s of resultado.salvados) {
      this._anotar(Registro.entradaSuceso('salvacion', {
        nombre: actor.nombre,
        estado: s.nombre,
      }, this.leer('combat.ronda', 1)));
    }

    for (const e of resultado.expirados) {
      this._anotar(Registro.entradaSuceso('estado_expirado', {
        nombre: actor.nombre,
        estado: e.nombre,
      }, this.leer('combat.ronda', 1)));
    }

    // El jugador sincroniza sus estados con el estado real.
    if (actor.esJugador) this._sincronizarJugador(resultado.combatiente);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TURNO ENEMIGO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Ejecuta el turno de un enemigo.
   * @param {Object} actor
   * @param {number} ronda
   * @private
   */
  async _turnoEnemigo(actor, ronda) {
    const flujo = this.rng.combate;

    let decision = IA.decidir(flujo, {
      actor,
      combatientes: this._combatientes,
      ronda,
      historial: this._rondaActual,
    });

    decision = IA.coordinar(decision, actor, this._rondaActual);

    switch (decision.accion) {
      case 'atacar':
        await this._ejecutarAtaque(actor, decision, ronda);
        break;

      case 'atacar_area':
        await this._ejecutarArea(actor, decision, ronda);
        break;

      case 'huir':
        await this._huir(actor);
        break;

      case 'invocar':
        await this._invocar(actor, false);
        break;

      default:
        this.emitir('narrative:direct', {
          texto: IA.describir(decision, actor, this._combatientes),
          voz: 'system',
        });
    }
  }

  /**
   * El turno de un compañero.
   *
   * Si el jugador le ha dado una orden («Grom, cúbreme», «Grom, al herido»),
   * la cumple ahora. Si no, decide con la misma IA que los enemigos, que ya
   * elige objetivo en el otro bando.
   *
   * @private
   */
  async _turnoCompanero(actor, ronda) {
    const orden = this._ordenes?.[actor.id];
    if (orden) delete this._ordenes[actor.id];

    if (orden?.tipo === 'cubrir') {
      const jugador = this._combatientes.jugador;
      if (jugador?.vivo) {
        const r = Estados.aplicar(jugador, 'protegido', { rondas: 1 });
        this._guardar(r.combatiente);
        this.emitir('narrative:direct', { texto: `${actor.nombre} se pone delante de ti y te cubre.`, voz: 'system' });
        return;
      }
    }

    if (orden?.tipo === 'atacar' && this._combatientes[orden.objetivo]?.vivo) {
      await this._ejecutarAtaque(actor, { objetivo: orden.objetivo, ataque: actor.ataques[0] }, ronda);
      return;
    }

    await this._turnoEnemigo(actor, ronda);
  }

  /**
   * Una orden a un compañero dentro de la jugada escrita.
   *
   * «Grom, cúbreme», «Grom, ataca al herido». Dar una orden no gasta el turno
   * del jugador: si la frase no trae nada más, se le vuelve a ceder la palabra.
   *
   * @returns {{orden: Object|null, resto: string, texto: string|null}}
   * @private
   */
  _leerOrden(texto) {
    const miembro = this.sistema('party')?.porNombreEn?.(texto);
    if (!miembro) return { orden: null, resto: texto, texto: null };

    const actor = Object.values(this._combatientes).find((c) => c.esCompanero && c.refId === miembro.refId && c.vivo);
    if (!actor) return { orden: null, resto: texto, texto: `${miembro.ficha.nombre} no puede ahora.` };

    const llano = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const t = llano(texto);
    const nombre = llano(miembro.ficha.nombre);

    // Lo que va detrás del nombre es la orden; lo que va delante, la jugada
    // del propio jugador, si la hay («le golpeo y tú, Grom, cúbreme»).
    const i = t.indexOf(nombre);
    const tras = t.slice(i + nombre.length).replace(/^[\s,:]+/, '');
    const antes = texto.slice(0, i).replace(/\b(y tú|y tu|y)[\s,]*$/i, '').trim();

    let orden = null;
    if (/\b(cubre|cubreme|protege|protegeme|defiende|defiendeme|ponte delante)/.test(tras)) {
      orden = { tipo: 'cubrir' };
    } else if (/\b(ataca|a por|al |a la |golpea|carga)/.test(tras)) {
      const enemigos = Object.values(this._combatientes).filter((c) => c.vivo && c.bando === Comb.BANDO.ENEMIGO);
      const objetivo = leerJugada(`ataco ${tras}`, { enemigos }).objetivo ?? enemigos[0]?.id;
      orden = { tipo: 'atacar', objetivo };
    }

    if (!orden) return { orden: null, resto: texto, texto: null };

    this._ordenes[actor.id] = orden;
    const eco = orden.tipo === 'cubrir'
      ? `${actor.nombre} asiente y se acerca a ti.`
      : `${actor.nombre} asiente y va a por ${this._combatientes[orden.objetivo]?.nombre ?? 'ellos'}.`;
    return { orden, resto: antes, texto: eco };
  }

  /**
   * Ejecuta un ataque individual.
   * @private
   */
  async _ejecutarAtaque(atacante, decision, ronda) {
    const objetivo = this._combatientes[decision.objetivo];
    if (!objetivo?.vivo) return;

    const flujo = this.rng.combate;

    // Estar rodeado penaliza: se cuenta cuántos enemigos vivos hay.
    const rodeado = atacante.esJugador
      ? Object.values(this._combatientes).filter((c) => c.vivo && c.bando === Comb.BANDO.ENEMIGO).length >= 3
      : false;

    const resultado = Ataques.resolver(flujo, {
      atacante,
      objetivo,
      ataque: decision.ataque,
      ronda,
      circunstancias: { rodeado, creatividad: decision.creatividad ?? 0 },
    });

    // Una jugada que además de golpear deja al enemigo tocado —«le lanzo
    // arena a los ojos y le golpeo»— aplica su estado si el golpe entra.
    if (decision.estadoAlAcertar && resultado.dano && !resultado.cayo) {
      const { refId, rondas } = decision.estadoAlAcertar;
      const r = Estados.aplicar(resultado.objetivo, refId, { rondas });
      resultado.objetivo = r.combatiente;
      resultado.estadosAplicados = [...(resultado.estadosAplicados ?? []), { refId }];
    }

    this._guardar(resultado.atacante);
    this._guardar(resultado.objetivo);

    const entrada = Registro.entradaAtaque(resultado, {
      ronda,
      atacante,
      objetivo,
      ataque: decision.ataque,
    });

    this._anotar(entrada);

    this.emitir(EVENTOS_COMBATE.ATAQUE, entrada);

    // Sincronización del jugador en ambas direcciones.
    if (resultado.objetivo.esJugador) this._sincronizarJugador(resultado.objetivo);
    if (resultado.atacante.esJugador) this._sincronizarJugador(resultado.atacante);

    if (resultado.cayo) await this._registrarCaida(resultado.objetivo);

    // El desgaste del equipo es real: atacar gasta el arma.
    if (atacante.esJugador && resultado.dano) {
      this._desgastarArma();
    }
    if (objetivo.esJugador && resultado.dano) {
      this._desgastarArmadura(resultado.dano.total);
    }
  }

  /**
   * Ejecuta un ataque de área.
   * @private
   */
  async _ejecutarArea(atacante, decision, ronda) {
    const objetivos = decision.objetivos
      .map((id) => this._combatientes[id])
      .filter((c) => c?.vivo);

    if (!objetivos.length) return;

    const resultado = Ataques.resolverArea(this.rng.combate, {
      atacante,
      objetivos,
      ataque: decision.ataque,
      ronda,
    });

    this._guardar(resultado.atacante);
    for (const o of resultado.objetivos) this._guardar(o);

    this.emitir('narrative:direct', {
      texto: `${atacante.nombre} usa ${decision.ataque.nombre}.`,
      voz: 'system',
    });

    for (const r of resultado.resultados) {
      const objetivo = this._combatientes[r.objetivo];

      this._anotar({
        ronda,
        tipo: 'ataque',
        resultado: 'impacto',
        atacante: { id: atacante.id, nombre: atacante.nombre, esJugador: atacante.esJugador },
        objetivo: { id: r.objetivo, nombre: r.nombre, esJugador: objetivo?.esJugador },
        ataque: decision.ataque.nombre,
        dano: r.dano,
        estados: [],
        cayo: r.cayo,
        objetivoTras: {
          vida: objetivo?.vida.actual ?? 0,
          max: objetivo?.vida.max ?? 1,
          fraccion: Comb.fraccionVida(objetivo ?? { vida: { actual: 0, max: 1 } }),
        },
      });

      if (objetivo?.esJugador) this._sincronizarJugador(objetivo);
      if (r.cayo && objetivo) await this._registrarCaida(objetivo);
    }
  }

  /**
   * Un enemigo huye del combate.
   * @private
   */
  async _huir(actor) {
    const estado = this.leer('combat');
    const retirada = Iniciativa.retirar(estado, actor.id);

    delete this._combatientes[actor.id];

    this.despachar('combat/actualizar', {
      combatientes: this._combatientes,
      orden: retirada.orden,
      turnoActual: retirada.indiceAjustado,
    });

    this.emitir('narrative:direct', {
      texto: `${actor.nombre} escapa del combate.`,
      voz: 'system',
    });

    this._anotar(Registro.entradaSuceso('huida', { nombre: actor.nombre }, this.leer('combat.ronda', 1)));
  }

  /**
   * Un jefe invoca refuerzos.
   * @private
   */
  async _invocar(jefe, extra) {
    const flujo = this.rng.combate;
    const resultado = Jefes.invocar(flujo, jefe, { extra });

    if (!resultado.combatientes.length) return;

    const estado = this.leer('combat');
    let orden = estado.iniciativa ?? [];
    let indice = estado.turnoActual ?? 0;

    for (const nuevo of resultado.combatientes) {
      const insercion = Iniciativa.insertar(flujo, { iniciativa: orden, turnoActual: indice }, nuevo, this._combatientes);

      orden = insercion.orden;
      indice = insercion.indiceAjustado;
      this._combatientes[insercion.combatiente.id] = insercion.combatiente;
    }

    this.despachar('combat/actualizar', {
      combatientes: this._combatientes,
      orden,
      turnoActual: indice,
    });

    this.emitir('narrative:direct', { texto: resultado.narracion, voz: 'system' });

    this._anotar(Registro.entradaSuceso('invocacion', {
      narracion: resultado.narracion,
      cantidad: resultado.combatientes.length,
    }, this.leer('combat.ronda', 1)));

    await this._pausa(700);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ACCIÓN DEL JUGADOR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * El jugador describe su jugada con palabras.
   *
   * Se lee con `leerJugada` —qué es, a quién, con qué y cuánto premia— y se
   * resuelve con el mismo d20 de siempre: la creatividad suma a la tirada, no
   * la sustituye. Lo que contradice el mundo o el inventario se dice en una
   * línea y resta.
   *
   * @param {string} texto
   * @param {Object} [opciones]
   * @param {string|null} [opciones.marcado] Objetivo marcado en el panel.
   * @returns {Promise<Object|null>} La jugada leída.
   */
  async jugadaLibre(texto, { marcado = null } = {}) {
    if (!this._esperando) return null;

    const jugador = this._combatientes.jugador;
    const objetos = this.leer('inventory.objetos.porId', {}) ?? {};
    const arma = objetos[this.leer('inventory.equipado.armaPrincipal')]?.nombre ?? jugador?.ataques?.[0]?.nombre ?? null;

    // Órdenes al grupo. Si la frase era solo eso, el jugador sigue teniendo
    // su turno: se le devuelve la palabra sin gastarlo.
    const orden = this._leerOrden(texto);
    if (orden.texto) this.emitir('narrative:direct', { texto: orden.texto, voz: 'system' });
    if (orden.orden && !orden.resto) {
      this.emitir(EVENTOS_COMBATE.ESPERANDO, { ronda: this.leer('combat.ronda', 1), acciones: Iniciativa.accionesDisponibles(jugador) });
      return { tipo: 'orden', orden: orden.orden };
    }
    if (orden.orden) texto = orden.resto;

    const jugada = leerJugada(texto, {
      enemigos: Object.values(this._combatientes).filter((c) => c.vivo && c.bando === Comb.BANDO.ENEMIGO),
      inventario: Object.values(objetos),
      arma,
      marcado,
      anterior: this._ultimaJugada ?? null,
    });

    if (jugada.aviso) this.emitir('narrative:direct', { texto: jugada.aviso, voz: 'system' });

    this._ultimaJugada = null;

    switch (jugada.tipo) {
      case 'huir':
        await this.accionJugador({ tipo: 'huir' });
        return jugada;

      case 'defender':
        await this.accionJugador({ tipo: 'defender' });
        return jugada;

      case 'parlamentar':
        this._esperando = false;
        if (await this._parlamentar(texto)) return jugada;
        await this._terminarTurnoDe(this._combatientes.jugador);
        await this._avanzar();
        return jugada;

      case 'curar':
        this._esperando = false;
        this._curarEnCombate(jugada);
        await this._terminarTurnoDe(this._combatientes.jugador);
        await this._avanzar();
        return jugada;

      case 'maniobra':
        this._esperando = false;
        await this._maniobra(jugada);
        await this._terminarTurnoDe(this._combatientes.jugador);
        await this._avanzar();
        return jugada;

      default: {
        this._esperando = false;
        const objetivo = this._combatientes[jugada.objetivo] ?? this._objetivoPorDefecto();
        if (objetivo && jugador?.vivo) {
          await this._ejecutarAtaque(jugador, {
            objetivo: objetivo.id,
            ataque: jugador.ataques[0],
            creatividad: jugada.creatividad.valor,
            estadoAlAcertar: jugada.golpea ? jugada.estado : null,
          }, this.leer('combat.ronda', 1));
          if (jugada.estado && jugada.golpea) this._ultimaJugada = { estado: jugada.estado.refId };
        }
        await this._terminarTurnoDe(this._combatientes.jugador);
        await this._avanzar();
        return jugada;
      }
    }
  }

  /**
   * Una maniobra sin golpe: arena a los ojos, un empujón al río.
   *
   * Se tira como un ataque —d20 más la jugada contra la defensa del enemigo—
   * y si entra, el enemigo queda en el estado de la maniobra. No hace daño:
   * lo que gana es la ronda siguiente.
   *
   * @private
   */
  async _maniobra(jugada) {
    const jugador = this._combatientes.jugador;
    const objetivo = this._combatientes[jugada.objetivo];
    if (!objetivo?.vivo || !jugador?.vivo) return;

    const tirada = this.sistema('rules').resolver({
      habilidad: 'atletismo',
      umbral: Comb.defensaEfectiva(objetivo),
      bonoExtra: jugada.creatividad.valor,
      fuenteExtra: 'Creativo',
    });

    const dados = `(d20 ${tirada.natural}${jugada.creatividad.valor ? `, ${jugada.creatividad.valor > 0 ? '+' : ''}${jugada.creatividad.valor} por la jugada` : ''}: ${tirada.total} contra ${tirada.umbral})`;

    if (!tirada.exito) {
      this.emitir('narrative:direct', { texto: `Lo intentas con ${objetivo.nombre}, pero no sale. ${dados}`, voz: 'system' });
      return;
    }

    const r = Estados.aplicar(objetivo, jugada.estado.refId, { rondas: jugada.estado.rondas });
    this._guardar(r.combatiente);
    this._ultimaJugada = { estado: jugada.estado.refId };

    const nombreEstado = concordar(obtenerEstado(jugada.estado.refId)?.nombre?.toLowerCase() ?? jugada.estado.refId, objetivo.genero);
    this.emitir('narrative:direct', { texto: `${objetivo.nombre} queda ${nombreEstado}. ${dados}`, voz: 'system' });
  }

  /**
   * Curarse en plena pelea: la poción si la lleva; si no, vendarse a toda prisa.
   * @private
   */
  _curarEnCombate(jugada) {
    const r = curarConTexto(this, jugada.objeto);
    this._refrescarJugador();
    this.emitir('narrative:direct', { texto: r.texto, voz: 'system' });
  }

  /**
   * Procesa la acción que el jugador elige en su turno.
   *
   * @param {Object} accion
   * @returns {Promise<void>}
   */
  async accionJugador(accion) {
    if (!this._esperando) return;

    this._esperando = false;

    const jugador = this._combatientes.jugador;
    const ronda = this.leer('combat.ronda', 1);

    if (!jugador?.vivo) {
      await this._avanzar();
      return;
    }

    switch (accion.tipo) {
      case 'atacar': {
        // Solo se acepta un objetivo del otro bando y en pie: un id de un
        // compañero, del propio jugador o de un caído cae al de por defecto.
        const pedido = accion.objetivo ? this._combatientes[accion.objetivo] : null;
        const objetivo = pedido?.vivo && pedido.bando === Comb.BANDO.ENEMIGO
          ? pedido
          : this._objetivoPorDefecto();

        if (!objetivo) break;

        const ataque = jugador.ataques[0];
        await this._ejecutarAtaque(jugador, { objetivo: objetivo.id, ataque }, ronda);
        break;
      }

      case 'defender': {
        // Defenderse protege hasta el final de tu próximo turno: una ronda
        // entera de ataques enemigos. Las rondas se descuentan al terminar el
        // turno de quien lleva el estado, así que con 1 caducaba en este mismo
        // turno, antes de que nadie atacara, y defenderse no servía de nada.
        const r = Estados.aplicar(jugador, 'protegido', { rondas: 2 });
        this._guardar(r.combatiente);

        this.emitir('narrative:direct', {
          texto: 'Te cubres y aguantas la posición.',
          voz: 'system',
        });
        break;
      }

      case 'usar_objeto':
        this.despachar('inventory/consumir', { idObjeto: accion.idObjeto });
        // El consumo modifica el estado real; se refleja en el combatiente.
        this._refrescarJugador();
        break;

      case 'huir':
        await this._intentarHuir(jugador);
        return;

      case 'esperar':
        this.emitir('narrative:direct', { texto: 'Esperas tu momento.', voz: 'system' });
        break;
    }

    await this._terminarTurnoDe(this._combatientes.jugador);
    await this._avanzar();
  }

  /**
   * El jugador intenta huir.
   * @private
   */
  async _intentarHuir(jugador) {
    const rules = this.sistema('rules');

    const tirada = rules.resolver({
      habilidad: 'acrobacias',
      umbral: 'dificil',
      condiciones: ['huyendo'],
    });

    if (tirada.exito) {
      this.emitir('narrative:direct', {
        texto: Registro.cierre(this.rng.combate, 'huida'),
        voz: 'system',
      });
      await this._terminar('huida');
      return;
    }

    this.emitir('narrative:direct', {
      texto: 'No encuentras por dónde salir. Pierdes el turno intentándolo.',
      voz: 'system',
    });

    await this._terminarTurnoDe(this._combatientes.jugador);
    await this._avanzar();
  }

  /**
   * Objetivo por defecto: el enemigo más débil, que es lo que la mayoría
   * elegiría si tuviera que pensarlo.
   * @private
   */
  _objetivoPorDefecto() {
    return Object.values(this._combatientes)
      .filter((c) => c.vivo && c.bando === Comb.BANDO.ENEMIGO)
      .sort((a, b) => a.vida.actual - b.vida.actual)[0] ?? null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FIN DEL COMBATE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Cierra el combate y reparte las consecuencias.
   * @param {string} resultado
   * @private
   */
  /**
   * Hablar en mitad de la pelea.
   *
   * Con quien atiende a razones (bandidos, guardias: `negociable`) se tira
   * trato social; más fácil si ya van tocados. Si sale, la pelea se acaba
   * sin más sangre. Si no, se ha gastado el turno hablando. Con una bestia
   * no hay con quién hablar, y se dice.
   *
   * @param {string} texto
   * @returns {Promise<boolean>} true si el combate ha terminado.
   * @private
   */
  async _parlamentar(texto) {
    const enemigos = Object.values(this._combatientes).filter((c) => c.vivo && c.bando === Comb.BANDO.ENEMIGO);
    if (!enemigos.some((e) => e.negociable)) {
      this.emitir('narrative:direct', { texto: 'No hay con quién hablar: lo que tienes delante no entiende de palabras.', voz: 'system' });
      return false;
    }

    const tocados = enemigos.some((e) => Comb.fraccionVida(e) < 0.5);
    const tirada = this.sistema('rules')?.resolver({ habilidad: 'trato_social', umbral: tocados ? 'facil' : 'moderada' }) ?? null;
    const dados = tirada ? ` (d20 ${tirada.natural}: ${tirada.total} contra ${tirada.umbral})` : '';

    if (tirada?.exito) {
      this.emitir('narrative:direct', { texto: `Te escuchan${dados}. Uno baja el arma; luego, otro.`, voz: 'system' });
      this.despachar('hazanas/registrar', { clave: 'conflictosResueltosSinViolencia', delta: 1 });
      await this._terminar('acuerdo');
      return true;
    }

    this.emitir('narrative:direct', { texto: `No quieren saber nada${dados}: la pelea sigue.`, voz: 'system' });
    return false;
  }

  async _terminar(resultado) {
    const flujo = this.rng.combate;
    // Enemigos son los del otro bando: un compañero caído no da experiencia
    // ni botín.
    const enemigos = Object.values(this._combatientes).filter((c) => c.bando === Comb.BANDO.ENEMIGO);
    const jugador = this._combatientes.jugador;

    // ─── Resumen ────────────────────────────────────────────────────────
    const resumen = Registro.resumir(this._registro, {
      resultado,
      rondas: this.leer('combat.ronda', 1),
      enemigos,
      jugadorInicial: this._jugadorInicial,
      jugadorFinal: jugador,
    });

    // ─── Narración de cierre ────────────────────────────────────────────
    this.emitir('narrative:direct', {
      texto: Registro.cierre(flujo, resultado),
      voz: 'system',
    });

    // ─── Recompensas ────────────────────────────────────────────────────
    if (resultado === 'victoria') {
      await this._repartirRecompensas(enemigos, flujo);
    }

    // ─── El grupo ───────────────────────────────────────────────────────
    // Vida y heridas de vuelta al grupo. Solo en Brutal un compañero caído
    // no se levanta.
    const companeros = Object.values(this._combatientes).filter((c) => c.esCompanero);
    if (companeros.length) {
      const lineas = this.sistema('party')?.despuesDelCombate?.(companeros, {
        puedenMorir: this.leer('settings.dificultad', 'equilibrado') === 'implacable',
      }) ?? [];
      for (const texto of lineas) this.emitir('narrative:direct', { texto, voz: 'system' });
    }

    // ─── Memoria ────────────────────────────────────────────────────────
    this.emitir('memory:remember', { texto: resumen.texto, peso: 3 });

    // ─── Estado ─────────────────────────────────────────────────────────
    this.despachar('combat/terminar', {});

    this.emitir(EVENTOS_COMBATE.FIN, {
      resultado,
      estadisticas: resumen.estadisticas,
      resumen: resumen.texto,
    });

    this.log.info(`combate terminado: ${resultado}`);

    // ─── Derrota ────────────────────────────────────────────────────────
    if (resultado === 'derrota') {
      this.emitir('player:defeated', { origen: 'combate' });
    }

    this._combatientes = {};
    this._registro = [];
    this._rondaActual = [];
    this._esperando = false;
    this._ordenes = {};
  }

  /**
   * Reparte experiencia y botín.
   * @private
   */
  async _repartirRecompensas(enemigos, flujo) {
    const caidos = enemigos.filter((e) => !e.vivo);
    if (!caidos.length) return;

    // ─── Experiencia ────────────────────────────────────────────────────
    const xp = caidos.reduce((total, e) => total + xpPorEnemigo(e.amenaza, e.nivel), 0);

    if (xp > 0) {
      this.despachar('player/xp', { cantidad: xp, motivo: 'combate' });
    }

    // ─── Botín ──────────────────────────────────────────────────────────
    // El botín se genera por enemigo y se acumula: cada uno aporta lo suyo.
    const nivelJugador = this.leer('player.nivel', 1);
    const terreno = this.leer('world.terreno');
    const dificultad = this.leer('settings.dificultad', 'equilibrado');

    const botin = { oro: 0, objetos: [] };

    for (const caido of caidos) {
      const suyo = botinDeEnemigo(flujo, {
        amenaza: caido.amenaza,
        nivelJugador,
        terreno,
        dificultad,
        tipoEnemigo: caido.tipo,
      });

      botin.oro += suyo.oro ?? 0;
      botin.objetos.push(...(suyo.objetos ?? []));
    }

    const inventario = this.sistema('inventory');
    inventario?.recibirBotin(botin);

    // El botín también se cuenta, no solo se apunta en el inventario: «entre
    // sus cosas encuentras…». Si no hay nada, se dice, que también es algo.
    this.emitir('narrative:direct', { texto: narrarBotin(botin, caidos.length), voz: 'dm' });

    // ─── Reputación con la facción de los caídos ─────────────────────────
    // Matar a los miembros de una facción tiene consecuencias con toda ella.
    for (const caido of caidos) {
      if (!caido.faccion) continue;

      this.emitir('npc:killed', {
        refId: caido.refId,
        nombre: caido.nombre,
        faccion: caido.faccion,
      });
    }
  }

  /**
   * Registra la caída de un combatiente.
   * @private
   */
  async _registrarCaida(combatiente) {
    // Una caída se anota UNA vez.
    //
    // Hay tres caminos que pueden traer aquí al mismo combatiente —el daño
    // periódico de un estado, el golpe que lo remata y el ataque en área— y en
    // el parte salía «Brunhilda cae.» dos veces seguidas. Se cae una sola vez,
    // y leerlo dos veces resta en lugar de sumar.
    this._caidos ??= new Set();
    if (this._caidos.has(combatiente.id)) return;
    this._caidos.add(combatiente.id);

    this._anotar(Registro.entradaSuceso('caida', {
      nombre: combatiente.nombre,
      esJugador: combatiente.esJugador,
    }, this.leer('combat.ronda', 1)));

    if (combatiente.esJugador) {
      this._sincronizarJugador(combatiente);
      return;
    }

    // Un compañero no es una baja enemiga: ni experiencia, ni misiones de
    // «acabar con», ni «X cae» como quien derriba a un saqueador.
    if (combatiente.esCompanero) {
      this.emitir('narrative:direct', { texto: `${combatiente.nombre} cae, malherido.`, voz: 'system' });
      return;
    }

    this.emitir(EVENTOS_COMBATE.MUERTE, {
      refId: combatiente.refId,
      nombre: combatiente.nombre,
      amenaza: combatiente.amenaza,
      tipo: combatiente.tipo,
      faccion: combatiente.faccion,
    });

    this.emitir('narrative:direct', {
      texto: `${combatiente.nombre} cae.`,
      voz: 'system',
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SINCRONIZACIÓN
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Propaga la vida y los estados del combatiente al estado real.
   *
   * El combatiente del jugador es una proyección, no una copia: lo que le pasa
   * en combate le pasa de verdad.
   *
   * @param {Object} jugador
   * @private
   */
  _sincronizarJugador(jugador) {
    const actual = this.leer('player.vida.actual', 0);
    const delta = jugador.vida.actual - actual;

    if (delta < 0) {
      this.despachar('player/danar', { cantidad: -delta, origen: 'combate' });
    } else if (delta > 0) {
      this.despachar('player/curar', { cantidad: delta, origen: 'combate' });
    }

    this.despachar('player/estados/fijar', { estados: jugador.estados ?? [] });
  }

  /**
   * Relee el estado del jugador y actualiza su combatiente.
   *
   * Se usa tras consumir un objeto: el efecto se aplica al estado real y hay que
   * traerlo de vuelta.
   *
   * @private
   */
  _refrescarJugador() {
    const jugador = this._combatientes.jugador;
    if (!jugador) return;

    const real = this.leer('player');

    this._guardar({
      ...jugador,
      vida: { actual: real.vida.actual, max: real.vida.max },
      estados: [...(real.estados ?? [])],
    });
  }

  /** @private */
  _desgastarArma() {
    const equipado = this.leer('inventory.equipado.manoPrincipal');
    if (equipado) {
      this.despachar('inventory/desgastar', { idObjeto: equipado, tipo: 'arma' });
    }
  }

  /** @private */
  _desgastarArmadura(dano) {
    const equipado = this.leer('inventory.equipado.torso');
    if (equipado) {
      this.despachar('inventory/desgastar', { idObjeto: equipado, tipo: 'armadura', dano });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUXILIARES
     ═══════════════════════════════════════════════════════════════════════ */

  /** @private */
  _guardar(combatiente) {
    if (!combatiente?.id) return;

    this._combatientes[combatiente.id] = combatiente;
    this.despachar('combat/actualizar', { combatientes: this._combatientes });
  }

  /** @private */
  _anotar(entrada) {
    this._registro.push(entrada);
    this._rondaActual.push(entrada);

    const texto = Registro.paraJugador(entrada);
    if (texto) this.emitir('combat:log', { texto, entrada });
  }

  /** @private */
  _pausa(ms) {
    return new Promise((resolver) => this.espera(resolver, ms));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REDUCTORES
     ═══════════════════════════════════════════════════════════════════════ */

  /** @private */
  _reducirIniciar(estado, accion) {
    const { combatientes, orden, emboscada } = accion.payload ?? {};

    return {
      combat: {
        activo: true,
        ronda: 1,
        turnoActual: -1,
        iniciativa: orden ?? [],
        combatientes: combatientes ?? {},
        emboscada: emboscada ?? null,
      },
      meta: { fase: 'combate' },
    };
  }

  /** @private */
  _reducirActualizar(estado, accion) {
    const parche = { combat: {} };
    const { combatientes, orden, turnoActual } = accion.payload ?? {};

    if (combatientes) parche.combat.combatientes = { ...combatientes };
    if (orden) parche.combat.iniciativa = orden;
    if (turnoActual !== undefined) parche.combat.turnoActual = turnoActual;

    return parche;
  }

  /** @private */
  _reducirTurno(estado, accion) {
    const { indice, ronda } = accion.payload ?? {};

    return {
      combat: {
        turnoActual: indice ?? estado.combat.turnoActual,
        ronda: ronda ?? estado.combat.ronda,
      },
    };
  }

  /** @private */
  _reducirTerminar(estado) {
    return {
      combat: {
        activo: false,
        ronda: 0,
        turnoActual: 0,
        iniciativa: [],
        combatientes: {},
        emboscada: null,
      },
      // Si el jugador cayó en la pelea, la partida sigue detenida.
      //
      // Caer pone la fase en `fin`; acabar el combate la devolvía a
      // `exploracion` justo después, así que la pantalla de caída se abría
      // pero el motor volvía a aceptar turnos. Solo la saca de ahí una de las
      // salidas de la caída.
      meta: { fase: estado?.meta?.fase === 'fin' ? 'fin' : 'exploracion' },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSULTAS
     ═══════════════════════════════════════════════════════════════════════ */

  /** @returns {boolean} */
  get activo() {
    return this.leer('combat.activo', false);
  }

  /** @returns {boolean} */
  get esperandoJugador() {
    return this._esperando;
  }

  /**
   * Estado del combate para la interfaz.
   * @returns {Object|null}
   */
  paraInterfaz() {
    if (!this.activo) return null;

    const estado = this.leer('combat');
    const jefe = Object.values(this._combatientes).find((c) => c.vivo && Jefes.esJefe(c));

    return {
      ronda: estado.ronda,
      iniciativa: Iniciativa.paraInterfaz(estado, this._combatientes),
      combatientes: Object.values(this._combatientes).map((c) => Comb.paraInterfaz(c)),
      jefe: jefe ? Jefes.paraInterfaz(jefe) : null,
      esperando: this._esperando,
      turnoDelJugador: Iniciativa.actuando(estado, this._combatientes)?.esJugador ?? false,
    };
  }

  /**
   * Contexto de combate para el director.
   * @returns {string}
   */
  paraDirector() {
    if (!this.activo) return '';

    const estado = this.leer('combat');
    const partes = [`COMBATE, ronda ${estado.ronda}.`];

    partes.push(Iniciativa.paraDirector(estado, this._combatientes));

    const jefe = Object.values(this._combatientes).find((c) => c.vivo && Jefes.esJefe(c));
    if (jefe) partes.push(Jefes.paraDirector(jefe));

    if (this._rondaActual.length) {
      partes.push(`En esta ronda: ${Registro.paraDirector(this._rondaActual)}`);
    }

    return partes.join(' ');
  }

  /** @returns {Object} */
  inspeccionar() {
    return {
      activo: this.activo,
      ronda: this.leer('combat.ronda', 0),
      combatientes: Object.values(this._combatientes).map((c) => ({
        nombre: c.nombre,
        vida: `${c.vida.actual}/${c.vida.max}`,
        estados: (c.estados ?? []).map((e) => e.refId),
      })),
      entradas: this._registro.length,
      cargasLegendarias: this._cargasLegendarias,
      esperando: this._esperando,
    };
  }
}

export default CombatManager;
