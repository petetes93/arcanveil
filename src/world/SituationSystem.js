/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · world/SituationSystem.js
 * ---------------------------------------------------------------------------
 * Lo que está pasando en el mundo, con o sin el jugador.
 *
 * Una situación es una escena en marcha: gente con sus motivos, algo que se
 * tuerce y más de una manera de meterse. No es un encargo: nadie la acepta ni
 * la rechaza. El jugador puede intervenir, mirar o seguir a lo suyo:
 *
 *   · Si interviene, la vía que elige se tira con los dados y el mundo
 *     cambia: actitudes, recuerdos de los PNJ, y a veces la situación acaba.
 *   · Si la ignora, la situación sigue ahí —sus actores no se evaporan— y
 *     pasados unos turnos se resuelve sin él, de la forma en que lo habría
 *     hecho de todos modos. No es un castigo: es el mundo moviéndose.
 *
 * Vive en `world.situaciones`, que se guarda con la partida.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import { situacionesPara, obtenerSituacion } from '../data/situaciones.data.js';
import { obtenerLugar } from '../data/locations.data.js';
import { nombreAleatorio } from '../player/CharacterRandom.js';
import { sinAcentos } from '../utils/text.js';
import { actoDeHabla, ACTO } from '../engine/ActoDeHabla.js';

/**
 * Frases que apuntan a «lo que está pasando» sin nombrarlo: «me acerco a ver
 * qué pasa», «echo un vistazo». Con una situación en marcha, es a ella.
 */
export const ATIENDE = /\b(?:ver que (?:pasa|ocurre|sucede)|que (?:pasa|ocurre|sucede)|me acerco|acercarme|me asomo|echo un vistazo|me fijo|miro (?:lo que|que) (?:pasa|ocurre))\b/;

/** Frases con las que el jugador deja algo de lado a propósito. */
export const OMITE = /\b(?:ignoro|ignorando|paso de|no hago caso|sin hacer caso|me desentiendo|no me meto|no me importa|dejo (?:estar|atras|en paz)|sigo de largo|miro hacia otro lado|hago como si no)\b/;

/** Estados de una situación. */
export const ESTADO_SITUACION = Object.freeze({
  ABIERTA: 'abierta',
  RESUELTA: 'resuelta',
  DESENLACE: 'desenlace',   // se resolvió sola, sin el jugador
});

const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

export class SituationSystem extends SystemBase {
  static nombre = 'situations';
  static dependencias = ['world', 'npcs', 'rules'];

  constructor(contexto) {
    super(contexto);
    /** La situación en la que se fijó el jugador este turno. @private */
    this._atendida = null;
  }

