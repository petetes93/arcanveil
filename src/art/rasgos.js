/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · src/art/rasgos.js
 * ---------------------------------------------------------------------------
 * Lo que el jugador escribe de su personaje, dicho para un generador de
 * imágenes: en inglés, con quién es delante y sus rasgos distintivos pronto.
 *
 * Salió de `retrato-ia.js`, que pedía el retrato a un servicio anónimo de
 * fuera (Pollinations) con un encuadre anime. El servicio y el encuadre se
 * han ido; esto se queda porque el generador local (ComfyUI, vía
 * tools/imagen-local-proxy.mjs) entiende mejor el inglés, y porque la regla
 * de «si nombra especie, manda su especie» sigue valiendo. El encuadre y el
 * estilo los pone el puente (`encargo` y `ESTILO`): aquí solo el sujeto.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Por debajo de esto no hay descripción que pintar. */
const MINIMO = 8;

/** Sujeto cuando la descripción no dice quién es. */
const SUJETO_NEUTRO = 'one person';

/**
 * Rasgo físico de cada linaje, en inglés.
 *
 * Se antepone a lo que escribe el jugador para que su personaje siga
 * pareciendo de su pueblo. Si describe algo que lo contradice, manda el
 * jugador: su texto va después y pesa más.
 */
const LINAJE = Object.freeze({
  valdes: 'olive to bronze skin, dark hair',
  sombracorteza: 'tall and gaunt, grey-brown bark-veined skin, solid black eyes',
  ferrano: 'broad shouldered, ruddy weathered skin',
  albar: 'slender, angular pale features, faint sheen on the skin',
  griscuerno: 'very tall, grey-blue skin, curved horns from the temples',
  menudo: 'small and slight, bright eyes',
  brumal: 'translucent bluish skin, hair drifting as if underwater',
  crisol: 'body of pale alloy with faint glowing mineral veins',
});

/* ═══════════════════════════════════════════════════════════════════════════
   DEL ESPAÑOL AL ENCARGO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Glosario español → inglés de rasgos de personaje.
 *
 * Existe porque **el modelo ignora el español**. Comprobado: con
 * «herrero de barba trenzada gris, cicatriz cruzando la ceja izquierda,
 * delantal de cuero quemado» devolvió una mujer joven sin barba, sin cicatriz
 * y sin delantal. El mismo encargo en inglés sale a la primera.
 *
 * Se traduce con una tabla y no con un servicio a propósito: traducir por red
 * añade una espera, otra cosa que puede caerse y una dependencia más. La tabla
 * es instantánea, funciona sin conexión y cubre el vocabulario que la gente
 * usa de verdad al describir un personaje de rol.
 *
 * El vocabulario arranca del que ya entiende el retrato vectorial
 * (`tonosDescripcion` y `detallesDescripcion` en `retrato.js`) para que ambos
 * lean lo mismo y el jugador no tenga que aprender dos lenguajes.
 */
/*
 * Cada entrada lleva un GRUPO, y **solo gana la primera coincidencia de cada
 * grupo**. Sin eso, «barba trenzada» producía a la vez «a braided beard» y
 * «a beard»: el encargo se llenaba de sinónimos peleándose, que es la forma
 * más fiable de confundir a un modelo de imagen.
 *
 * El orden dentro de un grupo es de más específico a más genérico, porque el
 * primero que acierta es el que se queda.
 */
