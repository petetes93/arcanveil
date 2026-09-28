/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · persistence/SaveManager.js
 * ---------------------------------------------------------------------------
 * Gestión de partidas guardadas.
 *
 * Aquí se rompe deliberadamente una de las restricciones del proyecto: esto
 * escribe en el navegador del jugador. Por eso lleva tres salvaguardas:
 *
 *   1. DESACTIVADO POR DEFECTO. Sin permiso explícito en Ajustes, este sistema
 *      no toca LocalStorage. La partida vive en memoria y muere al recargar.
 *   2. TODO ES BORRABLE. Un botón vacía cuanto se haya escrito.
 *   3. NUNCA CREDENCIALES. `Serializer` las filtra antes de llegar aquí.
 *
 * Sobre el autoguardado: es la única forma de que una partida larga sobreviva a
 * un cierre accidental de pestaña, y por eso existe. Pero usa una ranura propia
 * que nunca pisa las manuales — sobrescribir el guardado de alguien sin que lo
 * pida es de las peores cosas que puede hacer un juego.
 *
 * También hay exportación a archivo, que funciona con la persistencia
 * desactivada: descargar un JSON no es escribir en el navegador, es entregarle
 * al jugador sus propios datos.
 *
 * Dependencias: SystemBase, Serializer, Migrations.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SystemBase } from '../core/SystemBase.js';
import * as Ser from './Serializer.js';
import * as Mig from './Migrations.js';
import { crearEstadoInicial } from '../core/GameState.js';
import { PERSISTENCIA, APP } from '../config/app.config.js';

/** Eventos publicados. */
export const EVENTOS_GUARDADO = Object.freeze({
  GUARDADO: 'save:done',
  CARGADO: 'save:loaded',
  BORRADO: 'save:deleted',
  ERROR: 'save:error',
  EXPORTADO: 'save:exported',
});

/** Prefijo de las claves en LocalStorage. */
const PREFIJO = 'arcanveil:partida:';

/** Ranura reservada al autoguardado. Nunca pisa las manuales. */
const RANURA_AUTO = 'auto';

export class SaveManager extends SystemBase {
  static nombre = 'saves';
  static dependencias = [];
  static canal = 'persistencia';

