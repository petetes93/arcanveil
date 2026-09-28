/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · engine/Ambicion.js
 * ---------------------------------------------------------------------------
 * ¿Está la acción al alcance del personaje?
 *
 * El jugador tiene libertad para intentar cosas épicas y originales, y una
 * acción bien pensada y detallada merece ventaja. Lo que no puede es saltarse
 * su nivel: un paladín de nivel 1 no parte el mundo de un espadazo. Aquí se
 * decide eso ANTES de tirar, igual que el resto de reglas: el máster narra el
 * intento, no decide si funciona.
 *
 * Función pura.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Hazañas de escala desmedida y el nivel mínimo a partir del cual dejan de
 * ser imposibles. Se buscan en el texto normalizado (sin tildes).
 */
const DESMEDIDAS = [
  { nivel: 99, patron: /\b(destru\w*|aniquil\w*|arras\w*|partir|romper|borrar)\b.{0,30}\b(el mundo|los reinos|el reino|la realidad|el cielo|el sol|la luna|el continente)\b/ },
  { nivel: 99, patron: /\b(matar|mato|derrotar|derroto|destruir|destruyo)\b.{0,20}\b(a los |a un |al )?(dioses|dios|diosa)\b/ },
  { nivel: 15, patron: /\b(mat\w*|acab\w*|elimin\w*|fulmin\w*|arras\w*)\b.{0,25}\b(a todos|a todo el mundo|toda la ciudad|todo el ejercito|a la ciudad|a toda la guardia|todo el pueblo)\b/ },
  { nivel: 15, patron: /\b(destru\w*|arras\w*|derrib\w*|hund\w*|incendi\w*|quem\w*)\b.{0,25}\b(la ciudad|el castillo|la fortaleza|la montana|el pueblo entero|la muralla entera)\b/ },
  { nivel: 15, patron: /\b(part\w*|romp\w*|abr\w*|separ\w*)\b.{0,25}\b(la montana|las montanas|el rio|el mar|el lago|la tierra|las aguas)\b(.{0,15}\ben dos\b)?/ },
  { nivel: 12, patron: /\b(puente|muralla|montana|torre|castillo|muro|fortaleza|portalon)\b.{0,30}\b(de un (solo )?(golpe|tajo|espadazo|punetazo|patada|cabezazo)|con (las|mis) (propias )?manos)\b|\bde un (solo )?(golpe|tajo|espadazo|punetazo|patada)\b.{0,30}\b(puente|muralla|montana|torre|castillo|fortaleza)\b/ },
  { nivel: 12, patron: /\b(resucit\w*|devolver a la vida|revivir)\b/ },
  { nivel: 12, patron: /\b(invoc\w*|conjur\w*)\b.{0,20}\b(un dragon|dragones|un demonio mayor|un ejercito|un titan|un meteorito)\b/ },
  { nivel: 10, patron: /\b(vuelo|volar|vuelo hasta|me elevo por los aires|echo a volar)\b/ },
  { nivel: 10, patron: /\b(de un (solo )?(golpe|tajo|espadazo|punetazo))\b.{0,30}\b(mato|matar|acabo|acabar|derribo|derribar|parto|partir|destrozo|destrozar)\b|\b(mato|matar|acabo con|acabar con|derribo|derribar|parto|partir|destrozo|destrozar)\b.{0,30}\bde un (solo )?(golpe|tajo|espadazo|punetazo)\b/ },
  { nivel: 8, patron: /\b(teletransport\w*|detengo el tiempo|paro el tiempo|viajo en el tiempo)\b/ },
];

/** Números escritos con letra que se usan para distancias. */
const NUMEROS = Object.freeze({ diez: 10, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, quinientos: 500, mil: 1000 });

/**
 * Un salto de más metros de los que salta un cuerpo (unos 8 de largo). «Salto
 * 100 metros hasta el tejado de enfrente» se narraba como si volara.
 * @param {string} t Texto normalizado.
 * @returns {number|null} Los metros, si son imposibles.
 */
function saltoImposible(t) {
  const m = t.match(/\b(?:salt\w*|brinc\w*)\b[^.;]{0,40}?\b(\d+(?:[.,]\d+)?|diez|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|doscientos|trescientos|quinientos|mil)\s*(?:metros|m|varas)\b/);
  if (!m) return null;
  const n = NUMEROS[m[1]] ?? Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 8 ? n : null;
}

const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Evalúa la ambición de una acción.
 *
 * @param {string} texto Lo que escribió el jugador.
 * @param {number} nivel Nivel del personaje.
 * @returns {{grado: 'normal'|'detallada'|'desmedida', nivelNecesario?: number, pista: string|null}}
 */
export function evaluarAmbicion(texto, nivel = 1) {
  const t = normalizar(texto);

  const metros = saltoImposible(t);
  if (metros) {
    return {
      grado: 'desmedida',
      nivelNecesario: 99,
      pista: `El personaje intenta saltar ${metros} metros. Ningún cuerpo llega tan lejos: narra el intento y dónde acaba de verdad `
        + '(se queda corto, cae, se agarra a lo que puede), sin que llegue al otro lado ni pase nada de lo que habría pasado allí.',
    };
  }

  for (const d of DESMEDIDAS) {
    if (nivel < d.nivel && d.patron.test(t)) {
      return {
        grado: 'desmedida',
        nivelNecesario: d.nivel,
        pista: `El personaje (nivel ${nivel}) intenta algo que está muy por encima de su poder. `
          + 'Narra el intento con respeto y con consecuencias creíbles, pero sus fuerzas no alcanzan: '
          + 'el mundo no se rompe ni ocurre lo imposible. Muestra el límite de forma dramática, no como un aviso del sistema.',
      };
    }
  }

  // Una acción concreta, con cómo y con qué, merece ventaja: premia pensar.
  const palabras = t.split(/\s+/).filter(Boolean).length;
  const detalles = (t.match(/\b(con|usando|mientras|aprovechando|para|sin que|despues de|antes de|hacia|contra|detras|por encima|por debajo|entre)\b/g) ?? []).length;
  if (palabras >= 16 && detalles >= 2) {
    return {
      grado: 'detallada',
      pista: 'La acción está bien pensada y detallada. Respeta cada detalle que el jugador describió e intégralo en la '
        + 'escena; si el resultado acompaña, que sea memorable y con efectos visibles en el entorno y en quien esté presente.',
    };
  }

  return { grado: 'normal', pista: null };
}

export default { evaluarAmbicion };