const GLOSARIO = Object.freeze([
  // ── Quién es ──────────────────────────────────────────────────────────
  //
  // El sexo y la especie van los PRIMEROS del encargo y no son un rasgo más:
  // son el sujeto. Sin ellos, el encargo decía «one person» y el modelo lo
  // resolvía a cara o cruz. «Elfa exploradora de pelo plateado» salía con cara
  // andrógina y sin orejas; «enano pelirrojo» salía un humano alto y castaño.
  //
  // El femenino va antes que el masculino porque las formas masculinas son
  // prefijo de las femeninas: /cazador/ casa dentro de «cazadora». Por eso
  // todas las masculinas llevan `\b` al final.
  ['sexo', /\b(mujer|chica|muchacha|señora|dama|ancian a|elfa|enana|orca|guerrera|exploradora|cazadora|rastreadora|maga|hechicera|bruja|ladrona|bandida|sacerdotisa|monja|herrera|erudita|escriba|barda|juglaresa|mercenaria|soldada|pelirroja|morena|rubia|ancianas?)\b/, 'a woman'],
  ['sexo', /\b(hombre|chico|muchacho|señor|varon|anciano|elfo|enano|orco|guerrero|explorador|cazador|rastreador|mago|hechicero|brujo|ladron|bandido|sacerdote|monje|herrero|erudito|escriba|bardo|juglar|mercenario|soldado|pelirrojo|moreno|rubio)\b/, 'a man'],

  ['especie', /\belf[oa]s?\b|\belfic/, 'an elf with long pointed ears'],
  ['especie', /\benan[oa]s?\b|\bdwarf/, 'a dwarf, short and stocky with a heavy build'],
  ['especie', /\borc[o]s?\b|\bogro/, 'an orc with tusks and green-grey skin'],
  ['especie', /\bmedian[oa]s?\b|\bhalfling/, 'a halfling, very small and childlike in stature'],
  ['especie', /\bhuman[oa]s?\b/, 'a human'],

  // ── Pelo ──────────────────────────────────────────────────────────────
  // «pelirrojo» suelto cuenta: antes exigía la forma «pelo pelirrojo» y se
  // perdía en «enano pelirrojo» o «una pelirroja», que es como se escribe.
  ['color-pelo', /\b(pelo|cabello|melena)\s+(rojiz|pelirroj|roj)|\bpelirroj\w*/, 'red hair'],
  ['color-pelo', /\b(pelo|cabello|melena)\s+(negr|azabache)/, 'black hair'],
  ['color-pelo', /\b(pelo|cabello|melena)\s+(blanc|platead|cano|gris)/, 'silver white hair'],
  ['color-pelo', /\b(pelo|cabello|melena)\s+(rubi|dorad)/, 'blonde hair'],
  ['color-pelo', /\b(pelo|cabello|melena)\s+(castañ|marron|moren)/, 'brown hair'],
  ['color-pelo', /\b(pelo|cabello|melena)\s+(azul|verde|violeta|morad|rosa)/, 'unnaturally coloured hair'],
  ['color-pelo', /\b(calv|rapad)/, 'shaved head'],
  // La trenza exige contexto de pelo: «barba trenzada» no es un peinado.
  ['peinado', /(pelo|cabello|melena)[^,.;]{0,24}trenz|trenz[^,.;]{0,24}(pelo|cabello|melena)/, 'braided hair'],
  ['peinado', /\brizad|\brizos/, 'curly hair'],
  ['largo-pelo', /\b(pelo|cabello|melena)\s+(larg)/, 'long hair'],
  ['largo-pelo', /\b(pelo|cabello|melena)\s+(cort)/, 'short hair'],

  // ── Ojos ──────────────────────────────────────────────────────────────
  ['ojos', /\bojos?\s+(roj|carmesi|escarlata)/, 'red eyes'],
  ['ojos', /\bojos?\s+(azul|celest|cian)/, 'blue eyes'],
  ['ojos', /\bojos?\s+verde/, 'green eyes'],
  ['ojos', /\bojos?\s+(dorad|ambar|miel)/, 'amber eyes'],
  ['ojos', /\bojos?\s+(violet|morad)/, 'violet eyes'],
  ['ojos', /\bojos?\s+(negr|oscur)/, 'dark eyes'],
  ['ojos', /\bojos?\s+(gris|claro)/, 'grey eyes'],

  // ── Cara ──────────────────────────────────────────────────────────────
  // «cicatriz en la ceja» es más preciso que «cicatriz en la cara», y el lado
  // se le pega después en `analizar`.
  ['cicatriz', /\bcicatriz[^,.;]{0,24}\bceja/, 'a scar through the eyebrow'],
  ['cicatriz', /\bcicatriz[^,.;]{0,24}\bojo/, 'a scar over one eye'],
  ['cicatriz', /\bcicatriz[^,.;]{0,24}\b(?:mejilla|pomulo)/, 'a scar on the cheek'],
  ['cicatriz', /\bcicatriz/, 'a scar across the face'],
  ['parche', /\bparche/, 'an eyepatch'],
  // Lo específico antes que lo genérico: gana la primera del grupo.
  ['barba', /\bbarba\s+\w*trenzad/, 'a braided beard'],
  ['barba', /\bbarba\s+\w*(roj|pelirroj)|\bbarba\s+rojiz/, 'a red beard'],
  ['barba', /\bbarba|barbud/, 'a beard'],
  ['bigote', /\bbigote/, 'a moustache'],
  ['tatuaje', /\btatuaj/, 'facial tattoos'],
  ['piel', /\bpecas/, 'freckles'],
  ['edad', /\bviej|ancian|canoso/, 'an old weathered face'],
  ['edad', /\bjoven|jovenc/, 'a young face'],
  ['gesto', /\bcansad|ojeras|agotad/, 'a tired face with dark circles'],
  ['gesto', /\bserio|severo|duro/, 'a stern hard expression'],

  // ── Cuerpo ────────────────────────────────────────────────────────────
  ['cuerpo', /\bhombros anchos|corpulent|fornid|robust|musculos/, 'broad powerful shoulders'],
  ['cuerpo', /\bdelgad|flac|enjut|esbelt/, 'a lean slender build'],
  // «bajo» y «alto» son también preposición y adverbio. Sin el freno, «un libro
  // bajo el brazo» convertía a la maga en enana, y «habla alto» en gigante: si
  // detrás viene un determinante, no está hablando de su estatura.
  ['altura', /\balt[oa]\b(?!\s+(el|la|los|las|un|una|su|mi|tu))|\bgigante/, 'very tall'],
  ['altura', /\bbaj[oa]\b(?!\s+(el|la|los|las|un|una|su|mi|tu))|\bpequeñ|\bmenud/, 'short and slight'],

  // ── Ropa y equipo ─────────────────────────────────────────────────────
  //
  // Las prendas con color NO están aquí: las resuelve `prendasConColor`, que
  // busca el color junto a la prenda. En esta tabla no cabía, porque «capa
  // verde» y «armadura de cuero negro» necesitan mirar dos palabras a la vez y
  // una tabla de pares prenda×color serían cuarenta filas.
  ['cabeza', /\bcorona|diadema/, 'wearing a circlet'],
  ['ropa-extra', /\bharapos|andrajos/, 'ragged clothing'],
  ['cuernos', /\bcuernos/, 'curved horns'],
  ['estado', /\bquemad|chamuscad/, 'scorched and burned'],

  // ── Lo que lleva encima ───────────────────────────────────────────────
  //
  // Se perdían todos. «un martillo de guerra al hombro» no dejaba rastro en el
  // encargo, y un guerrero sin su arma es otro personaje.
  ['objeto', /\bmartillo/, 'holding a large warhammer over the shoulder'],
  // «a la espalda» o «al hombro»: que se vea el mango asomando, que es lo
  // que cabe en un busto. «holding» a secas lo dejaba fuera del encuadre.
  ['objeto', /\bhacha\b[^,.;]*\b(?:espalda|hombro)/, 'a battle axe strapped on the back, its haft visible over the shoulder'],
  ['objeto', /\bhacha/, 'holding a battle axe close to the chest'],
  ['objeto', /\blanza/, 'holding a spear'],
  ['objeto', /\barco\b|\bballesta/, 'a bow slung across the back'],
  ['objeto', /\bbaston|\bcayado/, 'holding a wooden staff'],
  ['objeto', /\bespada|\bsable|\bmandoble/, 'a sword at the hip'],
  ['objeto', /\bdaga|\bcuchillo|\bpuñal/, 'a dagger at the belt'],
  ['objeto', /\bescudo/, 'a shield on the arm'],
  ['objeto', /\blibro|\btomo\b|\bgrimorio/, 'holding an old book'],
  ['objeto', /\bmedallon|\bcolgante|\bamuleto/, 'a pendant at the neck'],

  // ── Oficio ────────────────────────────────────────────────────────────
  ['oficio', /\bherrer/, 'a blacksmith'],
  ['oficio', /\bcazador|rastread/, 'a hunter'],
  ['oficio', /\bladron|bandid/, 'a thief'],
  ['oficio', /\bmag[oa]\b|hechicer|bruj/, 'a spellcaster'],
  ['oficio', /\bguerrer|soldad|mercenari/, 'a soldier'],
  ['oficio', /\bsacerdot|clerig|monj/, 'a cleric'],
  ['oficio', /\berudit|escrib/, 'a scholar'],
  ['oficio', /\bbard|juglar/, 'a travelling performer'],
]);