  constructor(contexto) {
    super(contexto);

    /** Turno del último autoguardado. @private */
    this._ultimoAuto = 0;

    /** true si LocalStorage está disponible y permitido. @private */
    this._disponible = false;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CICLO DE VIDA
     ═══════════════════════════════════════════════════════════════════════ */

  alIniciar() {
    this._disponible = this._comprobarDisponibilidad();

    // Antes de leer nada: rescatar lo guardado bajo el nombre anterior.
    //
    // Va SIN condicionar a `_disponible` a propósito. Esa bandera dice si se
    // puede guardar AHORA, y es falsa mientras la persistencia esté desactivada
    // —que es como viene de fábrica—. Pero copiar claves que ya están escritas
    // no es guardar: es rescatar. Colgarlo de `_disponible` dejaba las partidas
    // antiguas invisibles justo para quien no había tocado los ajustes.
    this._migrarClavesHeredadas();

    this.escuchar('game:save', ({ ranura, nota }) => this.guardar(ranura, { nota }));
    this.escuchar('game:load', ({ ranura }) => this.cargar(ranura));
    this.escuchar('game:export', () => this.exportar());

    // Activar la persistencia en Ajustes reevalúa la disponibilidad.
    this.escuchar('settings:change', ({ id, valor }) => {
      if (id === 'persistencia') {
        this._disponible = valor ? this._comprobarDisponibilidad() : false;

        if (!valor) {
          this.emitir('ui:notice', {
            mensaje: 'Persistencia desactivada. La partida solo vive en memoria.',
            tipo: 'info',
          });
        }
      }
    });
  }

  /**
   * Cada turno se evalúa si toca autoguardar.
   * @param {Object} contexto
   */
  alTurno(contexto) {
    if (!this._puedeGuardar()) return;
    if (!this.leer('settings.autoguardado', true)) return;

    // Nunca a mitad de combate: el estado de combate no se guarda, así que
    // guardar ahí produciría una partida que arranca en un vacío raro.
    if (this.leer('combat.activo', false)) return;

    const turno = contexto.turno ?? 0;

    if (turno - this._ultimoAuto >= PERSISTENCIA.turnosEntreAutoguardados) {
      this._ultimoAuto = turno;
      this.guardar(RANURA_AUTO, { silencioso: true, nota: 'automático' });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DISPONIBILIDAD
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Comprueba si se puede y se debe escribir en LocalStorage.
   *
   * Dos condiciones: que el jugador lo haya permitido y que el navegador lo
   * ofrezca. La segunda puede fallar en modo privado o con las cookies
   * bloqueadas, y hay que detectarlo escribiendo de verdad.
   *
   * @returns {boolean}
   * @private
   */
  _comprobarDisponibilidad() {
    if (!this.leer('settings.persistencia', false)) return false;

    try {
      const prueba = `${PREFIJO}__prueba__`;
      localStorage.setItem(prueba, '1');
      localStorage.removeItem(prueba);
      return true;
    } catch {
      this.log.aviso('LocalStorage no está disponible: la partida no se guardará');
      return false;
    }
  }

  /**
   * Copia a `arcanveil:` lo que quedó escrito bajo el prefijo `arcanum:`.
   *
   * El juego se llamó ARCANUM hasta el 22-09-2026, y todas sus claves de
   * LocalStorage empezaban por `arcanum:`. Al renombrar el proyecto, un jugador
   * que ya tuviera partidas habría abierto el juego y no habría encontrado
   * ninguna: los datos siguen ahí, pero nadie los busca con ese nombre. Una
   * partida perdida en silencio es el peor resultado posible de un cambio de
   * nombre, que para el jugador no cambia nada.
   *
   * Decisiones deliberadas:
   *
   * - **No se borra el original.** Ocupa unos kilobytes y es la red de
   *   seguridad si la copia sale mal. Que sobre un dato es barato; que falte,
   *   no tiene arreglo.
   * - **No se pisa lo que ya exista** en el prefijo nuevo. Si el jugador ya ha
   *   jugado tras el renombrado, su partida reciente manda sobre la antigua.
   * - **Se recorren las claves antes de tocarlas.** Escribir mientras se
   *   itera `localStorage` corre los índices y se saltaría entradas.
   *
   * Esto puede retirarse cuando no quede nadie con guardados anteriores al
   * renombrado, que en la práctica es nunca: vale lo mismo que la regla de oro
   * de `Migrations.js`, una migración no se borra.
   *
   * @private
   */
  _migrarClavesHeredadas() {
    const VIEJO = 'arcanum:';
    const NUEVO = 'arcanveil:';

    try {
      const pendientes = [];

      for (let i = 0; i < localStorage.length; i++) {
        const clave = localStorage.key(i);
        if (clave?.startsWith(VIEJO)) pendientes.push(clave);
      }

      if (!pendientes.length) return;

      let copiadas = 0;

      for (const clave of pendientes) {
        const destino = NUEVO + clave.slice(VIEJO.length);

        // Ya hay algo más reciente ahí: no se toca.
        if (localStorage.getItem(destino) !== null) continue;

        const valor = localStorage.getItem(clave);
        if (valor === null) continue;

        localStorage.setItem(destino, valor);
        copiadas += 1;
      }

      if (copiadas) {
        this.log.info(`${copiadas} claves de guardado migradas de ARCANUM a ARCANVEIL`);
      }
    } catch (e) {
      // El almacén puede llenarse a mitad de la copia o estar bloqueado. No es
      // motivo para impedir jugar: lo antiguo sigue intacto y se avisa.
      this.log.aviso(`No se pudieron migrar los guardados anteriores: ${e?.message ?? e}`);
    }
  }

  /** @returns {boolean} @private */
  _puedeGuardar() {
    return this._disponible && this.leer('meta.fase') !== 'menu';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     GUARDAR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Guarda la partida en una ranura.
   *
   * @param {string} [ranura='1']
   * @param {Object} [opciones]
   * @param {string} [opciones.nota]
   * @param {boolean} [opciones.silencioso=false]
   * @returns {{exito: boolean, motivo: string|null, tamano: Object|null}}
   */
  guardar(ranura = '1', opciones = {}) {
    if (!this._disponible) {
      const motivo = 'La persistencia está desactivada. Actívala en Ajustes o exporta a archivo.';

      if (!opciones.silencioso) {
        this.emitir('ui:notice', { mensaje: motivo, tipo: 'aviso' });
      }

      return { exito: false, motivo, tamano: null };
    }

    try {
      const guardado = this._construir(opciones.nota);

      // ─── Auditoría de seguridad ───────────────────────────────────────
      // Si algo sensible se hubiera colado, se detecta antes de escribir.
      const auditoria = Ser.auditar(guardado.estado);

      if (!auditoria.limpio) {
        this.log.error('el guardado contiene campos sensibles', auditoria.encontrado);

        return {
          exito: false,
          motivo: 'El guardado contiene datos que no deben persistirse.',
          tamano: null,
        };
      }

      // ─── Tamaño ───────────────────────────────────────────────────────
      const tamano = Ser.medir(guardado);

      if (!tamano.dentroDelLimite) {
        return {
          exito: false,
          motivo: `La partida ocupa ${tamano.kb} KB y no cabe en una ranura.`,
          tamano,
        };
      }

      // ─── Escritura ────────────────────────────────────────────────────
      localStorage.setItem(`${PREFIJO}${ranura}`, JSON.stringify(guardado));

      this.emitir(EVENTOS_GUARDADO.GUARDADO, {
        ranura,
        cabecera: guardado.cabecera,
        tamano,
        automatico: ranura === RANURA_AUTO,
      });

      if (!opciones.silencioso) {
        this.emitir('ui:notice', { mensaje: 'Partida guardada.', tipo: 'exito' });
      }

      this.log.info(`partida guardada en la ranura ${ranura} (${tamano.kb} KB)`);

      return { exito: true, motivo: null, tamano };

    } catch (e) {
      // El error más probable es la cuota agotada.
      const esCuota = /quota|exceeded/i.test(e?.name ?? e?.message ?? '');

      const motivo = esCuota
        ? 'No queda espacio en el navegador. Borra alguna partida antigua.'
        : `No se pudo guardar: ${e.message}`;

      this.log.error('fallo al guardar', e);
      this.emitir(EVENTOS_GUARDADO.ERROR, { operacion: 'guardar', motivo });

      if (!opciones.silencioso) {
        this.emitir('ui:notice', { mensaje: motivo, tipo: 'error' });
      }

      return { exito: false, motivo, tamano: null };
    }
  }

  /**
   * Construye el objeto de guardado.
   * @param {string} [nota]
   * @returns {Object}
   * @private
   */
  _construir(nota) {
    // Los sistemas que guardan estado aparte lo aportan aquí.
    const sistemas = {};

    for (const nombre of ['world', 'events', 'time', 'exploration', 'merchants', 'turns']) {
      const sistema = this.sistema(nombre);
      if (sistema?.serializar) sistemas[nombre] = sistema.serializar();
    }

    return Ser.serializar({
      estado: this.store.getState(),
      sistemas,
      nota,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CARGAR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Carga una partida.
   *
   * @param {string} ranura
   * @returns {{exito: boolean, motivo: string|null, avisos: string[]}}
   */
  cargar(ranura) {
    const crudo = this._leerRanura(ranura);

    if (!crudo) {
      return { exito: false, motivo: 'No hay partida en esa ranura.', avisos: [] };
    }

    return this.cargarDesde(crudo);
  }

  /**
   * Carga una partida desde un objeto de guardado.
   *
   * Se usa tanto al cargar de una ranura como al importar un archivo.
   *
   * @param {Object} guardado
   * @returns {{exito: boolean, motivo: string|null, avisos: string[]}}
   */
  cargarDesde(guardado) {
    const avisos = [];

    // ─── Migración ──────────────────────────────────────────────────────
    const migracion = Mig.migrar(guardado);

    if (migracion.error) {
      this.emitir(EVENTOS_GUARDADO.ERROR, { operacion: 'cargar', motivo: migracion.error });
      this.emitir('ui:notice', { mensaje: migracion.error, tipo: 'error' });

      return { exito: false, motivo: migracion.error, avisos };
    }

    if (migracion.migrado) {
      avisos.push(...migracion.avisos);
      this.log.info(`guardado migrado del formato ${migracion.desde} al ${migracion.hasta}`);
    }

    // ─── Deserialización ────────────────────────────────────────────────
    const resultado = Ser.deserializar(migracion.guardado, crearEstadoInicial());

    if (!resultado.valido) {
      this.emitir(EVENTOS_GUARDADO.ERROR, { operacion: 'cargar', motivo: resultado.error });
      this.emitir('ui:notice', { mensaje: resultado.error, tipo: 'error' });

      return { exito: false, motivo: resultado.error, avisos };
    }

    avisos.push(...resultado.avisos);

    // ─── Aplicación ─────────────────────────────────────────────────────
    try {
      this.store.reemplazar(resultado.estado);

      // Los sistemas restauran su estado propio.
      for (const [nombre, datos] of Object.entries(resultado.sistemas)) {
        const sistema = this.sistema(nombre);
        if (sistema?.restaurar) sistema.restaurar(datos);
      }

      this._ultimoAuto = resultado.estado.meta?.turno ?? 0;

      this.emitir(EVENTOS_GUARDADO.CARGADO, {
        cabecera: migracion.guardado.cabecera,
        migrado: migracion.migrado,
        avisos,
      });

      this.emitir('game:resumed', { desdeGuardado: true });

      if (avisos.length) {
        this.log.aviso(`partida cargada con ${avisos.length} avisos`, avisos);
      }

      this.emitir('ui:notice', {
        mensaje: migracion.migrado
          ? 'Partida cargada y convertida al formato actual.'
          : 'Partida cargada.',
        tipo: 'exito',
      });

      return { exito: true, motivo: null, avisos };

    } catch (e) {
      this.log.error('fallo al aplicar el guardado', e);

      const motivo = `El guardado no se pudo aplicar: ${e.message}`;
      this.emitir(EVENTOS_GUARDADO.ERROR, { operacion: 'cargar', motivo });

      return { exito: false, motivo, avisos };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RANURAS
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Lee el contenido de una ranura.
   * @param {string} ranura
   * @returns {Object|null}
   * @private
   */
  _leerRanura(ranura) {
    if (!this._disponible) return null;

    try {
      const texto = localStorage.getItem(`${PREFIJO}${ranura}`);
      if (!texto) return null;
      // Lo guardado aquí también se puede tocar a mano: mismas defensas que
      // al importar un archivo.
      const { objeto, error } = Ser.parsearSeguro(texto);
      if (error) throw new Error(error);
      return objeto;
    } catch (e) {
      this.log.aviso(`ranura ${ranura} corrupta: ${e.message}`);
      return null;
    }
  }

  /**
   * Lista las partidas guardadas.
   *
   * Devuelve solo las cabeceras: no hace falta deserializar el estado entero
   * para mostrar la lista.
   *
   * @returns {Array<Object>}
   */
  listar() {
    if (!this._disponible) return [];

    const ranuras = [];

    for (let i = 1; i <= PERSISTENCIA.ranuras; i++) {
      ranuras.push(String(i));
    }
    ranuras.push(RANURA_AUTO);

    return ranuras.map((ranura) => {
      const guardado = this._leerRanura(ranura);

      if (!guardado) {
        return { ranura, vacia: true, automatica: ranura === RANURA_AUTO };
      }

      const migracion = Mig.comprobar(guardado);

      return {
        ranura,
        vacia: false,
        automatica: ranura === RANURA_AUTO,
        cabecera: guardado.cabecera ?? {},
        guardadoEn: guardado.guardadoEn,
        version: guardado.version,
        app: guardado.app,
        tamano: Ser.medir(guardado),
        // Que el jugador sepa si su guardado va a poder abrirse.
        migracion: migracion.necesita ? Mig.describir(guardado) : null,
        abrible: !migracion.necesita || migracion.posible,
      };
    });
  }

  /**
   * Borra una partida.
   *
   * @param {string} ranura
   * @returns {boolean}
   */
  borrar(ranura) {
    if (!this._disponible) return false;

    try {
      localStorage.removeItem(`${PREFIJO}${ranura}`);

      this.emitir(EVENTOS_GUARDADO.BORRADO, { ranura });
      this.log.info(`ranura ${ranura} borrada`);

      return true;
    } catch (e) {
      this.log.error('fallo al borrar', e);
      return false;
    }
  }

  /**
   * Borra todo lo que ARCANVEIL haya escrito en el navegador.
   *
   * Es la contrapartida de haber escrito algo: el jugador puede deshacerlo por
   * completo cuando quiera.
   *
   * @returns {{borradas: number}}
   */
  borrarTodo() {
    let borradas = 0;

    try {
      // Se recorren las claves en orden inverso: borrar mientras se itera
      // desplaza los índices.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const clave = localStorage.key(i);

        if (clave?.startsWith('arcanveil:')) {
          localStorage.removeItem(clave);
          borradas++;
        }
      }

      this.log.info(`borradas ${borradas} claves del navegador`);

      this.emitir('ui:notice', {
        mensaje: borradas
          ? `Se ha borrado todo: ${borradas} entradas.`
          : 'No había nada guardado.',
        tipo: 'exito',
      });

    } catch (e) {
      this.log.error('fallo al borrar todo', e);
    }

    return { borradas };
  }

  /**
   * Comprueba si hay alguna partida guardada.
   *
   * La usa el menú principal para decidir si mostrar «Continuar».
   *
   * @returns {{hay: boolean, ranura: string|null, cabecera: Object|null}}
   */
  hayPartida() {
    if (!this._disponible) return { hay: false, ranura: null, cabecera: null };

    // La más reciente, sea manual o automática.
    const guardadas = this.listar().filter((r) => !r.vacia);

    if (!guardadas.length) return { hay: false, ranura: null, cabecera: null };

    const reciente = guardadas.sort((a, b) => (b.guardadoEn ?? 0) - (a.guardadoEn ?? 0))[0];

    return {
      hay: true,
      ranura: reciente.ranura,
      cabecera: reciente.cabecera,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EXPORTAR E IMPORTAR
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Exporta la partida a un archivo descargable.
   *
   * Funciona con la persistencia desactivada: descargar un JSON no es escribir
   * en el navegador del jugador, es entregarle sus propios datos. Es la vía que
   * respeta la restricción original del proyecto.
   *
   * @returns {{exito: boolean, motivo: string|null, nombre: string|null}}
   */
  exportar() {
    try {
      const guardado = this._construir('exportada');

      const auditoria = Ser.auditar(guardado.estado);
      if (!auditoria.limpio) {
        this.log.error('la exportación contiene campos sensibles', auditoria.encontrado);
        return { exito: false, motivo: 'La partida contiene datos que no deben exportarse.', nombre: null };
      }

      const texto = Ser.aTexto(guardado);
      const nombre = Ser.nombreArchivo(guardado.cabecera);

      // ─── Descarga ─────────────────────────────────────────────────────
      const blob = new Blob([texto], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);

      // Liberar la URL con retraso: revocarla de inmediato aborta la descarga
      // en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      this.emitir(EVENTOS_GUARDADO.EXPORTADO, { nombre, tamano: Ser.medir(guardado) });

      this.emitir('ui:notice', { mensaje: `Partida exportada: ${nombre}`, tipo: 'exito' });

      return { exito: true, motivo: null, nombre };

    } catch (e) {
      this.log.error('fallo al exportar', e);
      return { exito: false, motivo: `No se pudo exportar: ${e.message}`, nombre: null };
    }
  }

  /**
   * Importa una partida desde texto.
   *
   * @param {string} texto Contenido del archivo.
   * @returns {{exito: boolean, motivo: string|null, avisos: string[]}}
   */
  importar(texto) {
    const lectura = Ser.desdeTexto(texto);

    if (!lectura.guardado) {
      this.emitir('ui:notice', { mensaje: lectura.error, tipo: 'error' });
      return { exito: false, motivo: lectura.error, avisos: [] };
    }

    return this.cargarDesde(lectura.guardado);
  }

  /**
   * Lee un archivo seleccionado por el jugador.
   *
   * @param {File} archivo
   * @returns {Promise<{exito: boolean, motivo: string|null}>}
   */
  async importarArchivo(archivo) {
    if (!archivo) return { exito: false, motivo: 'No se ha elegido ningún archivo.' };

    // Antes de leerlo: un archivo de cientos de megas no se carga en memoria
    // para descubrir después que no era una partida.
    if (Number.isFinite(archivo.size) && archivo.size > PERSISTENCIA.importacionMaxBytes) {
      const motivo = `Ese archivo es demasiado grande para ser una partida (${Math.round(archivo.size / 1024)} KB).`;
      this.emitir('ui:notice', { mensaje: motivo, tipo: 'error' });
      return { exito: false, motivo };
    }

    try {
      const texto = await archivo.text();
      return this.importar(texto);
    } catch (e) {
      return { exito: false, motivo: `No se pudo leer el archivo: ${e.message}` };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CONSULTAS
     ═══════════════════════════════════════════════════════════════════════ */

  /** @returns {boolean} */
  get disponible() {
    return this._disponible;
  }

  /**
   * Espacio ocupado en el navegador.
   * @returns {{claves: number, kb: number}}
   */
  espacioUsado() {
    if (!this._disponible) return { claves: 0, kb: 0 };

    let bytes = 0;
    let claves = 0;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const clave = localStorage.key(i);
        if (!clave?.startsWith('arcanveil:')) continue;

        bytes += (localStorage.getItem(clave) ?? '').length * 2;
        claves++;
      }
    } catch {
      // Sin acceso: se devuelve cero.
    }

    return { claves, kb: Math.round(bytes / 1024 * 10) / 10 };
  }

  /** @returns {Object} */
  inspeccionar() {
    return {
      disponible: this._disponible,
      permitido: this.leer('settings.persistencia', false),
      autoguardado: this.leer('settings.autoguardado', true),
      ultimoAuto: this._ultimoAuto,
      partidas: this.listar().filter((r) => !r.vacia).length,
      espacio: this.espacioUsado(),
      versionFormato: PERSISTENCIA.versionFormato,
      versionApp: APP.version,
    };
  }
}

export default SaveManager;