  alIniciar() {
    this.reductores({ 'situaciones/guardar': this._reducirGuardar });

    // Al llegar a un asentamiento puede haber algo en marcha. No siempre: un
    // pueblo en el que siempre pasa algo al llegar es un escenario, no un
    // pueblo.
    this.escuchar('world:arrived', () => {
      // Colocar al personaje en su pueblo al empezar también es «llegar»:
      // de eso se encarga la apertura, que abre la suya.
      if (this.leer('meta.turno', 0) < 1) return;
      if (this.aqui().length) return;
      if (!this.rng.flujo('mundo').oportunidad(0.5)) return;
      const s = this.abrir();
      if (s) this.emitir('narrative:direct', { texto: s.texto, voz: 'dm' });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSULTAS
     ═══════════════════════════════════════════════════════════════════════ */

  /** @returns {Object[]} */
  todas() {
    const s = this.leer('world.situaciones', null) ?? { porId: {}, orden: [] };
    return (s.orden ?? []).map((id) => s.porId?.[id]).filter(Boolean);
  }

  /** Las abiertas donde está el jugador. @returns {Object[]} */
  aqui() {
    const lugar = this.leer('world.ubicacion');
    return this.todas().filter((s) => s.lugar === lugar && s.estado === ESTADO_SITUACION.ABIERTA);
  }

  /**
   * Lo que el jugador ha tenido delante en un lugar: la apertura de cada
   * situación, los cambios que ya se vieron y cómo acabó. Es lo que existe
   * allí para el juego, sea cual sea el narrador.
   *
   * @param {string} lugar
   * @returns {string[]}
   */
  textosDe(lugar, { soloAbiertas = false, soloCerradas = false, recientes = 0 } = {}) {
    const textos = [];
    const turno = this.leer('meta.turno', 0);
    for (const sit of this.todas()) {
      if (sit.lugar !== lugar) continue;
      // Lo que acaba de terminar sigue a la vista unos turnos: la cabra no
      // se esfuma en cuanto el pastor la saca del huerto.
      const reciente = recientes > 0 && sit.estado !== ESTADO_SITUACION.ABIERTA
        && turno - (sit.turnoDesenlace ?? sit.ultimaAtencion ?? sit.turnoInicio ?? 0) <= recientes;
      const abierta = sit.estado === ESTADO_SITUACION.ABIERTA || reciente;
      if ((soloAbiertas && !abierta) || (soloCerradas && abierta)) continue;
      const p = obtenerSituacion(sit.refId);
      if (!p) continue;
      textos.push(this.rellenar(p.apertura, sit));
      const pulsos = p.siIgnorada?.pulsos ?? p.pulsos ?? [];
      for (const x of pulsos.slice(0, sit.pulsos ?? 0)) textos.push(this.rellenar(x.texto, sit));
      if (sit.estado === ESTADO_SITUACION.DESENLACE && p.siIgnorada?.texto) textos.push(this.rellenar(p.siIgnorada.texto, sit));
    }
    return textos;
  }

  /**
   * Sustituye {clave} por el nombre de cada actor.
   * @param {string} texto
   * @param {Object} situacion
   * @returns {string}
   */
  rellenar(texto, situacion) {
    return String(texto ?? '').replace(/\{(\w+)\}/g, (_, clave) => situacion.actores?.[clave]?.nombre ?? clave);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ABRIR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Pone en marcha una situación donde está el jugador.
   *
   * @param {Object} [opciones]
   * @param {string} [opciones.refId] Una plantilla concreta.
   * @returns {Object|null} La situación, con `texto` ya relleno.
   */
  abrir({ refId = null, hereda = null, desde = null } = {}) {
    const lugarId = this.leer('world.ubicacion');
    const lugar = obtenerLugar(lugarId);
    const flujo = this.rng.flujo('mundo');

    // No se repite una plantilla en el mismo sitio.
    const usadas = new Set(this.todas().filter((s) => s.lugar === lugarId).map((s) => s.refId));
    const plantilla = refId
      ? obtenerSituacion(refId)
      : flujo.elegir(situacionesPara(lugar).filter((p) => !usadas.has(p.refId)));
    if (!plantilla) return null;

    const npcs = this.sistema('npcs');
    const actores = {};
    for (const a of plantilla.actores) {
      // En una secuela vuelven los mismos: el mercader al que robaron es el
      // que ahora espera a la guardia, no uno nuevo con otro nombre.
      const previo = hereda?.[a.clave] ? desde?.actores?.[hereda[a.clave]] : null;
      if (previo?.refId) {
        npcs?.introducir?.({ refId: previo.refId, nombre: previo.nombre });
        actores[a.clave] = { ...previo, rol: a.rol };
        continue;
      }
      const genero = a.genero ?? (flujo.oportunidad(0.5) ? 'f' : 'm');
      const nombre = this._nombreLibre(genero, flujo);
      const npc = npcs?.introducir?.({ nombre, rol: a.rol, genero }) ?? null;
      actores[a.clave] = { refId: npc?.refId ?? null, nombre: npc?.nombre ?? nombre, rol: a.rol, genero };
    }

    const turno = this.leer('meta.turno', 0);
    const situacion = {
      id: `sit_${plantilla.refId}_${lugarId}_${turno}`,
      refId: plantilla.refId,
      lugar: lugarId,
      actores,
      estado: ESTADO_SITUACION.ABIERTA,
      turnoInicio: turno,
      ultimaAtencion: turno,
      ignoradaAProposito: false,
      intentos: 0,
      resolucion: null,
      tension: 0,
      pulsos: 0,
      origen: desde?.id ?? null,
    };
    this._guardar(situacion);

    // Lo que quiere cada uno NO es un hecho del mundo: se guardaba en la
    // memoria general y cualquiera «sabía» lo que el vigía pretendía. La
    // intención va en el contexto del director (`paraDirector`), que es quien
    // tiene que conocerla, y no en lo que el mundo recuerda.
    return { ...situacion, texto: this.rellenar(plantilla.apertura, situacion) };
  }

  /** Un nombre que no sea ya de nadie conocido. @private */
  _nombreLibre(genero, flujo) {
    const azar = () => flujo.next();
    let nombre = nombreAleatorio('valdes', genero, azar);
    for (let i = 0; i < 6; i += 1) {
      const refId = `npc_${nombre.toLowerCase().replace(/\s+/g, '_')}`;
      if (!this.leer(`npcs.conocidos.porId.${refId}`)) return nombre;
      nombre = nombreAleatorio('valdes', genero, azar);
    }
    return nombre;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EL JUGADOR ACTÚA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Mira si lo que escribe el jugador tiene que ver con una situación de aquí.
   *
   * @param {string} texto
   * @returns {null | {situacion: Object, omitida?: boolean, via?: string,
   *   tirada?: Object, narracion?: string, resuelta?: boolean}}
   */
  intervenir(texto) {
    const sit = this.aqui()[0];
    if (!sit) return null;

    const plantilla = obtenerSituacion(sit.refId);
    if (!plantilla) return null;

    const n = llano(texto);
    const nombrados = Object.values(sit.actores).some((a) => a.nombre && n.includes(llano(a.nombre)));
    // «Me acerco» a secas es ir a ver qué pasa; «me acerco al herrero» es ir
    // a otra cosa, y contaba como atender la situación que acababa de
    // ignorar.
    const aOtro = /\b(?:me acerco|acercarme)\s+(?:a|al|hacia|junto)\s+(?!ver\b|mirar\b|curiosear\b)/.test(n);
    // Si el turno anterior estaba en ello (o acaba de empezar delante de él),
    // lo que dice ahora sigue siendo con ello si encaja con alguna vía: «le
    // explico que es un abuso» después de hablar con el del peaje, «no hay de
    // qué» a la madre que acaba de dar las gracias.
    // Pero no si le habla a otro: «le exijo a Brenis que me diga…» después de
    // ir a por la cabra es con Brenis, no con la cabra.
    const suyos = new Set(Object.values(sit.actores).map((a) => a.refId));
    const aOtraPersona = (this.leer('npcs.presentes', []) ?? [])
      .filter((id) => !suyos.has(id))
      .map((id) => this.leer(`npcs.conocidos.porId.${id}.nombre`))
      .some((nombre) => nombre && new RegExp(`\\b${llano(nombre)}\\b`).test(n));
    const turnoActual = this.leer('meta.turno', 0);
    // «Sigue con ello» exige que el jugador ya estuviera con ello: acabar de
    // abrirse delante de él no cuenta como haberlo atendido.
    const yaTrato = (sit.intentos ?? 0) > 0 || Boolean(sit.detalleVisto) || (sit.ultimaAtencion ?? -99) > (sit.turnoInicio ?? -99);
    const sigue = !aOtraPersona && yaTrato && turnoActual - (sit.ultimaAtencion ?? -99) <= 1 && plantilla.vias.some((v) => v.patron.test(n));
    const menciona = nombrados || plantilla.claves.test(n) || (ATIENDE.test(n) && !aOtro) || sigue;
    if (!menciona) return null;

    // Dejarla de lado a propósito: sigue ahí, con su reloj en marcha. No es
    // una manera de resolverla ni una falta que haya que cobrar.
    if (OMITE.test(n)) {
      this._guardar({ ...sit, ignoradaAProposito: true });
      return { situacion: sit, omitida: true };
    }

    const turno = this.leer('meta.turno', 0);
    // Solo se resuelve por una vía si lo escrito es de ESTA situación (nombra
    // a los suyos, sus claves, o sigue con ella). Mirar a secas es atención:
    // «examino el suelo buscando rastros de lobo» sacaba el colgante del pozo
    // porque «rastr» casaba con la vía de pescarlo.
    const deEsta = nombrados || plantilla.claves.test(n) || sigue;
    // Ofrecerle algo o ayuda a alguien no es intervenir todavía: «le ofrezco
    // a Berdar un poco de mi agua» casaba con la vía de atraer a la cabra con
    // comida, y la cabra se llevaba lo que era para el pastor.
    const acto = actoDeHabla(texto)?.acto;
    const soloOfrece = [ACTO.OFRECER, ACTO.OFRECER_AYUDA].includes(acto);
    // Una vía dirigida a alguien (`contra`) no se toma si lo escrito va a
    // otro de la escena: «me enfrento a Damán» casaba con plantarle cara a
    // la figura del tejado, y el robo se frustraba por encararse con la
    // víctima.
    const nombra = (actor) => Boolean(actor?.nombre) && n.includes(llano(actor.nombre));
    const aOtroActor = (v) => Boolean(v.contra) && !nombra(sit.actores[v.contra])
      && Object.entries(sit.actores).some(([clave, a]) => clave !== v.contra && nombra(a));
    const via = deEsta && !soloOfrece ? plantilla.vias.find((v) => v.patron.test(n) && !aOtroActor(v)) : null;
    // Encararse con alguien que no es el blanco de ninguna vía no es cosa de
    // la situación: lo resuelve la conversación, con la reacción de quien lo
    // recibe.
    if (!via && acto === ACTO.ENFRENTAR) return null;
    this._atendida = sit.id;

    if (!via) {
      // Mirar de cerca también cuenta, y se ve algo que no se veía de lejos.
      // El detalle se ve una vez; mirar otra vez no lo repite palabra por
      // palabra: sigue contando la atención (el reloj se para) y el narrador
      // describe lo que haya, que es lo que habría si se volviera a mirar.
      this._guardar({ ...sit, ultimaAtencion: turno, ignoradaAProposito: false, detalleVisto: true });
      return { situacion: sit, atencion: true, narracion: sit.detalleVisto ? null : this.rellenar(plantilla.detalle ?? '', sit) };
    }

    // Atacar no se tira aquí: empieza la pelea y la resuelve el combate.
    if (via.combate) {
      const narracion = this.rellenar(via.exito, sit);
      this._guardar({ ...sit, ultimaAtencion: turno, estado: ESTADO_SITUACION.RESUELTA, resolucion: via.clave });
      this._consecuencias(sit, via);
      // La pelea no se pide aquí: la pide el turno cuando ya ha contado por
      // qué empieza. Pedida desde aquí, «Todo se decide ahora» salía antes
      // que lo que había hecho el jugador.
      // Están cara a cara con él: golpea primero, pero le han visto venir.
      return { situacion: sit, via: via.clave, tirada: null, narracion, resuelta: true, combate: { ...via.combate, playerAmbush: true, teVen: true } };
    }

    // Pagar no es una prueba: se tiene o no se tiene.
    let exito;
    let tirada = null;
    if (via.habilidad) {
      tirada = this.sistema('rules')?.resolver({ habilidad: via.habilidad, umbral: via.umbral }) ?? null;
      exito = Boolean(tirada?.exito);
    } else {
      const oro = via.coste?.oro ?? 0;
      exito = oro <= (this.leer('player.oro', 0) ?? 0);
      if (exito && oro) this.despachar('inventory/oro', { delta: -oro, motivo: `situación: ${sit.refId}` });
    }
    let narracion = this.rellenar(exito ? via.exito : via.fracaso, sit);

    // Un mal intento sube la tensión; si llega al límite, estalla. Entonces
    // se cuenta el estallido, no otra vez la misma negativa.
    const tension = (sit.tension ?? 0) + (!exito && via.tension ? via.tension : 0);
    const estalla = Boolean(plantilla.escala) && !exito && tension >= plantilla.escala.umbral;
    if (estalla) narracion = this.rellenar(plantilla.escala.aviso, sit);

    const resuelta = (exito && Boolean(via.resuelveSiExito)) || estalla;
    const siguiente = {
      ...sit,
      ultimaAtencion: turno,
      ignoradaAProposito: false,
      intentos: (sit.intentos ?? 0) + 1,
      tension,
      estado: resuelta ? ESTADO_SITUACION.RESUELTA : sit.estado,
      resolucion: resuelta ? (estalla ? 'pelea' : via.clave) : sit.resolucion,
    };
    this._guardar(resuelta ? this._conSecuela(siguiente, 'resuelta') : siguiente);

    if (exito) this._consecuencias(sit, via);
    return { situacion: sit, via: via.clave, tirada, narracion, resuelta, combate: estalla ? { ...plantilla.escala.combate } : null };
  }

  /**
   * Apunta la secuela, si la plantilla tiene una para este final.
   * @private
   */
  _conSecuela(sit, final) {
    const p = obtenerSituacion(sit.refId);
    const s = p?.secuela ?? p?.siIgnorada?.secuela;
    if (!s || (s.cuando && s.cuando !== final)) return sit;
    return { ...sit, secuelaEn: this.leer('meta.turno', 0) + s.tras };
  }

  /** Actitudes y recuerdos de cada actor tras una vía que sale bien. @private */
  _consecuencias(sit, via) {
    const relaciones = this.sistema('relationships');
    const npcs = this.sistema('npcs');

    for (const [clave, delta] of Object.entries(via.actitud ?? {})) {
      const actor = sit.actores[clave];
      if (actor?.refId) relaciones?.ajustar?.(actor.refId, delta, via.recuerdo?.[clave] ?? via.clave);
    }
    for (const [clave, recuerdo] of Object.entries(via.recuerdo ?? {})) {
      const actor = sit.actores[clave];
      if (!actor?.refId) continue;
      npcs?.recordar?.(actor.refId, recuerdo, { tipo: 'situacion', peso: 3 });
      this.emitir('memory:remember', { texto: `${actor.nombre} (${actor.rol}): ${recuerdo}`, peso: 3, categoria: 'situacion' });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EL MUNDO SIGUE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Al final de cada turno, lo que nadie atendió avanza.
   *
   * El reloj corre desde la última vez que el jugador se fijó en ella, esté
   * donde esté: una situación que dejó atrás al irse del pueblo también se
   * resuelve sin él, y se entera si vuelve.
   */
  alTurno() {
    const turno = this.leer('meta.turno', 0);
    const aqui = this.leer('world.ubicacion');

    for (const sit of this.todas()) {
      // Lo que vino después: se abre donde pasó, cuando el jugador está.
      if (sit.secuelaEn != null && !sit.secuelaAbierta && turno >= sit.secuelaEn && sit.lugar === aqui && !this.aqui().length) {
        const p = obtenerSituacion(sit.refId);
        const s = p?.secuela ?? p?.siIgnorada?.secuela;
        const nueva = s ? this.abrir({ refId: s.refId, hereda: s.hereda, desde: sit }) : null;
        this._guardar({ ...sit, secuelaAbierta: true });
        if (nueva) this.emitir('memory:context', { texto: `EN ESCENA: ${nueva.texto}`, temporal: true });
        continue;
      }

      if (sit.estado !== ESTADO_SITUACION.ABIERTA || sit.id === this._atendida) continue;

      const plantilla = obtenerSituacion(sit.refId);
      const regla = plantilla?.siIgnorada;
      if (!regla) continue;
      const sinAtender = turno - sit.ultimaAtencion;

      // Antes del desenlace, lo que cambia se ve: la niña ya tiene la cuerda
      // en la mano. Cada pulso sale una vez, y solo si el jugador está.
      const pulsos = regla.pulsos ?? plantilla.pulsos ?? [];
      const toca = pulsos.findIndex((p, i) => i >= (sit.pulsos ?? 0) && sinAtender >= p.tras);
      if (sinAtender < regla.tras) {
        if (toca >= 0) {
          this._guardar({ ...sit, pulsos: toca + 1 });
          if (sit.lugar === aqui) this.emitir('memory:context', { texto: `EN ESCENA: ${this.rellenar(pulsos[toca].texto, sit)}`, temporal: true });
        }
        continue;
      }

      this._guardar(this._conSecuela({ ...sit, estado: ESTADO_SITUACION.DESENLACE, turnoDesenlace: turno }, 'desenlace'));
      // Es un suceso del mundo: lo que un PNJ puede contar que pasó aquí.
      this.emitir('memory:remember', { texto: this.rellenar(regla.hecho, sit), peso: 2, categoria: 'suceso' });

      // Quien lo vivió lo cuenta si se le pregunta, también tras guardar y
      // cargar: va en su memoria. Y quien se ha ido ya no está en la calle:
      // el vigía que robó la bolsa seguía «presente» después del robo.
      const npcs = this.sistema('npcs');
      for (const [clave, texto] of Object.entries(regla.testimonio ?? {})) {
        const actor = sit.actores[clave];
        if (actor?.refId) npcs?.recordar(actor.refId, this.rellenar(texto, sit), { tipo: 'testimonio', peso: 2 });
      }
      for (const clave of regla.marchan ?? []) {
        const actor = sit.actores[clave];
        if (actor?.refId) npcs?.retirar(actor.refId);
      }

      // Si pasa delante de él, se cuenta en el turno siguiente.
      if (sit.lugar === aqui) {
        this.emitir('memory:context', { texto: `EN ESCENA: ${this.rellenar(regla.texto, sit)}`, temporal: true });
      }
    }

    this._atendida = null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PARA EL DIRECTOR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * La situación abierta de aquí, para el contexto del director.
   * @returns {Object|null}
   */
  paraContexto() {
    const sit = this.aqui()[0];
    if (!sit) return null;
    const plantilla = obtenerSituacion(sit.refId);
    if (!plantilla) return null;

    return {
      id: sit.id,
      texto: this.rellenar(plantilla.apertura, sit),
      agenda: this.rellenar(plantilla.agenda, sit),
      actores: Object.values(sit.actores).map((a) => ({ refId: a.refId, nombre: a.nombre, rol: a.rol })),
      refId: sit.refId,
      sitio: plantilla.sitio ?? null,
      tension: sit.tension ?? 0,
      sinAtender: this.leer('meta.turno', 0) - sit.ultimaAtencion,
      ignoradaAProposito: Boolean(sit.ignoradaAProposito),
      // Lo que se le propone, de sus vías: primero mirar, y lo demás cuando
      // ya lo ha visto de cerca (ver `data/situaciones.data.js`).
      sugerencia: plantilla.sugerencia ?? null,
      sugerencias: (plantilla.sugerencias ?? [])
        .filter((s) => s.tras !== 'detalle' || sit.detalleVisto)
        .map((s) => ({ label: this.rellenar(s.label, sit), intent: s.intent })),
      detalleVisto: Boolean(sit.detalleVisto),
      tema: plantilla.tema ?? null,
    };
  }

  /**
   * La misma situación en prosa, para el prompt de un modelo.
   * @returns {string}
   */
  paraDirector() {
    const c = this.paraContexto();
    if (!c) return '';
    const lineas = [`SITUACIÓN EN MARCHA AQUÍ (no es una misión; el jugador puede ignorarla): ${c.texto}`, `Lo que quiere cada uno: ${c.agenda}`];
    if (c.ignoradaAProposito) lineas.push('El jugador ha decidido no meterse. Respétalo: sigue su curso sin él y sin castigarle por ello.');
    return lineas.join('\n');
  }

  /**
   * Mirar y no llegar a ver: el detalle sigue por descubrir. `intervenir` lo
   * da por visto al fijarse, pero con la tirada fallada solo se cuenta lo
   * evidente, y las sugerencias que dependen del detalle («Avisar a Damán
   * de que le vigilan») salían sin que el jugador supiera nada de ello.
   *
   * @param {string} id
   */
  detalleSinVer(id) {
    const sit = this.aqui().find((s) => s.id === id);
    if (sit?.detalleVisto) this._guardar({ ...sit, detalleVisto: false });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ESTADO
     ═══════════════════════════════════════════════════════════════════════ */

  /** @private */
  _guardar(situacion) {
    this.despachar('situaciones/guardar', { situacion });
  }

  /** @private */
  _reducirGuardar(estado, accion) {
    const { situacion } = accion.payload ?? {};
    if (!situacion?.id) return null;
    const actual = estado.world?.situaciones ?? { porId: {}, orden: [] };
    const orden = (actual.orden ?? []).includes(situacion.id) ? actual.orden : [...(actual.orden ?? []), situacion.id];
    return { world: { situaciones: { porId: { ...(actual.porId ?? {}), [situacion.id]: situacion }, orden } } };
  }

  inspeccionar() {
    return { situaciones: this.todas().map((s) => `${s.refId}@${s.lugar}:${s.estado}`) };
  }
}

export default SituationSystem;
