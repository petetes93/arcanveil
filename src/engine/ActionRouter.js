/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/ActionRouter.js
 * ---------------------------------------------------------------------------
 * Enrutado de acciones.
 *
 * Decide quién resuelve cada acción del jugador. Tres destinos:
 *
 *   · LOCAL — el motor lo resuelve solo y no consulta al director. Beber una
 *     poción, mirar el mapa, viajar. Son acciones mecánicas con una respuesta
 *     objetiva.
 *   · DIRECTOR — necesita narración. La mayoría.
 *   · RECHAZADA — no se puede hacer, y se dice por qué.
 *
 * El primer destino es el que más aporta. Consultar a un modelo de lenguaje
 * para decirle al jugador que ha bebido agua es lento, caro y peor: el modelo
 * puede inventarse un efecto que el motor no ha aplicado.
 *
 * El tercero evita una clase entera de frustración. Si el jugador escribe «voy
 * a Forja Alta» y no conoce el sitio, decírselo es mejor que dejar que el
 * director improvise un viaje imposible.
 *
 * Dependencias: SystemBase, sistemas de mundo, inventario y misiones.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import { obtenerSublugar, obtenerLugar } from '../data/locations.data.js';
import { evaluarAmbicion } from './Ambicion.js';
import * as Tablas from '../world/EncounterTables.js';
import { obtenerEnemigo } from '../data/enemies.data.js';
import { DIRECCION } from '../config/balance.config.js';
import { DOMINIO as DOMINIO_RNG } from '../core/RNG.js';
import { obtenerPlantilla } from '../data/items.data.js';
import { ARMAS, leerGesto } from './IntentParser.js';
import { aSegundaPersona } from '../ai/Persona.js';
import { articulo, articuloIndet, capitalizar, sinAcentos } from '../utils/text.js';
import { VOCES } from '../config/ui.config.js';
import { curarConTexto, PIDE_CURAR } from '../player/Curacion.js';
import { SITUACIONES } from '../data/situaciones.data.js';

/**
 * Cómo llama la gente a los enemigos cuando escribe libremente.
 *
 * Las fichas de `enemies.data.js` tienen nombres de catálogo («Saqueador»,
 * «Guardia corrupto») y nadie los usa al jugar. Esto es el puente entre lo
 * que se escribe y lo que hay en las tablas.
 */
const APODOS = Object.freeze({
  saqueador: ['bandido', 'bandidos', 'salteador', 'salteadores', 'ladron', 'ladrones', 'asaltante', 'asaltantes'],
  guardia_corrupto: ['guardia', 'guardias', 'soldado', 'soldados', 'patrulla'],
  lobo_ceniciento: ['lobo', 'lobos', 'bestia', 'bestias', 'manada'],
  espectro_menor: ['espectro', 'espectros', 'fantasma', 'fantasmas', 'aparicion'],
  tejedora_de_umbral: ['arana', 'aranas', 'tejedora'],
  rata_gigante: ['rata', 'ratas'],
  carronero: ['carronero', 'carroneros', 'carrona'],
  bruto_griscuerno: ['bruto', 'brutos', 'gigante'],
});

/**
 * Atacar sin decir a quién: «al que tenga más cerca», «al primero», «a
 * cualquiera». Sin posiciones en el motor, eso no señala a nadie.
 */
const ATAQUE_INDEFINIDO = /\b(?:al|a la|a los|a las|el|la|contra el|contra la) (?:que|quien(?:es)?) (?:tenga|tengo|este|esten|haya|pille|vea)\b|\b(?:al|a la|el|la) mas cercan[oa]\b|\b(?:al|a la|el|la) primer[oa]?(?= que\b| de ellos\b|$|[,.])|\b(?:a|contra) (?:cualquiera|alguien|uno de ellos|una de ellas|todos)\b|\bal de (?:delante|al lado)\b/;

/** «A unos pasos: Garnis (herrera). En la garita del puente: Román (guardia) y Mardo (arriero).» */
function describirGente(gente) {
  const grupos = new Map();
  for (const g of gente) {
    const k = g.sitio ?? 'a unos pasos';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(g.rol ? `${g.nombre} (${g.rol})` : g.nombre);
  }
  const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0]);
  return [...grupos].map(([sitio, xs]) => `${capitalizar(sitio)}: ${lista(xs)}.`).join(' ');
}

/** Destinos posibles. */
export const RUTA = Object.freeze({
  LOCAL: 'local',
  DIRECTOR: 'director',
  RECHAZADA: 'rechazada',
});

/** Los gestos de `IntentParser.leerGesto`, en infinitivo para preguntar. */
const INFINITIVO_GESTO = Object.freeze({
  guardo: 'guardar', envaino: 'envainar', enfundo: 'enfundar', cuelgo: 'colgar',
  ajusto: 'ajustar', limpio: 'limpiar', afilo: 'afilar', reviso: 'revisar',
  compruebo: 'comprobar', engraso: 'engrasar', pulo: 'pulir', coloco: 'colocar',
});

