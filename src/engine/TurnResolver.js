/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/TurnResolver.js
 * ---------------------------------------------------------------------------
 * El bucle de turno. Aquí converge todo el motor.
 *
 * Secuencia completa, en orden:
 *
 *   1. Se recibe la acción del jugador
 *   2. IntentParser deduce qué pretende
 *   3. RulesEngine TIRA LOS DADOS y decide el resultado
 *   4. ContextComposer arma el contexto con ese resultado dentro
 *   5. El proveedor narra lo que ya está decidido
 *   6. ResponseSchema valida y repara la respuesta
 *   7. EffectApplier aplica lo permitido, recorta el resto
 *   8. Clock avanza el mundo
 *   9. MemoryStore recuerda lo ocurrido
 *
 * El orden importa. Los dados se tiran en el paso 3, antes de que el director
 * exista en la ecuación. Ningún modelo de lenguaje puede hacer que aciertes
 * cuando has fallado.
 *
 * Garantía adicional: un turno nunca deja el estado a medias. Si algo falla,
 * se restaura y se entrega un turno mínimo jugable.
 *
 * Dependencias: SystemBase y prácticamente todo el motor.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { evaluarAmbicion } from './Ambicion.js';
import { SystemBase } from '../core/SystemBase.js';
import { interpretar, tipoDeTurno, COMANDOS, leerGesto } from './IntentParser.js';
import { validarRespuesta } from '../ai/ResponseSchema.js';
import { MemoryStore } from '../ai/MemoryStore.js';
import { leerTurno } from '../ai/Cronica.js';
import { preguntaDeMesa, cerrarConPregunta, terminaEnPregunta } from '../ai/Pregunta.js';
import { ContextComposer } from '../ai/ContextComposer.js';
import { construirInstantanea } from '../ai/narrador/Instantanea.js';
import { filtrarModelo, aplicarNarrativos } from '../ai/narrador/FiltroModelo.js';
import { anotar, muertosSegunCanon, mensajeDeEdicion } from '../ai/narrador/Canon.js';
import { ProceduralProvider } from '../ai/providers/ProceduralProvider.js';
import { PROVEEDORES } from '../config/ai.config.js';
import { LIMITES, TIEMPOS } from '../config/app.config.js';
import { DIRECCION } from '../config/balance.config.js';
import { VOCES } from '../config/ui.config.js';
import { idEntidad, TIPO } from '../utils/id.js';
import { evaluar } from '../core/Dice.js';
import { sinAcentos } from '../utils/text.js';
import { interpretarTurno, escenaDesde } from './Interpretacion.js';
import { separarVocativo } from './Segmentos.js';
import { leerRecuento } from './Recuento.js';
import { infinitivoAPrimera, intento } from './Infinitivo.js';

