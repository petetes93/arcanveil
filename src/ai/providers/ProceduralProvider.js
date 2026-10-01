/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · ai/providers/ProceduralProvider.js
 * ---------------------------------------------------------------------------
 * Director de juego interno. Sin IA, sin red, sin claves.
 *
 * Es la pieza que garantiza que ARCANVEIL sea un juego completo por sí mismo.
 * También es el respaldo al que caen todos los demás proveedores cuando fallan.
 *
 * Cómo narra: no elige frases de una lista, COMPONE. Cada turno se ensambla a
 * partir de piezas independientes —resultado de la acción, atmósfera del lugar,
 * momento del día, un detalle, una consecuencia— y la combinatoria produce
 * variedad real. Las mismas mil frases dan cien mil turnos distintos.
 *
 * Qué no puede hacer: sorprender de verdad. No inventará una trama que nadie
 * previó. Pero mantiene coherencia, recuerda lo que pasó, retoma hilos abiertos
 * y responde a lo que el jugador hace. Para una partida entera, basta.
 *
 * Dependencias: IDMProvider, narrative.templates, datos, config.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { IDMProvider } from './IDMProvider.js';
import {
  atmosferaDe, atmosferaInterior, resultadosDe, categoriaDe,
  FRANJA, CLIMA, COMBATE, NPC, OPCIONES, CIERRES,
} from '../../data/narrative.templates.js';
import { APP } from '../../config/app.config.js';
import { capitalizar, trasPreposicion, sinAcentos, seguirFrase } from '../../utils/text.js';
import { aSegundaPersona, esPrimeraPersona } from '../Persona.js';
import { obtenerLugar } from '../../data/locations.data.js';
import * as Cadencia from '../Cadencia.js';
import { comentario } from '../../npc/Companero.js';
import { queSabe, responder } from '../narrador/Conocimiento.js';
import { rasgosDe, buscarRasgo, rasgoGeneral } from '../../data/rasgos.data.js';
import { LUGARES } from '../../data/locations.data.js';
import { ruta as rutaMapa } from '../../world/MapGraph.js';
import { horasDichas } from '../narrador/Conocimiento.js';
import { actoDeHabla, ACTO } from '../../engine/ActoDeHabla.js';
import { separarVocativo } from '../../engine/Segmentos.js';
import { intento } from '../../engine/Infinitivo.js';
import { COTAS_IA } from '../../config/balance.config.js';

const minuscula = (t) => seguirFrase(t);

/** El cielo que hay, dicho desde el clima y la hora del mundo. */
function cieloDe(mundo = {}) {
  const clima = {
    despejado: 'limpio, sin una nube', nublado: 'cubierto de nubes bajas', lluvia: 'gris y cargado de lluvia', llovizna: 'gris, con una llovizna fina',
    tormenta: 'negro de tormenta', niebla: 'borrado por la niebla', nieve: 'blanco, soltando nieve', viento: 'barrido por el viento',
  }[mundo.clima] ?? 'como siempre por aquí';
  const hora = { madrugada: 'Aún no ha amanecido', amanecer: 'Está amaneciendo', manana: 'Es media mañana', mediodia: 'Es mediodía', tarde: 'Es por la tarde', atardecer: 'Está atardeciendo', noche: 'Es de noche' }[mundo.franja] ?? '';
  return `El cielo está ${clima}.${hora ? ` ${hora}.` : ''}`;
}

/** Lo que hace cada oficio mientras nadie le habla: se ve al mirar a la gente. */
const ACTIVIDAD = Object.freeze({
  herrero: '{n} saca una herradura al rojo y la mete en el barril: el vapor sube hasta el alero.',
  herrera: '{n} saca una herradura al rojo y la mete en el barril: el vapor sube hasta el alero.',
  tendero: '{n} cuenta sacos detrás del mostrador y vuelve a contarlos.',
  tendera: '{n} cuenta sacos detrás del mostrador y vuelve a contarlos.',
  mercader: '{n} recoloca la mercancía para que se vea lo caro primero.',
  lavandera: '{n} pasa con un cesto de ropa mojada apoyado en la cadera.',
  guardia: '{n} mira a todo el que cruza como si le debiera algo.',
  posadero: '{n} barre la puerta de la posada sin quitar ojo a la calle.',
  posadera: '{n} barre la puerta de la posada sin quitar ojo a la calle.',
  carretero: '{n} revisa las correas del tiro, una por una.',
  pastor: '{n} lleva una vara larga y la mirada puesta en otra parte.',
});

/** Notas de escena que se pueden narrar tal cual: están escritas para el jugador. */
const PARA_EL_JUGADOR = /^(?:EN ESCENA|HA CAMBIADO DESDE LA ÚLTIMA VISITA):/;

/** Preguntar a alguien qué le ha pasado o cómo sigue, en llano. */
const QUE_PASO = /\bque (?:te |le |os |les )?(?:ha |han )?(?:pasado|ocurrido|sucedido|hecho)\b|\bque (?:te |le )?paso\b|\bque ha sido\b|\bestas bien\b|\bque tal (?:sigue|sigues|esta|estas)\b|\bcomo (?:sigue|sigues|estas)\b/;

export class ProceduralProvider extends IDMProvider {
  static id = 'procedural';
  static nombre = 'Director procedural';
  static autonomo = true;

  constructor(opciones = {}) {
    super(opciones);

    /**
     * Fragmentos usados recientemente, para no repetirse.
     *
     * Sin esto, la aleatoriedad pura repite la misma frase cada pocos turnos y
     * el efecto se rompe de inmediato.
     * @type {Set<string>}
     * @private
     */
    this._usados = new Set();

    /** Tamaño de la ventana antirrepetición. @private */
    this._ventana = 24;

    /**
     * Memoria por familia de frases.
     *
     * La ventana global de arriba no bastaba, y se veía jugando: en ocho
     * turnos, la misma reacción del acompañante salió cuatro veces palabra por
     * palabra. La razón es que `_usados` mezcla todas las familias y un turno
     * gasta cinco o seis frases de familias distintas, así que una familia de
     * tres opciones queda «limpia» a los pocos turnos. Peor: cuando las tres
     * estaban marcadas, el filtro se quedaba sin candidatas y caía a la lista
     * entera, es decir, podía repetir justo la que acababa de decir.
     *
     * Con una cola por familia se recorren todas las opciones antes de que
     * ninguna vuelva. Es lo mínimo que se le pide a un narrador: que no repita
     * teniendo más cosas que decir.
     *
     * @type {Map<string, string[]>}
     * @private
     */
    this._porFamilia = new Map();
  }