/**
 * Traduce lo que escribió el jugador a fragmentos de encargo en inglés.
 *
 * Lo que no reconoce se descarta: ver `encargoRetrato` para por qué el texto
 * en español ya no viaja al final del encargo.
 *
 * @param {string} texto
 * @param {string} [yaDicho] Texto del encargo que ya está escrito (el linaje).
 *   Lo que ya aparezca ahí no se repite: el griscuerno ya es «very tall» por
 *   nacimiento, y decirlo dos veces no lo hace más alto, solo gasta atención.
 * @returns {string}
 */
/* ═══════════════════════════════════════════════════════════════════════════
   PRENDAS CON COLOR
   ═══════════════════════════════════════════════════════════════════════════ */

/** Colores, por raíz para que valgan masculino, femenino y plural. */
const COLORES = Object.freeze([
  [/\bverde/, 'green'],
  [/\bnegr|\boscur/, 'black'],
  [/\broj|\bcarmesi|\bescarlata|\bgranate/, 'red'],
  [/\bazul/, 'blue'],
  [/\bblanc/, 'white'],
  [/\bgris/, 'grey'],
  [/\bdorad|\bdorada/, 'golden'],
  [/\bplatead/, 'silver'],
  [/\bmarron|\bcastañ|\bpard/, 'brown'],
  [/\bmorad|\bpurpur|\bviolet/, 'purple'],
  [/\bamarill/, 'yellow'],
  [/\bnaranja|\banaranjad/, 'orange'],
]);

