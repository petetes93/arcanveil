/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · ai/providers/GroqProvider.js
 * ---------------------------------------------------------------------------
 * Narrador con IA Groq (openai/gpt-oss-120b), a través del puente local.
 *
 * El navegador nunca ve la clave: habla con `tools/groq-proxy.mjs` en
 * 127.0.0.1, que es quien la tiene. Groq corre en la nube, no en el PC, así
 * que cada turno envía a Groq el contexto narrativo. Por eso:
 *
 *   · No se activa por defecto ni manda nada hasta que el jugador lo elige
 *     sabiendo qué sale de su equipo (`consentido`). Ese permiso vale para
 *     ESTA sesión: no se guarda. Tras recargar o cargar partida no sale nada
 *     hasta un gesto nuevo.
 *   · «Probar conexión» es otro permiso, más pequeño: pide la lista de
 *     modelos, sin generar nada ni enviar la partida. Y comprueba que quien
 *     contesta en esa dirección es el puente de ARCANVEIL: no se envía la
 *     historia a una dirección cualquiera que responda.
 *   · Cada turno es independiente: la política del narrador (idéntica
 *     siempre, para que Groq la cachee) y una instantánea del mundo ya
 *     resuelta. No hay historial que pueda quedarse viejo: tras una caída,
 *     el siguiente turno llega con el estado de ahora.
 *   · Si Groq pide esperar poco, se espera una vez; si es la cuota del día,
 *     se pausa y el turno lo narra el procedural. Nunca otra nube.
 *   · Un reintento lleva el mismo identificador de turno: el puente no lo
 *     cobra dos veces.
 *
 * Lo que devuelve NO es autoridad: TurnResolver lo verifica contra el
 * estado y solo aplica los efectos que la política autoriza.
 *
 * Dependencias: IDMProvider, PromptBuilder, ResponseParser.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { IDMProvider } from './IDMProvider.js';
import * as Prompt from '../PromptBuilder.js';
import * as Parser from '../ResponseParser.js';
import { PROVEEDORES } from '../../config/ai.config.js';

/** El único modelo que usa, el mismo que admite el puente. */
export const MODELO_GROQ = 'openai/gpt-oss-120b';

/** Dirección por defecto del puente. */
export const URL_PUENTE_GROQ = 'http://127.0.0.1:11436';

/** Cómo se identifica el puente de ARCANVEIL (ver tools/groq-proxy.mjs). */
export const SERVICIO_PUENTE = /^arcanveil-puente-groq\/\d+$/;

/** Lo que se espera como mucho a que Groq deje pasar, sin dar el turno por perdido. */
const ESPERA_CORTA_S = 8;

export class GroqProvider extends IDMProvider {
  static id = PROVEEDORES.GROQ;
  static nombre = 'IA Groq';
  static autonomo = false;

  constructor(opciones = {}) {
    super(opciones);
    this._url = URL_PUENTE_GROQ;
    this._consentido = false;
    this._verificado = null;   // la dirección que se identificó como el puente, en esta sesión
    this._pausaHasta = 0;
    this._motivoPausa = null;
    this._ultimoUso = null;
    this._fetch = opciones.fetch ?? ((...a) => fetch(...a));
    this._dormirMs = opciones.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.solicitudes = 0;
  }

  /**
   * @param {Object} config
   * @param {string} [config.url]
   * @param {boolean} [config.consentido] El jugador sabe qué se envía y lo acepta.
   */
  configurar(config = {}) {
    if (config.url !== undefined) {
      const nueva = String(config.url).trim().replace(/\/+$/, '');
      // Cambiar la dirección obliga a volver a comprobar quién contesta.
      if (nueva !== this._url) this._verificado = null;
      this._url = nueva;
    }
    if (config.consentido !== undefined) this._consentido = config.consentido === true;
  }