/** Una huella corta y estable de un texto (FNV-1a), para identificar peticiones. */
function huellaCorta(texto) {
  let h = 0x811c9dc5;
  for (const c of String(texto)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Edición deliberada del canon, fuera de la ficción: «canon: …», «(fuera de personaje): …». */
const CANON_FUERA = /^\s*(?:\(\s*)?(?:canon|fuera de personaje|fuera de la historia|ooc)(?:\s*\))?\s*[:：]\s*(.{3,})$/iu;

/** Aceptar lo que está sobre la mesa. */
const ACEPTA = /^(?:si,?\s*)?(?:acepto|lo acepto|acepto el encargo|cuenta conmigo|lo hare|me encargo|me encargo yo|trato hecho|vale,? (?:lo hago|acepto|me encargo))\b/;
/** Decir que no. */
const RECHAZA = /^(?:no acepto|no me interesa|no lo hare|rechazo|paso|no cuentes conmigo|no,? gracias|no me encargo|no quiero ese encargo)\b/;
/** Proponerse algo por su cuenta: son sus palabras, no un encargo. */
const META = /^(?:me propongo|mi objetivo es|me marco como objetivo|he decidido|juro que)\s+(.+)$|^quiero\s+((?:averiguar|encontrar|descubrir|saber|recuperar|vengar|limpiar)\b.+)$/i;

/** Palabras que no dicen de qué va una sugerencia. */
const VACIAS = new Set(['a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'lo', 'le', 'les', 'en', 'con', 'por', 'para', 'que', 'se', 'un', 'una', 'unos', 'unas', 'y', 'o', 'me', 'te', 'mi', 'tu', 'su', 'sus', 'es', 'si']);

/**
 * ¿Lo que ha escrito el jugador dice lo mismo que una sugerencia? Cada
 * palabra con contenido de la sugerencia tiene que estar en lo escrito, por
 * su raíz (cuatro letras: «preguntar»/«pregunto», «hablar»/«hablo»). Si la
 * sugerencia tiene más de tres, basta con tres de cada cuatro.
 *
 * @param {string} escrito
 * @param {string} sugerencia Ya normalizada (minúsculas, sin tildes).
 * @returns {boolean}
 */
function cubre(escrito, sugerencia) {
  const palabras = (t) => sinAcentos(String(t).toLowerCase()).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((p) => p && !VACIAS.has(p));
  const suyas = palabras(sugerencia);
  if (!suyas.length) return false;
  const mias = palabras(escrito);
  const casa = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
  const hay = suyas.filter((s) => mias.some((m) => casa(s, m))).length;
  return suyas.length <= 3 ? hay === suyas.length : hay / suyas.length >= 0.75;
}

/** Tildes de las órdenes que se escriben sin ellas. */
const TILDES_ORDEN = Object.freeze({ dejame: 'déjame', largate: 'lárgate', callate: 'cállate', apartate: 'apártate', quitate: 'quítate', sueltame: 'suéltame', dejadme: 'dejadme', largaos: 'largaos', callaos: 'callaos' });

/**
 * Una orden a otro sin decir a quién: «déjame en paz», «lárgate», «vete».
 * Devuelve la orden bien escrita, o null. Si nombra a alguien, no es esto:
 * ya tiene destinatario.
 * @param {string} texto
 * @returns {string|null}
 */
function ordenSinDestino(texto) {
  const t = String(texto ?? '').trim().replace(/[.!¡]+$/u, '').replace(/^¡/u, '');
  const n = sinAcentos(t.toLowerCase());
  if (!/^(?:no\s+)?(?:dejame|dejadme|largate|largaos|vete|idos|callate|callaos|apartate|quitate|sueltame|basta ya|basta|fuera de aqui|dejalo ya)\b/.test(n)) return null;
  if (/\p{Lu}\p{Ll}{2,}/u.test(t.slice(1))) return null;
  if (t.split(/\s+/).length > 8) return null;
  const bien = t.replace(/^(\p{L}+)/u, (w) => TILDES_ORDEN[sinAcentos(w.toLowerCase())] ?? w);
  return `${bien.charAt(0).toUpperCase()}${bien.slice(1)}`;
}

/**
 * Cose los segmentos hechos en una sola frase: «le digo "no" y espero».
 * @param {Array<{texto: string}>} hechos
 * @returns {string}
 */
function unirHechos(hechos) {
  // Lo que dijo sin comillas se cita tal cual: son sus palabras, no algo que
  // haga. Y lo que nombra algo que aquí no hay no se cuenta como hecho.
  // Con vocativo («Corvane, si ves al encapuchado, avísame»), a quien se
  // nombra es el destinatario, no parte de la cita.
  const citar = (texto) => {
    const limpio = texto.replace(/[.;,]+$/u, '').trim();
    // «¿Corvane, has oído…?», «¿Te echo una mano, Corvane?»: a Corvane.
    const voc = separarVocativo(limpio);
    if (!voc) return `le digo: «${limpio}»`;
    const verbo = /\?\s*$/u.test(voc.dicho) ? 'pregunto' : 'digo';
    return `le ${verbo} a ${voc.nombre}: «${voc.dicho}»`;
  };
  const t = hechos.filter((x) => !x.sinReferente)
    .map((x) => (x.citaImplicita ? citar(x.texto) : x.texto.replace(/[.;,]+$/u, '').trim()))
    .filter(Boolean)
    // «… y Espero»: lo que sigue va en minúscula, salvo que empiece por nombre.
    .map((x, i) => (i && /^\p{Lu}\p{Ll}+[oé]\b/u.test(x) ? x[0].toLowerCase() + x.slice(1) : x));
  return t.length <= 1 ? (t[0] ?? '') : `${t.slice(0, -1).join(', ')} y ${t.at(-1)}`;
}

/**
 * La interpretación en limpio, para el contexto de quien narre: sin las
 * funciones de la escena y con solo lo que cambia la narración.
 * @param {import('./Interpretacion.js').Interpretacion} ir
 */
function resumirInterpretacion(ir) {
  const quien = (d) => (d ? { estado: d.estado, nombre: d.quien?.nombre ?? null, refId: d.quien?.id ?? null, implicito: Boolean(d.implicito) } : null);
  return {
    texto: ir.texto,
    acto: ir.acto ?? null,
    segmentos: ir.segmentos.map((s) => ({
      tipo: s.tipo,
      texto: s.texto,
      polaridad: s.polaridad,
      pregunta: Boolean(s.pregunta),
      hipotesis: Boolean(s.hipotesis),
      acto: s.acto ?? null,
      citaLiteral: Boolean(s.citaImplicita) || /[«"“]/.test(s.texto),
      condicion: s.condicion ?? null,
      consecuencia: s.consecuencia ?? null,
      destinatario: quien(s.destinatario),
      referentes: s.referentes.map((r) => ({ palabra: r.palabra, clase: r.clase, estado: r.estado })),
    })),
  };
}

/** Verbos de hablar con alguien, sin tildes: «le pregunto», «hablo», «le cuento». */
const HABLA = /\b(?:pregunt\w*|habl[oa]\w*|dig[oa]|decirle|cuent[oa]|contarle|charl\w*|convers\w*|interrog\w*|salud[oa]\w*|le explico|le pido)\b/;

/** Eventos del ciclo de turno. */
export const EVENTOS_TURNO = Object.freeze({
  INICIO: 'turn:start',
  PENSANDO: 'turn:thinking',
  RESUELTO: 'turn:resolved',
  FIN: 'turn:end',
  ERROR: 'turn:error',
  BLOQUEADO: 'turn:blocked',
});

export class TurnResolver extends SystemBase {
  static nombre = 'turns';
  static dependencias = ['clock', 'player', 'inventory', 'rules', 'effects'];
  static canal = 'engine';

  constructor(contexto) {
    super(contexto);

    /** @type {MemoryStore} */
    this.memoria = new MemoryStore();

    /** @type {ContextComposer|null} @private */
    this._compositor = null;

    /** Proveedor de respaldo, si no hay coordinador. @private */
    this._respaldo = null;

    /** true mientras hay un turno resolviéndose. @private */
    this._ocupado = false;

    /** La última pregunta de mesa, para no repetirla seguida. @private */
    this._ultimaPregunta = null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CICLO DE VIDA
     ═══════════════════════════════════════════════════════════════════════ */

  alIniciar() {
    this._compositor = new ContextComposer({
      store: this.store,
      registry: this.registry,
      memoria: this.memoria,
    });

    this.reductores({
      'narrative/anadir': this._reducirAnadirEntrada,
      'narrative/opciones': this._reducirOpciones,
      'narrative/limpiar': this._reducirLimpiar,
    });

    // Toda acción del jugador entra por aquí, venga de donde venga.
    this.escuchar('ui:action:submit', ({ texto, intencion, opcionId, origen }) => {
      this.procesar(texto, { intencionSugerida: intencion, opcionId, origen });
    });

    // Narración directa de otros sistemas: combate, mundo, comercio.
    // Puede traer `meta`: una ilustración de escena lleva la imagen ahí.
    this.escuchar('narrative:direct', ({ texto, voz, meta }) => {
      this._anadirEntrada(voz ?? VOCES.SISTEMA, texto, meta ?? {});
    });

    // Al empezar partida, la memoria se vacía.
    this.escuchar('player:created', () => {
      // Lo importado sobrevive: se registra ANTES de crear el personaje —el
      // jugador pega su historia y luego rellena la ficha— así que un
      // `limpiar()` a secas se llevaba por delante a toda su gente justo
      // después de habérsela leído. Lo de partidas anteriores sí se va,
      // porque viene de turnos jugados y no lleva esta marca.
      const importado = this.memoria.canon.filter((c) => c.origen === 'importado');

      this.memoria.limpiar();
      this.memoria.canon = importado;
      // La historia del jugador NO se abre como hilos de memoria. Lo hacía
      // y cada fragmento se volvía un gancho cuya urgencia crecía al
      // ignorarlo: el pasado acababa dictando la campaña. Vive en la ficha
      // como canon (ver `ai/Trasfondo.js`) y vuelve cuando el jugador lo busca.
      this.store.fijar('ai.memoria', this.memoria.serializar());
    });

    // El director abre la crónica cuando la partida arranca.
    this.escuchar('game:open', () => this.abrirCronica());

    // Los hechos y hilos que publican otros sistemas van a la memoria.
    // La categoría viaja: sin ella todo acababa en «general» y no se podía
    // distinguir lo que PASÓ (un robo) de una hazaña o de una nota interna.
    this.escuchar('memory:remember', ({ texto, peso, categoria }) => {
      this.memoria.recordar(texto, { turno: this.leer('meta.turno', 0), peso, categoria });
    });

    this.escuchar('memory:thread', (datos) => {
      this.memoria.abrirHilo({ ...datos, turno: this.leer('meta.turno', 0) });
    });

    // Lo que está pasando en la escena AHORA. Nueve sistemas lo publican
    // —encuentros, viaje, misiones, facciones, combate, consecuencias— y no lo
    // recogía nadie: se tiraba entero. El director narraba a ciegas sobre una
    // escena que el motor sí tenía descrita, y de ahí salían los turnos que no
    // decían nada.
    this.escuchar('memory:context', ({ texto, temporal = true }) => {
      this.memoria.anotarContexto(texto, { temporal });
    });

    // Canon que no viene de un turno: la gente y los sitios de una historia
    // que el jugador trae escrita de otro sitio. Entran igual que si los
    // hubiera nombrado jugando, porque para el juego es lo mismo.
    this.escuchar('canon:registrar', (entidad) => {
      const { entrada } = this.memoria.registrarCanon(entidad, this.leer('meta.turno', 0));
      if (entrada) entrada.origen = entidad.origen ?? 'importado';
      this.store.fijar('ai.memoria', this.memoria.serializar());
    });
  }

  /**
   * La instantánea del turno para un modelo (ver `ai/narrador/Instantanea.js`).
   * @private
   */
  _instantanea(peticion, texto) {
    const aqui = this.leer('world.ubicacion', null);
    const ficha = this.leer('world.localizaciones.porId.' + aqui, {}) ?? {};
    // Quién ha muerto según el canon ENTERO: el verificador lo usa aunque
    // esa entrada no quepa en la petición.
    peticion.canonMuertos = muertosSegunCanon({ registro: this.memoria.registroCanon, lore: this.leer('player.lore', ''), entidades: this.memoria.canon });
    return construirInstantanea(peticion.contexto, {
      memoria: this.memoria,
      entradas: this.leer('narrative.entradas', []),
      lugar: { nombre: ficha.nombre, descripcion: ficha.descripcion },
      elementos: (this.leer('world.elementos', {}) ?? {})[aqui]?.map((e) => e.texto) ?? [],
      inventario: Object.values(this.leer('inventory.objetos.porId', {}) ?? {}).map((o) => ({ nombre: o.nombre, cantidad: o.cantidad ?? 1 })),
      oro: this.leer('player.oro', null),
      texto,
    });
  }

  /**
   * Si el canon ya no cabe entero en una petición, se dice (una vez, cuando
   * pasa): la continuidad deja de estar garantizada por lo enviado.
   * @private
   */
  _avisarCanonIncompleto(inst) {
    const omitido = inst?.canonOmitido;
    const antes = this.leer('meta.canonIncompleto', false);
    const ahora = Boolean(omitido?.n);
    this.store.fijar('meta.canonIncompleto', ahora);
    if (ahora && !antes) {
      this.emitir('ui:notice', {
        mensaje: `Tu canon ya no cabe entero en una petición gratuita: van las ${inst.memoria.canon.length} entradas más pertinentes de ${omitido.total}. El resto sigue guardado y el juego comprueba lo esencial (quién ha muerto), pero la IA puede no tenerlo delante.`,
        tipo: 'aviso',
      });
    }
  }

  /**
   * Quién ha narrado este turno, para la interfaz, y el aviso cuando cambia.
   * Si la IA falla y narra el procedural, se dice; cuando vuelve, también.
   * @private
   */
  _anotarNarrador(resultado) {
    const elegido = this.director?.inspeccionar?.()?.elegido ?? PROVEEDORES.PROCEDURAL;
    const actual = { elegido, narra: resultado.proveedor, respaldo: Boolean(resultado.degradado) && elegido !== PROVEEDORES.PROCEDURAL,
      motivo: resultado.motivoRespaldo ?? (resultado.avisos ?? []).find((a) => /falló|agot|no respond|puente|Groq|esperar/i.test(a)) ?? null };
    const previo = this.leer('meta.narrador', null);
    this.store.fijar('meta.narrador', actual);
    if (actual.respaldo && !previo?.respaldo) {
      this.emitir('ui:notice', { mensaje: 'La IA no ha podido narrar este turno' + (actual.motivo ? ' (' + String(actual.motivo).replace(/^el director externo falló: /, '').replace(/[.\s]+$/, '') + ')' : '') + '. Narra el procedural hasta que vuelva.', tipo: 'aviso' });
    } else if (!actual.respaldo && previo?.respaldo && elegido !== PROVEEDORES.PROCEDURAL) {
      this.emitir('ui:notice', { mensaje: 'La IA vuelve a narrar, con el estado de ahora.', tipo: 'exito' });
    }
  }

  /**
   * Lo que el mundo ha puesto delante, aquí y en otros lugares, para
   * resolver a qué se refiere el jugador.
   * @private
   */
  _textosDeEscena() {
    const aqui = this.leer('world.ubicacion', null);
    const sits = this.sistema('situations');
    // Lo que está pasando cuenta como aquí; lo que ya acabó, aunque fuera en
    // este sitio, como antes: el carretero se fue con su carro.
    const todas = sits?.todas?.() ?? [];
    // Los papeles de lo que pasa aquí, también de lo que acaba de terminar:
    // «el carretero» sigue siendo Elrén aunque se haya ido.
    const turno = this.leer('meta.turno', 0);
    const abiertas = todas.filter((s) => s.lugar === aqui && (s.estado === 'abierta' || turno - (s.turnoDesenlace ?? s.ultimaAtencion ?? s.turnoInicio ?? 0) <= 6));
    const lugares = new Set(todas.map((s) => s.lugar).filter(Boolean));
    return {
      textos: [...(this.memoria.contextoDeEscena?.() ?? []), ...(sits?.textosDe?.(aqui, { soloAbiertas: true, recientes: 6 }) ?? [])],
      antes: [...lugares].flatMap((lugar) => (sits.textosDe(lugar, lugar === aqui ? { soloCerradas: true, recientes: 6 } : {}) ?? []).map((texto) => ({ lugar, texto }))),
      papeles: abiertas.flatMap((s) => Object.entries(s.actores ?? {}).map(([papel, a]) => ({ papel, quien: { id: a.refId, nombre: a.nombre } }))),
    };
  }

  /**
   * Registra algo que pasa a estar en la escena: lo introduce el narrador
   * autorizado o un sistema. Queda guardado con su lugar, su fuente y su
   * turno; es lo que luego permite decir «el carro que viste en el vado».
   *
   * @param {string} texto
   * @param {Object} [opciones]
   * @param {string} [opciones.fuente='motor']
   * @param {string} [opciones.lugar]
   */
  registrarElemento(texto, { fuente = 'motor', lugar = this.leer('world.ubicacion', null) } = {}) {
    const limpio = String(texto ?? '').trim().slice(0, 160);
    if (!limpio || !lugar) return false;
    const todos = { ...(this.leer('world.elementos', {}) ?? {}) };
    const lista = [...(todos[lugar] ?? [])];
    if (lista.some((e) => e.texto === limpio)) return false;
    lista.push({ texto: limpio, fuente, turno: this.leer('meta.turno', 0) });
    todos[lugar] = lista.slice(-24);
    this.store.fijar('world.elementos', todos);
    return true;
  }

  /**
   * Pasa al canon lo que el jugador ha afirmado en su turno.
   *
   * Un nombre nuevo se anuncia como hecho para que el director lo tenga
   * delante ya en el turno siguiente, y una promesa abre hilo, que es el
   * mecanismo por el que el pasado vuelve solo.
   *
   * @param {string} texto Lo que escribió el jugador.
   * @param {number} turno
   * @private
   */
  _anotarCanon(texto, turno) {
    const { entidades, promesas } = leerTurno(texto);

    for (const e of entidades) {
      const { nuevo, entrada } = this.memoria.registrarCanon(e, turno);
      if (!nuevo || !entrada) continue;

      // Solo lo nuevo se recuerda como hecho: repetir un nombre conocido en
      // cada mención llenaría la memoria de lo mismo.
      const partes = [entrada.nombre];
      if (entrada.rasgos.length) partes.push(`(${entrada.rasgos.join(', ')})`);
      if (entrada.notas.length) partes.push(`— ${entrada.notas[0]}`);

      this.memoria.recordar(`El personaje ha nombrado a ${partes.join(' ')}.`, {
        turno, peso: 2, categoria: 'canon',
      });
    }

    for (const p of promesas) {
      // Se cita lo que dijo, entre comillas, en vez de coserlo a «se
      // comprometió a». Coserlo producía «Se comprometió a no descansaré
      // hasta…», porque lo que él escribió ya venía conjugado.
      this.memoria.abrirHilo({
        tipo: 'promesa',
        texto: `Dio su palabra: «${p}»`,
        turno,
        relacionadoCon: 'promesa_jugador',
      });
    }
  }

  async alArrancar() {
    // Sin coordinador de directores, se usa el procedural directamente.
    this._respaldo = new ProceduralProvider({ rng: this.rng });
    this.log.info(`Director activo: ${this._idDirector()}`);
  }

  /**
   * El coordinador de directores, si está registrado.
   * @returns {Object}
   */
  get director() {
    return this.sistema('dungeonmaster') ?? this._respaldo;
  }

  /**
   * Identificador del proveedor que narra ahora.
   *
   * El coordinador lo expone como `proveedorId`; un proveedor suelto, como `id`.
   *
   * @returns {string}
   * @private
   */
  _idDirector() {
    const d = this.director;
    return d?.proveedorId ?? d?.id ?? PROVEEDORES.PROCEDURAL;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PROCESAMIENTO DE UN TURNO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Procesa una acción del jugador de principio a fin.
   *
   * @param {string} texto
   * @param {Object} [opciones]
   * @returns {Promise<Object|null>}
   */
  async procesar(texto, opciones = {}) {
    // ─── Guardas ────────────────────────────────────────────────────────
    if (this._ocupado) {
      this.emitir(EVENTOS_TURNO.BLOQUEADO, { motivo: 'turno en curso' });
      return null;
    }

    // Lo que escribió, tal cual, para la bitácora; `limpio` es lo que se
    // interpreta.
    const escrito = String(texto ?? '').trim();
    let limpio = escrito;
    if (limpio.length < LIMITES.entradaMin) return null;

    if (this.leer('meta.fase') === 'fin') {
      this.emitir(EVENTOS_TURNO.BLOQUEADO, { motivo: 'la crónica ha terminado' });
      return null;
    }

    // ─── 0. Cambiar el canon, a propósito y fuera de la historia ───────
    // «canon: mi hermano murió en el paso» es el jugador editando su propio
    // universo, no su personaje diciendo algo. Solo así se cambia el canon:
    // lo que diga un PNJ, una suposición o una frase dentro de la ficción no
    // lo reescribe. No consume turno ni pasa por ningún narrador.
    const edicion = limpio.match(CANON_FUERA);
    if (edicion) return this._editarCanon(edicion[1].trim());

    // ─── 0b. Infinitivos y órdenes sin destinatario ────────────────────
    // «Fijarte en la figura del tejado» (una sugerencia, o como escribe
    // mucha gente) es una acción suya: se pasa a primera persona. Se tomaba
    // por algo dicho a alguien y salía «Le dices: «Fijarte…»».
    limpio = infinitivoAPrimera(limpio);

    // «Déjame en paz» sin decir a quién: a quien le acaba de hablar, si lo
    // hay; si no, se pregunta en vez de narrarlo al aire.
    const orden = ordenSinDestino(limpio);
    if (orden) {
      const quien = this._interlocutorReciente();
      if (quien) {
        limpio = `le digo a ${quien.nombre}: «${orden}»`;
      } else {
        const aqui = (this.leer('npcs.presentes', []) ?? []).map((id) => this.leer(`npcs.conocidos.porId.${id}.nombre`)).filter(Boolean);
        this._anadirEntrada(VOCES.JUGADOR, escrito);
        this._anadirEntrada(VOCES.SISTEMA, `¿A quién se lo dices? ${aqui.length ? `Si es a alguien de aquí, nómbralo (${aqui.join(', ')}). ` : ''}Si es al máster, di qué quieres hacer ahora: por ejemplo, «me alejo de aquí» o «me siento a descansar».`);
        return { aclaracion: 'orden_sin_destino' };
      }
    }

    // ─── 1. Interpretación ──────────────────────────────────────────────
    const contextoIntencion = {
      intencionSugerida: opciones.intencionSugerida,
      enCombate: this.leer('combat.activo', false),
      npcsPresentes: this.leer('npcs.presentes', []),
    };

    // El texto se parte en lo que hace, dice, deja de lado o deja para
    // después (ver `Segmentos.js`). La intención y la tirada salen de lo
    // primero que hace; lo condicional no se ejecuta, y el eco del narrador
    // cuenta solo lo que de verdad ha hecho en este turno.
    //
    // Antes de partirlo se resuelve contra la escena a quién habla y qué
    // nombra (ver `Interpretacion.js`): el que narre, sea el procedural o un
    // modelo, recibe lo mismo, y lo que no existe no se narra como hecho.
    const textosEscena = this._textosDeEscena();
    const escena = escenaDesde((r, d) => this.leer(r, d), textosEscena);
    const ir = interpretarTurno(limpio, escena);
    const plan = ir.plan;
    // «Afilo el cuchillo y ataco a Korsa»: el gesto prepara, el turno lo
    // decide el ataque. Antes el foco era lo primero y el ataque se perdía
    // sin decirlo.
    if (plan.foco && leerGesto(plan.foco.texto)) {
      const ataque = plan.hechos.find((s) => s !== plan.foco && s.tipo === plan.foco.tipo && interpretar(s.texto, contextoIntencion).tipo === 'attack');
      if (ataque) plan.foco = ataque;
    }
    const textoFoco = plan.foco?.texto ?? ir.texto;
    const textoHecho = plan.hechos.length ? unirHechos(plan.hechos) : limpio;
    // Si todo es una condición («si el herrero me sigue mirando, me voy al
    // puente»), este turno no se hace nada: se espera a ver. Se interpretaba
    // el texto entero, y el «me voy» movía al personaje.
    const soloCondicion = !plan.foco && plan.pendientes.length > 0;
    // Lo dicho sin verbo de habla («Corvane, si ves al encapuchado, avísame»)
    // se interpreta como lo que es, hablarle a alguien; si no, no puntuaba
    // como nada y se narraba sin que contestara nadie.
    const paraIntencion = plan.foco?.citaImplicita ? unirHechos([plan.foco]) : textoFoco;
    const intencion = interpretar(soloCondicion ? 'espero' : paraIntencion, contextoIntencion);

    // Negarse no se tira: es una decisión, no un intento que pueda fallar.
    if (plan.foco?.negativa) Object.assign(intencion, { requiereTirada: false, negativa: true });

    // Pedirle a alguien que te diga algo es hablar con él, no ir a ninguna
    // parte: «le exijo a Irmir que me diga dónde está el camino del norte»
    // se tomaba por un viaje y contestaba «No sabes cómo llegar».
    if (intencion.tipo !== 'talk' && /\b(?:que me (?:diga|digas|digais|cuente|cuentes|explique|indique)|dime|cuentame|me dices|me cuentas)\b/.test(sinAcentos(textoFoco.toLowerCase()))) {
      Object.assign(intencion, { tipo: 'talk', habilidad: 'trato_social', requiereTirada: false, objetivo: null });
    }

    // Encararse sin decir con quién («me enfrento a un ciudadano», con cuatro
    // delante): no se elige a nadie ni se inventa una pelea; se pregunta,
    // sin gastar turno. Salía «Te enfrentas a un ciudadano» y nada más.
    const conQuien = () => {
      const aqui = (this.leer('npcs.presentes', []) ?? []).map((id) => this.leer(`npcs.conocidos.porId.${id}`)).filter((n) => n?.nombre);
      const n = sinAcentos(limpio.toLowerCase());
      const porOficio = aqui.filter((x) => x.rol && new RegExp(`\\b${sinAcentos(x.rol.toLowerCase())}`).test(n));
      return this._aQuienSeHablo(limpio, { soloNombrado: true }) ?? (porOficio.length === 1 ? porOficio[0] : null);
    };
    if (intencion.acto?.acto === 'enfrentar' && !conQuien()) {
      const aqui = (this.leer('npcs.presentes', []) ?? []).map((id) => this.leer(`npcs.conocidos.porId.${id}`)).filter((n) => n?.nombre);
      this._anadirEntrada(VOCES.JUGADOR, escrito);
      this._anadirEntrada(VOCES.SISTEMA, aqui.length
        ? `¿Con quién? Aquí están ${aqui.map((n) => (n.rol ? `${n.nombre} (${n.rol})` : n.nombre)).join(', ')}, y nadie te ha provocado. Di con quién te encaras y cómo: con palabras o a golpes.`
        : 'Aquí no hay nadie con quien encararse.');
      return { aclaracion: 'enfrentar_sin_destino' };
    }

    // Los comandos no consumen turno.
    if (intencion.esComando) {
      return this._ejecutarComando(intencion);
    }

    this._ocupado = true;
    const numeroTurno = this.leer('meta.turno', 0) + 1;

    this.emitir(EVENTOS_TURNO.INICIO, { turno: numeroTurno, accion: limpio, intencion });
    this._bloquearEntrada(true);

    // Instantánea previa: un turno nunca deja el estado a medias.
    this.store.instantanea('turno');

    try {
      // ─── 2. La acción se registra en la bitácora ──────────────────────
      this._anadirEntrada(VOCES.JUGADOR, escrito, { turno: numeroTurno });

      // ─── 2a. Encargos y objetivos, dichos con palabras ────────────────
      const encargo = this._encargosPorTexto(textoFoco);
      if (encargo) return this._turnoLocal(numeroTurno, encargo, { voz: VOCES.DM });

      // ─── 2a'. ¿Existe aquello de lo que depende? ──────────────────────
      // Una pregunta a quien no está no la contesta el que haya al lado, y
      // examinar un eje sin carro no se tira ni se adorna con el río. Buscar
      // o ir hacia algo sí se puede aunque no esté: por eso se busca.
      const buscaOva = ['travel', 'search', 'explore'].includes(intencion.tipo);
      if (ir.bloqueo && (ir.bloqueo.motivo === 'destinatario' || !buscaOva)) {
        return this._turnoLocal(numeroTurno, ir.bloqueo.texto, { voz: VOCES.DM });
      }

      // ─── 2b. Encuentro pendiente ──────────────────────────────────────
      const exploration = this.sistema('exploration');

      // Lo que resuelve el encuentro vale: su tirada es la del turno y su
      // desenlace se narra. Antes se descartaba: el turno volvía a tirar con
      // otra habilidad y el narrador no se enteraba de cómo había ido.
      let encuentro = null;
      if (exploration?.encuentroActivo) {
        encuentro = await exploration.resolverEncuentro(intencion);

        if (encuentro.resuelto && encuentro.resultado === 'combate') {
          // El combate toma el control: este turno termina aquí.
          if (encuentro.narracion) this._anadirEntrada(VOCES.SISTEMA, encuentro.narracion, { turno: numeroTurno });
          this.store.descartarInstantanea('turno');
          return { turno: numeroTurno, encuentro: 'combate' };
        }
        if (encuentro.narracion && !encuentro.tirada && !encuentro.resuelto) {
          // Lo que pasa mientras hace otra cosa: la patrulla que se mueve.
          this.memoria.anotarContexto(`EN ESCENA: ${encuentro.narracion}`, { temporal: true });
        }
      }

      // ─── 2c. Situaciones en marcha ────────────────────────────────────
      // Si lo que escribe tiene que ver con algo que está pasando aquí (el
      // carro atascado, la niña del pozo), la vía que elige se tira y es la
      // acción del turno. Si la deja de lado a propósito, se apunta y sigue:
      // el turno es lo demás que haya escrito.
      // Vale con dados o sin ellos: un soborno que sale bien no se tira, y
      // se contaba como si no hubiera pasado (contestaba un vecino).
      const porEncuentro = encuentro?.narracion && (encuentro.tirada || encuentro.resuelto) ? encuentro : null;

      // Si el encuentro ya ha recogido lo que hace (le habla a la patrulla
      // que le corta el paso), eso es el turno. La situación de al lado no lo
      // reinterpreta: «le digo a la patrulla que no busco pelea» salía
      // contestado por el cobrador de la garita, y lo que había hecho la
      // patrulla no se contaba.
      const situaciones = this.sistema('situations');
      for (const o of plan.omisiones) situaciones?.intervenir(o.texto);
      // Lo imposible para su nivel se mide antes: «salto 100 metros hasta el
      // tejado» no llega al tejado, así que la situación de arriba no puede
      // reaccionar como si hubiera llegado.
      const ambicion = evaluarAmbicion(limpio, this.leer('player.nivel', 1));
      const situacion = plan.delegacion || porEncuentro || ambicion.grado === 'desmedida' ? null : (situaciones?.intervenir(textoFoco) ?? null);

      // «Que mi compañera negocie; yo observo»: actúa ella, él mira.
      const delegacion = plan.delegacion ? this._delegar(plan.delegacion) : null;
      if (plan.delegacion && !delegacion) {
        return this._turnoLocal(numeroTurno, `No va nadie contigo que pueda hacerlo por ti.`);
      }

      const intervino = Boolean(situacion?.via) || Boolean(delegacion) || Boolean(porEncuentro);
      const resuelto = delegacion ?? (situacion?.via ? situacion : porEncuentro);

      // ─── 2d. Enrutado local ───────────────────────────────────────────
      const router = this.sistema('router');
      // Un gesto de la orden sobre algo que no se lleva («afilo el hacha y
      // ataco», sin hacha) se aclara antes de hacer nada: ni el gesto con
      // otra cosa ni el resto como si el hacha estuviera.
      const gestoSinObjeto = intervino ? null : plan.hechos
        .filter((s) => s !== plan.foco && leerGesto(s.texto))
        .map((s) => router?.comprobarGesto?.(s.texto))
        .find(Boolean);
      const ruta = gestoSinObjeto ?? (intervino ? null : router?.enrutar(intencion, contextoIntencion));

      if (ruta?.ruta === 'rechazada') {
        this._anadirEntrada(VOCES.SISTEMA, ruta.narracion, { turno: numeroTurno });
        this.store.descartarInstantanea('turno');
        return { turno: numeroTurno, rechazada: ruta.motivo };
      }

      if (ruta?.ruta === 'local') {
        // La ruta puede pedir voz: un gesto se narra, no es un aviso del sistema.
        // Y si lo narra el máster, lo cierra devolviendo la palabra.
        if (ruta.narracion) {
          const voz = ruta.voz ?? VOCES.SISTEMA;
          const texto = voz === VOCES.DM
            ? this._cerrarTurno(ruta.narracion, null, this._aQuienSeHablo(limpio, { soloNombrado: true }))
            : ruta.narracion;
          this._anadirEntrada(voz, texto, { turno: numeroTurno });
        }
        await this.sistema('clock').turno({ tipo: 'exploracion' });
        this.store.descartarInstantanea('turno');
        return { turno: numeroTurno, local: true };
      }

      // ─── 3. LOS DADOS, ANTES QUE EL DIRECTOR ──────────────────────────
      // Antes de tirar se mide la ambición: lo desmedido para el nivel se
      // intenta contra la dificultad máxima; lo detallado gana un bono.
      const rules = this.sistema('rules');
      const intencionTirada = ambicion.grado === 'desmedida'
        ? { ...intencion, requiereTirada: true, habilidad: intencion.habilidad ?? 'atletismo' }
        : intencion;
      // Comprar pan no se tira. La tasación cuenta si regatea; si no, salía
      // «No consigues situarlo» debajo de «Compras pan».
      const compraLlana = intencion.tipo === 'trade' && !intencion.requiereTirada
        && !/regate|rebaj|descuent|mejor precio|precio justo/.test(sinAcentos(textoFoco.toLowerCase()));
      const tirada = intervino ? resuelto.tirada : compraLlana ? null : rules?.resolverIntencion(intencionTirada, {
        situacion: this._situacionActual(),
        ...(ambicion.grado === 'desmedida' ? { umbral: 35 } : {}),
        ...(ambicion.grado === 'detallada' ? { bono: 2, fuenteBono: 'Acción bien pensada' } : {}),
      }) ?? null;
      if (tirada && !intervino && ambicion.grado === 'desmedida') {
        // Ni un 20 natural rompe el mundo: como mucho, un intento digno.
        tirada.exito = false; tirada.critico = false;
        if (!tirada.pifia) tirada.grado = 'fracaso';
        tirada.desmedida = true;
      }

      if (tirada && this.leer('settings.mostrarTiradas', true)) {
        this._anadirEntrada(VOCES.TIRADA, '', { tirada, turno: numeroTurno });
      }

      // ─── 4. Contexto ──────────────────────────────────────────────────
      const tipo = tipoDeTurno(intencion, contextoIntencion);

      const accionEco = delegacion ? delegacion.eco : textoHecho;
      // Lo que el jugador ha escrito entero sigue siendo su acción para el
      // modelo; el eco y la respuesta usan lo que se resuelve en este turno.
      const peticion = {
        accion: accionEco,
        intencion,
        tirada,
        tipo,
        turno: numeroTurno,
        contexto: this._compositor.componerEstructurado({ accion: accionEco, intencion, tirada, tipo }),
        prompt: null,
      };
      peticion.contexto.foco = textoFoco;
      // La interpretación viaja entera: a quién habla, qué nombra y en qué
      // estado está cada cosa. Nadie narra sobre un referente sin resolver.
      peticion.contexto.interpretacion = resumirInterpretacion(ir);
      // Lo que hay (y acaba de pasar) aquí, para que mirar algo de ello
      // cuente cómo está, no un rasgo al azar.
      peticion.contexto.escenaTextos = textosEscena.textos;
      if (ir.destinatario?.quien && ir.destinatario.estado === 'presente') peticion.contexto.destinatario = ir.destinatario.quien;
      if (ir.aclaraciones.length) peticion.contexto.aclaraciones = ir.aclaraciones;

      // Los proveedores basados en modelos necesitan el contexto como prosa.
      if (this.director && this._idDirector() !== PROVEEDORES.PROCEDURAL) {
        const compuesto = this._compositor.componer({ accion: limpio, intencion, tirada, tipo });
        peticion.prompt = compuesto.texto;
        peticion.caracteres = compuesto.caracteres;
      }

      // La pista del enrutador se añade al contexto del director.
      const pistas = [ruta?.pistaDirector, ambicion.pista].filter(Boolean);

      // Lo que el jugador ha escrito, en orden, cuando es más de una cosa.
      if (plan.hechos.length + plan.pendientes.length + plan.omisiones.length > 1) {
        const partes = [
          ...plan.hechos.map((x) => `hace o dice: «${x.texto}»`),
          ...plan.omisiones.map((x) => `deja de lado: «${x.objeto || x.texto}»`),
        ];
        pistas.push(`El jugador, en orden: ${partes.join('; ')}. Resuelve solo esto.`);
      }
      if (plan.pendientes.length) {
        peticion.contexto.pendientes = plan.pendientes.map((x) => ({ condicion: x.condicion, consecuencia: x.consecuencia }));
        for (const x of plan.pendientes) {
          pistas.push(`Condición que deja dicha el jugador: si ${x.condicion}, ${x.consecuencia}. NO la ejecutes: aún no ha pasado. Cuando llegue el momento, decide él.`);
          this.memoria.recordar(`Dejó dicho: «si ${x.condicion}, ${x.consecuencia}».`, { turno: numeroTurno, peso: 2 });
        }
      }

      // Lo que niega, se queda negado, y quien lo oye lo recuerda.
      const negativa = this._registrarNegativas(plan, numeroTurno);
      if (negativa) {
        peticion.contexto.negativa = negativa;
        pistas.push(`El jugador se niega: ${negativa.cita}. Respeta su negativa: no entrega, no acepta ni cede nada. ${negativa.nombre} reacciona según lo que sabe y lo que quiere.`);
      }

      if (porEncuentro && !delegacion && !situacion?.via) {
        peticion.contexto.situacionResultado = porEncuentro.narracion;
        pistas.push(`Encuentro en curso, ya resuelto por el motor: ${porEncuentro.narracion} ${porEncuentro.pistaDirector ?? ''}`.trim());
      } else if (delegacion) {
        peticion.contexto.situacionResultado = delegacion.narracion;
        pistas.push(`Actúa ${delegacion.nombre}, no el jugador, que solo observa. No pongas palabras ni ofertas en boca del jugador. Resultado ya resuelto por el motor: ${delegacion.narracion}`);
      } else if (intervino) {
        peticion.contexto.situacionResultado = situacion.narracion;
        pistas.push(`Lo que ha pasado al intervenir, ya resuelto por el motor: ${situacion.narracion}`);
      } else if (situacion?.atencion && situacion.narracion) {
        // Si además tira por lo suyo (trepar al tejado desde el que se ve),
        // primero cómo le sale y después lo que ve. Lo que veía tapaba el
        // resultado, y no se sabía si había subido.
        // Hablar con alguien de la situación también: lo que se ve es
        // contexto, y el turno es lo que te contesta.
        if (peticion.tirada || intencion.tipo === 'talk') peticion.contexto.detalleEscena = situacion.narracion;
        else peticion.contexto.situacionResultado = situacion.narracion;
        // El detalle solo cuenta como visto si se narra: con la tirada fallada
        // o mientras se habla, no sale en el texto.
        if (intencion.tipo === 'talk' || (peticion.tirada && !peticion.tirada.exito)) {
          this.sistema('situations')?.detalleSinVer?.(situacion.situacion?.id);
          peticion.contexto.situacion = this.sistema('situations')?.paraContexto?.() ?? peticion.contexto.situacion;
        }
        pistas.push(`El jugador se fija en lo que está pasando. Lo que ve de cerca: ${situacion.narracion}`);
      } else if (situacion?.omitida) {
        pistas.push('El jugador ha decidido no meterse en lo que está pasando aquí. Respétalo: no le lleves de vuelta a ello ni le castigues por ignorarlo.');
      }
      // Salir sin destino: el director de respaldo dice por dónde se sale (el
      // modelo lo lee en la pista).
      if (ruta?.resultado?.tipo === 'salida_sin_destino') peticion.contexto.salidaSinDestino = ruta.resultado;
      if (pistas.length) {
        peticion.contexto.pistaRuta = pistas.join(' ');
        peticion.ambicion = ambicion.grado;
        if (peticion.prompt) peticion.prompt += `\n\nNOTA DEL MOTOR: ${pistas.join(' ')}`;
      }

      // ─── 4b. Lo que recibe un modelo ──────────────────────────────────
      // Un modelo no recuerda nada entre turnos: recibe la instantánea del
      // mundo ya resuelta, con procedencia. Y un identificador de turno para
      // que un reintento no se cobre dos veces.
      if (this._idDirector() !== PROVEEDORES.PROCEDURAL) {
        peticion.instantanea = this._instantanea(peticion, limpio);
        this._avisarCanonIncompleto(peticion.instantanea);
        // Partida, turno y lo escrito: tras recargar, el mismo turno con el
        // mismo texto reutiliza la respuesta que el puente ya vio; con otro
        // texto es otra petición.
        peticion.idTurno = 'p' + String(this.leer('meta.id', null) ?? this.leer('meta.semilla', 0)).slice(-12) + '-t' + numeroTurno + '-' + huellaCorta(limpio);
      }

      // ─── 5. El director narra ─────────────────────────────────────────
      const temporizadorPensando = setTimeout(() => {
        this.emitir(EVENTOS_TURNO.PENSANDO, { turno: numeroTurno });
      }, TIEMPOS.pensandoUmbral);

      let resultado;
      try {
        resultado = await this.director.dirigir(peticion);
      } finally {
        clearTimeout(temporizadorPensando);
        this.emitir(EVENTOS_TURNO.PENSANDO, { turno: numeroTurno, terminado: true });

        // El contexto de escena ya lo ha visto el director. Se descarta lo
        // temporal aquí y no después de validar: si el turno falla, tampoco
        // queremos que el encuentro se vuelva a anunciar en el siguiente.
        // Se hace en `finally` porque un director que lanza excepción también
        // ha recibido su contexto.
        this.memoria.consumirContexto();
      }

      // ─── 6. Validación ────────────────────────────────────────────────
      const validacion = validarRespuesta(resultado.respuesta);

      if (!validacion.valida) {
        this.log.aviso('respuesta del director inválida; se usa el turno mínimo', validacion.fallos);
        resultado.respuesta = this.director.turnoMinimo(peticion, 'respuesta inválida');
        resultado.degradado = true;
      } else {
        resultado.respuesta = validacion.respuesta;
      }

      // ─── 6b. Lo que narra un modelo no es autoridad ────────────────────
      // Se verifica contra el estado, se repara o se cae al procedural, y de
      // sus efectos solo entra lo narrativo que la política autoriza. Lo
      // mecánico es de cada sistema. Un solo camino para Groq, un modelo
      // local o el puente (ver `ai/narrador/FiltroModelo.js`).
      let narrativos = [];
      let traza = null;
      if (![PROVEEDORES.PROCEDURAL, 'minimo'].includes(resultado.proveedor)) {
        const filtro = await filtrarModelo({
          resultado,
          peticion,
          leer: (r, d) => this.leer(r, d),
          proveedor: this.director?.proveedor?.(resultado.proveedor) ?? null,
          permitirReparacion: this.leer('settings.reparacionRemota', true) !== false,
        });
        traza = { proveedor: resultado.proveedor, problemas: filtro.problemas.map((p) => p.tipo), reparado: filtro.reparado,
          rechazados: filtro.rechazados, solicitudesExtra: filtro.solicitudesExtra, uso: resultado.uso ?? null };
        if (filtro.caer) {
          const interno = this.director?.proveedor?.(PROVEEDORES.PROCEDURAL) ?? this._respaldo;
          const r2 = await interno.dirigir(peticion);
          const v2 = validarRespuesta(r2.respuesta);
          resultado = { ...r2, respuesta: v2.valida ? v2.respuesta : this.director.turnoMinimo(peticion, 'respuesta inválida'), degradado: true,
            avisos: [...(resultado.avisos ?? []), ...filtro.avisos], motivoRespaldo: filtro.motivo, desde: traza.proveedor };
        } else {
          resultado.respuesta = filtro.respuesta;
          resultado.avisos = [...(resultado.avisos ?? []), ...filtro.avisos];
          narrativos = filtro.aceptados;
        }
        traza.final = resultado.proveedor;
      }

      // ─── 7. Saneado y aplicación ──────────────────────────────────────
      const effects = this.sistema('effects');
      const { respuesta: saneada, retirado } = effects.sanear(resultado.respuesta);

      const aplicacion = effects.aplicar(saneada, {
        turno: numeroTurno,
        hitoNarrativo: this._esHito(saneada),
      });

      // Lo narrativo que el modelo propuso y la política aceptó, cada cosa
      // por su sistema.
      if (narrativos.length && traza) {
        traza.aplicado = aplicarNarrativos(narrativos, {
          npcs: this.sistema('npcs'),
          relaciones: this.sistema('relationships'),
          memoria: this.memoria,
          registrarElemento: (t, o) => this.registrarElemento(t, o),
          turno: numeroTurno,
        });
      }
      if (traza) this.emitir('narrador:traza', { turno: numeroTurno, ...traza });
      this._anotarNarrador(resultado);

      // ─── 8. Narración a la bitácora ───────────────────────────────────
      if (saneada.sceneBreak) this._cortarEscena();

      // Con quién se ha hablado, antes de cerrar el texto: la pregunta final
      // solo nombra a quien de verdad ha intervenido.
      const interlocutor = this._registrarConversacion(saneada, tipo, accionEco);

      // Cada turno termina devolviendo la palabra. La pone el modelo si la
      // trae (`pregunta`); si no, el motor. Tras despedirse o pedir que le
      // dejen en paz, nadie «espera tu respuesta».
      const seVa = ['alejar', 'despedirse'].includes(ir.acto?.acto);
      const relevado = this._otroTomaLaPalabra(saneada.story, interlocutor);
      const sinCierre = saneada.story;
      saneada.story = this._cerrarTurno(saneada.story, saneada.pregunta, seVa || relevado ? null : interlocutor);

      this._anadirEntrada(VOCES.DM, saneada.story, {
        turno: numeroTurno,
        escenaAbierta: this.leer('narrative.escenaAbierta', true),
        mood: saneada.mood,
        // La pregunta añadida, si se añadió: un aviso del mundo que llegue
        // después en el mismo turno («Cierra el mercado») se pone delante de
        // ella, no detrás (ver `_reducirAnadirEntrada`).
        cierre: saneada.story !== sinCierre ? this._ultimaPregunta : null,
      });

      // Los eventos no silenciosos se narran aparte.
      for (const evento of saneada.events ?? []) {
        // Quien ya ha aparecido en escena deja de estar pendiente. Sin esta
        // marca, el capitán al que el jugador lleva turnos buscando se
        // «encontraría» una y otra vez, que es peor que no encontrarlo.
        if (evento.type === 'npc_meet' && evento.payload?.nombre) {
          const ficha = this.memoria.deCanon(evento.payload.nombre);
          if (ficha) ficha.presentado = true;
        }

        if (evento.silent) continue;
        const texto = this._describirEvento(evento);
        if (texto) this._anadirEntrada(VOCES.SISTEMA, texto, { turno: numeroTurno });
      }

      // ─── 9. Opciones ──────────────────────────────────────────────────
      this._fijarOpciones(saneada.choices ?? [], escrito);

      // ─── 10. Combate ──────────────────────────────────────────────────
      // Una situación que acaba a golpes (atacar al del peaje, o que se
      // acabe la paciencia) pide la pelea ahora, ya contado el porqué.
      if (situacion?.combate) this.emitir('combat:request', situacion.combate);
      if (saneada.combat?.start) {
        this.emitir('combat:request', saneada.combat);
      }

      // ─── 11. Memoria ──────────────────────────────────────────────────
      this.memoria.registrarTurno({
        numero: numeroTurno,
        accion: limpio,
        narracion: saneada.story,
        mood: saneada.mood,
        tirada,
      });

      this.memoria.recordarVarios(saneada.memory ?? [], { turno: numeroTurno });

      // Lo que cada PNJ tiene que recordar: lo que ha contado queda como
      // compartido (no lo volverá a contar como nuevo) y lo demás, en su
      // memoria. Solo con quien existe.
      const npcs = this.sistema('npcs');
      for (const r of saneada.npcMemory ?? []) {
        if (!r?.refId || !r.texto) continue;
        if (r.tipo === 'compartido') npcs?.compartir?.(r.refId, r.texto);
        else npcs?.recordar?.(r.refId, r.texto, { tipo: r.tipo || 'dicho' });
      }

      // Lo que el jugador ha nombrado pasa a existir.
      //
      // Es lo que hace que la historia se construya en vez de olvidarse. Antes
      // solo se minaba el trasfondo al crear el personaje: si tres turnos
      // después escribía «busco al capitán Verros, el que quemó mi forja», el
      // nombre moría en el texto de ese turno y el mundo no se enteraba.
      this._anotarCanon(limpio, numeroTurno);

      // ─── 12. El mundo avanza ──────────────────────────────────────────
      const clock = this.sistema('clock');
      await clock.turno({ tipo: tipo === 'combate' ? 'combate' : 'exploracion' });

      // ─── 13. Mantenimiento periódico ──────────────────────────────────
      await this._mantenimiento(numeroTurno);

      // ─── Cierre ───────────────────────────────────────────────────────
      this.store.descartarInstantanea('turno');
      this.store.fijar('ai.memoria', this.memoria.serializar());

      const resumen = {
        turno: numeroTurno,
        accion: limpio,
        intencion,
        tirada,
        proveedor: resultado.proveedor,
        degradado: resultado.degradado,
        ajustes: aplicacion.ajustes,
        retirado,
        avisos: resultado.avisos,
      };

      this.emitir(EVENTOS_TURNO.RESUELTO, resumen);


      return resumen;

    } catch (e) {
      // Un fallo en cualquier punto restaura el estado previo.
      this.store.restaurar('turno');
      this.log.error('fallo al resolver el turno', e);

      this._anadirEntrada(VOCES.SISTEMA, 'Algo se ha torcido. El momento pasa sin consecuencias.', {
        turno: numeroTurno,
      });

      this.emitir(EVENTOS_TURNO.ERROR, { turno: numeroTurno, error: e?.message });
      return null;

    } finally {
      this._ocupado = false;
      this._bloquearEntrada(false);
      this.emitir(EVENTOS_TURNO.FIN, { turno: numeroTurno });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MANTENIMIENTO PERIÓDICO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Tareas que no toca hacer cada turno: resúmenes y ajuste de dificultad.
   * @param {number} turno
   * @private
   */
  async _mantenimiento(turno) {
    // ─── Resumen de capítulo ────────────────────────────────────────────
    if (this.memoria.tocaResumir(turno)) {
      const turnos = this.memoria.turnosParaResumir();

      if (turnos.length) {
        let texto = null;

        // Se pide al proveedor; si no puede, se usa el resumen mecánico.
        try {
          texto = await this.director?.resumir?.(turnos);
        } catch {
          texto = null;
        }

        if (!texto) texto = this.memoria.resumenMecanico(turnos);

        if (texto) {
          this.memoria.guardarResumen(texto, turnos[0].turno, turno);
        }
      }
    }

    // ─── Dificultad adaptativa ──────────────────────────────────────────
    if (turno % DIRECCION.ventanaAnalisis === 0) {
      const rules = this.sistema('rules');
      rules?.revisarDificultad();
    }

    // ─── Turnos sin tensión ─────────────────────────────────────────────
    const enCombate = this.leer('combat.activo', false);
    const sinTension = this.leer('world.turnosSinTension', 0);

    this.store.fijar('world.turnosSinTension', enCombate ? 0 : sinTension + 1);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMANDOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Ejecuta un comando sin consumir turno.
   * @param {Object} intencion
   * @returns {Object}
   * @private
   */
  _ejecutarComando(intencion) {
    const { comando, argumentos } = intencion;

    switch (comando) {
      case '/dado': {
        const notacion = argumentos[0] ?? '1d20';
        try {
          const r = evaluar(this.rng.dados, notacion);
          this._anadirEntrada(VOCES.TIRADA, `${notacion} → ${r.total} [${r.dados.join(', ')}]`, {});
        } catch {
          this._anadirEntrada(VOCES.SISTEMA, `Notación no válida: ${notacion}`, {});
        }
        break;
      }

      case '/estado': {
        const player = this.sistema('player');
        const estado = player?.estadoNarrativo() ?? '';
        const jugador = this.leer('player');
        this._anadirEntrada(VOCES.SISTEMA,
          `${jugador.nombre}, nivel ${jugador.nivel}. Vida ${jugador.vida.actual}/${jugador.vida.max}. Está ${estado}.`, {});
        break;
      }

      case '/inventario':
        this.emitir('ui:drawer:open', { lado: 'izquierdo' });
        break;

      case '/misiones':
      case '/mapa':
        this.emitir('ui:drawer:open', { lado: 'derecho' });
        break;

      case '/guardar':
        this.emitir('game:save', { ranura: 'auto' });
        break;

      case '/ayuda': {
        const lineas = Object.entries(COMANDOS).map(([c, d]) => `${c} — ${d.descripcion}`);
        this._anadirEntrada(VOCES.SISTEMA, lineas.join('\n'), {});
        break;
      }
    }

    return { comando, ejecutado: true };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BITÁCORA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Añade una entrada a la bitácora narrativa.
   * @param {string} voz
   * @param {string} texto
   * @param {Object} meta
   * @private
   */
  _anadirEntrada(voz, texto, meta = {}) {
    this.despachar('narrative/anadir', {
      entrada: {
        id: idEntidad(TIPO.ENTRADA),
        voz,
        texto,
        meta,
        // Dónde se dijo: lo narrado en otro lugar no cuenta como «aquí».
        lugar: this.leer('world.ubicacion', null),
        turno: meta.turno ?? this.leer('meta.turno', 0),
      },
    });
  }

  /** @private */
  _cortarEscena() {
    this.store.fijar('narrative.escenaAbierta', true);
    this.emitir('narrative:sceneBreak', {});
  }

  /** @private */
  _reducirAnadirEntrada(estado, accion) {
    const { entrada } = accion.payload ?? {};
    if (!entrada) return null;

    let entradas = [...estado.narrative.entradas, entrada];
    // Un aviso del mundo en el mismo turno va antes de la pregunta que
    // devuelve la palabra: salía «¿Qué haces? / Cierra el mercado.», y la
    // pregunta quedaba enterrada. La pregunta pasa a su propia línea, al final.
    const ultima = estado.narrative.entradas.at(-1);
    if (entrada.voz === VOCES.SISTEMA && ultima && ultima.turno === entrada.turno) {
      const cierre = ultima.meta?.cierre;
      if (ultima.voz === VOCES.DM && cierre && ultima.texto.endsWith(`\n${cierre}`)) {
        const narrado = { ...ultima, texto: ultima.texto.slice(0, -(cierre.length + 1)), meta: { ...ultima.meta, cierre: null } };
        const pregunta = { ...ultima, id: `${ultima.id}-cierre`, texto: cierre, meta: { turno: ultima.turno, soloCierre: true } };
        entradas = [...estado.narrative.entradas.slice(0, -1), narrado, entrada, pregunta];
      } else if (ultima.meta?.soloCierre) {
        entradas = [...estado.narrative.entradas.slice(0, -1), entrada, ultima];
      }
    }

    // La bitácora se poda en el estado, no solo en el DOM.
    const podadas = entradas.length > LIMITES.narrativaMax * 2
      ? entradas.slice(-LIMITES.narrativaMax)
      : entradas;

    return {
      narrative: {
        entradas: podadas,
        escenaAbierta: entrada.voz === 'dm' ? false : estado.narrative.escenaAbierta,
      },
    };
  }

  /** @private */
  _reducirOpciones(estado, accion) {
    const { opciones = [], usadas, vistas, pausadas } = accion.payload ?? {};
    return {
      narrative: {
        opciones,
        ...(usadas ? { sugerenciasUsadas: usadas } : {}),
        ...(vistas ? { sugerenciasVistas: vistas } : {}),
        ...(pausadas ? { sugerenciasPausadas: pausadas } : {}),
      },
    };
  }

  /**
   * Cómo está la escena, en una huella: dónde, qué situaciones y en qué
   * punto, y quién hay. Si no cambia, una sugerencia usada no vuelve.
   * @returns {string}
   * @private
   */
  _huellaEscena() {
    // Solo lo que cambia lo que tiene sentido proponer: el sitio, qué
    // situación y en qué estado, si ya se vio de cerca, y quién hay. Los
    // pulsos (la figura se mueve dos casas) y los intentos entraban aquí y
    // cambiaban la huella cada dos turnos: lo ya usado volvía a salir.
    const sits = (this.sistema('situations')?.aqui?.() ?? [])
      .map((s) => [s.refId, s.estado, Boolean(s.detalleVisto)]);
    return JSON.stringify([this.leer('world.ubicacion'), sits, [...(this.leer('npcs.presentes', []) ?? [])].sort()]);
  }

  /**
   * Fija las sugerencias del turno.
   *
   * Se sugirió «Hablar con Cordor» unas cinco veces seguidas: la que el
   * jugador acaba de usar sin que cambie nada no se vuelve a ofrecer hasta
   * que cambie la escena (otra situación, otro punto de la misma, otra
   * gente). Y dos iguales no salen juntas. Queda guardado en la partida:
   * tras cargar no vuelven las mismas.
   *
   * @param {Array<Object>} choices Lo que propone quien narra.
   * @param {string|null} [usada] Lo que ha escrito o pulsado el jugador.
   * @private
   */
  _fijarOpciones(choices, usada = null) {
    const clave = (t) => sinAcentos(String(t ?? '').toLowerCase()).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const huella = this._huellaEscena();
    // Lista y no objeto: el parche del almacén funde objetos, y una clave
    // quitada seguiría ahí.
    const guardadas = this.leer('narrative.sugerenciasUsadas', []);
    const usadas = new Map(Array.isArray(guardadas) ? guardadas.map((u) => [u.k, u.h]) : []);
    const vistasAntes = new Map((this.leer('narrative.sugerenciasVistas', []) ?? []).map((v) => [v.k, v]));
    const previas = (this.leer('narrative.opciones', []) ?? []).map((o) => clave(o.label));
    // Lo que escribió cuenta si es una sugerencia ofrecida, o si dice lo
    // mismo con otras palabras: «le pregunto a Cordan qué se cuenta por
    // aquí» es «Preguntar a Cordan qué se cuenta aquí». Antes solo contaba
    // la frase exacta, y la sugerencia seguía saliendo ya contestada.
    if (usada) {
      const hecha = [...previas, ...(choices ?? []).map((o) => clave(o.label))].filter((k) => k && cubre(usada, k));
      for (const k of hecha) usadas.set(k, huella);
    }
    // Se olvidan las de otras escenas: solo cuenta la actual.
    for (const [k, h] of usadas) if (h !== huella) usadas.delete(k);
    // Cuántos turnos seguidos lleva cada una a la vista en esta escena.
    const edad = (k) => { const v = vistasAntes.get(k); return v && v.h === huella ? v.n : 0; };
    // Dos turnos seguidos a la vista sin que el jugador la tome: descansa tres
    // turnos y vuelve si sigue valiendo. «Fijarte en la figura del tejado»
    // salía nueve turnos seguidos; y si caducaba hasta que cambiara la
    // escena, las vías de la trama («Avisar a Iando…») no volvían antes del
    // robo. Lo USADO sí espera a que cambie algo.
    const turno = this.leer('meta.turno', 0);
    const pausadas = new Map((this.leer('narrative.sugerenciasPausadas', []) ?? [])
      .filter((p) => p.h === huella && p.hasta > turno).map((p) => [p.k, p]));
    for (const [k, v] of vistasAntes) if (v.h === huella && v.n >= 2) pausadas.set(k, { k, h: huella, hasta: turno + 3 });
    const vistas = new Set();
    // En el orden de quien narra: la trama delante. Solo las tres que se
    // enseñan; si solo quedan dos útiles, dos, no una tercera de relleno.
    const opciones = (choices ?? []).filter((o) => {
      const k = clave(o.label);
      if (!k || vistas.has(k) || usadas.get(k) === huella || pausadas.has(k)) return false;
      vistas.add(k);
      return true;
    }).slice(0, 3);
    const enseñadas = opciones.map((o) => ({ k: clave(o.label), n: edad(clave(o.label)) + 1, h: huella }));
    this.despachar('narrative/opciones', { opciones, usadas: [...usadas].map(([k, h]) => ({ k, h })), vistas: enseñadas, pausadas: [...pausadas.values()] });
  }

  /** @private */
  _reducirLimpiar() {
    return { narrative: { entradas: [], opciones: [], escenaAbierta: true } };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUXILIARES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Situación circunstancial que modifica las tiradas.
   * @returns {string}
   * @private
   */
  _situacionActual() {
    const jugador = this.leer('player');

    // Estar al límite de vida es una situación adversa por sí misma.
    const fraccionVida = (jugador.vida?.actual ?? 1) / (jugador.vida?.max ?? 1);
    if (fraccionVida <= 0.2) return 'adversa';

    return 'neutra';
  }

  /**
   * Determina si un turno constituye un hito narrativo.
   *
   * Los hitos permiten al director conceder objetos de rareza alta. Se
   * reconocen por lo que ocurre, no por lo que el director diga que ocurre.
   *
   * @param {Object} respuesta
   * @returns {boolean}
   * @private
   */
  _esHito(respuesta) {
    if (respuesta.quests?.some((q) => q.action === 'complete')) return true;
    if (respuesta.sceneBreak) return true;

    const xp = respuesta.playerUpdates?.xp;
    const delta = typeof xp === 'object' ? xp.delta : xp;
    if (typeof delta === 'number' && delta >= 300) return true;

    return false;
  }

  /**
   * Traduce un evento del mundo a texto para la bitácora.
   * @param {Object} evento
   * @returns {string|null}
   * @private
   */
  _describirEvento(evento) {
    switch (evento.type) {
      case 'weather':
        return evento.payload?.descripcion ?? null;
      case 'discovery':
        return evento.payload?.texto ?? 'Has descubierto algo.';
      case 'npc_meet':
        return null;   // Ya viene narrado dentro de la historia.
      case 'faction':
        return evento.payload?.texto ?? null;
      default:
        return null;
    }
  }

  /**
   * Avisa de con quién ha hablado el jugador.
   *
   * Es lo que hace avanzar los objetivos «Hablar con…»: el evento
   * `npc:talked` se escuchaba desde siempre y no lo emitía nadie, así que
   * ninguno se había cumplido nunca. Si el narrador lo declara (`npc_talk`),
   * manda él; si no —un modelo no siempre lo hace—, se deduce de la frase.
   *
   * @private
   */
  _registrarConversacion(respuesta, tipo, accion) {
    const declarado = (respuesta.events ?? []).find((e) => e.type === 'npc_talk' && e.payload?.refId)?.payload;
    // «Busco a Dadar y le pregunto por el hierro» se lee como una búsqueda,
    // pero ha hablado con Dadar. Fuera del diálogo cuenta si hay un verbo de
    // hablar y se nombra a quien está delante; sin nombre, no se adivina.
    // «Cuento los guardias que hay junto a Xivio» no es hablar con Xivio.
    const deLaFrase = tipo === 'dialogo'
      ? this._aQuienSeHablo(accion)
      : (HABLA.test(sinAcentos(String(accion ?? '').toLowerCase())) && !leerRecuento(accion) ? this._aQuienSeHablo(accion, { soloNombrado: true }) : null);
    const npc = declarado ?? deLaFrase;
    if (npc?.refId) {
      this.emitir('npc:talked', { refId: npc.refId, nombre: npc.nombre });
      // Cuenta como encuentro: es lo que dice cuándo le vio por última vez.
      this.sistema('npcs')?.registrarEncuentro?.(npc.refId);
    }
    return npc?.nombre ? npc : null;
  }

  /**
   * Quien le ha hablado (o a quien ha hablado) en los dos últimos turnos y
   * sigue aquí. Sin nadie así, una orden suelta no tiene destinatario.
   * @returns {{refId: string, nombre: string}|null}
   * @private
   */
  _interlocutorReciente() {
    const turno = this.leer('meta.turno', 0);
    const conocidos = this.leer('npcs.conocidos.porId', {}) ?? {};
    return (this.leer('npcs.presentes', []) ?? [])
      .map((id) => conocidos[id])
      .filter((n) => n?.nombre && n.vivo !== false && Number.isFinite(n.ultimoEncuentro) && turno - n.ultimoEncuentro <= 2)
      .sort((a, b) => b.ultimoEncuentro - a.ultimoEncuentro)[0] ?? null;
  }

  /**
   * De los presentes, el nombrado en la frase; si solo hay uno, ese (salvo
   * que se pida solo el nombrado).
   * @private
   */
  _aQuienSeHablo(accion, { soloNombrado = false } = {}) {
    const conocidos = this.leer('npcs.conocidos.porId', {}) ?? {};
    const presentes = (this.leer('npcs.presentes', []) ?? []).map((id) => conocidos[id]).filter(Boolean);
    const frase = sinAcentos(String(accion ?? '').toLowerCase());
    const nombrado = presentes.find((n) => n.nombre && frase.includes(sinAcentos(n.nombre.toLowerCase())));
    if (nombrado || soloNombrado) return nombrado ?? null;
    return presentes.length === 1 ? presentes[0] : null;
  }

  /**
   * Aceptar, rechazar o proponerse algo, dicho con palabras.
   *
   * Antes un encargo solo se aceptaba con el botón del panel, y ni siquiera
   * se podía rechazar: se quedaba ofrecido para siempre. Un objetivo propio
   * no existía: solo había lo que el juego proponía.
   *
   * @param {string} texto
   * @returns {string|null} Lo que se narra, o null si no va de esto.
   * @private
   */
  _encargosPorTexto(texto) {
    const quests = this.sistema('quests');
    if (!quests) return null;
    const n = sinAcentos(String(texto ?? '').toLowerCase()).trim();

    const oferta = quests.ofrecidas?.().at(-1);
    if (oferta && RECHAZA.test(n)) {
      quests.rechazar(oferta.refId);
      const quien = oferta.nombreOrigen;
      return quien
        ? `${quien} se encoge de hombros. «Tú sabrás.» El encargo se queda sin dueño.`
        : 'Lo dejas estar. El encargo se queda sin dueño.';
    }
    if (oferta && ACEPTA.test(n)) {
      const r = quests.aceptar(oferta.refId);
      if (!r.aplicada) return null;
      const quien = oferta.nombreOrigen;
      return `${quien ? `${quien} asiente: trato hecho. ` : 'Trato hecho. '}Queda en tu diario: «${oferta.titulo}».`;
    }

    const meta = String(texto ?? '').trim().match(META);
    if (meta) {
      const lo = (meta[1] ?? meta[2]).trim();
      const m = quests.adoptarMeta(lo);
      if (!m) return null;
      // Solo los posesivos: «averiguar quién quemó la forja de mi padre» es
      // un infinitivo y se queda; «mi padre» pasa a «tu padre».
      const suyo = lo.replace(/\bmis\b/gi, 'tus').replace(/\bmi\b/gi, 'tu').replace(/[.\s]+$/u, '');
      return `Te lo propones en serio: ${suyo}. Queda apuntado entre tus objetivos.`;
    }
    return null;
  }

  /**
   * Resuelve una delegación: el compañero actúa y el jugador observa.
   *
   * `quien` es un nombre o «mi compañera»: se busca en el grupo, y si no,
   * entre los presentes. La tirada es la del compañero; la narración no
   * atribuye nada al jugador.
   *
   * @param {{quien: string, delegado: string}} d
   * @returns {{nombre: string, tirada: Object|null, narracion: string, eco: string}|null}
   * @private
   */
  _delegar(d) {
    const miembros = (this.sistema('party')?.miembros?.() ?? []).map((m) => m.ficha).filter(Boolean);
    const q = sinAcentos(String(d.quien ?? '').toLowerCase());
    let quien = miembros.find((f) => q.includes(sinAcentos(String(f.nombre).toLowerCase())));
    if (!quien && /^mi\s/.test(q)) {
      const femenino = /a$/.test(q);
      quien = miembros.find((f) => (femenino ? f.genero === 'f' : f.genero !== 'f')) ?? miembros[0];
    }
    if (!quien?.nombre) return null;

    const verbo = sinAcentos(String(d.delegado ?? '').toLowerCase());
    const habilidad = /negoci|habl|convenz|pregunt|pid|regate|trat/.test(verbo) ? 'trato_social'
      : /vigil|mir|observ|busq|registr|rastre/.test(verbo) ? 'percepcion'
        : /cur|vend/.test(verbo) ? 'medicina'
          : /amenac|intimid/.test(verbo) ? 'intimidacion'
            : 'trato_social';
    const tirada = this.sistema('rules')?.resolver({ habilidad, umbral: 'moderada' }) ?? null;

    // Con quién: el que nombra la orden («negocie con Mara»); si no nombra a
    // nadie, el primero de los presentes que no sea el propio compañero.
    const conocidos = this.leer('npcs.conocidos.porId', {}) ?? {};
    const presentes = (this.leer('npcs.presentes', []) ?? []).map((id) => conocidos[id])
      .filter((n) => n?.nombre && n.nombre !== quien.nombre);
    const otro = presentes.find((n) => verbo.includes(sinAcentos(n.nombre.toLowerCase()))) ?? presentes[0];
    const conQuien = otro?.nombre ?? 'el otro';
    const nom = quien.nombre;
    const bien = Boolean(tirada?.exito);

    // Lo que se cuenta depende de lo que se le ha pedido: vigilar no se
    // narra como una negociación.
    const NARRAR = {
      trato_social: [`${nom} toma la palabra con calma. ${conQuien} escucha, duda y acaba cediendo algo de terreno.`,
        `${nom} lo intenta, pero ${conQuien} no se deja llevar y la cosa se queda donde estaba.`],
      percepcion: [`${nom} se aposta sin hacer ruido y no quita ojo: si pasa algo, lo verá antes que tú.`,
        `${nom} se pone a ello, pero se le escapa más de lo que debería.`],
      medicina: [`${nom} se arrodilla y hace lo que puede con manos de quien sabe.`,
        `${nom} lo intenta, pero no consigue gran cosa.`],
      intimidacion: [`${nom} da un paso al frente y ${conQuien} retrocede.`,
        `${nom} alza la voz, pero ${conQuien} no se inmuta.`],
    };
    const [ok, mal] = NARRAR[habilidad] ?? [`${nom} se encarga, y sale bien.`, `${nom} se encarga, pero no sale como esperabas.`];
    const narracion = bien ? ok : mal;

    return { nombre: quien.nombre, tirada, narracion, eco: `dejo que ${quien.nombre} ${d.delegado} y observo` };
  }

  /**
   * Apunta lo que el jugador se niega a hacer, y quién lo oyó.
   *
   * «Le digo a Mara: "No os entregaré la llave"» queda como hecho de la
   * partida y en la memoria de Mara, para que al volver a verla lo recuerde.
   *
   * @returns {{nombre: string, refId: string, actitud: number, cita: string}|null}
   * @private
   */
  _registrarNegativas(plan, turno) {
    const seg = plan.hechos.find((x) => x.negativa);
    if (!seg) return null;
    const npc = this._aQuienSeHablo(seg.texto);
    if (!npc?.refId) return null;

    const cita = seg.texto.match(/«[^»]*»|"[^"]*"|“[^”]*”/u)?.[0] ?? `«${seg.texto}»`;
    const jugador = this.leer('player.nombre', 'El personaje');
    this.memoria.recordar(`${jugador} se negó ante ${npc.nombre}: ${cita}`, { turno, peso: 3 });
    this.sistema('npcs')?.recordar?.(npc.refId, `Se negó: ${cita}`, { tipo: 'negativa', peso: 3 });
    return { nombre: npc.nombre, refId: npc.refId, actitud: npc.actitud ?? 0, cita };
  }

  /**
   * Anota un cambio de canon que el jugador hace fuera de la historia.
   *
   * La edición se guarda entera, con su procedencia (el jugador) y su
   * turno, y se divide en hechos (ver `ai/narrador/Canon.js`): una
   * corrección revisa solo el hecho que corrige. Si no está claro de quién
   * habla o qué corrige, no se adivina: se pregunta, o se guardan las dos
   * versiones marcadas en conflicto. No es un turno: el mundo no avanza.
   *
   * @param {string} texto
   * @returns {{canon: string, revisada: boolean, resultado: string}}
   * @private
   */
  _editarCanon(texto) {
    // Entero, sin recortar: es su universo.
    const r = anotar(this.memoria.registroCanon, texto, { turno: this.leer('meta.turno', 0), fuente: 'jugador' });
    this.memoria.registroCanon = r.registro;
    this.store.fijar('ai.memoria', this.memoria.serializar());
    this._anadirEntrada(VOCES.SISTEMA, mensajeDeEdicion(r));
    return { canon: r.edicion.texto, revisada: r.revisados.length > 0, resultado: r.edicion.resultado };
  }

  /**
   * Un turno que se resuelve sin dados ni director: se narra y se cierra.
   * @private
   */
  async _turnoLocal(numeroTurno, texto, { voz = VOCES.SISTEMA } = {}) {
    const final = voz === VOCES.DM ? this._cerrarTurno(texto) : texto;
    this._anadirEntrada(voz, final, { turno: numeroTurno });
    await this.sistema('clock').turno({ tipo: 'exploracion' });
    this.store.descartarInstantanea('turno');
    return { turno: numeroTurno, local: true };
  }

  /**
   * Mete unas líneas justo antes de la pregunta final, si la hay.
   * @private
   */
  _antesDeLaPregunta(texto, lineas) {
    const t = String(texto ?? '').trimEnd();
    if (!terminaEnPregunta(t)) return `${t}\n${lineas}`;
    const partes = t.split('\n');
    const pregunta = partes.pop();
    return [...partes, lineas, pregunta].join('\n');
  }

  /**
   * Cierra una narración con la pregunta de mesa.
   *
   * @param {string} texto
   * @param {string} [propuesta] La que trae el modelo, si trae.
   * @param {{nombre: string}|null} [interlocutor] Con quién ha hablado el jugador este turno.
   * @returns {string}
   * @private
   */
  /**
   * Si después de lo que dijo el interlocutor aparece otro de los presentes,
   * la escena ya no está en él: el guardia llega preguntando «¿Viste algo?»
   * y cerraba «Cormir espera tu respuesta», con Cormir mudo desde hacía dos
   * frases.
   *
   * @param {string} texto
   * @param {{nombre: string}|null} interlocutor
   * @returns {boolean}
   * @private
   */
  _otroTomaLaPalabra(texto, interlocutor) {
    const suyo = interlocutor?.nombre;
    if (!suyo) return false;
    const t = String(texto ?? '');
    const desde = t.lastIndexOf(suyo);
    if (desde < 0) return false;
    const resto = t.slice(desde + suyo.length);
    return (this.leer('npcs.presentes', []) ?? [])
      .map((id) => this.leer(`npcs.conocidos.porId.${id}.nombre`))
      .some((otro) => otro && otro !== suyo && resto.includes(otro));
  }

  _cerrarTurno(texto, propuesta, interlocutor = null) {
    const pregunta = String(propuesta ?? '').trim() || this._preguntar(interlocutor);
    this._ultimaPregunta = pregunta;
    this._preguntasRecientes = [...(this._preguntasRecientes ?? []), pregunta].slice(-8);
    return cerrarConPregunta(texto, pregunta);
  }

  /**
   * Elige la pregunta según la escena.
   *
   * Solo se nombra a quien el jugador se ha dirigido en este turno. Se nombraba
   * al primero de los presentes: tras hablar con la posadera cerraba «Ulket te
   * mira, esperando», y tras un viaje «Ulket espera tu respuesta», aunque Ulket
   * no hubiera dicho nada. Esperar una respuesta es de quien ha preguntado.
   *
   * @param {{nombre: string}|null} [interlocutor]
   * @returns {string}
   * @private
   */
  _preguntar(interlocutor = null) {
    const npcs = interlocutor?.nombre ? [interlocutor] : [];
    const enemigos = this.leer('combat.activo', false)
      ? Object.values(this.leer('combat.combatientes', {}) ?? {}).filter((c) => c.bando === 'enemigo' && c.vida?.actual > 0)
      : [];

    const flujo = this.rng?.flujo?.('narrativa');
    // Lo que está pasando, si el jugador no lo ha dejado de lado a propósito.
    const sit = enemigos.length ? null : this.sistema('situations')?.paraContexto?.();
    // Y no si se recordó hace menos de cuatro turnos: una vez sirve de
    // recordatorio; cada dos, de muletilla.
    const turno = this.leer('meta.turno', 0);
    const reciente = turno - (this._temaTurno ?? -99) < 4;
    const tema = sit && !sit.ignoradaAProposito && !reciente ? sit.tema : null;
    const pregunta = preguntaDeMesa(
      { npcs, enemigos, franja: this.leer('world.tiempo.franja'), tema, temaVez: this._temaVeces ?? 0 },
      { anterior: this._ultimaPregunta, recientes: this._preguntasRecientes ?? [], elegir: (lista) => flujo?.elegir(lista) ?? lista[0] },
    );
    const nucleo = String(tema ?? '').toLowerCase().replace(/^(?:el|la|los|las|lo)\s+/, '');
    if (tema && pregunta.toLowerCase().includes(nucleo)) {
      this._temaTurno = turno;
      this._temaVeces = (this._temaVeces ?? 0) + 1;
    }
    return pregunta;
  }

  /**
   * @param {boolean} bloqueada
   * @private
   */
  _bloquearEntrada(bloqueada) {
    this.store.fijar('ui.entradaBloqueada', bloqueada);
    this.store.fijar('ui.pensando', bloqueada);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     API PÚBLICA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Arranca la crónica con un turno de apertura.
   *
   * Se invoca tras crear el personaje. No hay acción del jugador: el director
   * abre la escena.
   *
   * @returns {Promise<void>}
   */
  async abrirCronica() {
    if (this._ocupado) return;

    this._ocupado = true;
    this._bloquearEntrada(true);

    try {
      // La apertura NO crea ni presenta una misión sacada del pasado del
      // personaje. Lo hacía: la biografía se convertía en «busca al culpable,
      // está en Saucedo» y la campaña quedaba decidida antes de jugar. Ahora
      // se abre una escena del mundo con algo que atender o ignorar, y el
      // pasado es canon que vuelve cuando el jugador lo busca.
      // Algo está pasando donde empieza: una escena del mundo, con gente y
      // más de una salida. Entra como nota de escena, igual que un encuentro.
      const situaciones = this.sistema('situations');
      const yaHay = situaciones?.aqui?.()[0];
      const situacion = yaHay
        ? { ...yaHay, texto: situaciones.paraContexto()?.texto }
        : situaciones?.abrir?.() ?? null;
      if (situacion?.texto) this.memoria.anotarContexto(`EN ESCENA: ${situacion.texto}`, { temporal: true });

      const peticion = {
        accion: '',
        intencion: { tipo: 'custom', requiereTirada: false, confianza: 1 },
        tirada: null,
        tipo: 'narracion',
        turno: 1,
        contexto: this._compositor.componerEstructurado({ accion: '', tipo: 'narracion' }),
      };

      if (this._idDirector() !== PROVEEDORES.PROCEDURAL) {
        const compuesto = this._compositor.componer({ accion: '', tipo: 'narracion' });
        peticion.instantanea = this._instantanea(peticion, '');
        peticion.instantanea.jugador.notaDelMotor = 'PRIMER TURNO: abre la crónica con una escena viva y concreta del mundo: el lugar, la hora, quién hay y lo que está pasando (enEscenaAhora). No es un encargo ni una misión y el jugador puede ignorarlo. No abras con el pasado del personaje. Termina devolviendo la palabra.';
        peticion.idTurno = 'p' + String(this.leer('meta.id', null) ?? this.leer('meta.semilla', 0)).slice(-12) + '-t1';
        peticion.prompt = `${compuesto.texto}\n\nESTE ES EL PRIMER TURNO. Abre la crónica con una escena viva y concreta del mundo: el lugar, la hora, quién hay y algo que está pasando y admite más de una respuesta (hablar, mirar, intervenir, marcharse). No es un encargo ni una misión, y el jugador puede ignorarlo. No abras con el pasado del personaje ni lo conviertas en el motivo de la escena: puede colorear un detalle, nada más. Termina devolviendo la palabra.`;
      }

      let resultado;
      try {
        resultado = await this.director.dirigir(peticion);
      } finally {
        this.memoria.consumirContexto();
      }
      if (![PROVEEDORES.PROCEDURAL, 'minimo'].includes(resultado.proveedor)) {
        const filtro = await filtrarModelo({ resultado, peticion, leer: (r, d) => this.leer(r, d), proveedor: this.director?.proveedor?.(resultado.proveedor) ?? null });
        if (filtro.caer) {
          const interno = this.director?.proveedor?.(PROVEEDORES.PROCEDURAL) ?? this._respaldo;
          resultado = { ...(await interno.dirigir(peticion)), degradado: true, motivoRespaldo: filtro.motivo };
        } else {
          resultado.respuesta = filtro.respuesta;
        }
      }
      this._anotarNarrador(resultado);
      const validacion = validarRespuesta(resultado.respuesta);
      const respuesta = validacion.valida ? validacion.respuesta : resultado.respuesta;

      let story = respuesta.story;
      story = this._cerrarTurno(story, respuesta.pregunta);

      this._anadirEntrada(VOCES.DM, story, { turno: 1, escenaAbierta: true });
      this._fijarOpciones(respuesta.choices ?? []);

      this.memoria.registrarTurno({
        numero: 1,
        accion: '(inicio)',
        narracion: story,
        mood: respuesta.mood,
      });

      this.store.fijar('meta.fase', 'exploracion');

    } finally {
      this._ocupado = false;
      this._bloquearEntrada(false);
    }
  }

  /** @returns {boolean} */
  get ocupado() {
    return this._ocupado;
  }

  /**
   * Estado serializable de la memoria del director.
   * @returns {Object}
   */
  serializar() {
    return { memoria: this.memoria.serializar() };
  }

  /** @param {Object} datos */
  restaurar(datos) {
    if (datos?.memoria) Object.assign(this.memoria, datos.memoria);
  }

  /**
   * Estado del resolutor, para depuración.
   * @returns {Object}
   */
  inspeccionar() {
    return {
      ocupado: this._ocupado,
      turno: this.leer('meta.turno', 0),
      director: this.director?.inspeccionar() ?? null,
      memoria: this.memoria.inspeccionar(),
    };
  }
}

export default TurnResolver;