/**
 * Prendas, de la más específica a la más genérica.
 *
 * El grupo es el mismo que usaría la tabla, así que una prenda resuelta aquí
 * bloquea las de su grupo en el glosario y no salen dos abrigos.
 */
const PRENDAS = Object.freeze([
  ['ropa', /\barmadura\s+de\s+placas|\bplacas\b|\barmadura\s+completa/, 'plate armour', false],
  ['ropa', /\barmadura\s+de\s+cuero|\bcuero\s+endurecid/, 'leather armour', false],
  ['ropa', /\bcota\s+de\s+malla|\bmalla\b/, 'chainmail', false],
  ['ropa', /\barmadura|\bcoraza|\bpeto\b/, 'armour', false],
  ['ropa', /\bdelantal/, 'leather apron', true],
  ['ropa', /\btunica|\btunic/, 'tunic', true],
  ['ropa', /\bcuero\b/, 'leather clothing', false],
  ['capa', /\bcapa\b|\bmanto\b/, 'cloak', true],
  ['cabeza', /\bcapucha|encapuchad/, 'hood', true],
]);

/**
 * Traduce las prendas conservando su color.
 *
 * El color se perdía por completo: «capa verde» acababa en "a worn cloak" y
 * «armadura de cuero negro» en "battered armour". El jugador describía una
 * silueta concreta y el modelo recibía ropa genérica, así que el retrato no
 * se parecía a lo que había escrito.
 *
 * El color se busca DESPUÉS de la prenda y en una ventana corta, porque en
 * castellano el adjetivo va detrás («capa verde», no «verde capa») y porque
 * una ventana larga se lleva el color de la frase siguiente: en «capa raída y
 * ojos azules», el azul es de los ojos.
 *
 * @param {string} d Descripción sin tildes y en minúsculas.
 * @returns {{frases: string[], grupos: Set<string>}}
 */
