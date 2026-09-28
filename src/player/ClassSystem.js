/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · player/ClassSystem.js
 * ---------------------------------------------------------------------------
 * Vocaciones: rasgos activos, usos y clases avanzadas.
 *
 * La pieza central es `rasgosActivos`, que reúne TODOS los rasgos vigentes de
 * un personaje —vocación, linaje, subraza, clase avanzada y talentos— en una
 * sola lista. Cualquier sistema que necesite saber qué puede hacer el personaje
 * consulta esa función y no tiene que recorrer cinco fuentes distintas.
 *
 * El seguimiento de usos vive en `player.usosRasgos`: un mapa de refId a usos
 * gastados, que se vacía al descansar. Así los rasgos con «una vez por descanso»
 * funcionan sin que cada rasgo tenga que gestionarse solo.
 *
 * Funciones puras.
 *
 * Dependencias: classes.data, races.data, balance.config, SkillSystem.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { obtenerClase, listarClases } from '../data/classes.data.js';
import { obtenerRaza, rasgosDe as rasgosLinaje } from '../data/races.data.js';
import { PROGRESION } from '../config/balance.config.js';
import { concederVarias } from './SkillSystem.js';

/* ═══════════════════════════════════════════════════════════════════════════
   RASGOS ACTIVOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reúne todos los rasgos vigentes del personaje.
 *
 * Cada rasgo se devuelve etiquetado con su origen, para que la ficha pueda
 * agruparlos y para que un mensaje de error pueda decir de dónde viene el
 * efecto que falló.
 *
 * @param {Object} jugador
 * @returns {Array<{nombre: string, descripcion: string, efecto: Object, origen: string, refId: string}>}
 */
export function rasgosActivos(jugador) {
  const salida = [];
  const nivel = jugador?.nivel ?? 1;

  // — Linaje y subraza —
  const rasgosRaza = rasgosLinaje(jugador?.raza, jugador?.subraza);
  for (const r of rasgosRaza) {
    salida.push({ ...r, origen: 'linaje', refId: _refId(r.nombre) });
  }

  // — Vocación: solo los rasgos cuyo nivel ya se ha alcanzado —
  const clase = obtenerClase(jugador?.clase);
  for (const r of clase?.rasgos ?? []) {
    if ((r.nivel ?? 1) <= nivel) {
      salida.push({ ...r, origen: 'vocación', refId: _refId(r.nombre) });
    }
  }

  // — Clase avanzada —
  if (jugador?.claseAvanzada) {
    const avanzada = obtenerClaseAvanzada(jugador.claseAvanzada);
    for (const r of avanzada?.rasgos ?? []) {
      if ((r.nivel ?? 1) <= nivel) {
        salida.push({ ...r, origen: 'especialización', refId: _refId(r.nombre) });
      }
    }
  }

  // — Trasfondo —
  if (jugador?._rasgoTrasfondo) {
    salida.push({ ...jugador._rasgoTrasfondo, origen: 'trasfondo', refId: _refId(jugador._rasgoTrasfondo.nombre) });
  }

  return salida;
}

/**
 * Identificador estable derivado del nombre del rasgo.
 * @param {string} nombre
 * @returns {string}
 * @private
 */