  /** @returns {{disponible: boolean, motivo: string|null}} */
  comprobar() {
    if (!this._consentido) {
      return { disponible: false, motivo: 'Groq no se usa hasta que aceptes, en Narrador, que cada turno envía el contexto narrativo a Groq.' };
    }
    if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(this._url)) {
      return { disponible: false, motivo: 'El puente de Groq tiene que estar en este equipo (http://127.0.0.1:<puerto>).' };
    }
    if (this._verificado !== this._url) {
      return { disponible: false, motivo: 'Prueba la conexión con el puente en esta sesión antes de usar Groq.' };
    }
    if (this._pausaHasta > Date.now()) {
      return { disponible: false, motivo: this._motivoPausa ?? 'Groq está en pausa por la cuota gratuita.' };
    }
    return { disponible: true, motivo: null };
  }

  /**
   * Prueba el puente y la cuenta sin generar nada ni enviar la partida.
   * @returns {Promise<{ok: boolean, motivo: string|null, estado?: Object}>}
   */
  async probar() {
    if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(this._url)) return { ok: false, causa: 'direccion', motivo: 'Dirección del puente no válida.' };
    let r;
    try {
      r = await this._fetch(`${this._url}/probar`);
    } catch {
      this._verificado = null;
      return this._sinLectura();
    }
    const datos = await r.json().catch(() => ({}));
    if (!SERVICIO_PUENTE.test(String(datos?.servicio ?? ''))) {
      this._verificado = null;
      return { ok: false, causa: 'otro_servicio', motivo: `En ${this._url} contesta otro programa: no es el puente de ARCANVEIL. No se le enviará nada. Ciérralo, o arranca el puente en otro puerto.` };
    }
    // Lo que diga el puente (clave rechazada, cuota, red) es más útil que un código.
    if (!r.ok) return { ok: false, causa: `puente_${r.status}`, motivo: datos?.error?.message ?? `El puente respondió ${r.status}.` };
    if (!datos.disponible) return { ok: false, causa: 'modelo', motivo: `La cuenta no tiene ${MODELO_GROQ} disponible.` };
    this._verificado = this._url;
    const estado = await this.estado();
    return { ok: true, causa: null, motivo: null, estado };
  }

  /**
   * Cuando `fetch` no llega a dar respuesta, falla igual si no hay nadie
   * escuchando que si hay alguien que no deja leer desde esta página (el
   * puente arrancado para otra dirección, u otro programa sin CORS). Se decía
   * siempre «No se encuentra el puente», y con el puente arrancado eso
   * mandaba a arrancarlo otra vez. Una petición opaca (`no-cors`) distingue
   * las dos cosas: sale si algo contesta, aunque no se pueda leer. Va a
   * `/estado`, que no llama a Groq.
   * @private
   */
  async _sinLectura() {
    try {
      await this._fetch(`${this._url}/estado`, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      return { ok: false, causa: 'sin_puente', motivo: `No hay nada escuchando en ${this._url}. Arranca el puente con: node tools/iniciar-groq.mjs` };
    }
    const aqui = globalThis.location?.origin ?? 'esta página';
    return {
      ok: false,
      causa: 'no_deja_leer',
      motivo: `Algo contesta en ${this._url}, pero no deja leer la respuesta desde ${aqui}. O el puente se arrancó para otra dirección (juega en la que indica node tools/iniciar-groq.mjs al arrancar), o ese puerto lo usa otro programa.`,
    };
  }

  /** Uso de hoy y pausas, según el puente. Sin llamar a Groq. */
  async estado() {
    try {
      const r = await this._fetch(`${this._url}/estado`);
      return r.ok ? r.json() : null;
    } catch {
      return null;
    }
  }

  /**
   * Narra un turno.
   *
   * Lanza si no puede: el coordinador hace entonces que narre el procedural
   * y lo avisa. No reintenta por su cuenta más que una espera corta.
   *
   * @param {Object} peticion Con `instantanea` e `idTurno`.
   * @returns {Promise<Object>}
   */
  async dirigir(peticion) {
    const listo = this.comprobar();
    if (!listo.disponible) throw Object.assign(new Error(listo.motivo), { codigo: 'no_disponible' });
    if (!peticion?.instantanea) throw Object.assign(new Error('Falta la instantánea del turno.'), { codigo: 'sin_instantanea' });

    const mensajes = [
      { role: 'system', content: Prompt.sistema() },
      { role: 'user', content: Prompt.turnoDesdeInstantanea(peticion.instantanea) },
    ];
    const crudo = await this._pedir(mensajes, peticion.idTurno, peticion.tipo);
    return this._analizar(crudo, peticion);
  }

  /**
   * Una segunda petición para corregir una respuesta que contradice el
   * estado. Solo se usa si quien llama lo decide, y se avisa al jugador de
   * que gasta otra solicitud.
   *
   * @param {Object} peticion
   * @param {string} anterior JSON devuelto antes.
   * @param {Array<{tipo: string, detalle?: string, frase: string}>} problemas
   */
  async reparar(peticion, anterior, problemas) {
    const lista = problemas.map((p) => `· ${p.tipo}${p.detalle ? ` (${p.detalle})` : ''}: «${p.frase.slice(0, 120)}»`).join('\n');
    const mensajes = [
      { role: 'system', content: Prompt.sistema() },
      { role: 'user', content: Prompt.turnoDesdeInstantanea(peticion.instantanea) },
      { role: 'assistant', content: String(anterior).slice(0, 6000) },
      { role: 'user', content: `Tu respuesta contradice el estado del juego:\n${lista}\nReescríbela sin esas contradicciones, con el mismo formato JSON.` },
    ];
    const crudo = await this._pedir(mensajes, `${peticion.idTurno}-r`, peticion.tipo);
    return this._analizar(crudo, peticion);
  }

  /** @private */
  async _pedir(mensajes, idTurno, tipo) {
    const cuerpo = {
      model: MODELO_GROQ,
      messages: mensajes,
      temperature: tipo === 'combate' ? 0.6 : 0.85,
      max_tokens: tipo === 'combate' ? 500 : 800,
    };
    for (let intento = 0; intento < 2; intento += 1) {
      let r;
      try {
        r = await this._fetch(`${this._url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Arcanveil-Turno': String(idTurno ?? '').slice(0, 64) },
          body: JSON.stringify(cuerpo),
        });
      } catch {
        throw Object.assign(new Error('No se encuentra el puente de Groq. ¿Está arrancado?'), { codigo: 'red' });
      }
      const datos = await r.json().catch(() => ({}));
      if (r.ok) {
        this.solicitudes += 1;
        this._ultimoUso = datos.usage ?? null;
        const texto = datos?.choices?.[0]?.message?.content;
        if (!texto) throw Object.assign(new Error('Groq respondió sin narración.'), { codigo: 'vacio' });
        return texto;
      }
      if (r.status === 429) {
        const espera = Number(r.headers?.get?.('retry-after')) || 60;
        const diaria = datos?.error?.code === 'cuota_diaria' || espera > 120;
        if (!diaria && espera <= ESPERA_CORTA_S && intento === 0) {
          // Un poco más de lo pedido: llegar justo al borde es volver a chocar.
          await this._dormirMs(espera * 1000 + 300);
          continue;
        }
        this._pausaHasta = Date.now() + espera * 1000;
        // El puente dice si el tope es suyo o de Groq; se cuenta tal cual.
        const deQuien = /puente/.test(datos?.error?.message ?? '') ? 'el puente' : 'Groq';
        this._motivoPausa = diaria
          ? 'Se ha agotado la cuota gratuita de Groq por hoy. Sigue el narrador procedural.'
          : `${deQuien === 'Groq' ? 'Groq pide' : 'El puente pide'} esperar ${espera} s por el límite gratuito.`;
        throw Object.assign(new Error(this._motivoPausa), { codigo: diaria ? 'cuota_diaria' : 'cuota_minuto' });
      }
      throw Object.assign(new Error(datos?.error?.message ?? `El puente respondió ${r.status}.`), { codigo: `http_${r.status}` });
    }
    throw Object.assign(new Error('Groq sigue pidiendo esperar.'), { codigo: 'cuota_minuto' });
  }

  /**
   * JSON validado; si llega roto y se rescata prosa, vale como narración
   * pero SIN efectos: un rescate no es un atajo para colar cambios.
   * @private
   */
  _analizar(crudo, peticion) {
    const analisis = Parser.analizar(crudo, { accion: peticion.accion });
    if (!analisis.exito) throw Object.assign(new Error('La respuesta de Groq no se pudo leer.'), { codigo: 'ilegible' });
    const respuesta = analisis.respuesta;
    if (analisis.nivel === Parser.NIVEL.PROSA || analisis.nivel === Parser.NIVEL.PARCIAL) respuesta._sinEfectos = true;
    respuesta._crudo = String(crudo).slice(0, 8000);
    return { respuesta, proveedor: this.id, avisos: analisis.avisos ?? [], degradado: false, nivel: analisis.nivel, uso: this._ultimoUso };
  }

  /** Sin historial que reiniciar: cada turno llega con el estado de ahora. */
  reiniciar() {
    this._pausaHasta = Math.max(this._pausaHasta, 0);
  }

  inspeccionar() {
    return {
      id: this.id,
      url: this._url,
      modelo: MODELO_GROQ,
      consentido: this._consentido,
      verificado: this._verificado === this._url,
      pausa: this._pausaHasta > Date.now() ? { hasta: new Date(this._pausaHasta).toISOString(), motivo: this._motivoPausa } : null,
      solicitudes: this.solicitudes,
      ultimoUso: this._ultimoUso,
    };
  }
}

export default GroqProvider;