function prendasConColor(d) {
  const frases = [];
  const grupos = new Set();

  for (const [grupo, patron, ingles, articulo] of PRENDAS) {
    if (grupos.has(grupo)) continue;

    const m = d.match(patron);
    if (!m) continue;

    grupos.add(grupo);

    const cola = d.slice(m.index + m[0].length, m.index + m[0].length + 22);

    // Gana el color MÁS CERCANO, no el primero de la tabla. Con «armadura de
    // cuero negro y capa verde», buscar por orden de tabla encontraba «verde»
    // —que es de la capa, cuatro palabras más allá— y vestía la armadura de
    // verde. La distancia es el único dato que dice a qué prenda pertenece.
    const color = COLORES
      .map(([c, ing]) => [cola.search(c), ing])
      .filter(([i]) => i !== -1)
      .sort((a, b) => a[0] - b[0])[0]?.[1] ?? '';

    const cuerpo = `${color ? `${color} ` : ''}${ingles}`;
    frases.push(`wearing ${articulo ? 'a ' : ''}${cuerpo}`);
  }

  return { frases, grupos };
}

/**
 * Qué parte del linaje pisa cada concepto del glosario.
 *
 * El linaje describe al pueblo; la descripción describe a ESTE personaje. Si
 * el jugador dice «ojos azules» y el linaje dice «bright eyes», el retrato
 * llevaba las dos y salía un ojo de cada. Manda el jugador: su rasgo se queda
 * y el del linaje se cae. Lo que el jugador no menciona, el linaje lo conserva.
 */
const PISA = Object.freeze({
  ojos: /\beyes?\b/,
  'color-pelo': /\bhair\b/,
  peinado: /\bhair\b/,
  'largo-pelo': /\bhair\b/,
  cuerpo: /\bshoulder|\bbuild\b|slight|gaunt|slender|broad/,
  altura: /\btall\b|\bsmall\b|\bshort\b/,
  cuernos: /\bhorns?\b/,

  // La especie escrita por el jugador manda sobre el linaje del dado.
  //
  // Es el caso que más cantaba: el jugador escribía «enano» y el linaje
  // Sombracorteza aportaba "tall and gaunt, grey-brown bark-veined skin", así
  // que salía un humano alto. El linaje sale del generador aleatorio; la
  // especie la escribe él. Gana él.
  //
  // Se poda lo que contradice la silueta —altura, complexión, rasgos de cara—
  // y se conserva el color de piel y los cuernos, que pueden convivir: un
  // enano griscuerno de piel grisazulada es exactamente lo que pidió.
  especie: /\btall\b|\bshort\b|gaunt|stocky|slender|angular|small and slight|\bbuild\b|\bshoulder/,
});

/**
 * Quita del linaje los trozos que la descripción del jugador ya contradice.
 *
 * @param {string} linaje
 * @param {Set<string>} grupos Conceptos que el glosario sí reconoció.
 * @returns {string}
 */
function podarLinaje(linaje, grupos) {
  const choques = [...grupos].map((g) => PISA[g]).filter(Boolean);
  if (!choques.length) return linaje;

  return String(linaje ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !choques.some((r) => r.test(t)))
    .join(', ');
}

/** El sexo de la ficha, en el idioma del encargo. */
const SEXO_DE_FICHA = Object.freeze({ f: 'a woman', m: 'a man' });

/**
 * El sexo que marca la primera palabra de la descripción que lo marca.
 *
 * @param {string} texto
 * @returns {string|null} 'a woman', 'a man' o null.
 */
function sexoDeLaDescripcion(texto) {
  const d = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let mejor = null;

  for (const [grupo, patron, ingles] of GLOSARIO) {
    if (grupo !== 'sexo') continue;
    const m = d.match(patron);
    if (m && (mejor === null || m.index < mejor.index)) mejor = { index: m.index, ingles };
  }

  return mejor?.ingles ?? null;
}

/**
 * La especie que nombra la descripción, tal y como la escribió el jugador.
 *
 * Sirve para avisarle en la revelación de que su texto y su ficha no dicen lo
 * mismo. No se traduce a un linaje del juego a propósito: «enana» no es
 * Ferrana ni ninguna otra cosa por decreto, y el linaje cambia las reglas. Eso
 * lo decide él.
 *
 * @param {string} texto
 * @returns {string|null} Por ejemplo «enana», o null si no nombra ninguna.
 */