function _refId(nombre) {
  return String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Busca un rasgo activo por el tipo de su efecto.
 * Es la consulta que hacen los sistemas: «¿tiene este personaje visión en la
 * oscuridad?» se responde con `buscarRasgo(jugador, 'visionOscuridad')`.
 *
 * @param {Object} jugador
 * @param {string} tipoEfecto
 * @returns {Object|null}
 */
export function buscarRasgo(jugador, tipoEfecto) {
  return rasgosActivos(jugador).find((r) => r.efecto?.tipo === tipoEfecto) ?? null;
}

/**
 * Todos los rasgos de un tipo de efecto.
 * @param {Object} jugador
 * @param {string} tipoEfecto
 * @returns {Array<Object>}
 */
export function buscarRasgos(jugador, tipoEfecto) {
  return rasgosActivos(jugador).filter((r) => r.efecto?.tipo === tipoEfecto);
}

/**
 * Suma de un efecto numérico repartido en varios rasgos.
 * Un personaje puede tener reducción de daño por linaje y por vocación a la vez.
 *
 * @param {Object} jugador
 * @param {string} tipoEfecto
 * @param {string} [campo='valor']
 * @returns {number}
 */
export function sumarEfecto(jugador, tipoEfecto, campo = 'valor') {
  return buscarRasgos(jugador, tipoEfecto)
    .reduce((total, r) => total + (Number(r.efecto?.[campo]) || 0), 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   USOS DE RASGOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Usos que quedan de un rasgo con carga limitada.
 *
 * @param {Object} jugador
 * @param {string} refIdRasgo
 * @param {number} [maximo=1]
 * @returns {{restantes: number, maximo: number, agotado: boolean}}
 */
export function usosDisponibles(jugador, refIdRasgo, maximo = 1) {
  const gastados = jugador?.usosRasgos?.[refIdRasgo] ?? 0;
  const restantes = Math.max(0, maximo - gastados);
  return { restantes, maximo, agotado: restantes === 0 };
}

/**
 * Consume un uso de un rasgo.
 *
 * @param {Object} jugador
 * @param {string} refIdRasgo
 * @param {number} [maximo=1]
 * @returns {{parche: Object|null, exito: boolean, restantes: number}}
 */
export function consumirUso(jugador, refIdRasgo, maximo = 1) {
  const { restantes } = usosDisponibles(jugador, refIdRasgo, maximo);
  if (restantes <= 0) return { parche: null, exito: false, restantes: 0 };

  const gastados = jugador?.usosRasgos?.[refIdRasgo] ?? 0;
  return {
    parche: { player: { usosRasgos: { [refIdRasgo]: gastados + 1 } } },
    exito: true,
    restantes: restantes - 1,
  };
}

/**
 * Devuelve los usos gastados de los rasgos que se recargan con un descanso.
 *
 * Un descanso corto recupera solo los rasgos de recarga corta; uno largo, todos.
 * Por eso hay que saber la recarga declarada de cada rasgo, y no basta con
 * vaciar el mapa entero.
 *
 * @param {Object} jugador
 * @param {'corto'|'largo'|'combate'|'escena'} tipo
 * @returns {Object} Parche.
 */
export function recargarUsos(jugador, tipo = 'largo') {
  const recargas = {
    corto: ['descansoCorto'],
    largo: ['descansoCorto', 'descansoLargo', 'combate', 'escena'],
    combate: ['combate'],
    escena: ['escena', 'combate'],
  };

  const admitidas = recargas[tipo] ?? recargas.largo;
  const rasgos = rasgosActivos(jugador);
  const usos = { ...(jugador?.usosRasgos ?? {}) };

  for (const rasgo of rasgos) {
    const recarga = rasgo.efecto?.recarga;
    // A cero, no `delete`: el parche se funde con el estado y una clave
    // borrada en la copia seguía gastada. Los rasgos no se recargaban nunca.
    if (recarga && admitidas.includes(recarga)) usos[rasgo.refId] = 0;
  }

  return { player: { usosRasgos: usos } };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLASES AVANZADAS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Especializaciones disponibles.
 *
 * Cada vocación tiene dos, y son divergentes a propósito: no son «lo mismo pero
 * más fuerte», sino dos formas distintas de entender el mismo oficio.
 */
export const CLASES_AVANZADAS = Object.freeze({
  /* Baluarte */
  muro_juramentado: {
    refId: 'muro_juramentado',
    base: 'baluarte',
    nombre: 'Muro Juramentado',
    lema: 'Mientras yo esté en pie, la línea aguanta.',
    descripcion: 'Defensa absoluta. Proteges a varios a la vez y castigas a quien los toca.',
    rasgos: [
      { nombre: 'Muro viviente', descripcion: 'Puedes proteger a dos aliados adyacentes en la misma ronda.', nivel: 6, efecto: { tipo: 'redirigirAtaque', usosPorRonda: 2 } },
      { nombre: 'Represalia', descripcion: 'Quien hiera a alguien que proteges recibe daño igual a tu nivel.', nivel: 10, efecto: { tipo: 'represalia', formula: 'nivel' } },
    ],
  },
  vanguardia: {
    refId: 'vanguardia',
    base: 'baluarte',
    nombre: 'Vanguardia',
    lema: 'La mejor defensa es llegar antes.',
    descripcion: 'Defensa ofensiva. Cargas, rompes formaciones y arrastras al grupo contigo.',
    rasgos: [
      { nombre: 'Ariete', descripcion: 'Tu carga derriba y aturde a quien impacta.', nivel: 6, efecto: { tipo: 'cargaDerribo' } },
      { nombre: 'Grito de avance', descripcion: 'Al cargar, todos tus aliados ganan +2 al ataque esa ronda.', nivel: 10, efecto: { tipo: 'bonoGrupo', valor: 2 } },
    ],
  },

  /* Filo */
  maestro_de_sala: {
    refId: 'maestro_de_sala',
    base: 'filo',
    nombre: 'Maestro de Sala',
    lema: 'Te he leído antes de que desenvainaras.',
    descripcion: 'Duelo puro. Lees al rival y castigas cada error.',
    rasgos: [
      { nombre: 'Lectura de guardia', descripcion: 'Contra un mismo enemigo, cada ronda ganas +1 acumulativo al ataque.', nivel: 6, efecto: { tipo: 'bonoAcumulativo', valor: 1, max: 5 } },
      { nombre: 'Golpe de sala', descripcion: 'Tu crítico contra un enemigo estudiado triplica el daño.', nivel: 10, efecto: { tipo: 'multiplicadorCritico', valor: 3 } },
    ],
  },
  hoja_errante: {
    refId: 'hoja_errante',
    base: 'filo',
    nombre: 'Hoja Errante',
    lema: 'No me quedo quieto el tiempo suficiente.',
    descripcion: 'Movilidad extrema. Golpeas y ya no estás donde estabas.',
    rasgos: [
      { nombre: 'Danza de acero', descripcion: 'Tras atacar puedes desplazarte sin provocar reacciones.', nivel: 6, efecto: { tipo: 'movimientoLibre' } },
      { nombre: 'Filo múltiple', descripcion: 'Si empiezas y terminas tu turno junto a enemigos distintos, atacas a ambos.', nivel: 10, efecto: { tipo: 'ataqueMultiple', objetivos: 2 } },
    ],
  },

  /* Glifista */
  archivista: {
    refId: 'archivista',
    base: 'glifista',
    nombre: 'Archivista',
    lema: 'Alguien ya resolvió esto. Solo hay que encontrarlo.',
    descripcion: 'Amplitud sobre potencia. Conoces más glifos que nadie y los adaptas.',
    rasgos: [
      { nombre: 'Biblioteca portátil', descripcion: 'Puedes preparar el doble de glifos por descanso.', nivel: 6, efecto: { tipo: 'grimorioAmpliado', factor: 2 } },
      { nombre: 'Improvisación notada', descripcion: 'Una vez por descanso, lanzas un glifo que no llevas preparado.', nivel: 10, efecto: { tipo: 'glifoImprovisado', usos: 1, recarga: 'descansoLargo' } },
    ],
  },
  rompeglifos: {
    refId: 'rompeglifos',
    base: 'glifista',
    nombre: 'Rompeglifos',
    lema: 'Toda notación tiene un error. Yo lo busco.',
    descripcion: 'Anti-magia. Desmontas los conjuros ajenos y los vuelves contra su autor.',
    rasgos: [
      { nombre: 'Disipación', descripcion: 'Puedes anular un efecto mágico como reacción.', nivel: 6, efecto: { tipo: 'disipar', usosPorEscena: 2 } },
      { nombre: 'Reflejo arcano', descripcion: 'Al disipar con éxito, el conjuro impacta a quien lo lanzó.', nivel: 10, efecto: { tipo: 'reflejarConjuro' } },
    ],
  },

  /* Vinculado */
  heraldo: {
    refId: 'heraldo',
    base: 'vinculado',
    nombre: 'Heraldo',
    lema: 'Ya no discuto con la voz. Hablo por ella.',
    descripcion: 'Aceptación del pacto. Más poder, menos control.',
    rasgos: [
      { nombre: 'Manifestación', descripcion: 'Tu entidad se manifiesta durante una escena por descanso largo.', nivel: 6, efecto: { tipo: 'invocarEntidad', usos: 1, recarga: 'descansoLargo' } },
      { nombre: 'Poder sin freno', descripcion: 'Tus glifos hacen +50 % de daño, pero pierdes 3 de vida por cada uno.', nivel: 10, efecto: { tipo: 'potenciaPeligrosa', factor: 1.5, coste: 3 } },
    ],
  },
  rompepacto: {
    refId: 'rompepacto',
    base: 'vinculado',
    nombre: 'Rompepacto',
    lema: 'Firmé algo. Estoy buscando la letra pequeña.',
    descripcion: 'Rebelión contra el pacto. Robas poder sin pagar el precio.',
    rasgos: [
      { nombre: 'Cláusula torcida', descripcion: 'Una vez por descanso, usas un poder sin coste ni consecuencia.', nivel: 6, efecto: { tipo: 'poderGratuito', usos: 1, recarga: 'descansoLargo' } },
      { nombre: 'Voz silenciada', descripcion: 'Tu entidad ya no puede engañarte ni obligarte.', nivel: 10, efecto: { tipo: 'inmunidad', categoria: 'entidadPropia' } },
    ],
  },

  /* Rastreador */
  ojo_de_halcon: {
    refId: 'ojo_de_halcon',
    base: 'rastreador',
    nombre: 'Ojo de Halcón',
    lema: 'Si lo veo, ya está muerto.',
    descripcion: 'Precisión a distancia. Ningún blanco está fuera de alcance.',
    rasgos: [
      { nombre: 'Alcance imposible', descripcion: 'Tu alcance efectivo se duplica y ignoras toda cobertura.', nivel: 6, efecto: { tipo: 'alcanceExtendido', factor: 2 } },
      { nombre: 'Disparo marcado', descripcion: 'Marcas a un enemigo: todos tus disparos contra él son críticos con 18+.', nivel: 10, efecto: { tipo: 'criticoAmpliado', umbral: 18 } },
    ],
  },
  guardian_de_sendas: {
    refId: 'guardian_de_sendas',
    base: 'rastreador',
    nombre: 'Guardián de Sendas',
    lema: 'Este bosque me conoce.',
    descripcion: 'Dominio del terreno. Conviertes cualquier lugar en tu ventaja.',
    rasgos: [
      { nombre: 'Terreno propio', descripcion: 'Tras un turno en un lugar, todo tu bando gana +2 allí.', nivel: 6, efecto: { tipo: 'bonoTerreno', valor: 2 } },
      { nombre: 'Sendas ocultas', descripcion: 'Puedes mover a todo el grupo sin ser detectado en terreno natural.', nivel: 10, efecto: { tipo: 'sigiloGrupo' } },
    ],
  },

  /* Sombra */
  mano_izquierda: {
    refId: 'mano_izquierda',
    base: 'sombra',
    nombre: 'Mano Izquierda',
    lema: 'La información vale más que el oro. Yo tengo ambas.',
    descripcion: 'Manipulación e información. Sabes cosas antes que nadie.',
    rasgos: [
      { nombre: 'Red extendida', descripcion: 'En cualquier asentamiento obtienes información precisa sin tirada.', nivel: 6, efecto: { tipo: 'informacionGarantizada' } },
      { nombre: 'Favor cobrado', descripcion: 'Una vez por capítulo, alguien te debe un favor y aparece cuando hace falta.', nivel: 10, efecto: { tipo: 'aliadoOportuno', usos: 1, recarga: 'capitulo' } },
    ],
  },
  fantasma: {
    refId: 'fantasma',
    base: 'sombra',
    nombre: 'Fantasma',
    lema: 'Nunca estuve allí.',
    descripcion: 'Sigilo absoluto. Entras donde nadie entra.',
    rasgos: [
      { nombre: 'Sin rastro', descripcion: 'No dejas huellas ni rastro mágico de tu paso.', nivel: 6, efecto: { tipo: 'sinRastro' } },
      { nombre: 'Desvanecerse', descripcion: 'Puedes volverte invisible durante una ronda, una vez por escena.', nivel: 10, efecto: { tipo: 'invisibilidad', usos: 1, recarga: 'escena' } },
    ],
  },

  /* Portavoz */
  tejedor_de_pactos: {
    refId: 'tejedor_de_pactos',
    base: 'portavoz',
    nombre: 'Tejedor de Pactos',
    lema: 'Todos ganan algo. Yo elijo cuánto.',
    descripcion: 'Negociación de alto nivel. Cierras acuerdos que parecían imposibles.',
    rasgos: [
      { nombre: 'Terreno común', descripcion: 'Puedes hacer que dos bandos hostiles negocien.', nivel: 6, efecto: { tipo: 'mediar' } },
      { nombre: 'Acuerdo vinculante', descripcion: 'Un pacto cerrado por ti obliga mágicamente a ambas partes.', nivel: 10, efecto: { tipo: 'pactoMagico', usos: 1, recarga: 'capitulo' } },
    ],
  },
  voz_de_corte: {
    refId: 'voz_de_corte',
    base: 'portavoz',
    nombre: 'Voz de Corte',
    lema: 'No mando yo. Manda quien me escucha.',
    descripcion: 'Influencia política. Mueves a los poderosos sin que lo noten.',
    rasgos: [
      { nombre: 'Oído del poder', descripcion: 'Consigues audiencia con cualquier autoridad de la región.', nivel: 6, efecto: { tipo: 'accesoSocial', nivel: 'maximo' } },
      { nombre: 'Palabra que pesa', descripcion: 'Una vez por capítulo, tu palabra cambia una decisión política.', nivel: 10, efecto: { tipo: 'influenciaMayor', usos: 1, recarga: 'capitulo' } },
    ],
  },

  /* Custodio */
  guardian_de_votos: {
    refId: 'guardian_de_votos',
    base: 'custodio',
    nombre: 'Guardián de Votos',
    lema: 'Mi promesa os cubre a todos.',
    descripcion: 'Protección extendida. Tu juramento ampara a más de una persona.',
    rasgos: [
      { nombre: 'Juramento compartido', descripcion: 'Puedes juramentar a tres personas y protegerlas a la vez.', nivel: 6, efecto: { tipo: 'juramentoMultiple', objetivos: 3 } },
      { nombre: 'Última promesa', descripcion: 'Una vez por partida, evitas la muerte de alguien a quien juraste.', nivel: 10, efecto: { tipo: 'evitarMuerteAliado', usos: 1, recarga: 'partida' } },
    ],
  },
  penitente: {
    refId: 'penitente',
    base: 'custodio',
    nombre: 'Penitente',
    lema: 'Rompí mi juramento. Ahora pago y sigo.',
    descripcion: 'Poder nacido del fracaso. Tu culpa es tu fuerza.',
    rasgos: [
      { nombre: 'Fuerza de la culpa', descripcion: 'Con el juramento roto, ganas +4 en vez de la penalización.', nivel: 6, efecto: { tipo: 'invertirPenalizacion', valor: 4 } },
      { nombre: 'Redención', descripcion: 'Puedes reparar un juramento roto cumpliendo una penitencia.', nivel: 10, efecto: { tipo: 'repararJuramento' } },
    ],
  },
});

/**
 * @param {string} refId
 * @returns {Object|null}
 */
export function obtenerClaseAvanzada(refId) {
  return CLASES_AVANZADAS[refId] ?? null;
}

/**
 * Especializaciones a las que puede optar el personaje.
 *
 * @param {Object} jugador
 * @returns {{disponibles: Array<Object>, puede: boolean, motivo: string|null}}
 */
export function avanzadasDisponibles(jugador) {
  const nivel = jugador?.nivel ?? 1;

  if (nivel < PROGRESION.nivelClaseAvanzada) {
    return {
      disponibles: [],
      puede: false,
      motivo: `Requiere nivel ${PROGRESION.nivelClaseAvanzada}`,
    };
  }

  if (jugador?.claseAvanzada) {
    return { disponibles: [], puede: false, motivo: 'Ya has elegido especialización' };
  }

  const clase = obtenerClase(jugador?.clase);
  const disponibles = (clase?.avanzadas ?? [])
    .map((refId) => CLASES_AVANZADAS[refId])
    .filter(Boolean);

  return { disponibles, puede: disponibles.length > 0, motivo: null };
}

/**
 * Aplica la elección de clase avanzada.
 * @param {Object} jugador
 * @param {string} refId
 * @returns {{parche: Object|null, exito: boolean, motivo: string|null}}
 */
export function elegirAvanzada(jugador, refId) {
  const { disponibles, puede, motivo } = avanzadasDisponibles(jugador);
  if (!puede) return { parche: null, exito: false, motivo };

  if (!disponibles.some((a) => a.refId === refId)) {
    return { parche: null, exito: false, motivo: 'Esa especialización no está disponible para tu vocación' };
  }

  return { parche: { player: { claseAvanzada: refId } }, exito: true, motivo: null };
}

/* ═══════════════════════════════════════════════════════════════════════════
   APLICACIÓN INICIAL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parche con las competencias iniciales que otorgan linaje, vocación y trasfondo.
 *
 * @param {Object} jugador
 * @param {Object} fuentes { raza, clase, trasfondo }
 * @returns {Object}
 */
export function competenciasIniciales(jugador, fuentes) {
  const refIds = [
    ...(fuentes.raza?.habilidadesGratis ?? []),
    ...(fuentes.clase?.habilidadesGratis ?? []),
    ...(fuentes.trasfondo?.habilidades ?? []),
  ];
  return concederVarias(jugador, refIds, 'practicado');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARA EL DIRECTOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Capacidades destacadas del personaje, en lenguaje natural.
 *
 * El director necesita saber qué puede hacer este personaje que otros no, para
 * plantear situaciones donde eso importe. No le sirve una lista de refIds.
 *
 * @param {Object} jugador
 * @returns {string}
 */
export function capacidadesParaDirector(jugador) {
  const rasgos = rasgosActivos(jugador);
  if (!rasgos.length) return '';

  const notables = rasgos
    .filter((r) => r.origen !== 'trasfondo')
    .slice(0, 6)
    .map((r) => `${r.nombre} (${r.descripcion})`);

  return `Capacidades propias: ${notables.join('; ')}.`;
}

export default {
  rasgosActivos,
  buscarRasgo,
  buscarRasgos,
  sumarEfecto,
  usosDisponibles,
  consumirUso,
  recargarUsos,
  CLASES_AVANZADAS,
  obtenerClaseAvanzada,
  avanzadasDisponibles,
  elegirAvanzada,
  competenciasIniciales,
  capacidadesParaDirector,
};