/** Gestos que solo tienen sentido sobre algo con filo. */
const PIDE_FILO = new Set(['afilo', 'envaino']);
const CON_FILO = new Set(['espada', 'hacha', 'daga', 'cuchillo', 'punal', 'sable', 'estoque', 'mandoble', 'lanza']);

export class ActionRouter extends SystemBase {
  static nombre = 'router';
  static dependencias = ['world', 'inventory', 'player'];
  static canal = 'engine';

  /* ═══════════════════════════════════════════════════════════════════════
     ENRUTADO
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Decide cómo se resuelve una acción.
   *
   * @param {Object} intencion Salida de IntentParser.
   * @param {Object} [contexto]
   * @returns {{
   *   ruta: string, motivo: string|null, narracion: string|null,
   *   pistaDirector: string|null, resultado: Object|null
   * }}
   */
  enrutar(intencion, contexto = {}) {
    const vacio = {
      ruta: RUTA.DIRECTOR, motivo: null, narracion: null,
      pistaDirector: null, resultado: null,
    };

    if (!intencion) return vacio;

    // Entrar y salir de un interior, dicho con palabras.
    //
    // El estado tenía `world.sublugar` y nadie lo escribía desde la caja de
    // texto: solo lo hacía la exploración. Así, «entro en la taberna» narraba
    // la entrada y el juego seguía creyendo que estabas en la calle, de modo
    // que al turno siguiente volvía a describir los campos y los caminos.
    //
    // Va antes del switch porque no depende de qué intención se haya deducido:
    // quien dice que entra, entra.
    this._ajustarSublugar(intencion);

    // ─── Comprobaciones que rechazan ────────────────────────────────────
    const rechazo = this._comprobarRechazos(intencion, contexto);
    if (rechazo) return rechazo;

    // ─── Gestos con el equipo ───────────────────────────────────────────
    // Guardar, colgar o limpiar un arma: sin dados, sin director y contra lo
    // que el personaje lleva de verdad.
    if (intencion.gesto) return this._gesto(intencion);

    // ─── El grupo ───────────────────────────────────────────────────────
    if (intencion.tipo === 'recruit') return this._reclutar(intencion);
    if (intencion.tipo === 'dismiss') return this._despedir(intencion);

    // ─── Curarse con palabras ───────────────────────────────────────────
    // «Vendo la herida» fuera de combate: tirada de medicina y, con éxito,
    // algo de vida. En combate lo resuelve la jugada escrita.
    if (!contexto.enCombate && PIDE_CURAR.test(sinAcentos(String(intencion.texto ?? '').toLowerCase()))) {
      const r = curarConTexto(this, null);
      return {
        ruta: RUTA.LOCAL, motivo: null, narracion: r.texto, voz: VOCES.DM,
        pistaDirector: null, resultado: { tipo: 'curacion', cantidad: r.cantidad },
      };
    }

    // ─── Acciones que resuelve el motor ─────────────────────────────────
    switch (intencion.tipo) {
      case 'attack': return this._atacar(intencion, contexto);
      case 'use_item': return this._usarObjeto(intencion);
      case 'travel': return this._viajar(intencion);
      case 'rest': return this._descansar(intencion, contexto);
      case 'explore': return this._explorar(intencion);
      case 'search': return this._registrar(intencion);
      case 'trade': return this._comerciar(intencion);
      default: return vacio;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RECHAZOS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Comprueba si la acción es imposible.
   *
   * Decirlo con claridad es mejor que dejar que el director improvise algo
   * incoherente.
   *
   * @private
   */
  _comprobarRechazos(intencion, contexto) {
    // ─── En combate, ciertas acciones no proceden ───────────────────────
    if (contexto.enCombate) {
      if (intencion.tipo === 'travel') {
        return this._rechazar('No puedes marcharte con un combate en curso.');
      }
      if (intencion.tipo === 'rest') {
        return this._rechazar('No es momento de descansar.');
      }
      if (intencion.tipo === 'trade') {
        return this._rechazar('Nadie va a comerciar contigo en mitad de una pelea.');
      }
    }

    // ─── Estados que impiden actuar ─────────────────────────────────────
    const estados = this.leer('player.estados', []);

    const bloqueantes = {
      paralizado: 'No puedes moverte.',
      moribundo: 'Estás demasiado malherido para eso.',
    };

    for (const estado of estados) {
      const motivo = bloqueantes[estado.refId];
      if (motivo && ['travel', 'explore', 'search'].includes(intencion.tipo)) {
        return this._rechazar(motivo);
      }
    }

    // ─── Viaje sin destino conocido ─────────────────────────────────────
    if (intencion.tipo === 'travel' && intencion.objetivo) {
      const world = this.sistema('world');
      const destino = world?.buscarDestino(intencion.objetivo);

      if (destino?.intuido) {
        return this._rechazar(
          `Sabes que ${destino.nombre} existe, pero no cómo llegar. Tendrás que preguntar o buscar el camino.`,
        );
      }
    }

    return null;
  }

  /**
   * Quién hay en la escena y, si está metido en algo, dónde.
   * @returns {Array<{nombre: string, rol: string|null, sitio: string|null}>}
   * @private
   */
  _gentePresente() {
    const conocidos = this.leer('npcs.conocidos.porId', {}) ?? {};
    const donde = new Map();
    for (const s of this.sistema('situations')?.aqui?.() ?? []) {
      for (const a of Object.values(s.actores ?? {})) if (a.refId) donde.set(a.refId, SITUACIONES[s.refId]?.sitio ?? null);
    }
    return (this.leer('npcs.presentes', []) ?? [])
      .map((id) => conocidos[id])
      .filter((n) => n?.nombre && n.vivo !== false && !n.hostil)
      .map((n) => ({ nombre: n.nombre, rol: n.rol ?? null, sitio: donde.get(n.refId) ?? null }));
  }

  /** @private */
  _rechazar(narracion) {
    return {
      ruta: RUTA.RECHAZADA,
      motivo: narracion,
      narracion,
      pistaDirector: null,
      resultado: null,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ACCIONES LOCALES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Consumir un objeto.
   *
   * Se resuelve local porque el efecto es mecánico y objetivo. Que el director
   * narre el sabor de la poción no compensa el riesgo de que se invente su
   * efecto.
   *
   * @private
   */
  _usarObjeto(intencion) {
    const inventario = this.sistema('inventory');

    // Se busca por el objetivo declarado, o el primer consumible.
    const objetos = Object.values(this.leer('inventory.objetos.porId', {}));
    const consumibles = objetos.filter((o) => o.categoria === 'consumible');

    if (!consumibles.length) {
      return this._rechazar('No llevas nada que puedas usar.');
    }

    let elegido = null;

    if (intencion.objetivo) {
      const buscado = intencion.objetivo.toLowerCase();
      elegido = consumibles.find((o) => o.nombre.toLowerCase().includes(buscado));
    }

    // Sin objetivo claro, se deja al director: puede que el jugador se refiera
    // a algo del entorno y no del inventario.
    if (!elegido) {
      return {
        ruta: RUTA.DIRECTOR,
        motivo: null,
        narracion: null,
        pistaDirector: `El personaje quiere usar algo. Lleva: ${consumibles.map((o) => o.nombre).join(', ')}.`,
        resultado: null,
      };
    }

    this.despachar('inventory/consumir', { idObjeto: elegido.id });

    return {
      ruta: RUTA.LOCAL,
      motivo: null,
      narracion: `Usas ${elegido.nombre.toLowerCase()}.`,
      pistaDirector: null,
      resultado: { tipo: 'consumo', objeto: elegido.nombre },
    };
  }

  /**
   * Los candidatos que encajan con lo que el jugador ha nombrado.
   *
   * «Ataco al primer bandido que vea» devolvía una patrulla de guardias
   * corruptos. El sorteo era correcto y el resultado, absurdo: el jugador había
   * dicho a quién atacaba. Si nombra algo que el terreno puede ofrecer, se
   * sortea solo entre eso; si no nombra nada reconocible, devuelve `null` y
   * decide el sorteo normal.
   *
   * @param {Array<Object>} candidatos
   * @param {string} texto
   * @returns {Array<Object>|null}
   * @private
   */
  _loQueNombro(candidatos, texto) {
    const plano = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!plano) return null;

    const encajan = candidatos.filter((c) => this._terminosDe(c).some((t) => plano.includes(t)));
    return encajan.length ? encajan : null;
  }

  /**
   * Con qué palabras se puede llamar a un encuentro.
   *
   * Sale del propio catálogo (nombre del encuentro y nombre y plural de sus
   * enemigos) más los apodos que la gente usa de verdad y que no están en
   * ninguna ficha: nadie escribe «ataco al saqueador», escribe «bandido».
   *
   * @param {Object} encuentro
   * @returns {Array<string>}
   * @private
   */
  _terminosDe(encuentro) {
    const limpiar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const terminos = new Set();

    for (const e of encuentro.combate?.enemies ?? []) {
      const ficha = obtenerEnemigo(e.refId);
      for (const t of [ficha?.nombre, ficha?.plural]) {
        if (t) terminos.add(limpiar(t));
      }
      for (const apodo of APODOS[e.refId] ?? []) terminos.add(apodo);
    }

    if (encuentro.nombre) terminos.add(limpiar(encuentro.nombre));

    return [...terminos].filter((t) => t.length >= 4);
  }

  /**
   * «¿Vienes conmigo?»: se lo pide a alguien de la escena.
   *
   * A quien nombre la frase, o si solo hay uno delante, a ese. Lo que conteste
   * sale de una tirada social contra lo bien que le cae el personaje; ver
   * `PartySystem.reclutar`.
   *
   * @private
   */
  _reclutar(intencion) {
    const party = this.sistema('party');
    if (!party) return this._rechazar('Aquí no puede unirse nadie.');

    const conocidos = this.leer('npcs.conocidos.porId', {}) ?? {};
    const presentes = (this.leer('npcs.presentes', []) ?? []).map((id) => conocidos[id]).filter(Boolean);
    const frase = sinAcentos(String(intencion.texto ?? '').toLowerCase());

    const nombrado = presentes.find((n) => frase.includes(sinAcentos(n.nombre.toLowerCase())))
      ?? presentes.find((n) => n.rol && frase.includes(sinAcentos(n.rol.toLowerCase())));
    const npc = nombrado ?? (presentes.length === 1 ? presentes[0] : null);

    if (!npc) {
      return this._rechazar(presentes.length
        ? `¿A quién se lo pides? Aquí están ${presentes.map((n) => n.nombre).join(' y ')}.`
        : 'No hay nadie aquí a quien pedírselo.');
    }

    const r = party.reclutar(npc, { pago: Boolean(intencion.pago) });
    return {
      ruta: RUTA.LOCAL, motivo: null, narracion: r.texto, voz: VOCES.DM,
      pistaDirector: null, resultado: { tipo: 'reclutar', unido: r.unido, npc: npc.refId },
    };
  }

  /**
   * «Vete a casa, Grom»: el compañero nombrado, o el único que hay.
   * @private
   */
  _despedir(intencion) {
    const party = this.sistema('party');
    const miembros = party?.miembros?.() ?? [];
    if (!miembros.length) return this._rechazar('No va nadie contigo.');

    const miembro = party.porNombreEn(intencion.texto) ?? (miembros.length === 1 ? miembros[0] : null);
    if (!miembro) return this._rechazar(`¿A quién despides? Van contigo ${miembros.map((m) => m.ficha.nombre).join(' y ')}.`);

    const r = party.despedir(miembro.refId);
    return {
      ruta: RUTA.LOCAL, motivo: null, narracion: r.texto, voz: VOCES.DM,
      pistaDirector: null, resultado: { tipo: 'despedir', npc: miembro.refId },
    };
  }

  /**
   * Un gesto con un arma, narrado contra lo que el personaje lleva.
   *
   * Una enana con un hacha escribió «guardo la espada» y el juego le contestó
   * como si tuviera una. El motor sabe qué lleva.
   *
   * Si lo nombrado no está, se dice qué falta y se pregunta por lo que sí
   * lleva y admite ese gesto, sin hacer nada ni gastar turno. Antes se hacía
   * el gesto con el arma equipada («No llevas hacha; afilas el arco corto»):
   * una acción que nadie pidió, y a veces absurda (afilar un arco o un foco).
   * Ese contrato se retiró a propósito: sustituir el objeto es decidir por el
   * jugador, y lo que se hace sobre el equipo (afilar, guardar) se nota luego.
   *
   * Y el verbo tiene que casar con el objeto: afilar o envainar piden filo.
   *
   * @param {Object} intencion Con `gesto` de `IntentParser.leerGesto`.
   * @returns {Object}
   * @private
   */
  /**
   * Un gesto que va dentro de una orden más larga: devuelve la aclaración
   * si no se puede hacer tal como se escribió, o null si sí.
   *
   * @param {string} texto El trozo de la orden con el gesto.
   * @returns {Object|null}
   */
  comprobarGesto(texto) {
    const gesto = leerGesto(texto);
    if (!gesto) return null;
    const ruta = this._gesto({ gesto, texto });
    return ruta.ruta === RUTA.RECHAZADA ? ruta : null;
  }

  _gesto(intencion) {
    const { verbo, arma } = intencion.gesto;
    const objetos = Object.values(this.leer('inventory.objetos.porId', {}) ?? {}).filter((o) => o?.nombre);
    const llano = (t) => sinAcentos(String(t ?? '').toLowerCase());

    // Qué clase de cosa es cada objeto («Arco corto» → arco). Todo el
    // inventario, no solo las armas: el escudo es armadura y se cuelga igual.
    const tipoDe = (o) => llano(o.nombre).split(/\s+/).find((p) => ARMAS[p]) ?? null;
    const generoDe = (o) => obtenerPlantilla(o.refId)?.genero ?? ARMAS[tipoDe(o)] ?? 'm';
    const conArticulo = (o) => {
      const nombre = o.nombre.charAt(0).toLowerCase() + o.nombre.slice(1);
      return `${articulo(nombre, generoDe(o))} ${nombre}`;
    };

    // Nombres de arma con tilde, tal y como se escriben.
    const CON_TILDE = { punal: 'puñal', baston: 'bastón' };
    const dicha = CON_TILDE[arma] ?? arma;
    const infinitivo = INFINITIVO_GESTO[verbo] ?? verbo;
    const casa = (tipo) => !PIDE_FILO.has(verbo) || CON_FILO.has(tipo);

    // El verbo no casa con lo nombrado: ni se hace ni se busca otra cosa.
    if (!casa(arma)) {
      const un = articuloIndet(dicha, ARMAS[arma] ?? 'm');
      return this._rechazar(`${capitalizar(un)} ${dicha} no se puede ${infinitivo}: no tiene filo.`);
    }

    // Lo lleva: se narra lo que escribió, en segunda persona.
    if (objetos.some((o) => tipoDe(o) === arma)) {
      return {
        ruta: RUTA.LOCAL, motivo: null, voz: VOCES.DM, pistaDirector: null,
        narracion: `${capitalizar(aSegundaPersona(intencion.texto)).replace(/[.!?…]*$/u, '')}.`,
        resultado: { tipo: 'gesto', arma },
      };
    }

    // No lo lleva: se dice y se pregunta. Solo se ofrece lo que admite el gesto.
    const otras = objetos.filter((o) => tipoDe(o) && casa(tipoDe(o)));
    if (!otras.length) {
      return this._rechazar(`No llevas ${dicha}, ni nada más que ${infinitivo}.`);
    }
    const lista = otras.map(conArticulo);
    const cuales = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(', ')} o ${lista.at(-1)}`;
    return this._rechazar(`No llevas ${dicha}. ¿Quieres ${infinitivo} ${cuales}?`);
  }

  /**
   * Cuánto aprieta el mundo, según la intensidad elegida.
   *
   * Los preajustes ya existían en `balance.config.js` y el motor los leía para
   * otras cosas; aquí sirven para que «Pacífica» no signifique solo menos
   * encuentros, sino también grupos más pequeños cuando los hay.
   *
   * @returns {number}
   * @private
   */
  _factorIntensidad() {
    const clave = this.leer('settings.dificultad', 'equilibrado');
    return DIRECCION.preajustes?.[clave] ?? 1;
  }

  /**
   * Actualiza dónde está el personaje cuando dice que entra o que sale.
   *
   * Se compara con el nombre del sublugar y con alias de su tipo, porque nadie
   * escribe «entro en la posada de los Tres Clavos»: escribe «entro en la
   * taberna».
   *
   * @param {Object} intencion
   * @private
   */
  _ajustarSublugar(intencion) {
    const texto = String(intencion.texto ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!texto) return;

    const world = this.sistema('world');
    if (!world) return;

    // Salir: solo si está dentro de algo.
    if (this.leer('world.sublugar') && /\b(salgo|salir|me voy)\b.{0,20}\b(fuera|de aqui|a la calle|del local|de la taberna|de la posada|de la fragua)\b|\bsalgo fuera\b/.test(texto)) {
      world.entrarEn(null);
      return;
    }

    if (!/\b(entro|entrar|paso a|me meto|voy a la|voy al|subo a|bajo a|cruzo la puerta)\b/.test(texto)) return;

    const lugar = obtenerLugar(this.leer('world.ubicacion'));
    const sublugares = lugar?.sublugares ?? [];
    if (!sublugares.length) return;

    const ALIAS = {
      posada: ['posada', 'taberna', 'meson'],
      herrero: ['fragua', 'herreria', 'herrero'],
      mercado: ['mercado', 'plaza', 'puesto'],
      templo: ['templo', 'santuario', 'capilla'],
    };

    const destino = sublugares.find((s) => {
      const nombre = String(s.nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (nombre && texto.includes(nombre)) return true;
      return (ALIAS[s.tipo] ?? [s.tipo]).some((a) => new RegExp(`\\b${a}`).test(texto));
    });

    if (destino) world.entrarEn(destino.refId);
  }

  /**
   * Atacar cuando no hay a quién.
   *
   * En combate esto no se llama: el panel de combate lleva sus turnos. Esto es
   * para el jugador que escribe «ataco al primer enemigo que vea» caminando
   * por un camino vacío.
   *
   * Antes caía al director con una tirada de ataque y ya está: salía «d20 17 ·
   * 16 vs 15 · ÉXITO» y una narración de que atacas, sin enemigo, sin panel de
   * combate y con `combat.activo` en falso. Una tirada de ataque sin objetivo
   * no significa nada, y el arte de criaturas no se llegaba a ver nunca por
   * esta vía.
   *
   * Ahora hay dos caminos, y ninguno tira el dado al aire:
   *
   *   · Sitio con peligro: se saca un encuentro hostil de las mismas tablas
   *     que usan la exploración y el viaje, y se abre el combate con su
   *     criatura. Buscar pelea donde la hay, la encuentra.
   *   · Sitio seguro: lo narra el director. No hay a quién atacar, y desenvainar
   *     en un pueblo con guardia tiene sus propias consecuencias.
   *
   * @private
   */
  _atacar(intencion, contexto) {
    // Con un combate en curso, el panel manda.
    if (contexto.enCombate) return { ruta: RUTA.DIRECTOR, motivo: null, narracion: null, pistaDirector: null, resultado: null };

    // Empezar una pelea exige que el jugador lo haya dicho claro.
    //
    // Abrir combate es de lo poco que este juego hace de forma irreversible, y
    // el analizador lo deduce por palabras sueltas: nombrar un arma bastaba
    // para que «guardo la espada» o «me acerco con la mano lejos de la espada»
    // acabaran en una pelea a tres contra uno. Con poca confianza se manda al
    // director, que lo narra sin desenvainar por su cuenta.
    if ((intencion.confianza ?? 0) < 0.6) {
      return {
        ruta: RUTA.DIRECTOR,
        motivo: null,
        narracion: null,
        pistaDirector: 'El personaje menciona un arma o hace un gesto que podría ser hostil, '
          + 'pero no ha declarado que ataque. Narra el gesto y su efecto en quien lo vea. No empieces un combate.',
        resultado: null,
      };
    }

    const world = this.sistema('world');
    const lugar = world?.lugarActual();
    const peligro = lugar?.plantilla?.peligroBase ?? 0;
    const terreno = this.leer('world.terreno', 'camino');

    // Quien esté delante y sea hostil es el objetivo, sin necesidad de tablas.
    const hostil = (this.leer('npcs.presentes', []) ?? [])
      .map((id) => this.leer(`npcs.conocidos.porId.${id}`))
      .find((n) => n?.hostil);

    if (hostil?.refId) {
      // Quien ataca, pega primero.
      //
      // El parte mostraba «Guardia corrupto B te ataca…» ANTES de «Atacas a
      // Guardia corrupto B…» aunque el combate lo había abierto el jugador
      // declarando el ataque. La iniciativa se sorteaba a ciegas y podía
      // perderla quien había dado el primer paso.
      //
      // `playerAmbush` ya existía en el motor y da +100 de iniciativa a los
      // aliados: es exactamente esto y no lo usaba nadie por esta vía.
      this.emitir('combat:request', { enemies: [{ refId: hostil.refId, count: 1 }], playerAmbush: true, teVen: true, contra: hostil.nombre });

      return {
        ruta: RUTA.LOCAL,
        motivo: null,
        narracion: null,
        pistaDirector: null,
        resultado: { tipo: 'combate', origen: 'npc_presente' },
      };
    }

    // Con gente delante, no se saca a nadie de las tablas.
    //
    // «Ataco al que tenga más cerca» justo después de hablar con la patrulla
    // abría pelea contra un guardia corrupto sacado de la tabla del camino,
    // «que no te ha visto»: alguien que no estaba en la escena. El motor no
    // tiene posiciones, así que no sabe quién está más cerca, y ninguno de los
    // que hay ha buscado pelea: se dice quién hay y dónde, y se pregunta. Si
    // nombra a uno que no es enemigo, se narra la agresión sin abrir combate
    // contra otro.
    const gente = this._gentePresente();
    const dicho = sinAcentos(String(intencion.texto ?? '').toLowerCase());
    if (gente.length && ATAQUE_INDEFINIDO.test(dicho)) {
      return this._rechazar(`Nadie de los que hay te ha buscado pelea, y no está claro contra quién vas. ${describirGente(gente)} Si vas a por alguien, di a por quién.`);
    }
    const agredido = gente.find((g) => new RegExp(`\\b${sinAcentos(g.nombre.toLowerCase())}\\b`).test(dicho));
    if (agredido) {
      return {
        ruta: RUTA.DIRECTOR,
        motivo: null,
        narracion: null,
        pistaDirector: `El personaje ataca a ${agredido.nombre}, que no es un enemigo ni había buscado pelea. `
          + `Narra el golpe o el amago y cómo reaccionan ${agredido.nombre} y quien lo vea. No abras un combate ni saques a nadie que no esté en la escena.`,
        resultado: { tipo: 'agresion', objetivo: agredido.nombre },
      };
    }

    if (peligro > 0 || terreno === 'camino') {
      // `Tablas.elegir` NO sirve aquí: sortea la familia por peso y pisa la que
      // se le pase, así que devolvía encuentros neutros y útiles. Buscando
      // pelea, un mercader ambulante no vale. Se piden los hostiles de frente.
      const hostiles = Tablas.candidatos({ terreno, peligro: Math.max(peligro, 1), familia: 'hostil' })
        .filter((e) => e.combate);

      // El grupo se ajusta a lo que el jugador puede aguantar.
      //
      // «Ataco al primer bandido que vea» a nivel 1 devolvía una patrulla de
      // dos guardias corruptos: 56 PV contra 26. Ahora se recorta al tope de
      // `ajustarAlJugador` y, de lo que quede, se elige lo más flojo. Buscar
      // pelea no puede ser una forma de suicidarse sin verlo venir.
      const vidaJugador = this.leer('player.vida.max', 0);
      const factor = this._factorIntensidad();
      const vidaDe = (refId) => obtenerEnemigo(refId)?.vida ?? 0;

      const ajustados = hostiles
        .map((e) => Tablas.ajustarAlJugador(e, { vidaJugador, factor, vidaDe }))
        .filter(Boolean);

      // De los que caben, se sortea por el peso de la tabla. Quedarse siempre
      // con el más flojo convertíria cada pelea buscada en el mismo saqueador
      // solitario: deja de matar al jugador y pasa a aburrirlo. Todo lo que
      // llega aquí ya cabe en su vida, así que sortear entre ellos es justo.
      // Si el jugador ha dicho a QUIÉN ataca, se le hace caso.
      const posibles = this._loQueNombro(ajustados, intencion.texto) ?? ajustados;

      const encuentro = posibles.length
        ? this.rng.flujo(DOMINIO_RNG.ENCUENTROS)
          .elegirPonderado(posibles.map((e) => ({ valor: e, peso: e.peso ?? 1 })))
        : null;

      if (encuentro?.combate) {
        this.emitir('combat:request', { ...encuentro.combate, playerAmbush: true });

        return {
          ruta: RUTA.LOCAL,
          motivo: null,
          narracion: null,
          pistaDirector: `El personaje buscaba pelea y la ha encontrado: ${encuentro.apertura}`,
          resultado: { tipo: 'combate', origen: 'encuentro', encuentro: encuentro.refId },
        };
      }
    }

    // Sitio tranquilo: lo cuenta el director, y sin tirada.
    return {
      ruta: RUTA.DIRECTOR,
      motivo: null,
      narracion: null,
      pistaDirector: 'El personaje busca pelea y aquí no hay contra quién. '
        + 'Narra que no encuentra enemigo: el sitio está tranquilo, o quien hay no le sigue el juego. '
        + 'Si hay guardia o gente alrededor, que reparen en que va buscando bronca. No hagas ninguna tirada de ataque.',
      resultado: { tipo: 'sin_objetivo' },
    };
  }

  /**
   * Viajar a otro lugar.
   * @private
   */
  _viajar(intencion) {
    const world = this.sistema('world');
    const travel = this.sistema('travel');

    // ─── Viaje en curso: reanudar ───────────────────────────────────────
    if (travel?.interrumpido) {
      travel.reanudar();

      return {
        ruta: RUTA.LOCAL,
        motivo: null,
        narracion: null,
        pistaDirector: null,
        resultado: { tipo: 'viaje_reanudado' },
      };
    }

    // ─── Sin destino: se ofrecen los disponibles ────────────────────────
    if (!intencion.objetivo) {
      const destinos = world?.destinos() ?? [];

      if (!destinos.length) {
        return this._rechazar('No hay ningún sitio conocido al que ir desde aquí.');
      }

      return {
        ruta: RUTA.DIRECTOR,
        motivo: null,
        narracion: null,
        pistaDirector: `El personaje quiere irse pero no ha dicho adónde. Desde aquí puede ir a: ${destinos.map((d) => d.nombre).join(', ')}. Pregúntale.`,
        resultado: null,
      };
    }

    // ─── Destino reconocido ─────────────────────────────────────────────
    const destino = world?.buscarDestino(intencion.objetivo);

    if (!destino) {
      return {
        ruta: RUTA.DIRECTOR,
        motivo: null,
        narracion: null,
        pistaDirector: `El personaje habla de ir a «${intencion.objetivo}», que no está en el mapa. Puede ser un sitio del que ha oído hablar o una confusión.`,
        resultado: null,
      };
    }

    if (!destino.conocido) {
      // Antes de rechazar por mapa se comprueba si lo escrito es una hazaña.
      // «Intento partir la montaña en dos de un tajo» encajaba «montaña» con
      // un lugar desconocido y devolvía «No sabes cómo llegar a Los Pozos
      // Hondos»: ni narración ni tirada, un error de mapa como respuesta a
      // algo épico. El analizador de intención ya no manda eso aquí, pero
      // esto cierra la puerta a las frases que aún lleguen.
      const ambicion = evaluarAmbicion(intencion.texto ?? '', this.leer('player.nivel', 1));

      if (ambicion.grado === 'desmedida') {
        return {
          ruta: RUTA.DIRECTOR,
          motivo: null,
          narracion: null,
          pistaDirector: ambicion.pista,
          resultado: null,
        };
      }

      return this._rechazar(`No sabes cómo llegar a ${destino.nombre}.`);
    }

    // El viaje se emprende de forma asíncrona: el turno no espera.
    queueMicrotask(() => travel?.viajar(destino.refId));

    return {
      ruta: RUTA.LOCAL,
      motivo: null,
      narracion: null,
      pistaDirector: null,
      resultado: { tipo: 'viaje', destino: destino.refId },
    };
  }

  /**
   * Descansar.
   *
   * Se enruta al director porque descansar es narrativamente relevante: puede
   * haber un sueño, una interrupción o una conversación. Pero el motor aplica
   * el efecto antes, para que la narración parta de un hecho consumado.
   *
   * @private
   */
  _descansar(intencion, contexto) {
    const inventario = this.sistema('inventory');
    const tieneProvisiones = inventario?.tieneProvisiones() ?? false;

    // ─── Seguridad del sitio ────────────────────────────────────────────
    const lugar = this.leer('world.ubicacion');
    const peligro = this.leer('world.peligroActual', 0);

    const enSublugar = Boolean(this.leer('world.sublugar'));
    const seguro = enSublugar || peligro <= 1;

    this.despachar('player/descansar', {
      tipo: seguro ? 'largo' : 'corto',
      conProvisiones: tieneProvisiones,
    });

    this.sistema('clock')?.avanzarTiempo(seguro ? 480 : 120, 'descanso');

    // Un descanso largo pone en pie también al grupo: es lo que cura a un
    // compañero herido en combate.
    if (seguro) this.sistema('party')?.descansar?.();

    const pistas = [];

    pistas.push(seguro
      ? 'El personaje descansa a cubierto y sin sobresaltos.'
      : 'El personaje descansa a la intemperie, en un sitio poco seguro. Puede pasar algo.');

    if (!tieneProvisiones) {
      pistas.push('No tiene provisiones: el descanso no le ha quitado el hambre.');
    }

    return {
      ruta: RUTA.DIRECTOR,
      motivo: null,
      narracion: null,
      pistaDirector: pistas.join(' '),
      resultado: { tipo: 'descanso', seguro, conProvisiones: tieneProvisiones },
    };
  }

  /**
   * Explorar.
   * @private
   */
  _explorar(intencion) {
    const exploration = this.sistema('exploration');
    if (!exploration) return { ruta: RUTA.DIRECTOR, motivo: null, narracion: null, pistaDirector: null, resultado: null };

    // Si el jugador nombra un interior, se entra en él.
    if (intencion.objetivo) {
      const entrada = this._buscarSublugar(intencion.objetivo);

      if (entrada) {
        const r = this.sistema('world')?.entrarEn(entrada.refId);

        if (r?.exito) {
          return {
            ruta: RUTA.DIRECTOR,
            motivo: null,
            narracion: null,
            pistaDirector: `El personaje entra en ${entrada.nombre}. Descríbelo.`,
            resultado: { tipo: 'sublugar', sublugar: entrada.refId },
          };
        }

        return this._rechazar(r?.motivo ?? 'No puedes entrar ahí ahora.');
      }
    }

    // El resultado se resuelve de forma asíncrona y llega al director como
    // pista en el turno siguiente.
    const promesa = exploration.explorar();

    return {
      ruta: RUTA.DIRECTOR,
      motivo: null,
      narracion: null,
      pistaDirector: 'El personaje explora los alrededores. El motor está resolviendo qué encuentra.',
      resultado: { tipo: 'exploracion', promesa },
    };
  }

  /**
   * Registrar a fondo.
   * @private
   */
  _registrar(intencion) {
    const exploration = this.sistema('exploration');
    if (!exploration) return { ruta: RUTA.DIRECTOR, motivo: null, narracion: null, pistaDirector: null, resultado: null };

    const promesa = exploration.registrar();

    return {
      ruta: RUTA.DIRECTOR,
      motivo: null,
      narracion: null,
      pistaDirector: 'El personaje registra el sitio a fondo. El motor está resolviendo qué encuentra.',
      resultado: { tipo: 'registro', promesa },
    };
  }

  /**
   * Comerciar.
   * @private
   */
  _comerciar(intencion) {
    const npcs = this.sistema('npcs');
    const mercaderes = npcs?.mercaderesPresentes() ?? [];

    if (!mercaderes.length) {
      // Puede haber un servicio aunque no haya un PNJ mercader presente.
      const time = this.sistema('time');
      const mercado = time?.puedeUsar('mercado');

      if (mercado?.disponible) {
        return {
          ruta: RUTA.DIRECTOR,
          motivo: null,
          narracion: null,
          pistaDirector: 'El personaje busca con quién comerciar. Hay mercado aquí: preséntale a alguien que venda.',
          resultado: null,
        };
      }

      return this._rechazar('No hay nadie con quien comerciar aquí.');
    }

    // Con un solo mercader, se abre directamente.
    if (mercaderes.length === 1) {
      this.emitir('ui:trade:open', { npc: mercaderes[0] });

      return {
        ruta: RUTA.LOCAL,
        motivo: null,
        narracion: null,
        pistaDirector: null,
        resultado: { tipo: 'comercio', mercader: mercaderes[0].refId },
      };
    }

    return {
      ruta: RUTA.DIRECTOR,
      motivo: null,
      narracion: null,
      pistaDirector: `Hay varios con quien comerciar: ${mercaderes.map((m) => m.nombre).join(', ')}. Que el personaje elija.`,
      resultado: null,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUXILIARES
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Busca un sublugar del lugar actual por nombre.
   * @private
   */
  _buscarSublugar(texto) {
    const refId = this.leer('world.ubicacion');
    const lugar = this.sistema('world')?.lugarActual();

    const sublugares = lugar?.plantilla?.sublugares ?? [];
    if (!sublugares.length) return null;

    const limpio = texto.toLowerCase();

    return sublugares.find((s) => s.nombre.toLowerCase().includes(limpio))
      ?? sublugares.find((s) => (s.tipo ?? '').includes(limpio))
      ?? null;
  }

  /** @returns {Object} */
  inspeccionar() {
    return {
      enCombate: this.leer('combat.activo', false),
      destinos: this.sistema('world')?.destinos().length ?? 0,
      mercaderes: this.sistema('npcs')?.mercaderesPresentes().length ?? 0,
    };
  }
}

export default ActionRouter;