export function especieNombrada(texto) {
  const d = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  for (const [grupo, patron] of GLOSARIO) {
    if (grupo !== 'especie') continue;
    const m = d.match(patron);
    if (m) return m[0];
  }

  return null;
}

export function traducirRasgos(texto, yaDicho = '') {
  return analizar(texto, yaDicho).frases.join(', ');
}

/**
 * El trabajo de verdad: devuelve las frases y qué conceptos tocaron.
 *
 * Los conceptos hacen falta fuera para podar el linaje, pero no tienen por qué
 * asomar en la API pública, que es una frase.
 *
 * @param {string} texto
 * @param {string} [yaDicho]
 * @returns {{ frases: string[], grupos: Set<string> }}
 */
function analizar(texto, yaDicho = '') {
  // Sin tildes y en minúsculas: la gente escribe «marrón» y «marron» por igual.
  const d = String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const hallados = [];

  // Un concepto, una respuesta. Sin agrupar, «barba trenzada gris» sacaba a la
  // vez *a braided beard* y *a beard*, y el modelo pintaba dos barbas o
  // ninguna. Gana la primera entrada del grupo que casa: por eso el glosario
  // pone siempre lo específico antes que lo genérico.
  const usados = new Set();
  const dicho = String(yaDicho ?? '').toLowerCase();

  /** Qué frase salió de cada grupo, para poder recolocarlas después. */
  const porGrupo = new Map();

  // Las prendas van primero porque reclaman sus grupos: una «armadura de cuero
  // negro» resuelta aquí impide que la tabla añada luego un "battered armour"
  // genérico encima.
  const prendas = prendasConColor(d);
  for (const g of prendas.grupos) usados.add(g);

  for (const [grupo, patron, ingles] of GLOSARIO) {
    if (dicho.includes(ingles.toLowerCase())) continue;
    if (usados.has(grupo)) continue;
    if (!patron.test(d)) continue;

    usados.add(grupo);
    porGrupo.set(grupo, ingles);
    if (!hallados.includes(ingles)) hallados.push(ingles);
  }

  hallados.push(...prendas.frases.filter((f) => !hallados.includes(f)));

  // El lado importa cuando hay cicatriz o parche, y es fácil de acertar. Va
  // pegado a la marca, no al final de la lista: suelto al final, el modelo lo
  // leía como «el herrero está a la izquierda» y descentraba el retrato.
  const lado = /izquierd/.test(d) ? 'left' : (/derech/.test(d) ? 'right' : '');

  if (lado) {
    const i = hallados.findIndex((h) => /scar|eyepatch/.test(h));

    // «a scar through the eyebrow» quiere el lado DENTRO («through the left
    // eyebrow»), no colgando al final, que sonaría a dos cicatrices.
    if (i !== -1) {
      hallados[i] = /eyebrow/.test(hallados[i])
        ? hallados[i].replace('the eyebrow', `the ${lado} eyebrow`)
        : `${hallados[i]} on the ${lado} side`;
    }
  }

  return { frases: hallados, grupos: usados, porGrupo };
}

/**
 * El sujeto del retrato: quién es, sus rasgos distintivos y el resto, en
 * inglés, sin encuadre ni estilo (los pone el puente).
 *
 * @param {Object} personaje
 * @param {string} personaje.raza
 * @param {string} personaje.descripcion Lo que escribió el jugador.
 * @param {'f'|'m'} [personaje.genero]
 * @returns {string|null} null si no hay descripción suficiente.
 */