  /** El director interno siempre está listo. */
  comprobar() {
    return { listo: true, motivo: null };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     GENERACIÓN
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Produce el turno completo.
   *
   * @param {import('./IDMProvider.js').PeticionTurno} peticion
   * @returns {Promise<import('./IDMProvider.js').RespuestaTurno>}
   * @protected
   */
  async generar(peticion) {
    // Una latencia mínima evita que el texto aparezca de golpe, lo que resulta
    // desconcertante después de haber esperado en otros proveedores.
    await this._latencia();

    const ctx = peticion.contexto ?? {};

    // Una partida nueva o cargada empieza en un turno anterior: lo que este
    // narrador recuerda de la otra (qué describió, cuándo usó la antesala)
    // no vale aquí. Sin esto, «miro alrededor» al empezar otra partida
    // contestaba «Nada ha cambiado desde la última vez que miraste».
    const turno = peticion.turno ?? ctx.turno ?? 0;
    if (turno < (this._turnoVisto ?? -1)) {
      this._descritos = new Map();
      this._sinCambio = new Set();
      this._situacionesVistas = new Set();
      this._ultimaAntesala = null;
    }
    this._turnoVisto = turno;

    switch (peticion.tipo) {
      case 'combate': return this._turnoCombate(peticion, ctx);
      // Si el motor ya ha resuelto lo que pasa (hablar con la patrulla que
      // corta el paso, ayudar con el carro), eso es la escena: el diálogo
      // genérico contestaba en boca del primer vecino presente.
      case 'dialogo': return this._enriquecer(peticion, ctx, ctx.situacionResultado
        ? this._turnoNarrativo(peticion, ctx)
        : this._turnoDialogo(peticion, ctx));
      default: return this._enriquecer(peticion, ctx, this._turnoNarrativo(peticion, ctx));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INTEGRAR AL JUGADOR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Hace que el turno responda a lo que el jugador escribió.
   *
   * La acción se devuelve en segunda persona como arranque («Te acercas al
   * barquero y le enseñas el medallón»), quien esté presente reacciona, el
   * relato nunca queda en una sola línea y las sugerencias nombran lo que
   * hay en escena.
   * @private
   */
  _enriquecer(peticion, ctx, r) {
    // Los cierres tipo «Tú dirás.» sobran: la caja de texto ya invita a actuar.
    const parrafos = String(r.story ?? '').split(/\n\n+/).filter(Boolean)
      .filter((p) => !CIERRES.includes(p.trim()))
      // La cita literal de la intención se sustituye por la narración en segunda persona.
      .filter((p) => !(peticion.accion && /^(Pones en práctica tu idea|Sin apartar la vista|No dudas más)/.test(p)));
    const accion = String(peticion.accion ?? '').trim();

    if (accion) {
      const directo = this._ecoDirecto(accion, ctx);
      let frase = directo ?? capitalizar(aSegundaPersona(accion)).replace(/[.!?…]*$/u, '.');
      // Un intento que falla o que es imposible no se cuenta como hecho:
      // «Saltas 100 metros hasta el tejado» y después que no. Se narra el
      // intento, «Intentas saltar…», y el resultado lo pone la tirada.
      // Mirar o buscar sí se hace aunque falle la tirada: lo que decide es
      // cuánto se ve, no si se mira. «Intentas mirar el cielo» sobraba.
      const mirar = ['observe', 'search'].includes(peticion.intencion?.tipo);
      const fallido = peticion.ambicion === 'desmedida' || (peticion.tirada && !peticion.tirada.exito && !mirar);
      const conativo = !directo && fallido ? intento(accion) : null;
      if (conativo) frase = capitalizar(aSegundaPersona(conativo));
      // Lo desmedido se narra como intento, con el límite dentro de la historia.
      // El intento va solo y el límite justo detrás: lo primero del relato
      // ya no es un resultado de tirada, y pegado al intento salía «Intentas
      // saltar 50 metros. La mañana está entrada…» antes de saber qué pasa.
      if (peticion.ambicion === 'desmedida') {
        if (!conativo) frase = `${frase.replace(/\.$/, '')}: esa es tu intención, y la empuñas con todo lo que tienes.`;
        parrafos.unshift('');
        parrafos.splice(1, 0, this._unico([
          'Pero el mundo es más grande que tus fuerzas. El impulso se quiebra a medio camino y te deja jadeando, con los brazos temblando y la certeza de que aún no eres quien necesitas ser para algo así.',
          'Durante un instante parece posible. Luego la realidad pesa más que tu voluntad: el golpe se pierde, el eco se apaga y solo queda tu respiración, rápida, y las miradas de quien lo haya visto.',
          'Algo responde, muy lejos, como si el mundo hubiera notado el intento. Pero no cede. Todavía no. Quizá algún día, con más camino a la espalda.',
        ]));
      }
      const primera = parrafos[0] ?? '';
      // Las plantillas cortas de acción («Te pones en marcha.») sobran cuando
      // ya se narra lo que el jugador escribió.
      // Lo que ha resuelto el motor (el desenlace de un encuentro, lo que
      // pasa en una situación) nunca es plantilla, por corto que sea:
      // «Pones tierra de por medio.» se sustituía por el eco y se perdía.
      // Y el resultado de una tirada tampoco: «Lo consigues a duras penas» es
      // lo que ha pasado, y se perdía detrás de «Intentas trepar al tejado».
      // En un diálogo, lo primero es lo que hace o dice quien te escucha:
      // «Dalvane asiente y vuelve a lo suyo» era corto y sin comillas, y se
      // perdía detrás de «Le dices a Dalvane: «Déjame en paz»».
      const plantilla = peticion.tipo !== 'dialogo' && !ctx.situacionResultado && !peticion.tirada && primera.length < 60 && !primera.includes('«');
      parrafos[0] = plantilla ? frase : `${frase} ${primera}`.trim();
    }

    // Lo que el motor ha preparado para esta escena va justo detrás de la
    // acción y por delante de todo lo demás.
    //
    // El orden es la mitad del trabajo: si hay un carro volcado cortando el
    // paso, eso ES la escena, y el trigo moviéndose con el viento es decorado.
    // Enterrar el encuentro bajo dos párrafos de ambiente lo convierte en una
    // nota al pie de algo que no está pasando.
    const escena = this._narrarEscena(ctx);
    // Tras un imposible, primero dónde acaba el intento y después la escena:
    // metida en medio, parecía que la escena reaccionaba al salto.
    if (escena) parrafos.splice(peticion.ambicion === 'desmedida' ? 2 : 1, 0, escena);

    // Lo que nombró y aquí no hay: se dice, justo detrás de lo que sí hizo.
    for (const a of [...(ctx.aclaraciones ?? [])].reverse()) parrafos.splice(1, 0, a);

    // Las gracias o la despedida de paso («doy las gracias a Kordan y sigo mi
    // camino») tienen respuesta aunque el turno sea otra cosa: salían al aire.
    if (peticion.tipo !== 'dialogo') {
      const cortesia = (ctx.interpretacion?.segmentos ?? []).find((s) => [ACTO.AGRADECER, ACTO.DESPEDIRSE].includes(s.acto?.acto));
      const quien = cortesia && (ctx.npcsPresentes ?? []).find((p) => p?.nombre && sinAcentos(cortesia.texto.toLowerCase()).includes(sinAcentos(p.nombre.toLowerCase())));
      if (quien && !String(r.story ?? '').includes(quien.nombre)) {
        const aprecio = typeof quien.actitud === 'number' ? quien.actitud : 0;
        parrafos.push(aprecio <= -20 ? `${quien.nombre} ni levanta la vista.` : this._unico([`${quien.nombre} levanta la mano mientras te alejas.`, `«Buen camino», te dice ${quien.nombre}.`]));
      }
    }

    // Quien está en escena no se queda de piedra... pero tampoco comenta que
    // bebas agua.
    //
    // Antes reaccionaba en TODOS los turnos. Con tres frases rotando, en doce
    // turnos cada una salía cuatro veces, y el acompañante pasaba de estar
    // vivo a ser un tic. El problema no era la falta de frases: era que no
    // callaba nunca. Un acompañante de verdad mira cuando hay algo que mirar.
    //
    // Reacciona si ha pasado algo —hay escena, o la tirada salió redonda o
    // desastrosa— y si no, una de cada tres veces.
    // Solo reacciona quien tiene que ver con la acción: el que se nombra en
    // ella. Antes era el primero de los presentes, hubiera pasado lo que
    // hubiera pasado, y un gesto inventado a un tercero no es el mundo
    // reaccionando: es relleno.
    const nombrada = String(peticion.accion ?? '').toLowerCase();
    const npc = (ctx.npcsPresentes ?? []).find((n) => n?.nombre && nombrada.includes(n.nombre.toLowerCase()));
    const tir = peticion.tirada;
    const mereceLaPena = Boolean(escena) || Boolean(tir?.critico) || Boolean(tir?.pifia);

    // Tras una negativa ya ha reaccionado quien la oyó: otro gesto suyo
    // debajo la repetía con otras palabras.
    // Una reacción sin contenido («no te quita ojo», «ha tomado nota») no es
    // el mundo reaccionando: es relleno, y se aprendía a saltar en tres
    // turnos. Solo reacciona quien tiene motivo: un crítico o una pifia
    // delante de él.
    if (accion && npc?.nombre && !ctx.negativa && !String(r.story).includes(npc.nombre) && mereceLaPena && (tir?.critico || tir?.pifia)) {
      parrafos.push(tir.critico
        ? `${npc.nombre} lo ha visto, y no lo esperaba de ti.`
        : `${npc.nombre} lo ha visto. No se ríe, pero le cuesta.`);
    }

    // El relleno existe para que un turno no quede desnudo, no para alargar
    // uno que ya dice algo.
    //
    // El tope pasa de tres párrafos a dos, y la atmósfera se corta a una sola
    // frase. Casi todas las respuestas terminaban con dos o tres frases de
    // adorno —«Una bandada cruza el cielo en formación cerrada», «Algo cruje a
    // tu espalda y no hay nada cuando te giras»— que el jugador aprende a
    // saltarse en cuatro turnos. Una frase se lee; tres son ruido.
    const conContenido = Boolean(escena) || parrafos.length >= 2;

    // Un turno corto puede quedarse corto. Antes se rellenaba con atmósfera o
    // con un suceso de catálogo («Un gato salta de un barril») para que no
    // quedara desnudo, y eso era lo que más se repetía. Solo se trae lo que
    // el jugador ha construido o un hilo suyo que venga a cuento; si no hay,
    // silencio.
    if (!conContenido && parrafos.length < 2) {
      // Se comprueba que el canon no haya salido ya arriba, en `_turnoNarrativo`:
      // sin esto podía aparecer dos veces en el mismo turno, y un recuerdo
      // repetido dos párrafos más abajo deja de ser un recuerdo.
      const yaSalio = (ctx.canon ?? []).some((c) => parrafos.some((p) => p.includes(c.nombre)));
      const suyo = yaSalio ? '' : this._traerDelCanon(ctx, peticion.accion);
      const hilo = this._hiloPertinente(ctx);

      if (suyo) parrafos.push(suyo);
      else if (hilo) parrafos.push(this._recordarHilo(hilo, ctx));
    }

    // El turno se monta por golpes, no por párrafos.
    //
    // Antes esto era `parrafos.join('\n\n')`: cuatro o cinco frases apelmazadas
    // en dos bloques. Se leen de un vistazo y se olvidan igual, porque todo
    // pesa lo mismo: una pifia y el viento en el trigo ocupaban el mismo sitio
    // y sonaban igual.
    //
    // Una frase por línea, y el silencio entre ellas hace de puntuación. Como
    // la interfaz ya escribe línea a línea y con pausa, la máquina de escribir
    // deja de ser un adorno y pasa a marcar el tiempo.
    const t = peticion.tirada;

    // ─── Una negativa tiene respuesta ───────────────────────────────────
    // Quien la oye reacciona desde lo que siente por él, sin que el
    // narrador haga ceder al jugador ni le ponga otras palabras.
    if (ctx.negativa?.nombre) {
      const { nombre, actitud = 0 } = ctx.negativa;
      const reaccion = actitud >= 30
        ? `${nombre} asiente despacio. No le gusta, pero lo respeta.`
        : actitud <= -20
          ? `${nombre} entorna los ojos. «Te vas a arrepentir de eso.»`
          : `${nombre} aprieta los labios. No insiste, pero tampoco se va.`;
      parrafos.splice(1, 0, reaccion);
    }

    // ─── Lo que queda en el aire ────────────────────────────────────────
    // Lo condicional no ha pasado: se deja dicho y se devuelve la palabra.
    for (const x of ctx.pendientes ?? []) {
      // La condición la escribe el jugador en primera persona: «si el
      // herrero me sigue mirando» es «si el herrero te sigue mirando».
      if (x.condicion) parrafos.push(`Queda en el aire lo que harás si ${aSegundaPersona(x.condicion)}.`);
    }

    // ─── Lo que dice el grupo ───────────────────────────────────────────
    // Con la misma regla que el resto del adorno: solo cuando pasa algo, o
    // uno de cada tres turnos. Un compañero que comenta todo es ruido. Habla
    // uno cada vez, por turnos, y los heridos callan.
    const grupo = (ctx.grupo ?? []).filter((c) => !c.herido);
    const turnoActual = peticion.turno ?? ctx.turno ?? 0;
    if (grupo.length && (escena || t?.critico || t?.pifia || turnoActual % 3 === 0)) {
      const quien = grupo[turnoActual % grupo.length];
      parrafos.push(comentario(quien, ctx.misionEnCurso, (lista) => this._unico(lista)));
    }

    // UN golpe por turno, y nunca dos seguidos.
    //
    // El sonido y la antesala hacen lo mismo —parar el ojo— así que puestos
    // juntos se anulan: salía «BUM.» y debajo «Hasta que...», dos frenos
    // pegados que dejan de frenar. Se elige el que corresponde.
    //
    // El sonido es para el golpe físico: un crítico, una pifia. Una escena que
    // se abre no suena, se anuncia, y para eso está la antesala. «BUM» delante
    // de un carro volcado es ruido en el sentido literal.
    //
    // Y nunca detrás de palabras. Preguntar al tabernero por el incendio acabó
    // en «CRACK.» porque la tirada social salió crítica, y un sonido de golpe
    // detrás de un diálogo no significa nada. Hablar, recordar y mirar no
    // suenan, salgan como salgan.
    const sinSonido = peticion.tipo === 'dialogo'
      || ['social', 'saber', 'mirada'].includes(categoriaDe(t?.habilidad));
    const golpe = sinSonido ? '' : t?.critico ? 'critico' : t?.pifia ? 'pifia' : '';

    return {
      ...r,
      story: Cadencia.montar(parrafos, {
        golpe,
        // La antesala se gana: solo cuando de verdad gira algo, y solo si no
        // hay sonido. Puesta en cada turno se convierte en muletilla y deja de
        // anunciar nada.
        // Y con aire entre una y otra: en seis partidas medidas salía «Y
        // entonces...» catorce veces, cada vez que el reloj de una situación
        // daba un paso.
        antesala: !golpe && Boolean(escena) && this._antesalaLibre(turnoActual),
        elegir: (lista) => this._unico(lista),
      }),
      choices: this._sugerenciasDeEscena(ctx, r.choices ?? [], turnoActual),
    };
  }

  /**
   * Tres sugerencias que nombran lo que hay en escena: la persona presente,
   * un rincón del lugar y el hilo personal del jugador.
   * @private
   */
  _sugerenciasDeEscena(ctx, base, turno = ctx.turno ?? 0) {
    const lugar = obtenerLugar(ctx.mundo?.ubicacion);
    const presentes = (ctx.npcsPresentes ?? []).filter((n) => n?.nombre);
    const sit = ctx.situacion;

    const candidatas = [];

    // La escena primero: lo que está pasando, quien está delante y el sitio.
    // Antes iban por delante sugerencias sacadas del pasado del personaje
    // («Preguntar a Torlin por tu padre», «Enseñar el medallón»): la ayuda
    // para cuando no se sabe qué hacer empujaba otra vez hacia su biografía.
    // El pasado vuelve cuando él lo busca; no se le propone.
    //
    // De lo que está pasando: primero mirarlo; cuando ya se ha visto de
    // cerca, lo que se puede hacer con ello (sus vías). Antes era siempre la
    // misma sugerencia, turno tras turno.
    const deLaSituacion = [];
    if (sit) {
      if (!sit.detalleVisto && sit.sugerencia) deLaSituacion.push(sit.sugerencia);
      deLaSituacion.push(...(sit.sugerencias ?? []));
    }

    // Con quien ya se está hablando se propone de QUÉ hablar, no otro
    // «Hablar con…»: se sugirió «Hablar con Cordor» cinco veces seguidas.
    const deLaCharla = [];
    const conexion = this._flujo().elegir(lugar?.conexiones ?? []);
    const destino = conexion ? obtenerLugar(conexion.hasta) : null;
    // A quien se habla en ESTE turno cuenta ya: si no, los temas llegaban un
    // turno tarde.
    const ahora = ctx.destinatario?.id ? presentes.find((n) => n.refId === ctx.destinatario.id) : null;
    const charla = ahora ?? presentes
      .filter((n) => Number.isFinite(n.ultimoEncuentro) && turno - n.ultimoEncuentro <= 3)
      .sort((a, b) => b.ultimoEncuentro - a.ultimoEncuentro)[0];
    if (charla) {
      const esSuyo = (sit?.actores ?? []).some((a) => a.refId && a.refId === charla.refId);
      // Con su nombre si cabe en el botón; si no, «Preguntarle por…», que va
      // a quien se está hablando.
      const porTema = (tema) => {
        const largo = `Preguntar a ${charla.nombre} por ${tema}`;
        return largo.length <= COTAS_IA.etiquetaOpcionMax ? largo : `Preguntarle por ${tema}`;
      };
      if (sit?.tema && !esSuyo) deLaCharla.push({ label: porTema(sit.tema), intent: 'talk', risk: 'low' });
      deLaCharla.push({ label: `Preguntar a ${charla.nombre} qué se cuenta aquí`, intent: 'talk', risk: 'low' });
      if (destino?.nombre) deLaCharla.push({ label: `Preguntar a ${charla.nombre} por ${destino.nombre.replace(/^(El|La|Los|Las)\s/, (a) => a.toLowerCase())}`, intent: 'talk', risk: 'low' });
    } else if (presentes.length) {
      // Alguien con quien aún no se ha hablado, antes que el de siempre.
      const nuevo = presentes.find((n) => !Number.isFinite(n.ultimoEncuentro)) ?? presentes[turno % presentes.length];
      candidatas.push({ label: `Hablar con ${nuevo.nombre}`, intent: 'talk', risk: 'low' });
    }

    const sub = this._flujo().elegir(lugar?.sublugares ?? []);
    if (sub?.nombre) candidatas.push({ label: `Ir ${trasPreposicion('a', sub.nombre)}`, intent: 'explore', risk: 'low' });
    if (destino?.nombre) candidatas.push({ label: `Tomar el camino ${trasPreposicion('hacia', destino.nombre)}`, intent: 'travel', risk: conexion.peligro > 1 ? 'medium' : 'low' });

    // Lo que el jugador ha nombrado jugando, al final: es suyo, pero no se le
    // empuja hacia ello.
    const suyo = (ctx.canon ?? []).filter((c) => c.menciones >= 2 && c.origen !== 'importado');
    for (const c of suyo.slice(0, 1)) {
      // A otro, no a él mismo: salía «Preguntar a Cordan por Cordan».
      const mismo = (p) => sinAcentos(String(p?.nombre ?? '').toLowerCase()) === sinAcentos(String(c.nombre ?? '').toLowerCase());
      const quien = [charla, ...presentes].find((p) => p?.nombre && !mismo(p));
      if (c.tipo === 'persona' && quien) candidatas.push({ label: `Preguntar a ${quien.nombre} por ${c.nombre}`, intent: 'talk', risk: 'low' });
    }

    // El catálogo detrás. «Hablar» a secas no dice con quién: con gente
    // delante ya se propone «Hablar con…» por su nombre, o de qué hablar.
    candidatas.push(...base.filter((b) => !/^hablar$/i.test(String(b.label ?? '').trim())));

    // Lo que está pasando y la conversación, alternados: si se habla con
    // alguien, entre las tres visibles hay al menos un tema para él.
    const alternadas = [];
    for (let i = 0; i < Math.max(deLaSituacion.length, deLaCharla.length); i += 1) {
      if (deLaSituacion[i]) alternadas.push(deLaSituacion[i]);
      if (deLaCharla[i]) alternadas.push(deLaCharla[i]);
    }
    candidatas.unshift(...alternadas);

    // Hasta seis: el motor quita las ya usadas sin que haya cambiado nada
    // (ver `TurnResolver._fijarOpciones`) y la app enseña tres. Una etiqueta
    // más larga que el botón no se recorta a media frase: no se ofrece.
    const vistas = new Set();
    const elegidas = [];
    for (const c of candidatas) {
      const clave = c.label?.toLowerCase();
      if (!clave || vistas.has(clave) || c.label.length > COTAS_IA.etiquetaOpcionMax) continue;
      vistas.add(clave);
      elegidas.push(c);
      if (elegidas.length === 6) break;
    }
    return elegidas.map((o, i) => ({ ...o, id: `c${i + 1}` }));
  }

  /** @private */
  async _latencia() {
    const flujo = this.rng?.flujo('narrativa');
    const ms = flujo ? flujo.entero(180, 520) : 300;
    await this._dormir(ms);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TURNO NARRATIVO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Turno de exploración o acción libre.
   *
   * La narración se ensambla en cuatro movimientos:
   *   1. Resultado de lo que intentó el jugador
   *   2. Consecuencia inmediata
   *   3. Atmósfera del lugar
   *   4. Gancho o cierre abierto
   *
   * @param {Object} peticion
   * @param {Object} ctx
   * @returns {Object}
   * @private
   */
  _turnoNarrativo(peticion, ctx) {
    const parrafos = [];
    const eventos = [];
    const memoria = [];

    // No se abre con el pasado del personaje. Se hacía («Tu pasado no te ha
    // dejado llegar aquí por azar. Perdiste la forja…»), y la historia que
    // escribió el jugador pasaba a ser la campaña. Es canon: vuelve cuando él
    // lo busca o el mundo lo roza, no en la primera línea.
    //
    // La primera línea es dónde y cuándo: sin ella la apertura empezaba con
    // «Un árbol solitario marca un cruce» y no se sabía ni en qué pueblo.
    if ((peticion.turno ?? ctx.turno) <= 1 && !ctx.ultimoTurno && !peticion.accion) {
      parrafos.push(this._abrirEscena(ctx));
    }

    // ─── 1. Resultado de la acción ─────────────────────────────────────
    // Si ha intervenido en algo que estaba pasando, lo que ocurre es eso: la
    // rueda que se calza, la niña que se aparta del pozo. Una frase genérica
    // de tirada («Todo encaja a la primera») no dice nada al lado.
    const mirada = !ctx.situacionResultado && !ctx.salidaSinDestino && peticion.accion ? this._observar(peticion, ctx) : null;
    // Salir sin decir adónde: se queda en el sitio (no es un viaje) y se
    // dice por dónde se sale, con lo que el mapa sabe. Salía «Sales del
    // pueblo» y debajo las calles del pueblo, como si no se hubiera movido.
    const salida = ctx.salidaSinDestino;
    if (salida) {
      const lugar = obtenerLugar(ctx.mundo?.ubicacion)?.nombre ?? 'el pueblo';
      const caminos = (salida.destinos ?? []).map((d) => `${d.nombre.replace(/^(El|La|Los|Las)\s/, (a) => a.toLowerCase())} (${horasDichas(d.horas)})`);
      const lista = caminos.length > 1 ? `${caminos.slice(0, -1).join(', ')} y ${caminos.at(-1)}` : caminos[0];
      parrafos.push(lista
        ? `Llegas a las afueras de ${lugar}. De aquí salen caminos hacia ${lista}. ¿Hacia dónde?`
        : `Llegas a las afueras de ${lugar}.`);
    } else if (ctx.situacionResultado) {
      parrafos.push(ctx.situacionResultado);
    } else if (mirada) {
      // Mirar no se narra con «Ves lo principal; los detalles, no tanto»: se
      // cuenta lo que hay. La tirada decide si aparece lo escondido.
      parrafos.push(mirada.lineas.join(' '));
      memoria.push(...mirada.memoria);
    } else if (peticion.tirada) {
      // Un imposible no se queda «a un poco»: el límite lo cuenta `_enriquecer`
      // («Pero el mundo es más grande que tus fuerzas…»). «Te falta un poco»
      // detrás de un salto de 50 metros decía lo contrario.
      if (!peticion.tirada.desmedida) parrafos.push(this._narrarResultado(peticion.tirada, peticion.intencion));
      // Lo que se ve desde donde quería llegar, solo si ha llegado.
      if (ctx.detalleEscena && peticion.tirada.exito) parrafos.push(ctx.detalleEscena);
    } else if (peticion.accion) {
      parrafos.push(this._narrarAccionSimple(peticion.intencion, ctx));
    }

    // Lo que la acción nombra y está aquí se ve: «corro hacia el puente»,
    // «bebo agua del río». Una vez, no cada turno. Tras un imposible, no: el
    // tejado que no alcanzó no se describe como si estuviera allí.
    const nombrado = !mirada && !salida && !ctx.situacionResultado && peticion.ambicion !== 'desmedida' ? this._rasgoNombrado(peticion, ctx) : null;
    if (nombrado) parrafos.push(nombrado);

    // ─── 2. Atmósfera ──────────────────────────────────────────────────
    // Solo se describe el entorno cuando cambia algo o cada cierto tiempo. Un
    // director que describe el bosque en cada turno resulta agotador.
    //
    // Dos frases como mucho. Antes salían cuatro y cinco de golpe —hora,
    // clima, vista, sonido, olfato y detalle, todo seguido— y el jugador
    // aprendía a saltarse el párrafo entero en cuatro turnos. Lo que se lee
    // siempre no es lo que más dice, es lo que cabe.
    // Si hay algo pasando en escena, eso es la escena: sin paisaje encima.
    const conEscena = (ctx.contextoEscena ?? []).length > 0;
    if (!conEscena && !mirada && !nombrado && !salida && this._tocaDescribirEntorno(ctx)) {
      parrafos.push(this._componerAtmosfera(ctx, { frases: 1 }));
    }

    // ─── 3. Lo suyo vuelve ─────────────────────────────────────────────
    //
    // Primero el canon —lo que él ha nombrado— y luego los hilos abiertos. Es
    // el mismo criterio de siempre: entre repetir una plantilla del juego y
    // repetir algo que escribió el jugador, gana lo segundo. Su historia no la
    // construye el catálogo, la construye él.
    // Pero solo lo que viene a cuento. Antes salía al azar un turno de cada
    // cuatro, para aparentar continuidad: un recuerdo sin motivo no es
    // memoria, es un gancho repetido.
    const hilo = this._hiloPertinente(ctx);
    const suyo = this._traerDelCanon(ctx, peticion.accion);

    if (suyo) {
      parrafos.push(suyo);
    } else if (hilo) {
      parrafos.push(this._recordarHilo(hilo, ctx));
      eventos.push({ type: 'ambient', payload: { hilo: hilo.id }, silent: true });
    }

    // Sin suceso ambiental al azar ni cierre de catálogo. «Un gato salta de
    // un barril», «Algo cruje a tu espalda»: no pasaba nada y lo parecía. Lo
    // que cambia a la vista llega del mundo (el reloj de las situaciones, lo
    // que dejó el jugador a medias), y si no cambia nada, el turno calla.

    // ─── Consecuencias mecánicas ───────────────────────────────────────
    const playerUpdates = this._consecuencias(peticion, ctx);

    // ─── Memoria ───────────────────────────────────────────────────────
    if (peticion.tirada?.critico) {
      memoria.push(`El personaje logró algo notable al ${this._verboDe(peticion.intencion)}.`);
    }
    if (peticion.tirada?.pifia) {
      memoria.push(`El personaje falló estrepitosamente al ${this._verboDe(peticion.intencion)}.`);
    }

    return {
      schemaVersion: APP.versionContratoIA,
      story: parrafos.filter(Boolean).join('\n\n'),
      choices: this._opciones(ctx),
      playerUpdates,
      newItems: [],
      quests: [],
      combat: {},
      events: eventos,
      memory: memoria,
      mood: this._tono(peticion, ctx),
    };
  }

  /** ¿Hace bastante que no se usa la antesala? Si sí, la reserva. @private */
  _antesalaLibre(turno) {
    if (turno - (this._ultimaAntesala ?? -99) < 6) return false;
    this._ultimaAntesala = turno;
    return true;
  }

  /**
   * Mirar, examinar, escuchar: lo que hay en el sitio.
   *
   * Sale de los rasgos del lugar (`data/rasgos.data.js`): «miro el río» en el
   * Vado describe el río, el vado y quién cruza sin pagar; con buena tirada,
   * además, lo que solo ve quien mira bien, que se apunta como descubierto
   * una sola vez. Mirar lo mismo otra vez cuenta qué ha cambiado o pasa a lo
   * siguiente, en vez de repetirse. Escuchar en un pueblo trae lo que se
   * comenta y aún no se había oído.
   *
   * @returns {{lineas: string[], memoria: string[]}|null} null si no es mirar.
   * @private
   */
  _observar(peticion, ctx) {
    // Todo lo escrito, no solo el foco: en «vuelvo junto a la balanza y miro
    // qué ha cambiado» el foco es volver, y se miraba nada.
    const foco = `${ctx.foco ?? ''} ${peticion.accion ?? ''}`.trim();
    const n = sinAcentos(foco.toLowerCase());
    const tipo = peticion.intencion?.tipo;
    // «Me siento a escuchar lo que se habla» no casaba con «escucho» y
    // describía el río: el acto se clasifica una vez, para todos.
    const escucha = ctx.interpretacion?.acto?.acto === ACTO.ESCUCHAR || actoDeHabla(foco)?.acto === ACTO.ESCUCHAR
      || /\b(?:escucho|oigo|presto oido|pego la oreja|atiendo a lo que)/.test(n);
    const mira = escucha || tipo === 'observe' || tipo === 'search'
      || /\b(?:miro|observo|examino|me fijo|inspecciono|estudio|contemplo|echo un vistazo|reviso|registro)\b/.test(n);
    if (!mira) return null;

    const lugar = obtenerLugar(ctx.mundo?.ubicacion);
    if (!lugar) return null;
    const t = peticion.tirada;
    const buena = !t || t.exito;
    const sabido = new Set(ctx.hechosTextos ?? []);
    const lineas = [];
    const memoria = [];
    const turno = peticion.turno ?? ctx.turno ?? 0;

    if (escucha) {
      const oido = (g) => `En ${lugar.nombre} se comenta que ${g}.`;
      const nuevo = (lugar.ganchos ?? []).find((g) => !sabido.has(oido(g)));
      if (nuevo && buena) {
        lineas.push(`Entre precios y quejas del tiempo, una conversación se repite en dos corrillos distintos: ${nuevo}.`);
        memoria.push(oido(nuevo));
      } else if (ctx.situacion?.actores?.length) {
        const donde = ctx.situacion.sitio ? `, ${ctx.situacion.sitio}` : '';
        lineas.push(`De lo que más se habla es de lo que tienes delante: ${ctx.situacion.actores.map((a) => a.nombre).join(' y ')}${donde}.`);
      } else {
        lineas.push('Precios, el tiempo, quién debe a quién. Nada que no se oiga en cualquier plaza.');
      }
      return { lineas, memoria };
    }

    // Mirar a la gente es mirar quién hay y qué hace.
    if (/\b(?:la gente|gente|personas|quien hay|los que pasan|la multitud|la calle llena)\b/.test(n)) {
      const quienes = (ctx.npcsPresentes ?? []).filter((p) => p?.nombre).slice(0, 4);
      if (quienes.length) {
        lineas.push(`Por aquí andan ${quienes.map((p) => `${p.nombre}, ${p.genero === 'f' ? 'la' : 'el'} ${p.rol ?? 'vecino'}`).join('; ')}.`);
        const quien = quienes.find((p) => ACTIVIDAD[sinAcentos(String(p.rol ?? '').toLowerCase())]);
        if (quien) lineas.push(ACTIVIDAD[sinAcentos(String(quien.rol).toLowerCase())].replace('{n}', quien.nombre));
      } else {
        lineas.push('Pasa poca gente, y nadie se para.');
      }
      return { lineas, memoria };
    }

    // Si lo que mira es lo que está pasando (el peaje, el pozo), eso es lo
    // que se ve: con buena tirada, el detalle; si no, lo evidente. Salía
    // «Nada ha cambiado» porque el sitio ya se había descrito.
    if (ctx.detalleEscena) {
      lineas.push(buena ? ctx.detalleEscena : (String(ctx.situacion?.texto ?? '').split(/(?<=\.)\s+/)[0] || ctx.detalleEscena));
      return { lineas, memoria };
    }

    const lista = rasgosDe(lugar.refId, lugar.terreno);
    const general = !buscarRasgo(foco, lugar.refId, lugar.terreno);

    // Lo que no es un rasgo del sitio no se contesta con un rasgo al azar:
    // «miro el cielo» enseñaba el río. Si no hay nada, poco y verdadero.
    if (general) {
      if (/\b(?:cielo|nubes|el sol|estrellas|la luna)\b/.test(n)) {
        lineas.push(cieloDe(ctx.mundo));
        return { lineas, memoria };
      }
      if (/\bquien (?:me|nos) (?:mira|observa|sigue|vigila)|si alguien me (?:mira|observa|sigue|ha seguido)|me (?:esta|estan) mirando|por si alguien/.test(n)) {
        const sit = String(ctx.situacion?.texto ?? '').split(/(?<=\.)\s+/)[0];
        lineas.push(sit && /capucha|encapuch|vigil|observa|mira/.test(sinAcentos(sit.toLowerCase())) ? sit : 'Nadie parece fijarse en ti más de la cuenta.');
        return { lineas, memoria };
      }
      if (/\b(?:mis|mi)\s+\p{L}+/u.test(n) && !/alrededor/.test(n)) return { lineas, memoria };
      const alrededor = /\b(?:alrededor|todo|el sitio|el lugar|la zona|el paisaje|una ultima vez)\b/.test(n);
      // Lo que está pasando va primero, una vez: repetido cada vez que se
      // mira alrededor era lo más repetido de la partida.
      const sitTexto = String(ctx.situacion?.texto ?? '').split(/(?<=\.)\s+/).slice(0, 2).join(' ');
      this._situacionesVistas ??= new Set();
      const primeraFrase = sitTexto.split(/(?<=\.)\s+/)[0];
      const yaNarrada = (ctx.yaContado ?? []).some((f) => f.includes(primeraFrase.slice(0, 40)));
      if (alrededor && sitTexto && !yaNarrada && !this._situacionesVistas.has(sitTexto)) {
        this._situacionesVistas.add(sitTexto);
        lineas.push(sitTexto);
        return { lineas, memoria };
      }
      // Si lo que mira salió en lo que ha pasado aquí, se cuenta cómo quedó.
      const cosa = n.match(/\b(?:el|la|los|las|un|una|unos|unas)\s+(\p{L}{3,})/u)?.[1];
      if (cosa) {
        const raiz = cosa.replace(/(?:as|os|es|a|o|s)$/u, '');
        const frases = (ctx.escenaTextos ?? []).flatMap((x) => String(x).split(/(?<=[.!?»])\s+/u));
        const ultima = [...frases].reverse().find((f) => raiz.length >= 3 && sinAcentos(f.toLowerCase()).includes(raiz));
        if (ultima) { lineas.push(ultima.replace(/^EN ESCENA:\s*/, '')); return { lineas, memoria }; }
      }
      if (!alrededor && /\b(?:el|la|los|las|un|una|unos|unas)\s+\p{L}{3,}/u.test(n)) {
        lineas.push('Nada ahí que llame la atención.');
        return { lineas, memoria };
      }
    } else {
      // Lo que mira es de lo que está pasando («la figura del tejado»), no
      // el tejado del pueblo: se cuenta cómo está ahora. Con «tejado» dentro
      // salía la descripción de las calles.
      const cosa = n.match(/\b(?:el|la|los|las|un|una|unos|unas)\s+(\p{L}{3,})/u)?.[1];
      const raiz = cosa ? cosa.replace(/(?:as|os|es|a|o|s)$/u, '') : '';
      const deLaSituacion = raiz.length >= 3 && sinAcentos(String(ctx.situacion?.texto ?? '').toLowerCase()).includes(raiz);
      if (deLaSituacion) {
        const frases = (ctx.escenaTextos ?? []).flatMap((x) => String(x).split(/(?<=[.!?»])\s+/u));
        const ultima = [...frases].reverse().find((f) => sinAcentos(f.toLowerCase()).includes(raiz));
        if (ultima) { lineas.push(ultima.replace(/^EN ESCENA:\s*/, '')); return { lineas, memoria }; }
      }
    }
    let rasgo = buscarRasgo(foco, lugar.refId, lugar.terreno) ?? rasgoGeneral(lugar.refId, lugar.terreno);
    if (!rasgo) return null;

    // Lo ya descrito hace poco no se vuelve a describir igual.
    const clave = (r) => `${lugar.refId}:${r.clave}`;
    this._descritos ??= new Map();
    const reciente = (r) => turno - (this._descritos.get(clave(r)) ?? -99) < 12;
    if (general) {
      // «miro alrededor»: lo que menos se ha descrito, no lo mismo.
      const cuando = (r) => this._descritos.get(clave(r)) ?? -99;
      rasgo = [...lista].sort((a, b) => cuando(a) - cuando(b))[0] ?? rasgo;
    }

    // Lo que pasó aquí de verdad: hechos del mundo que nombran este rasgo.
    // No lo que se comenta ni lo que dijo alguien, y sin contar las palabras
    // del nombre del pueblo («vado» no hace que un rumor sea del río).
    const delNombre = new Set(sinAcentos(lugar.nombre.toLowerCase()).split(/[^a-zñ]+/u));
    const suyas = rasgo.palabras.split('|').filter((w) => w.length > 3 && !delNombre.has(w) && w !== 'alrededor');
    const loQuePaso = (ctx.sucesos ?? [...sabido])
      // Tampoco los recuerdos entre personas («Tormir (arriero): Le pagó…»):
      // son de alguien, no algo que pasó en el sitio.
      .filter((h) => !/^(?:Según |En .+?: |En .+? se comenta|[^\s(]+ \([^)]+\): |El personaje |Conoció a )/.test(h))
      .filter((h) => suyas.some((w) => new RegExp(`\\b${w}`).test(sinAcentos(h.toLowerCase()))))
      .at(-1);

    if (reciente(rasgo)) {
      // Se dice una vez; si insiste, silencio: repetir «nada ha cambiado»
      // cada turno es otra coletilla.
      this._sinCambio ??= new Set();
      if (loQuePaso) lineas.push(`Desde la última vez, lo que ha cambiado aquí es esto: ${minuscula(loQuePaso)}`);
      else if (!this._sinCambio.has(clave(rasgo))) lineas.push('Nada ha cambiado desde la última vez que miraste.');
      this._sinCambio.add(clave(rasgo));
    } else {
      this._sinCambio?.delete(clave(rasgo));
      lineas.push(rasgo.ve);
      if (loQuePaso && !general) lineas.push(`Y lo que pasó aquí: ${minuscula(loQuePaso)}`);
    }
    this._descritos.set(clave(rasgo), turno);

    // Lo escondido, con buena tirada y solo la primera vez.
    // Se guarda recortado (la memoria admite 200 caracteres): se compara igual.
    const descubierto = `En ${lugar.nombre}: ${rasgo.detalle}`.slice(0, 200);
    if (t?.exito && rasgo.detalle && !sabido.has(descubierto)) {
      lineas.push(rasgo.detalle);
      memoria.push(descubierto.slice(0, 200));
    }

    return { lineas, memoria };
  }

  /**
   * El rasgo del sitio que la acción nombra, dicho una vez cada tanto.
   * @private
   */
  _rasgoNombrado(peticion, ctx) {
    const lugar = obtenerLugar(ctx.mundo?.ubicacion);
    const rasgo = lugar ? buscarRasgo(ctx.foco ?? peticion.accion, lugar.refId, lugar.terreno) : null;
    if (!rasgo) return null;
    const turno = peticion.turno ?? ctx.turno ?? 0;
    this._descritos ??= new Map();
    const clave = `${lugar.refId}:${rasgo.clave}`;
    if (turno - (this._descritos.get(clave) ?? -99) < 12) return null;
    this._descritos.set(clave, turno);
    return rasgo.ve;
  }

  /**
   * Dónde y cuándo empieza la partida, en una línea.
   * @private
   */
  _abrirEscena(ctx) {
    const lugar = obtenerLugar(ctx.mundo?.ubicacion);
    if (!lugar?.nombre) return '';
    const CUANDO = {
      madrugada: 'de madrugada', alba: 'al alba', manana: 'por la mañana', mediodia: 'a mediodía',
      tarde: 'por la tarde', ocaso: 'al caer la tarde', noche: 'de noche',
    };
    const cuando = CUANDO[ctx.mundo?.franja] ? `, ${CUANDO[ctx.mundo.franja]}` : '';
    return `${lugar.nombre}${cuando}. ${lugar.descripcion ?? ''}`.trim();
  }

  /**
   * Narra el resultado de una tirada.
   *
   * El motor ya decidió: aquí solo se viste. La frase se elige por grado y por
   * categoría de la habilidad, de modo que fallar un sigilo suene distinto a
   * fallar un empujón.
   *
   * @param {Object} tirada
   * @param {Object} intencion
   * @returns {string}
   * @private
   */
  _narrarResultado(tirada, intencion) {
    const categoria = categoriaDe(tirada.habilidad);
    const frases = resultadosDe(tirada.grado, categoria);
    const base = this._unico(frases);

    const partes = [base + '.'];

    // Un fallo con causa identificable se narra citándola: perder por
    // agotamiento no es lo mismo que perder por mala suerte.
    if (!tirada.exito && tirada.desglose?.length) {
      const peor = [...tirada.desglose]
        .filter((m) => m.valor < 0)
        .sort((a, b) => a.valor - b.valor)[0];

      if (peor) {
        const causas = {
          Hambre: 'El hambre te resta reflejos.',
          Sed: 'La sed te nubla.',
          Agotamiento: 'Estás demasiado cansado para esto.',
          Carga: 'El peso que llevas encima te estorba.',
          Moral: 'No tienes el ánimo para esto.',
        };
        const clave = Object.keys(causas).find((k) => peor.fuente.startsWith(k));
        if (clave) partes.push(causas[clave]);
      }
    }

    // Un crítico o una pifia merecen su propia frase.
    if (tirada.critico) {
      partes.push(this._unico([
        'Todo se alinea de golpe.',
        'Ha sido uno de esos momentos que no se repiten.',
        'Ni tú te esperabas que saliera así.',
      ]));
    } else if (tirada.pifia) {
      partes.push(this._unico([
        'Y encima, ahora hay testigos.',
        'Lo que era un problema pequeño acaba de crecer.',
        'Peor imposible.',
      ]));
    }

    return partes.join(' ');
  }

  /**
   * Narra una acción que no requirió tirada.
   * @private
   */
  _narrarAccionSimple(intencion, ctx) {
    // El eco del jugador ya cuenta lo que hace. Aquí solo va lo que la acción
    // cambia de verdad; si no cambia nada que se vea, no se añade nada. Antes
    // salían frases de catálogo que valían para cualquier acción («Te mueves
    // con intención; alrededor, nada permanece del todo indiferente»).
    if (intencion?.tipo === 'rest') return 'Recuperas el aliento.';
    return '';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ATMÓSFERA
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Convierte en prosa lo que el motor ha preparado para esta escena.
   *
   * Las notas llegan escritas para un modelo de lenguaje, en mayúsculas y con
   * su etiqueta delante: «ENCUENTRO EN CURSO: un carro volcado corta el paso.
   * Vías posibles: ayudar, rodear, registrar.» Un modelo se las arregla con
   * eso; el director interno tiene que pasarlas a algo que se lea.
   *
   * Se traduce la etiqueta a una entradilla en castellano y se deja el cuerpo
   * de la nota tal cual, que es donde está la información concreta. Las vías
   * posibles se cuelgan al final como lo que son: lo que el jugador puede
   * hacer ahora.
   *
   * @param {Object} ctx
   * @returns {string}
   * @private
   */
  _narrarEscena(ctx) {
    // Solo las notas escritas para el jugador. Las demás son instrucciones
    // para un modelo («Guardias que buscan una excusa… Vías posibles…»,
    // «Alguien podría recordárselo») y se le leían tal cual al jugador. El
    // modelo las sigue recibiendo en su prompt.
    const notas = (ctx.contextoEscena ?? []).filter((n) => PARA_EL_JUGADOR.test(String(n ?? '')));
    if (!notas.length) return '';

    // Solo la primera. Dos avisos a la vez se pisan y ninguno se lee.
    const nota = String(notas[0] ?? '').trim();
    if (!nota) return '';

    const corte = nota.indexOf(':');
    const etiqueta = corte > 0 ? nota.slice(0, corte).toUpperCase() : '';
    let cuerpo = corte > 0 ? nota.slice(corte + 1).trim() : nota;

    // Las vías posibles se separan para que no queden en mitad de la frase.
    let vias = '';
    const mVias = cuerpo.match(/\s*V[ií]as posibles:\s*([^.]+)\.?\s*$/i);
    if (mVias) {
      vias = mVias[1].trim().replace(/\.$/, '');
      cuerpo = cuerpo.slice(0, mVias.index).trim();
    }

    const ENTRADILLAS = {
      'ENCUENTRO EN CURSO': ['Y entonces se tuerce el camino.', 'Algo se cruza.', 'Ahí delante hay algo que no estaba.'],
      'HA CAMBIADO DESDE LA ÚLTIMA VISITA': ['Esto no lo dejaste así.', 'Algo ha cambiado desde la última vez.'],
      PENDIENTE: ['Hay algo que sigue sin saldar.', 'Queda una cuenta abierta.'],
    };

    const entradilla = ENTRADILLAS[etiqueta] ? this._unico(ENTRADILLAS[etiqueta]) : '';

    const partes = [entradilla, capitalizar(cuerpo)].filter(Boolean);
    if (vias) partes.push(`Se te ocurren varias salidas: ${vias}.`);

    return partes.join(' ');
  }

  /**
   * Decide si conviene describir el entorno en este turno.
   *
   * Se describe siempre al cambiar de terreno o de franja horaria, y de vez en
   * cuando en los demás casos. Repetirlo cada turno cansa.
   *
   * @param {Object} ctx
   * @returns {boolean}
   * @private
   */
  _tocaDescribirEntorno(ctx) {
    if (!ctx.ultimoTurno) return true;

    // Cambio de escenario: siempre.
    if (ctx._terrenoAnterior && ctx._terrenoAnterior !== ctx.mundo?.terreno) return true;
    if (ctx._franjaAnterior && ctx._franjaAnterior !== ctx.mundo?.franja) return true;

    return this._flujo().oportunidad(0.45);
  }

  /**
   * Compone una descripción del entorno.
   *
   * Toma dos o tres registros sensoriales distintos de la atmósfera del terreno
   * y los une. Esa combinatoria es lo que evita la repetición.
   *
   * @param {Object} ctx
   * @returns {string}
   * @private
   */
  _componerAtmosfera(ctx, { frases = 0 } = {}) {
    // Dentro de un sitio se describe el sitio, no la comarca.
    //
    // Esto miraba solo el terreno, así que desde la mesa de una taberna
    // contaba los surcos de carro y el viento en el trigo. El jugador tiene
    // cuatro paredes delante y le describían los campos de fuera.
    const dentro = this._sublugarActual(ctx);
    // En un asentamiento, ambiente de pueblo: el terreno es el de la comarca
    // y en pleno Vado salían «campos abiertos» y «el trigo con el viento».
    const enPueblo = obtenerLugar(ctx.mundo?.ubicacion)?.tipo === 'asentamiento';
    const atmosfera = dentro ? atmosferaInterior(dentro.tipo) : atmosferaDe(enPueblo ? 'ciudad' : (ctx.mundo?.terreno ?? 'camino'));
    const partes = [];

    // La hora y el clima son cosa de fuera. Bajo techo no se ve el cielo, y
    // recordar que llueve mientras estás a cubierto rompe la escena.
    if (!dentro) {
      // Momento del día, solo a veces: no hace falta recordar la hora siempre.
      if (this._flujo().oportunidad(0.4)) {
        const franja = FRANJA[ctx.mundo?.franja] ?? FRANJA.mediodia;
        partes.push(this._unico(franja));
      }

      // Clima, si es algo más que un cielo despejado.
      const clima = ctx.mundo?.clima;
      if (clima && clima !== 'despejado' && this._flujo().oportunidad(0.6)) {
        partes.push(this._unico(CLIMA[clima] ?? CLIMA.despejado));
      }
    }

    // Vista casi siempre; oído y olfato de forma alterna.
    partes.push(this._unico(atmosfera.vista));

    if (this._flujo().oportunidad(0.55)) partes.push(this._unico(atmosfera.sonido));
    if (this._flujo().oportunidad(0.3)) partes.push(this._unico(atmosfera.olfato));

    // Un detalle concreto: es lo que hace que el lugar parezca real en vez de
    // un decorado genérico.
    if (this._flujo().oportunidad(0.5)) partes.push(this._unico(atmosfera.detalle));

    // `frases` recorta el bloque cuando se usa como relleno. Se queda con las
    // primeras, que son las que sitúan: la hora, el clima y lo que se ve. El
    // olfato y el detalle son la guinda, y una guinda sobre un turno que ya
    // dice algo es justo el ruido que sobra.
    const elegidas = frases > 0 ? partes.slice(0, frases) : partes;

    return elegidas.map((p) => (p.endsWith('.') ? p : `${p}.`)).join(' ');
  }

  /**
   * Trae de vuelta algo que el jugador nombró.
   *
   * Es la pieza que convierte una sucesión de turnos en una historia: el
   * nombre que soltó hace diez turnos reaparece, y reaparece DICIENDO LO
   * MISMO. Si escribió «el capitán Verros, el que quemó mi forja», el juego
   * podrá hablar de Verros como capitán y como el que quemó la forja, y de
   * nada más, porque no tiene nada más.
   *
   * Esa pobreza es a propósito. Un narrador que solo repite lo que le dijeron
   * nunca se contradice, y la contradicción es lo que rompe una partida larga.
   * Lo que no sabe, no lo dice.
   *
   * @param {Object} ctx
   * @returns {string}
   * @private
   */
  _traerDelCanon(ctx, accion = '') {
    const canon = ctx.canon ?? [];
    if (!canon.length) return '';

    // Solo lo que el jugador nombra en esta acción. Antes se elegía al azar
    // entre lo que había repetido, y volvía cuando no venía a cuento: él
    // preguntaba por el pozo y el narrador le recordaba a Verros.
    const dicho = String(accion ?? '').toLowerCase();
    const candidatos = canon.filter((c) => c.nombre && dicho.includes(String(c.nombre).toLowerCase()));
    if (!candidatos.length) return '';

    // Quien está delante no se «recuerda»: está.
    const presentes = new Set((ctx.npcsPresentes ?? []).map((n) => String(n.nombre).toLowerCase()));
    const e = candidatos.find((c) => !presentes.has(String(c.nombre).toLowerCase()));
    if (!e) return '';

    // Solo lo que el mundo sabe. Antes decía lo que el personaje pensaba
    // («Piensas otra vez en…», «No se te quita de la cabeza»), y eso lo
    // decide quien juega, no el narrador.
    if (e.tipo === 'lugar') {
      const destino = Object.values(LUGARES).find((l) => l?.nombre && sinAcentos(l.nombre.toLowerCase()) === sinAcentos(String(e.nombre).toLowerCase()));
      const r = destino ? rutaMapa(ctx.mundo?.ubicacion, destino.refId) : null;
      return r?.encontrada && r.tiempoTotal ? `${e.nombre} queda a ${horasDichas(r.tiempoTotal)} de aquí.` : '';
    }
    if (e.tipo === 'persona') return `De ${e.nombre}, aquí, ni rastro.`;
    return '';
  }

  /**
   * ¿Está el personaje dentro de algún sitio?
   *
   * Vale tanto el sublugar donde ya está como el que acaba de nombrar en su
   * acción: quien escribe «entro en la taberna y me siento» está dentro a
   * efectos de lo que ve, aunque el estado aún no se haya actualizado.
   *
   * @param {Object} ctx
   * @returns {{refId: string, nombre: string, tipo: string}|null}
   * @private
   */
  _sublugarActual(ctx) {
    const lugar = obtenerLugar(ctx.mundo?.ubicacion);
    const sublugares = lugar?.sublugares ?? [];
    if (!sublugares.length) return null;

    const actual = ctx.mundo?.sublugar;
    if (actual) {
      const hallado = sublugares.find((s) => s.refId === actual);
      if (hallado) return hallado;
    }

    // Lo que nombra la acción, pero solo si dice que ENTRA o que ESTÁ ahí.
    //
    // Mencionar un sitio no es estar en él: «pregunto al herrero si ha oído
    // hablar del incendio» describía la fragua estando el personaje sentado en
    // la taberna. Hace falta un verbo de entrar o de estar, no una mención.
    const accion = String(ctx.accion ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!accion) return null;

    const entra = /\b(entro|entrar|entramos|paso a|me meto|voy a la|voy al|subo a|bajo a|estoy en|me siento en|dentro de|cruzo la puerta)\b/.test(accion);
    if (!entra) return null;

    const ALIAS = { posada: ['posada', 'taberna', 'meson'], herrero: ['fragua', 'herreria', 'herrero'], mercado: ['mercado', 'plaza', 'puesto'], templo: ['templo', 'santuario', 'capilla'] };

    return sublugares.find((s) => {
      const nombre = String(s.nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (nombre && accion.includes(nombre)) return true;
      return (ALIAS[s.tipo] ?? [s.tipo]).some((a) => new RegExp(`\\b${a}`).test(accion));
    }) ?? null;
  }

  /**
   * Recuerda un hilo abierto sin resolverlo.
   *
   * La forma importa: se menciona de refilón, como un pensamiento intrusivo, no
   * como un recordatorio de la interfaz.
   *
   * @private
   */
  /**
   * El hilo abierto que viene a cuento ahora, si lo hay.
   *
   * Pertinente es que toque a quien está delante o al sitio donde se está.
   * Los hilos que nacían del pasado del personaje (`player_lore`) no vuelven
   * nunca solos: eran fragmentos de su biografía convertidos en ganchos.
   *
   * @param {Object} ctx
   * @returns {Object|null}
   * @private
   */
  _hiloPertinente(ctx) {
    const hilo = ctx.hiloParaRetomar;
    if (!hilo?.texto || /^player_lore/.test(hilo.relacionadoCon ?? '') || /^De su historia:/i.test(hilo.texto)) return null;

    const texto = String(hilo.texto).toLowerCase();
    const aqui = [
      ...(ctx.npcsPresentes ?? []).map((n) => n?.nombre),
      obtenerLugar(ctx.mundo?.ubicacion)?.nombre,
    ].filter(Boolean).map((x) => String(x).toLowerCase());
    const presentes = new Set((ctx.npcsPresentes ?? []).map((n) => n?.refId).filter(Boolean));

    const toca = presentes.has(hilo.relacionadoCon)
      || hilo.relacionadoCon === ctx.mundo?.ubicacion
      || aqui.some((x) => texto.includes(x));
    return toca ? hilo : null;
  }

  _recordarHilo(hilo, ctx) {
    // Los hilos de la historia del jugador llegan en su voz («Mi hermana
    // cruzó…»); se devuelven en la tuya y sin la etiqueta interna.
    const bruto = String(hilo.texto ?? '').replace(/^De su historia:\s*/i, '');
    const propio = bruto !== hilo.texto;

    if (propio) {
      const limpio = bruto.replace(/[.!?…]*$/u, '');

      // Solo se conjuga lo que viene en primera persona. El trasfondo lo suele
      // escribir el jugador en tercera, hablando de su personaje («Perdió la
      // forja de su padre»), y convertir eso producía «perdias la forja de su
      // padre»: verbo destrozado y posesivo sin tocar. En ese caso su texto se
      // deja tal cual y el encaje lo pone el narrador alrededor, con frases
      // que funcionan sin tener que tocarlo por dentro.
      if (esPrimeraPersona(limpio)) {
        const frase = aSegundaPersona(limpio).replace(/[.!?…]*$/u, '');
        return this._unico([
          `Y entonces lo recuerdas otra vez: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}. No has venido hasta aquí para olvidarlo.`,
          `${capitalizar(frase)}. Lo piensas sin querer, como una piedra en la bota que no termina de salir.`,
          `Por un momento, el ruido de alrededor se apaga y solo queda eso: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}.`,
        ]);
      }

      const suyo = capitalizar(limpio);
      return this._unico([
        `Vuelve a ti lo de siempre, con las mismas palabras de siempre. ${suyo}. Y aquí sigues.`,
        `${suyo}. Eso no se queda atrás por mucho camino que le eches.`,
        `Hay cosas que uno se lleva puestas. ${suyo}.`,
        `Por un momento el ruido se apaga y solo queda eso. ${suyo}.`,
      ]);
    }
    hilo = { ...hilo, texto: frase };
    const formas = [
      `Te viene a la cabeza, sin venir a cuento: ${hilo.texto.toLowerCase()}`,
      `Sigue ahí, en algún rincón: ${hilo.texto.toLowerCase()}`,
      `No lo has olvidado. ${capitalizar(hilo.texto)}`,
      `Y entonces lo recuerdas otra vez: ${hilo.texto.toLowerCase()}`,
    ];

    return this._unico(formas);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TURNO DE COMBATE
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Narra una ronda de combate. Corta y seca: en combate sobra la prosa.
   * @private
   */
  _turnoCombate(peticion, ctx) {
    const partes = [];
    const t = peticion.tirada;

    if (t) {
      const grupo = t.exito
        ? (t.critico ? PLANTILLAS_COMBATE.golpeJugador.critico
          : t.grado === 'exitoJusto' ? PLANTILLAS_COMBATE.golpeJugador.debil
          : PLANTILLAS_COMBATE.golpeJugador.normal)
        : PLANTILLAS_COMBATE.golpeJugador.fallo;

      partes.push(`${this._unico(grupo)}.`);
    }

    // Un enemigo herido de gravedad se comporta distinto, y eso se nota.
    const enemigos = ctx.combate?.combatientes;
    if (enemigos) {
      const heridos = Object.values(enemigos.porId ?? {})
        .filter((c) => c.bando === 'enemigo' && c.vida?.actual > 0)
        .filter((c) => c.vida.actual / c.vida.max < 0.3);

      if (heridos.length && this._flujo().oportunidad(0.5)) {
        partes.push(this._unico([
          'Uno de ellos sangra y ya no ataca con la misma confianza.',
          'Se nota que están al límite.',
          'Alguien retrocede medio paso.',
        ]));
      }
    }

    // En combate la cadencia importa el doble: una frase por línea y el golpe
    // sonando en el crítico y en la pifia. Es donde el ritmo se nota, porque
    // es donde el jugador está pendiente de cada línea.
    return {
      schemaVersion: APP.versionContratoIA,
      story: Cadencia.montar(partes, {
        golpe: t?.critico ? 'critico' : t?.pifia ? 'pifia' : '',
        elegir: (lista) => this._unico(lista),
      }),
      choices: OPCIONES.combate.map((o, i) => ({ ...o, id: `c${i + 1}` })),
      playerUpdates: {},
      newItems: [],
      quests: [],
      combat: {},
      events: [],
      memory: [],
      mood: 'tension',
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TURNO DE DIÁLOGO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Narra una interacción con un PNJ.
   * @private
   */
  _turnoDialogo(peticion, ctx) {
    const partes = [];

    // Contesta a quien se ha hablado, no al primero de la lista.
    //
    // «pregunto al tabernero por el incendio» en un vado, sin taberna,
    // contestaba Corlin sin más: el jugador no sabía si Corlin era el
    // tabernero, si había taberna o si el juego no le había escuchado. Si el
    // nombrado no está, se dice, y contesta quien sí está.
    //
    // Y si el motor ya ha resuelto a quién va dirigido, manda eso. Un
    // destinatario que no está lo ha dicho el motor antes de llegar aquí; si
    // no se dirige a nadie en concreto y hay varios delante, nadie contesta
    // por él: «Quien te oye es Torela» ponía la pregunta en otra boca.
    const { npc, ausente, alAire } = this._aQuienSeHabla(peticion, ctx);
    if (ausente && npc) partes.push(`No hay ${ausente} por aquí. Quien te oye es ${npc.nombre}.`);

    if (alAire) {
      return {
        schemaVersion: APP.versionContratoIA,
        story: 'Lo dices sin dirigirte a nadie en concreto, y nadie lo recoge.',
        choices: OPCIONES.npcPresente.map((o, i) => ({ ...o, id: `c${i + 1}` })),
        playerUpdates: {}, newItems: [], quests: [], combat: {}, events: [], memory: [], mood: 'neutro',
      };
    }

    if (!npc) {
      // Nadie con quien hablar: se genera alguien, que es más interesante que
      // decir «no hay nadie». Pero si preguntó por un oficio que aquí no hay,
      // se le dice antes de presentarle a otra persona.
      const generado = this._generarNPC(ctx);
      if (ausente) partes.push(`No hay ${ausente} por aquí.`);
      partes.push(generado.presentacion);

      return {
        schemaVersion: APP.versionContratoIA,
        story: partes.join(' '),
        choices: OPCIONES.npcPresente.map((o, i) => ({ ...o, id: `c${i + 1}` })),
        playerUpdates: {},
        newItems: [],
        quests: [],
        combat: {},
        events: [{ type: 'npc_meet', payload: generado.datos, silent: false }],
        memory: [`Conoció a ${generado.datos.nombre}, ${generado.datos.rol}.`],
        mood: 'neutro',
      };
    }

    // Diálogo con alguien ya presente.
    const actitud = npc.actitud ?? 'cordial';

    // Si le has PREGUNTADO algo, no te saluda.
    //
    // Antes salía siempre el saludo del catálogo, así que preguntar al herrero
    // por el incendio de Forja Alta devolvía «Buenas. ¿Qué necesitas?»: el PNJ
    // contestaba como si acabaras de entrar por la puerta. Es el fallo que más
    // rompe la ilusión de estar hablando con alguien.
    // Si ya os conocíais y ha pasado un rato, se acuerda. Antes de lo que
    // conteste: es lo primero que se nota al volver a alguien.
    const recuerdo = this._loQueRecuerda(npc, peticion.turno ?? ctx.turno ?? 0);
    if (recuerdo) partes.push(recuerdo);

    // Si le preguntas qué le ha pasado y le ha pasado algo, te lo cuenta.
    // Antes contestaba lo de siempre aunque acabaran de robarle.
    const testimonio = this._testimonio(npc, ctx.foco ?? peticion.accion);
    if (testimonio) partes.push(testimonio);

    // Lo que HACE al hablar manda sobre la forma de la frase (ver
    // `engine/ActoDeHabla.js`): «le pregunto si necesita ayuda» ofrece ayuda
    // y se contestaba «De eso no sé nada»; un «gracias» no tenía respuesta.
    const acto = ctx.interpretacion?.acto ?? actoDeHabla(ctx.foco ?? peticion.accion);
    const porActo = ctx.negativa || testimonio ? null : this._responderActo(acto, npc, ctx);

    // Una negativa no se contesta con un saludo ni se tira: la reacción de
    // quien la oye la pone `_enriquecer`, desde lo que siente por él.
    const respuesta = porActo ?? (ctx.negativa || testimonio ? null : this._responderPregunta(peticion, ctx, npc, recuerdo));

    if (respuesta) {
      partes.push(respuesta.texto);
    } else if (!ctx.negativa && !testimonio) {
      partes.push(this._responderAfirmacion(peticion, ctx, npc, actitud));
    }

    return {
      schemaVersion: APP.versionContratoIA,
      story: partes.join(' '),
      choices: OPCIONES.npcPresente.map((o, i) => ({ ...o, id: `c${i + 1}` })),
      playerUpdates: {},
      newItems: [],
      quests: [],
      combat: {},
      // Se ha hablado con alguien concreto: los objetivos «Hablar con…» lo
      // necesitan saber.
      events: npc.refId ? [{ type: 'npc_talk', payload: { refId: npc.refId, nombre: npc.nombre }, silent: true }] : [],
      memory: respuesta?.memory ?? [],
      npcMemory: respuesta?.npcMemory ?? [],
      mood: 'neutro',
    };
  }

  /**
   * A quién se dirige el jugador, y si ese alguien está en escena.
   *
   * Se busca el destinatario en la frase («pregunto AL tabernero», «hablo CON
   * la herrera») y se compara con el nombre y el oficio de quien está
   * presente. Los oficios tienen sinónimos porque la gente no escribe el
   * nombre de catálogo: dice «tabernero» y el catálogo dice «posadero».
   *
   * @returns {{npc: Object|null, ausente: string|null}} `ausente` ya lleva su
   *   determinante concordado: «ningún tabernero», «ninguna herrera».
   * @private
   */
  /**
   * Lo que un PNJ recuerda del jugador, dicho al volver a verle.
   *
   * Solo al reencontrarse (han pasado unos turnos desde la última vez) y con
   * algo que recordar. Una negativa se trae con las palabras exactas del
   * jugador: es lo único que se puede citar sin ponerle en la boca nada
   * que no dijo.
   *
   * @param {Object} npc Registro del PNJ, con `memoria` y `ultimoEncuentro`.
   * @param {number} turno
   * @returns {string}
   * @private
   */
  /**
   * Lo que le ha pasado a un PNJ, si se le pregunta por ello.
   *
   * Sale de su memoria (tipo `testimonio`): lo apunta el mundo cuando algo
   * termina sin el jugador, como el robo del mercader.
   *
   * @param {Object} npc
   * @param {string} texto Lo que pregunta el jugador.
   * @returns {string}
   * @private
   */
  /**
   * El eco de lo que el jugador dice en estilo directo: sus palabras, entre
   * comillas y a quien se las dice.
   *
   * «¿Corvane, has oído hablar de un incendio de libros?» se devolvía como
   * «¿Corvane, has oído hablar de un incendio de libros.»: la pregunta
   * perdía su cierre y no quedaba claro a quién iba. Ahora sale «Le
   * preguntas a Corvane: «¿Has oído hablar de un incendio de libros?»». Lo
   * que va entre comillas son sus palabras exactas: no se pasan a segunda
   * persona.
   *
   * @param {string} accion
   * @param {Object} ctx
   * @returns {string|null} null si no es estilo directo.
   * @private
   */
  _ecoDirecto(accion, ctx) {
    const t = String(accion ?? '').trim();
    const vocativo = separarVocativo(t);
    const presentes = (ctx.npcsPresentes ?? []).map((p) => p?.nombre).filter(Boolean);
    const nombreVoc = vocativo && presentes.some((p) => p.split(/\s+/)[0] === vocativo.nombre) ? vocativo.nombre : null;
    // Pregunta o exclamación en directo, o hablado a alguien por su nombre
    // («Corvane, si ves al encapuchado, avísame»).
    const directo = /^[¿¡]/u.test(t) || Boolean(nombreVoc)
      || (/[?!]$/u.test(t) && !/^\s*(?:y\s+)?(?:le |les )?(?:pregunto|digo|grito|susurro|contesto|respondo|pido|cuento)\b/iu.test(t));
    if (!directo) return null;

    const segmento = (ctx.interpretacion?.segmentos ?? []).find((s) => s.destinatario?.nombre && s.destinatario.estado === 'presente');
    const quien = segmento?.destinatario?.nombre ?? nombreVoc;

    // Sin el vocativo dentro de la cita: ya va delante («a Corvane»).
    let dicho = nombreVoc ? vocativo.dicho : t;
    dicho = dicho.replace(/^([¿¡]?)(\p{Ll})/u, (_, s, l) => `${s}${l.toUpperCase()}`);
    if (/^¿/u.test(dicho) && !/\?$/u.test(dicho)) dicho = `${dicho.replace(/[.!…]+$/u, '')}?`;
    if (/^¡/u.test(dicho) && !/!$/u.test(dicho)) dicho = `${dicho.replace(/[.?…]+$/u, '')}!`;
    const verbo = /\?$/u.test(dicho) ? 'preguntas' : 'dices';
    return quien ? `Le ${verbo} a ${quien}: «${dicho}».` : `${capitalizar(verbo)} en voz alta: «${dicho}».`;
  }

  /**
   * La respuesta a un acto de habla que no es pedir un dato: ofrecer ayuda,
   * regalar algo, dar las gracias, pedir que le avisen, despedirse. Sale de
   * lo que siente quien lo oye y de lo que tiene entre manos; sin dados.
   *
   * @param {{acto: string, cosa?: string}|null} acto
   * @param {Object} npc
   * @param {Object} ctx
   * @returns {{texto: string, npcMemory?: Object[], memory?: string[]}|null} null si el acto se contesta como pregunta.
   * @private
   */
  _responderActo(acto, npc, ctx) {
    if (!acto || !npc?.nombre) return null;
    const n = npc.nombre;
    const aprecio = typeof npc.actitud === 'number' ? npc.actitud : 0;
    const recuerdo = (texto) => (npc.refId ? [{ refId: npc.refId, texto, tipo: 'compartido' }] : []);

    switch (acto.acto) {
      case ACTO.ABRIR_CHARLA: {
        // «Hablar con Cordor» sin tema. La primera vez saluda desde su
        // actitud y pregunta qué quieres; si ya estabais hablando, no repite
        // el saludo: pide algo concreto. Salía «Hablas con Cordor. Cordor
        // espera tu respuesta» tres veces sin que nadie dijera nada.
        const turno = ctx.turno ?? 0;
        const hablando = Number.isFinite(npc.ultimoEncuentro) && turno - npc.ultimoEncuentro <= 3;
        if (hablando) {
          return {
            texto: aprecio <= -20 ? `${n} resopla. «¿Qué quieres ahora?»`
              : this._unico([`«Si quieres saber algo, pregúntalo. ¿Y bien?», dice ${n}.`, `${n} deja lo que hacía. «¿Qué te hace falta, exactamente?»`]),
          };
        }
        const clave = typeof npc.actitud === 'string' && NPC.saludos[npc.actitud] ? npc.actitud
          : aprecio >= 30 ? 'amable' : aprecio <= -20 ? 'hostil' : 'cordial';
        const saludo = this._unico(NPC.saludos[clave]);
        const suyo = ACTIVIDAD[sinAcentos(String(npc.rol ?? '').toLowerCase())];
        const dicho = saludo.startsWith('«') ? `${saludo.slice(0, -1).replace(/[.!?]?$/u, (s) => s || '.')}», dice ${n}.` : `${n}. ${saludo}`;
        return { texto: `${suyo ? `${suyo.replace('{n}', n)} ` : ''}${saludo.startsWith('«') ? dicho : `${n} ${saludo.charAt(0).toLowerCase()}${saludo.slice(1)}`}` };
      }
      case ACTO.ALEJAR:
        // «Déjame en paz» no es pedir un favor que se conceda con dados: se
        // respeta. Salía «Eso no puedo hacerlo».
        return {
          texto: aprecio <= -20 ? `«Encantado», dice ${n}, y te da la espalda.`
            : this._unico([`${n} levanta las manos y se aparta. «Como quieras.»`, `${n} asiente y vuelve a lo suyo sin decir nada más.`]),
          npcMemory: recuerdo('Le pidió que le dejara en paz.'),
        };
      case ACTO.ENFRENTAR: {
        // Encararse es tensión: quien lo recibe reacciona según lo que siente
        // por ti. No abre un combate ni trae guardias.
        return {
          texto: aprecio >= 30 ? `${n} te mira como si no te reconociera. «¿A qué viene esto?» Más dolido que asustado.`
            : aprecio <= -20 ? `${n} no se aparta. «Cuidado con lo que haces», dice, y la gente de alrededor empieza a mirar.`
              : this._unico([`${n} da un paso atrás y levanta las manos. «Tranquilo. No busco problemas.»`, `${n} se tensa y te sostiene la mirada. «¿Qué te pasa conmigo?»`]),
          npcMemory: recuerdo('Se le encaró sin motivo aparente.'),
        };
      }
      case ACTO.AGRADECER:
        return {
          texto: aprecio <= -20 ? `${n} se encoge de hombros y no dice nada.`
            : aprecio >= 30 ? this._unico([`${n} sonríe. «A ti.»`, `A ${n} se le nota que le ha gustado oírlo. «Cuando quieras.»`])
              : this._unico([`${n} asiente. «No hay de qué.»`, `${n} le quita importancia con la mano. «Nada, nada.»`]),
        };
      case ACTO.DESPEDIRSE:
        return { texto: aprecio <= -20 ? `${n} ni levanta la vista.` : this._unico([`${n} levanta la mano. «Buen camino.»`, `«Que te vaya bien», dice ${n}.`]) };
      case ACTO.PEDIR_AVISO:
        return {
          texto: aprecio <= -20 ? `«Ya veremos», dice ${n}, sin ningún interés.` : this._unico([`«Si lo veo, te aviso», dice ${n}.`, `${n} asiente. «Descuida: si sé algo, te enteras.»`]),
          npcMemory: recuerdo('Le pidió que le avisara si veía algo.'),
        };
      case ACTO.OFRECER: {
        if (aprecio <= -20) return { texto: `${n} mira lo que le ofreces y no lo coge. «Guárdatelo.»` };
        return {
          texto: this._unico([`${n} lo acepta con un gesto. «Se agradece.»`, `${n} duda un momento y lo acepta. «Gracias. No hacía falta.»`]),
          npcMemory: recuerdo(`Le ofreció ${acto.cosa ?? 'algo'} sin pedir nada a cambio.`),
        };
      }
      case ACTO.OFRECER_AYUDA: {
        // Si está metido en algo que se ve, eso es lo que necesita.
        const sit = ctx.situacion;
        const suyo = sit?.actores?.some((a) => a.refId && a.refId === npc.refId);
        if (suyo && aprecio > -20) {
          const primera = String(sit.texto ?? '').split(/(?<=\.)\s+/)[0];
          return { texto: `«Pues no me vendría mal», dice ${n}. ${primera}`.trim() };
        }
        return {
          texto: aprecio <= -20 ? `«De ti no necesito nada», dice ${n}.`
            : aprecio >= 30 ? `«Te lo agradezco, de verdad», dice ${n}. «Pero esto lo saco yo.»`
              : this._unico([`«Se agradece, pero me apaño», dice ${n}.`, `${n} niega con la cabeza. «Estoy bien, gracias.»`]),
        };
      }
      default:
        return null;
    }
  }

  _testimonio(npc, texto) {
    const t = [...(npc?.memoria ?? [])].reverse().find((m) => m.tipo === 'testimonio');
    if (!t) return '';
    const n = sinAcentos(String(texto ?? '').toLowerCase());
    return QUE_PASO.test(n) ? t.texto : '';
  }

  _loQueRecuerda(npc, turno) {
    // Solo se reconoce a quien ya ha tratado con el jugador. Lo que vivió él
    // solo (un testimonio de lo que pasó en la calle) no es recordarle.
    const memoria = (npc?.memoria ?? []).filter((m) => !['encuentro', 'actitud', 'testimonio'].includes(m.tipo));
    if (!memoria.length) return '';
    const ultima = npc.ultimoEncuentro ?? null;
    if (ultima === null || turno - ultima < 3) return '';

    const negativa = [...memoria].reverse().find((m) => m.tipo === 'negativa');
    if (negativa) {
      const cita = negativa.texto.match(/«[^»]*»|"[^"]*"|“[^”]*”/u)?.[0];
      if (cita) return `${npc.nombre} no ha olvidado lo que le dijiste: ${cita}.`;
    }

    const actitud = npc.actitud ?? 0;
    return actitud >= 30
      ? `${npc.nombre} te reconoce enseguida, y se le nota que se alegra.`
      : actitud <= -20
        ? `${npc.nombre} te reconoce, y no parece alegrarse.`
        : `${npc.nombre} te reconoce. Se acuerda de ti.`;
  }

  /**
   * Lo que contesta alguien a una frase que no es una pregunta.
   *
   * Contestaba siempre con un saludo de catálogo —«Pasa, pasa. ¿En qué te
   * ayudo?»— dijera el jugador lo que dijera. Ahora se mira qué es: un
   * saludo se devuelve, una petición se concede o no según la tirada, y lo
   * que se le cuenta se escucha.
   * @private
   */
  _responderAfirmacion(peticion, ctx, npc, actitud) {
    const dicho = sinAcentos(String(peticion.accion ?? '').toLowerCase());
    const t = peticion.tirada;

    if (/\b(?:hola|buenas|buenos dias|saludo|me presento)\b/.test(dicho)) {
      return this._unico(NPC.saludos[actitud] ?? NPC.saludos.cordial);
    }
    if (/\b(?:te pido|le pido|os pido|necesito|ayudame|me ayudas|podrias|puedes|dejame|me dejas)\b/.test(dicho)) {
      return t?.exito
        ? this._unico([`${npc.nombre} se lo piensa un momento y acaba asintiendo.`, `${npc.nombre} suspira. «Está bien. Pero que sea rápido.»`])
        : this._unico([`${npc.nombre} niega con la cabeza. «Eso no puedo hacerlo.»`, `${npc.nombre} te sostiene la mirada. «No.»`]);
    }
    if (/\b(?:cuento|le cuento|explico|le explico|le digo que|te digo que|le hablo de)\b/.test(dicho)) {
      return this._unico([
        `${npc.nombre} te escucha sin interrumpir. Cuando terminas, se queda un momento callado, midiéndote.`,
        `${npc.nombre} escucha con atención. No dice nada, pero algo ha cambiado en su gesto.`,
      ]);
    }
    // Una amenaza o un grito tienen respuesta, y depende de quién la recibe:
    // no reacciona igual quien te aprecia que quien ya no se fía de ti.
    if (/arrepent|te mato|largate|que se largue|os largueis|te parto|te rajo|cuidado conmigo|\bo te\b|grit/.test(dicho)) {
      const aprecio = typeof npc.actitud === 'number' ? npc.actitud : 0;
      return aprecio >= 30
        ? `${npc.nombre} te mira como si no te reconociera. «¿A qué viene eso?»`
        : aprecio <= -20
          ? `${npc.nombre} no se mueve. «Inténtalo», dice, y no aparta la vista.`
          : `${npc.nombre} da un paso atrás, más por prudencia que por miedo, y no dice nada.`;
    }
    // Lo demás se oye, y quien lo oye sigue con lo suyo: se ve qué hace.
    const suyo = ACTIVIDAD[sinAcentos(String(npc.rol ?? '').toLowerCase())];
    const resultado = t ? ` ${this._narrarResultado(t, peticion.intencion)}` : '';
    return suyo
      ? `${suyo.replace('{n}', npc.nombre)} Te ha oído, pero no contesta.${resultado}`
      : `${npc.nombre} te oye y no contesta.${resultado}`;
  }

  _aQuienSeHabla(peticion, ctx) {
    const presentes = ctx.npcsPresentes ?? [];
    const resuelto = ctx.interpretacion?.segmentos?.find((s) => s.destinatario)?.destinatario;
    if (resuelto?.refId) {
      const npc = presentes.find((n) => n.refId === resuelto.refId);
      if (npc) return { npc, ausente: null };
    }
    if (resuelto && resuelto.implicito && resuelto.estado === 'ambiguo') return { npc: null, ausente: null, alAire: true };
    const llano = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const frase = llano(ctx.foco ?? peticion.accion);

    const m = frase.match(/\b(?:pregunto|preguntar|hablo|hablar|digo|decir|le pregunto|le digo|enfrento|encaro)\s+(?:a la|al|a|con la|con el|con)\s+([a-zñ]+)/u);
    const destinatario = m?.[1] ?? null;
    // «le pregunto por el paso» sin decir a quién: a quien se estaba
    // hablando, no al primero de la lista.
    const reciente = [...presentes].sort((a, b) => (b.ultimoEncuentro ?? -1) - (a.ultimoEncuentro ?? -1))[0];
    const nombrado = presentes.find((n) => n?.nombre && frase.includes(llano(n.nombre)));
    if (!destinatario) return { npc: nombrado ?? reciente ?? presentes[0] ?? null, ausente: null };

    const SINONIMOS = {
      tabernero: ['tabernero', 'tabernera', 'posadero', 'posadera', 'mesonero', 'mesonera'],
      tabernera: ['tabernero', 'tabernera', 'posadero', 'posadera', 'mesonero', 'mesonera'],
      posadero: ['posadero', 'posadera', 'tabernero', 'tabernera'],
      posadera: ['posadero', 'posadera', 'tabernero', 'tabernera'],
      herrero: ['herrero', 'herrera', 'aprendiz de forja'],
      herrera: ['herrero', 'herrera', 'aprendiz de forja'],
      guardia: ['guardia', 'soldado', 'centinela'],
      soldado: ['guardia', 'soldado', 'centinela'],
    };
    const buscados = SINONIMOS[destinatario] ?? [destinatario];

    const npc = presentes.find((n) => {
      const nombre = llano(n.nombre);
      const rol = llano(n.rol);
      return nombre.split(/\s+/).includes(destinatario) || buscados.some((b) => rol.includes(b));
    });

    if (npc) return { npc, ausente: null };

    // Solo se dice «no hay» de un oficio, no de un nombre propio: si pregunta
    // por «Helta» y no está, eso es asunto de la pregunta, no del destinatario.
    const esOficio = Boolean(SINONIMOS[destinatario]) || /(ero|era|ista|ante|dor|dora)$/.test(destinatario);
    if (!esOficio) return { npc: presentes[0] ?? null, ausente: null };

    const EPICENOS = new Set(['guardia', 'centinela', 'guia']);
    const femenino = /a$/.test(destinatario) && !EPICENOS.has(destinatario);
    return { npc: presentes[0] ?? null, ausente: `${femenino ? 'ninguna' : 'ningún'} ${destinatario}` };
  }

  /**
   * Contesta a una pregunta concreta, recogiendo el tema.
   *
   * Devuelve `null` si la acción no era una pregunta, y entonces el saludo del
   * catálogo sigue valiendo.
   *
   * Lo que hace que esto funcione no es la plantilla: es el TEMA. «¿Forja
   * Alta? Eso queda lejos» convence porque repite lo que preguntaste; «Buenas,
   * ¿qué necesitas?» no convence de nada porque vale para cualquier cosa. Se
   * saca el sustantivo clave de la pregunta y se mete en la respuesta.
   *
   * El resultado de la tirada decide qué tipo de respuesta toca: con éxito hay
   * pista de verdad, atada a los ganchos del lugar o al hilo del jugador; con
   * fallo hay evasiva creíble, que no es lo mismo que silencio.
   *
   * @param {Object} peticion
   * @param {Object} ctx
   * @param {Object} npc
   * @returns {string|null}
   * @private
   */
  _responderPregunta(peticion, ctx, npc, recordado = '') {
    const accion = String(ctx.foco ?? peticion.accion ?? '').trim();
    if (!accion) return null;

    const plano = sinAcentos(accion.toLowerCase());

    // Sin `\b` de cierre: «pregunto» sigue a «pregunt» con una letra.
    const esPregunta = accion.includes('?')
      || /\b(pregunt|le digo si|si ha visto|si sabe|sabe algo|ha oido|has oido|que sabe|quien|donde|cuando|por que|cuanto|exijo que me diga|que me diga)/.test(plano);
    if (!esPregunta) return null;

    // Lo que contesta sale de lo que sabe (ver `narrador/Conocimiento.js`):
    // del mapa, de la ficha del lugar, de lo que ha visto y de su oficio. Si
    // no lo sabe, lo dice y señala a quién preguntar; solo esquiva si tiene
    // un motivo que se ve. Antes salía de tres plantillas evasivas y de un
    // gancho del lugar al azar: «El paso del norte… mira», y un rumor sobre
    // hierro que no venía a cuento.
    const saber = queSabe({
      npc,
      texto: accion,
      lugar: ctx.mundo?.ubicacion,
      conocidos: ctx.conocidos ?? ctx.npcsPresentes ?? [],
      situacion: ctx.situacion,
      hechos: (ctx.hechosTextos ?? []).map((texto) => ({ texto })),
      sucesos: ctx.sucesos ?? null,
      estacion: ctx.mundo?.estacion ?? null,
      lore: ctx.jugador?.lore ?? null,
    });

    // La tirada social ya está echada y manda sobre CUÁNTO cuenta, no sobre
    // si miente: con éxito se abre más; con fallo contesta lo justo.
    const t = peticion.tirada;
    const conGanas = !t || t.exito;
    if (!conGanas) saber.nuevos = saber.nuevos.slice(0, 1);
    const { lineas, contado } = responder(saber, npc, { elegir: (l) => this._unico(l), seco: !conGanas, recordado: Boolean(recordado) });

    return {
      texto: lineas.join('\n'),
      npcMemory: npc.refId ? contado.map((texto) => ({ refId: npc.refId, texto, tipo: 'compartido' })) : [],
      // Lo que cuenta un PNJ es lo que él dice, no la verdad del mundo.
      memory: contado.slice(0, 2).map((d) => `Según ${npc.nombre}: ${d}`.slice(0, 200)),
    };
  }

  /**
   * Genera un PNJ coherente con el lugar.
   *
   * Nombre compuesto de sílabas, oficio acorde al terreno y un rasgo físico
   * memorable. No es Shakespeare, pero da personas distintas cada vez.
   *
   * @private
   */
  _generarNPC(ctx) {
    const flujo = this._flujo();

    // Antes de inventar a nadie, se mira si el jugador ya nombró a alguien que
    // aún no ha aparecido.
    //
    // Es la diferencia entre un mundo que responde y uno que solo produce.
    // Quien lleva tres turnos preguntando por el capitán Verros no necesita
    // conocer a un tal Korsel: necesita que Verros aparezca. Y cuando aparece,
    // aparece con lo que el jugador dijo de él, no con un oficio del dado.
    const pendiente = (ctx.canon ?? [])
      .find((c) => c.tipo === 'persona' && c.rasgos.length && !c.presentado);

    if (pendiente && flujo.oportunidad(0.45)) {
      const rol = pendiente.rasgos[0];
      const nota = pendiente.notas[0] ?? '';

      return {
        datos: {
          refId: `npc_${pendiente.nombre.toLowerCase().replace(/\s+/g, '_')}`,
          nombre: pendiente.nombre,
          rol,
          rasgo: nota || rol,
          actitud: 'cauto',
        },
        presentacion: nota
          ? `Y entonces lo ves: ${pendiente.nombre}. El mismo ${rol} del que no has dejado de hablar, el que ${nota}.`
          : `Y entonces lo ves: ${pendiente.nombre}, el ${rol}. En carne y hueso, por fin.`,
      };
    }

    const nombre = capitalizar(
      flujo.elegir(NPC.nombres.pilaA) + flujo.elegir(NPC.nombres.pilaB),
    );

    // El oficio se filtra por lo que encaja en el terreno actual.
    const terreno = ctx.mundo?.terreno ?? 'camino';
    const compatibles = NPC.oficios.filter((o) => {
      if (terreno === 'ciudad') return true;
      if (terreno === 'bosque') return ['cazador', 'granjero', 'contrabandista'].includes(o.nombre);
      if (terreno === 'camino') return ['mercader', 'granjero', 'guardia', 'mendigo'].includes(o.nombre);
      if (terreno === 'oceano') return ['capitana', 'contrabandista', 'mercader'].includes(o.nombre);
      return ['cazador', 'contrabandista', 'mercader'].includes(o.nombre);
    });

    const oficio = flujo.elegir(compatibles.length ? compatibles : NPC.oficios);
    const rasgo = this._unico(NPC.rasgos);

    const presentaciones = [
      `Aparece ${nombre}, ${oficio.nombre} ${rasgo}.`,
      `Alguien se acerca: ${nombre}, ${oficio.nombre}, ${rasgo}.`,
      `Te cruzas con ${nombre}. Es ${oficio.nombre}, ${rasgo}.`,
    ];

    return {
      datos: {
        refId: `npc_${nombre.toLowerCase()}`,
        nombre,
        rol: oficio.nombre,
        actitud: oficio.actitud,
        rasgo,
        presente: true,
      },
      presentacion: this._unico(presentaciones),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSECUENCIAS Y OPCIONES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Consecuencias mecánicas del turno.
   *
   * El director procedural es deliberadamente conservador: apenas toca el
   * estado. El desgaste ya lo gestiona el reloj; aquí solo se añaden efectos
   * directamente ligados a lo que pasó.
   *
   * @private
   */
  _consecuencias(peticion, ctx) {
    const updates = {};
    const t = peticion.tirada;

    if (!t) return updates;

    // Una pifia en algo físico cuesta algo de vida.
    if (t.pifia && categoriaDe(t.habilidad) === 'fisico') {
      updates.hp = { delta: -this._flujo().entero(1, 4) };
    }

    // Un éxito rotundo levanta el ánimo; un fracaso grave lo hunde.
    if (t.grado === 'exitoRotundo') {
      updates.morale = { delta: 3 };
    } else if (t.grado === 'fracasoGrave') {
      updates.morale = { delta: -4 };
    }

    return updates;
  }

  /**
   * Elige el conjunto de opciones adecuado a la situación.
   * @private
   */
  _opciones(ctx) {
    let base;

    if (ctx.combate) base = OPCIONES.combate;
    else if (ctx.npcsPresentes?.length) base = OPCIONES.npcPresente;
    else base = OPCIONES.exploracion;

    // Se ofrece un subconjunto, no la lista entera: cuatro opciones se leen,
    // seis empiezan a ser ruido.
    const elegidas = this._flujo().elegirVarios(base, 4);

    return elegidas.map((o, i) => ({ ...o, id: `c${i + 1}` }));
  }

  /**
   * Tono emocional del turno, para que la interfaz pueda reaccionar.
   * @private
   */
  _tono(peticion, ctx) {
    if (ctx.combate) return 'tension';

    const t = peticion.tirada;
    if (t?.critico) return 'triunfo';
    if (t?.pifia) return 'desastre';
    if (t && !t.exito) return 'frustracion';

    if ((ctx.mundo?.turnosDesdeEncuentro ?? 0) > 6) return 'inquietud';
    if (ctx.mundo?.franja === 'noche') return 'sombrio';

    return 'neutro';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RESUMEN DE CAPÍTULO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Resume una tanda de turnos.
   *
   * Devuelve null a propósito: MemoryStore tiene su propio resumen mecánico y
   * hace mejor trabajo que cualquier plantilla que se pudiera escribir aquí.
   *
   * @returns {Promise<string|null>}
   */
  async resumir() {
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ANTIRREPETICIÓN
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Elige un fragmento evitando los usados recientemente.
   *
   * Es lo que separa una gramática generativa aceptable de una irritante. Sin
   * este filtro, la aleatoriedad pura repite la misma frase cada cinco turnos.
   *
   * @param {string[]} lista
   * @returns {string}
   * @private
   */
  _unico(lista) {
    if (!lista?.length) return '';
    if (lista.length === 1) return lista[0];

    // La familia se identifica por su contenido: la misma lista, llamada desde
    // donde sea, comparte memoria. Cambiar una opción crea una familia nueva,
    // que es lo correcto: ya no es la misma baraja.
    const familia = lista.join('\u0001');
    const recientes = this._porFamilia.get(familia) ?? [];

    // Se descartan las últimas N-1: así SIEMPRE queda al menos una candidata y
    // no hace falta el recurso de «si no hay, vale cualquiera», que era justo
    // por donde se colaban las repeticiones.
    const disponibles = lista.filter((f) => !recientes.includes(f));
    const elegido = this._flujo().elegir(disponibles.length ? disponibles : lista);

    recientes.push(elegido);
    while (recientes.length > lista.length - 1) recientes.shift();
    this._porFamilia.set(familia, recientes);

    // La ventana global se mantiene: sirve para que dos familias distintas no
    // suelten la misma frase si alguna vez comparten texto.
    this._usados.add(elegido);

    if (this._usados.size > this._ventana) {
      const mitad = [...this._usados].slice(this._ventana / 2);
      this._usados = new Set(mitad);
    }

    return elegido;
  }

  /**
   * Flujo aleatorio narrativo.
   * @private
   */
  _flujo() {
    return this.rng?.flujo('narrativa') ?? {
      elegir: (l) => l[Math.floor(Math.random() * l.length)],
      elegirVarios: (l, n) => [...l].sort(() => Math.random() - 0.5).slice(0, n),
      entero: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
      oportunidad: (p) => Math.random() < p,
    };
  }

  /**
   * Verbo asociado a una intención, para las entradas de memoria.
   * @private
   */
  _verboDe(intencion) {
    const verbos = {
      attack: 'atacar', talk: 'hablar', explore: 'explorar', open: 'abrir',
      hide: 'esconderse', negotiate: 'negociar', use_item: 'usar un objeto',
      flee: 'huir', rest: 'descansar', travel: 'viajar', search: 'registrar',
      persuade: 'persuadir', intimidate: 'intimidar', deceive: 'engañar',
      observe: 'observar', cast: 'lanzar un glifo', trade: 'comerciar',
    };
    return verbos[intencion?.tipo] ?? 'actuar';
  }
}

export default ProceduralProvider;