export function sujetoRetrato(personaje = {}) {
  const descripcion = String(personaje.descripcion ?? personaje.retrato ?? '').trim();
  if (descripcion.length < MINIMO) return null;

  const linaje = LINAJE[personaje.raza] ?? '';
  const { frases, grupos, porGrupo } = analizar(descripcion, linaje);

  // Si el jugador nombra su especie, el linaje de la ficha NO pinta nada.
  //
  // Se podó durante un tiempo dejando piel y cuernos, con el argumento de que
  // un enano griscórneo de piel grisazulada es posible. Lo es, pero no es lo
  // que nadie escribió: «enana guerrera de barba trenzada pelirroja» salía con
  // piel gris azulada y cuernos en las sienes porque el dado había elegido
  // Griscórneo. El jugador no puede adivinar que su ficha trae cuernos, así
  // que no puede quitarlos escribiendo. Nombra especie: manda su especie.
  const rasgo = grupos.has('especie') ? '' : podarLinaje(linaje, grupos);

  // Quién es va delante de todo: primero el sexo, luego la especie, y después
  // ya los rasgos. Antes el encargo empezaba por «one person» y el modelo
  // resolvía el sexo a cara o cruz —«elfa exploradora» salía con cara
  // andrógina—, y la especie ni se mencionaba.
  //
  // Se sacan de la lista de rasgos y se ponen al frente; el resto conserva su
  // orden original.
  //
  // El sexo se decide por la PRIMERA palabra que lo marca, no por la primera
  // entrada del glosario que case en cualquier sitio. En «enano guerrero de
  // barba trenzada pelirroja», «pelirroja» concuerda con la barba, pero el
  // glosario mira antes las formas femeninas y salía una mujer. La persona se
  // nombra primero; lo que va detrás describe otras cosas. Si el texto no lo
  // dice, manda la ficha.
  const sexo = sexoDeLaDescripcion(descripcion) ?? SEXO_DE_FICHA[personaje.genero] ?? null;
  // «a woman, a dwarf» se leía como dos cosas, y con barba ganaba el hombre.
  // Junto, «a dwarf woman», es una sola persona.
  const especieFrase = porGrupo.get('especie');
  const quienEs = sexo && especieFrase
    ? [especieFrase.replace(/^(an?) (\w+)/, (_, art, que) => `${art} ${que} ${sexo === 'a woman' ? 'woman' : 'man'}`)]
    : [sexo, especieFrase].filter(Boolean);
  const frasesSinSexo = frases.filter((f) => !Object.values(SEXO_DE_FICHA).includes(f));

  // Detrás de quién es, lo que hace a este personaje reconocible.
  //
  // Son los rasgos por los que el jugador lo describió y por los que va a
  // juzgar si el retrato es el suyo: la barba, el hacha, la cicatriz. Al final
  // del encargo se diluyen —salía una pelirroja joven sin barba ni hacha de
  // «enana guerrera de barba trenzada pelirroja, hacha a la espalda»— y en
  // cabeza el modelo los pinta. El resto conserva su orden original.
  const DISTINTIVOS = ['barba', 'objeto', 'cicatriz', 'parche', 'tatuaje'];
  const marca = DISTINTIVOS.map((g) => porGrupo.get(g)).filter(Boolean);

  // Sin sexo ni especie reconocidos hace falta un sujeto: sin él el encargo
  // empieza por un rasgo suelto y el modelo decide quién es por su cuenta.
  const delante = [...(quienEs.length ? quienEs : [SUJETO_NEUTRO]), ...marca];
  const resto = frasesSinSexo.filter((f) => !delante.includes(f) && f !== especieFrase);

  // El linaje y los rasgos se unen con coma porque son la misma lista de
  // atributos: pegados con espacio salía «dark hair a scar across the face» y
  // el modelo leía un rasgo inventado en vez de dos.
  const sujeto = [...delante, rasgo, ...resto].filter(Boolean).join(', ');

  // Orden: encuadre → sujeto → remate de estilo. El sujeto en el centro y
  // pronto; ver CABEZA para por qué esto importa tanto.
  //
  // El español original ya NO viaja al final. Con la misma semilla y el mismo
  // sujeto, con y sin cola en español, los dos retratos salen equivalentes: la
  // cola no aporta ningún rasgo que el glosario no hubiera puesto ya. No es
  // que estorbe —eso no lo demuestra la prueba—, es que no paga su sitio, y un
  // encargo corto es más fácil de razonar cuando algo sale mal.
  //
  // El precio es que lo que el glosario no reconoce se pierde. Se acepta: vale
  // más un retrato fiel a seis rasgos que uno confuso que intentó diez. Cuando
  // falte un rasgo, se añade al glosario; no se vuelve a colar español.
  return sujeto.slice(0, 300);
}

export default { sujetoRetrato, especieNombrada, traducirRasgos };
