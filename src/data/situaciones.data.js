/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · data/situaciones.data.js
 * ---------------------------------------------------------------------------
 * Situaciones: cosas que están pasando en el mundo cuando llega el jugador.
 *
 * No son misiones. Nadie le pide nada al personaje: hay gente con sus propios
 * motivos, algo en marcha y más de una manera de meterse… o de no hacerlo. Si
 * el jugador las ignora, siguen su curso: a los pocos turnos se resuelven sin
 * él, y el mundo lo recuerda. No hay castigo por mirar hacia otro lado; hay
 * consecuencias en el mundo, con causa y plazo.
 *
 * Cada plantilla declara:
 *   · actores — quién está metido, con su oficio. Se crean como PNJ de verdad.
 *     Cada uno lleva su sexo fijo, el mismo del texto: con el sexo sorteado
 *     salía «Berina, el carretero».
 *   · apertura — cómo se ve al llegar. {clave} se sustituye por el nombre.
 *   · agenda — qué quiere cada uno. Es para el director, no se narra tal cual.
 *   · detalle — lo que se ve al acercarse a mirar: algo nuevo y observable.
 *   · claves — palabras que dicen que el jugador se está fijando en esto.
 *   · vias — maneras de intervenir: patrón, habilidad, umbral y qué pasa.
 *   · siIgnorada — cuántos turnos aguanta sin el jugador y cómo termina.
 *     `marchan`: quién se va de la escena cuando pasa. `testimonio`: lo que
 *     contará cada implicado si se le pregunta; se guarda en su memoria.
 *   · pulsos — lo que cambia a la vista mientras nadie interviene, antes del
 *     desenlace: el reloj se ve correr.
 *   · escala — si los intentos fallidos suben la tensión, cuándo estalla y en
 *     qué pelea. Una vía con `combate` es atacar: pelea directa.
 *   · secuela — lo que pasa después, causado por cómo terminó: otra
 *     situación, con los mismos implicados si `hereda` lo dice.
 *   · lugares — solo en estos sitios (el peaje necesita un puente).
 *   · sugerencia / sugerencias — lo que se le propone al jugador, sacado de
 *     sus vías (el texto casa con su patrón). `tras: 'detalle'`: solo cuando
 *     ya lo ha visto de cerca. `tema`: de qué se le puede preguntar a alguien.
 *   · sitio — dónde están sus implicados, dicho como se diría («en la garita
 *     del puente»). Sirve para decir quién hay y dónde sin inventar posiciones
 *     que el motor no tiene.
 *   · soloSecuela — no aparece por azar: solo como consecuencia de otra.
 *
 * Todo en castellano de España. El texto de las vías va en segunda persona.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} ViaSituacion
 * @property {string} clave
 * @property {RegExp} patron Sobre el texto del jugador, sin tildes y en minúscula.
 * @property {string} [contra] Clave del actor al que va dirigida; si lo
 *   escrito nombra a otro de la escena y no a este, la vía no se toma.
 * @property {string} habilidad
 * @property {string} umbral
 * @property {string} exito
 * @property {string} fracaso
 * @property {boolean} [resuelveSiExito]
 * @property {Object<string, number>} [actitud] Cambio de actitud por actor si sale bien.
 * @property {Object<string, string>} [recuerdo] Lo que recuerda cada actor si sale bien.
 */

export const SITUACIONES = Object.freeze({

  carro_atascado: {
    refId: 'carro_atascado',
    sitio: 'junto al carro atascado, en mitad de la calle',
    donde: ['asentamiento'],
    actores: [
      { clave: 'carretero', rol: 'carretero', genero: 'm' },
      { clave: 'guardia', rol: 'guardia', genero: 'm' },
    ],
    apertura: 'En mitad de la calle principal, un carro cargado de fruta tiene una rueda partida y no se mueve. {carretero}, el carretero, forcejea con el eje. Detrás se amontonan otros carros, y {guardia}, de la guardia, le grita que lo aparte o lo vuelca él mismo.',
    agenda: '{carretero} necesita llegar al mercado antes de que la fruta se eche a perder; no tiene dinero para otra rueda. {guardia} solo quiere la calle libre y no piensa mancharse las manos.',
    detalle: 'De cerca se ve el problema: la rueda no está rota del todo, se ha salido del eje y el carro pesa demasiado para que {carretero} la encaje solo. {guardia} mira la cola de carros y se toca la porra.',
    claves: /carro|rueda|carretero|fruta|eje|atasc/,
    vias: [
      {
        clave: 'ayudar', patron: /ayud|levant|empuj|arregl|sujet|calz|rueda|eje/,
        habilidad: 'atletismo', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Entre los dos levantáis el carro lo justo para calzar el eje. Rueda coja, pero rueda: {carretero} lo aparta a un lado y te mira como quien no esperaba ayuda de nadie.',
        fracaso: 'Empujas con todo, pero el eje resbala y el carro vuelve a clavarse. {guardia} resopla. {carretero} no dice nada; sigue intentándolo.',
        actitud: { carretero: 30 },
        recuerdo: { carretero: 'Le ayudó a sacar el carro de la calle cuando nadie más lo hizo.' },
      },
      {
        clave: 'mediar', patron: /guardia|convenc|calm|tiempo|paciencia|razon|espera|media/,
        habilidad: 'trato_social', umbral: 'moderada',
        exito: '{guardia} te escucha, gruñe y da un paso atrás: «Una hora. Ni un minuto más.» {carretero} respira por primera vez.',
        fracaso: '{guardia} te mira de arriba abajo. «¿Y tú quién eres para decirme cómo hacer mi trabajo?» La cosa no mejora.',
        actitud: { carretero: 15, guardia: -5 },
        recuerdo: { carretero: 'Le consiguió tiempo frente al guardia.' },
      },
      {
        clave: 'aprovechar', patron: /rob|cojo (una|unas|la) fruta|me llevo|birlo|hurto/,
        habilidad: 'juego_manos', umbral: 'moderada',
        exito: 'Con el jaleo, nadie ve cómo desaparece un puñado de fruta del carro.',
        fracaso: '{carretero} te pilla con la mano en la caja. No grita: te mira. Es peor.',
        actitud: { carretero: -25 },
        recuerdo: { carretero: 'Le vio intentar robarle fruta del carro.' },
      },
    ],
    siIgnorada: {
      tras: 4,
      texto: 'Al fondo de la calle, {guardia} ha perdido la paciencia: entre tres vuelcan el carro de {carretero} a un lado. Media carga de fruta acaba en el barro.',
      hecho: 'La carga de fruta de {carretero} acabó en el barro de la calle principal.',
      pulsos: [{ tras: 2, texto: '{guardia} ya no grita: ha ido a buscar a otros dos guardias. {carretero} sigue solo con el eje.' }],
      testimonio: { carretero: '{carretero} se limpia las manos en el pantalón. «Me volcaron el carro entre tres. Media carga al barro, y a ver quién me la paga.»' },
    },
    sugerencia: { label: 'Echar una mano con el carro', intent: 'custom' },
    tema: 'el carro atascado',
    sugerencias: [
      { label: 'Ayudar a {carretero} a calzar la rueda', intent: 'custom' },
      { label: 'Pedirle calma a {guardia}', intent: 'talk' },
    ],
  },

  colgante_en_el_pozo: {
    refId: 'colgante_en_el_pozo',
    sitio: 'junto al pozo',
    donde: ['asentamiento'],
    actores: [
      { clave: 'nina', rol: 'niña', genero: 'f' },
    ],
    apertura: 'Junto al pozo, una niña se asoma tanto al brocal que da miedo. Se llama {nina}, se lo oyes decir a una vecina que pasa sin pararse: se le ha caído dentro el colgante de su madre, y su madre vuelve al anochecer.',
    agenda: '{nina} quiere recuperar el colgante antes de que vuelva su madre; le da más miedo la bronca que el pozo. Si nadie la ayuda, intentará bajar ella por la cuerda.',
    detalle: 'El agua está a unas tres brazas. Algo brilla en el fondo, entre el cieno. La cuerda del cubo parece aguantar, y {nina} ya la tiene medio desenrollada.',
    claves: /pozo|nina|colgante|brocal|cuerda|cubo/,
    vias: [
      {
        clave: 'bajar', patron: /baj|descuelg|me meto|cuerda|trep/,
        habilidad: 'atletismo', umbral: 'moderada', resuelveSiExito: true,
        exito: 'La cuerda aguanta. Abajo, entre el cieno, algo brilla: el colgante. Cuando subes, {nina} te lo quita de las manos y se lo aprieta contra el pecho.',
        fracaso: 'A media bajada la cuerda da un tirón y te raspas los brazos contra la piedra. Subes sin nada y con {nina} mirándote como si fueras su última esperanza.',
        actitud: { nina: 40 },
        recuerdo: { nina: 'Le sacó el colgante de su madre del pozo.' },
      },
      {
        clave: 'pescar', patron: /cubo|gancho|pesc|anzuelo|palo|rastrill|rastreo el fondo|ingeni/,
        habilidad: 'artesania', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Con el cubo lastrado y un poco de paciencia, el colgante sube enganchado en el asa. {nina} da un grito que oye medio pueblo.',
        fracaso: 'El cubo baja y sube tres veces, siempre con agua turbia y nada más.',
        actitud: { nina: 35 },
        recuerdo: { nina: 'Le pescó el colgante de su madre del fondo del pozo.' },
      },
      {
        clave: 'consolar', patron: /consuel|tranquil|calm|habl|pregunt|madre/,
        habilidad: 'trato_social', umbral: 'facil',
        exito: '{nina} se aparta del brocal y se sienta en el suelo. Te cuenta que el colgante era de su abuela antes que de su madre.',
        fracaso: '{nina} no te escucha: solo mira el agua.',
        actitud: { nina: 10 },
        recuerdo: { nina: 'Se paró a hablar con ella junto al pozo.' },
      },
    ],
    siIgnorada: {
      tras: 5,
      texto: 'Por la plaza pasa corriendo un chaval con una cuerda al hombro: dicen que {nina} intentó bajar sola al pozo y ahora hay medio pueblo alrededor del brocal.',
      hecho: '{nina} intentó bajar sola al pozo a por el colgante de su madre.',
      pulsos: [
        { tras: 2, texto: '{nina} ha desatado el cubo y se enrolla la cuerda del pozo en la muñeca, sin quitar la vista del fondo.' },
        { tras: 4, texto: '{nina} tiene ya una pierna por encima del brocal.' },
      ],
      testimonio: { nina: '{nina} se mira las rodillas raspadas. «Quise bajar yo. La cuerda no llegaba.»' },
    },
    sugerencia: { label: 'Acercarte a la niña del pozo', intent: 'talk' },
    tema: 'el colgante del pozo',
    sugerencias: [
      { label: 'Tranquilizar a {nina}', intent: 'talk' },
      { label: 'Pescar el colgante con el cubo', intent: 'custom', tras: 'detalle' },
      { label: 'Bajar al pozo por la cuerda', intent: 'custom', tras: 'detalle' },
    ],
    secuela: { tras: 3, refId: 'madre_agradece', cuando: 'resuelta', hereda: { nina: 'nina' } },
  },

  encapuchado_vigila: {
    refId: 'encapuchado_vigila',
    sitio: 'en su puesto de la calle',
    donde: ['asentamiento'],
    actores: [
      { clave: 'vigia', rol: 'encapuchado', genero: 'm' },
      { clave: 'mercader', rol: 'mercader', genero: 'm' },
    ],
    apertura: 'Desde el alero de un tejado, una figura con capucha observa la calle sin moverse. No te mira a ti: sigue a {mercader}, un mercader que cuenta monedas en su puesto sin enterarse de nada.',
    agenda: 'La figura ({vigia}) espera a que {mercader} cierre la bolsa para robársela; no busca pelea y huye si se ve descubierta. {mercader} no sospecha nada.',
    detalle: 'Desde aquí se ve mejor: la figura lleva guantes de cuero y no aparta los ojos de la bolsa de {mercader}, que sigue abierta sobre el mostrador.',
    claves: /encapuch|capucha|figura|tejado|alero|vigil|mercader|bolsa/,
    vias: [
      {
        clave: 'avisar', patron: /avis|advier|aviso al mercader|le digo al mercader|mercader/,
        habilidad: 'trato_social', umbral: 'facil', resuelveSiExito: true,
        exito: '{mercader} levanta la vista hacia el tejado justo cuando la figura se escurre por detrás de la chimenea. Guarda la bolsa bajo el mostrador y te da las gracias con la voz todavía temblando.',
        fracaso: '{mercader} te mira como si le hablaras de fantasmas. «¿Qué tejado?» Cuando vuelves a mirar, la figura sigue ahí.',
        actitud: { mercader: 30 },
        recuerdo: { mercader: 'Le avisó de que le vigilaban desde el tejado.' },
      },
      {
        clave: 'seguir', patron: /sig|acech|me escondo|sin que me vea|observ|vigilo/,
        habilidad: 'sigilo', umbral: 'moderada',
        exito: 'Te pegas a la pared y rodeas la manzana. Desde abajo, ves que la figura lleva un cuchillo corto y unos guantes de cuero gastados.',
        fracaso: 'Un gato salta de un barril a tu paso. La figura gira la cabeza hacia ti y se aparta del alero sin prisa, como quien ya ha visto suficiente.',
      },
      {
        clave: 'enfrentar', patron: /baja|grit|le llamo|enfrent|amenaz|subo al tejado/, contra: 'vigia',
        habilidad: 'intimidacion', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Tu voz corta la calle. La figura se incorpora, duda un instante y desaparece por el otro lado del tejado. Hoy no habrá robo.',
        fracaso: 'La figura te mira desde arriba y no se mueve. Luego se lleva un dedo a los labios.',
        actitud: { vigia: -20 },
        recuerdo: { vigia: 'Le plantó cara en mitad de la calle.' },
      },
    ],
    siIgnorada: {
      tras: 5,
      texto: 'Un grito en el mercado: a {mercader} le han quitado la bolsa del mostrador, y nadie ha visto a nadie. En el alero de enfrente ya no hay ninguna figura.',
      hecho: 'A {mercader} le robaron la bolsa en el mercado; alguien le vigilaba desde un tejado.',
      pulsos: [
        { tras: 2, texto: 'La figura del tejado se ha movido dos casas, más cerca del puesto de {mercader}.' },
        { tras: 4, texto: '{mercader} se ha dado la vuelta para atender a una clienta. La bolsa sigue abierta sobre el mostrador.' },
      ],
      secuela: { tras: 2, refId: 'guardia_pregunta', cuando: 'desenlace', hereda: { mercader: 'mercader' } },
      marchan: ['vigia'],
      testimonio: { mercader: '{mercader} señala el mostrador vacío. «Me han quitado la bolsa delante de las narices. Ni lo vi venir.»' },
    },
    sugerencia: { label: 'Fijarte en la figura del tejado', intent: 'observe' },
    tema: 'la figura del tejado',
    sugerencias: [
      { label: 'Avisar a {mercader} de que le vigilan', intent: 'talk', tras: 'detalle' },
      { label: 'Seguir a la figura sin que te vea', intent: 'observe', tras: 'detalle' },
      { label: 'Gritarle a la figura que baje', intent: 'talk', tras: 'detalle' },
    ],
  },

  balanza_trucada: {
    refId: 'balanza_trucada',
    sitio: 'en el puesto de harina',
    donde: ['asentamiento'],
    actores: [
      { clave: 'tendero', rol: 'tendero', genero: 'm' },
      { clave: 'clienta', rol: 'lavandera', genero: 'f' },
    ],
    apertura: 'En un puesto de harina, {clienta} discute a voces con {tendero}: jura que la balanza le roba un tercio de cada saco. {tendero} dice que la balanza es de su padre y que no ha fallado nunca. Se está juntando gente.',
    agenda: '{tendero} lleva meses con una pesa limada y teme que se descubra. {clienta} no tiene con qué pagar otro saco y no se piensa ir sin lo suyo.',
    detalle: 'La pesa grande de la balanza brilla por un canto, como si alguien la hubiera limado hace poco. {tendero} se ha dado cuenta de que la miras.',
    claves: /balanz|harina|pesa|tendero|puesto|saco|discut/,
    vias: [
      {
        clave: 'comprobar', patron: /compru|pes|mir.*balanz|examin|revis|pesa/,
        habilidad: 'percepcion', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Le das la vuelta a la pesa grande: tiene el canto limado, brillante de reciente. La gente lo ve. {tendero} se pone blanco y le rellena el saco a {clienta} sin decir palabra.',
        fracaso: 'Miras la balanza y no ves nada raro. {tendero} sonríe, más tranquilo de lo que debería.',
        actitud: { clienta: 30, tendero: -30 },
        recuerdo: { clienta: 'Destapó la pesa limada del tendero.', tendero: 'Le dejó en evidencia delante de todo el mercado.' },
      },
      {
        clave: 'mediar', patron: /calm|media|acuerdo|partir|medio|justo|hablo con/,
        habilidad: 'trato_social', umbral: 'moderada',
        exito: 'Propones pesar otra vez delante de todos. {tendero} acepta a regañadientes; la segunda pesada sale más generosa que la primera.',
        fracaso: 'Nadie te ha pedido que te metas, te dicen los dos a la vez.',
        actitud: { clienta: 10 },
      },
    ],
    siIgnorada: {
      tras: 3,
      texto: 'La discusión del puesto de harina se acaba como suelen acabar: {clienta} se va con medio saco y los ojos rojos, y {tendero} vuelve a su balanza.',
      hecho: '{clienta} se fue del puesto de {tendero} con medio saco de harina.',
      pulsos: [{ tras: 1, texto: 'Alguien del corro le da la razón a {clienta} en voz alta. {tendero} empieza a sudar.' }],
      marchan: ['clienta'],
      testimonio: { tendero: '{tendero} se encoge de hombros. «Se ha ido con medio saco. La balanza es buena, diga lo que diga.»' },
    },
    sugerencia: { label: 'Mirar de cerca la balanza', intent: 'observe' },
    tema: 'la balanza',
    sugerencias: [
      { label: 'Comprobar la balanza con un peso conocido', intent: 'custom', tras: 'detalle' },
      { label: 'Mediar entre {tendero} y {clienta}', intent: 'talk' },
    ],
  },

  cabra_escapada: {
    refId: 'cabra_escapada',
    sitio: 'detrás de la cabra, camino del huerto',
    donde: ['asentamiento'],
    actores: [
      { clave: 'pastor', rol: 'pastor', genero: 'm' },
    ],
    apertura: 'Una cabra negra cruza la calle a todo trapo con un trozo de cuerda colgando del cuello. Detrás, sin aliento, corre {pastor}, un muchacho que grita su nombre como si eso fuera a servir de algo. La cabra va derecha a un huerto vallado.',
    agenda: '{pastor} perderá el jornal si la cabra se come el huerto del dueño de la posada. La cabra solo quiere coles.',
    detalle: 'La cuerda de la cabra arrastra por el suelo, a un par de pasos de ti. {pastor} no va a llegar a tiempo.',
    claves: /cabra|pastor|huerto|cuerda|coles/,
    vias: [
      {
        clave: 'atrapar', patron: /atrap|cojo la cuerda|agarr|placa|corto el paso|salto|piso la cuerda/,
        habilidad: 'acrobacias', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Pisas la cuerda justo a tiempo. La cabra da un tirón que casi te tira, pero se queda. {pastor} llega doblado de la carrera y te da las gracias a trompicones.',
        fracaso: 'Te lanzas a por la cuerda y te quedas con un puñado de polvo. La cabra ni se ha enterado.',
        actitud: { pastor: 25 },
        recuerdo: { pastor: 'Le ayudó a atrapar la cabra antes de que entrara en el huerto.' },
      },
      {
        clave: 'engañar', patron: /comid|pan|racion|atraigo|ofrezco|silb|llamo a la cabra/,
        habilidad: 'supervivencia', umbral: 'facil', resuelveSiExito: true,
        exito: 'Un trozo de pan en la mano y la cabra cambia de idea sobre las coles. {pastor} la ata con doble nudo.',
        fracaso: 'La cabra huele el pan, lo piensa y elige las coles.',
        actitud: { pastor: 20 },
        recuerdo: { pastor: 'Atrajo a la cabra con comida.' },
      },
    ],
    siIgnorada: {
      tras: 2,
      texto: 'Del huerto vallado llegan gritos: la cabra ha entrado. {pastor} sale arrastrándola por los cuernos mientras el dueño le amenaza con quitarle el jornal de un mes.',
      hecho: 'La cabra de {pastor} se comió medio huerto del posadero.',
      pulsos: [{ tras: 1, texto: 'La cabra ya está en la valla del huerto, arrancando una col por encima de los tablones.' }],
      testimonio: { pastor: '{pastor} tira de la cuerda con rabia. «Medio huerto. Me quedo sin el jornal del mes.»' },
    },
    sugerencia: { label: 'Ir a por la cabra', intent: 'custom' },
    tema: 'la cabra',
    sugerencias: [
      { label: 'Cortarle el paso a la cabra', intent: 'custom' },
      { label: 'Atraer a la cabra con un poco de pan', intent: 'custom' },
    ],
  },

  buhonero_herido: {
    refId: 'buhonero_herido',
    sitio: 'a un lado del camino, sobre su fardo',
    donde: ['punto', 'natural'],
    actores: [
      { clave: 'buhonero', rol: 'buhonero', genero: 'm' },
    ],
    apertura: 'A un lado del camino, un buhonero está sentado sobre su fardo con el tobillo hinchado y morado. Se llama {buhonero}. De su mula solo quedan unas huellas que se pierden campo a través.',
    agenda: '{buhonero} necesita llegar a un techo antes de que anochezca y recuperar la mula, que lleva el resto de su género. Desconfía de quien se acerque demasiado rápido.',
    detalle: 'El tobillo de {buhonero} está muy hinchado, pero no parece roto. Las huellas de la mula van hacia un bosquecillo con agua cerca.',
    claves: /buhonero|tobillo|mula|fardo|herido|huellas/,
    vias: [
      {
        clave: 'curar', patron: /cur|vend|entablill|tobillo|herida|medicin/,
        habilidad: 'medicina', umbral: 'moderada',
        exito: 'Le entablillas el tobillo con dos palos y una tira de tela. No andará bien en días, pero podrá andar. {buhonero} te mira con otros ojos.',
        fracaso: 'Al tocarle el tobillo, {buhonero} suelta un aullido y te aparta la mano. «Déjalo, déjalo.»',
        actitud: { buhonero: 25 },
        recuerdo: { buhonero: 'Le entablilló el tobillo en el camino.' },
      },
      {
        clave: 'buscar', patron: /mula|huella|rastr|busc|sig/,
        habilidad: 'supervivencia', umbral: 'moderada', resuelveSiExito: true,
        exito: 'Las huellas te llevan a un arroyo, y allí está la mula, bebiendo como si nada con el fardo intacto. Cuando se la devuelves, a {buhonero} se le escapa una carcajada de alivio.',
        fracaso: 'Las huellas se pierden en un pedregal. Vuelves con las manos vacías.',
        actitud: { buhonero: 35 },
        recuerdo: { buhonero: 'Le encontró la mula y el género.' },
      },
    ],
    siIgnorada: {
      tras: 4,
      texto: 'Pasa una carreta en dirección contraria. Poco después, del buhonero del camino solo queda la marca del fardo en la hierba.',
      hecho: 'Una carreta recogió a {buhonero}, el buhonero herido del camino.',
      pulsos: [{ tras: 2, texto: '{buhonero} intenta ponerse en pie apoyándose en el fardo, y vuelve a caer.' }],
      marchan: ['buhonero'],
    },
    sugerencia: { label: 'Acercarte al buhonero herido', intent: 'talk' },
    tema: 'el buhonero herido',
    sugerencias: [
      { label: 'Curarle el tobillo a {buhonero}', intent: 'custom' },
      { label: 'Buscar las huellas de la mula', intent: 'search' },
    ],
  },

  /* ─── Negociar o pelear ───────────────────────────────────────────────── */

  peaje_abusivo: {
    refId: 'peaje_abusivo',
    sitio: 'en la garita del puente',
    donde: ['asentamiento'],
    lugares: ['vado_yunque'],
    actores: [
      { clave: 'cobrador', rol: 'guardia', genero: 'm' },
      { clave: 'arriero', rol: 'arriero', genero: 'm' },
    ],
    apertura: 'En la garita del puente, {cobrador}, de la guardia del peaje, le cobra a {arriero} el doble de lo que dice la tabla. El viejo cuenta monedas que no tiene, con la mula tirando del ronzal. Otro guardia mira desde el pretil, con la mano en el cinto.',
    agenda: '{cobrador} se queda la diferencia del peaje y la reparte con los del pretil. No quiere testigos ni líos con la guardia del pueblo, pero tampoco va a dejarse avergonzar delante de sus hombres.',
    detalle: 'La tabla de la garita dice tres cobres por bestia. {cobrador} pide seis. El del pretil no es de la guardia del pueblo: no lleva el distintivo del Vado.',
    claves: /peaje|garita|cobrador|arriero|mula|viejo|tabla|guardias?\b|pretil/,
    vias: [
      {
        clave: 'pagar', patron: /\bpag[oa]|\ble doy (?:el |las |unas |dos |tres |cinco )?(?:dinero|monedas|cobres)|\bmonedas\b|\bofrezco (?:dos|tres|unas|cinco)? ?monedas|lo pago/,
        habilidad: null, coste: { oro: 3 }, resuelveSiExito: true,
        exito: 'Pones las monedas en la tabla de la garita. {cobrador} las cuenta sin mirarte y le hace un gesto a {arriero}: pasa. El viejo tira de la mula y te busca con los ojos al cruzar.',
        fracaso: 'Buscas en la bolsa y no te llega. {cobrador} ni se molesta en reírse.',
        actitud: { arriero: 30 },
        recuerdo: { arriero: 'Le pagó el peaje en el puente cuando no le llegaba.' },
      },
      {
        // Hace falta hablar: «miro la tabla de precios» es mirar, no
        // negociar, y contaba como un intento fallido que subía la tensión.
        clave: 'razonar', patron: /\b(?:le digo|les digo|le explico|les explico|hablo|le hablo|le recuerdo|protesto|convenzo|razono|regateo|le hago ver|le pido)\b|es un abuso|lo que pone la tabla/,
        habilidad: 'trato_social', umbral: 'moderada', resuelveSiExito: true, tension: 1,
        exito: '{cobrador} mira la tabla, te mira a ti y cobra lo que pone. «Lo que pone, lo que pone.» {arriero} cruza sin mirar atrás.',
        fracaso: '{cobrador} se ríe. «La tabla la leo yo.» El del pretil se despega de la piedra y se acerca despacio.',
        actitud: { arriero: 20, cobrador: -10 },
        recuerdo: { arriero: 'Plantó cara al del peaje por él.', cobrador: 'Le afeó el cobro delante de todos.' },
      },
      {
        clave: 'intimidar', patron: /amenaz|parto|parte la cara|te arrepent|apartaos|apartate|o te|intimid|largaos|os mato/,
        habilidad: 'intimidacion', umbral: 'dificil', resuelveSiExito: true, tension: 1,
        exito: '{cobrador} calcula, escupe a un lado y le hace un gesto a {arriero} para que pase. No te quita los ojos de encima mientras cruzas.',
        fracaso: '{cobrador} no se mueve. «¿Tú y cuántos más?» El del pretil ya tiene la porra en la mano.',
        actitud: { arriero: 15, cobrador: -30 },
        recuerdo: { cobrador: 'Le amenazó en el peaje.' },
      },
      {
        clave: 'pelear', patron: /\bataco\b|golpeo|le pego|desenvain|punetazo|me lanzo contra/,
        habilidad: null, combate: { enemies: [{ refId: 'guardia_corrupto', count: 2 }] },
        exito: '{cobrador} ve venir el golpe y grita al del pretil. Ya no hay nada que hablar.',
        fracaso: '',
        actitud: { cobrador: -60 },
        recuerdo: { cobrador: 'Le atacó en el peaje.' },
      },
    ],
    escala: {
      umbral: 2,
      aviso: 'Se acabó la conversación: {cobrador} saca la porra y el del pretil viene detrás.',
      combate: { enemies: [{ refId: 'guardia_corrupto', count: 2 }] },
    },
    siIgnorada: {
      tras: 4,
      texto: 'En el puente, {arriero} acaba pagando con la manta que llevaba en la mula. {cobrador} la tira dentro de la garita.',
      hecho: '{cobrador} le quitó la manta a {arriero} en el peaje del puente.',
      testimonio: { arriero: '{arriero} se frota los brazos. «Me cobraron el doble y me quitaron la manta. Los del peaje hacen lo que quieren.»' },
      pulsos: [{ tras: 2, texto: '{arriero} ha empezado a desatar la manta de la mula para ofrecerla. {cobrador} ni la mira.' }],
    },
    sugerencia: { label: 'Mirar la tabla del peaje', intent: 'observe' },
    tema: 'lo que cobran en el peaje',
    sugerencias: [
      { label: 'Decirle a {cobrador} que cobre lo justo', intent: 'talk', tras: 'detalle' },
      { label: 'Pagar lo que le falta a {arriero}', intent: 'custom', tras: 'detalle' },
    ],
  },

  /* ─── Secuelas: solo como consecuencia de otra ───────────────────────── */

  guardia_pregunta: {
    refId: 'guardia_pregunta',
    sitio: 'yendo de puesto en puesto',
    donde: ['asentamiento'],
    soloSecuela: true,
    actores: [
      { clave: 'guardia', rol: 'guardia', genero: 'f' },
      { clave: 'mercader', rol: 'mercader', genero: 'm' },
    ],
    apertura: '{guardia}, de la guardia del pueblo, va puesto por puesto preguntando por la bolsa de {mercader}. Llega hasta ti: «¿Viste algo esta mañana? Una vecina dice que había alguien en los tejados.»',
    agenda: '{guardia} tiene poco con qué empezar y lo sabe. Busca a cualquiera que viera algo, sin acusar a nadie.',
    detalle: '{guardia} lleva una tablilla con tres nombres apuntados y ninguno tachado.',
    claves: /guardia|bolsa|robo|tejado|encapuch|figura|capucha/,
    vias: [
      {
        clave: 'contar', patron: /\bvi\b|encapuch|tejado|capucha|figura|le cuento|le digo lo que|habia uno|alero/,
        habilidad: null, resuelveSiExito: true,
        exito: '{guardia} apunta lo que dices en la tablilla. «Eso cuadra con lo de la vecina.» Se va hacia el callejón de detrás del mercado, deprisa.',
        fracaso: '',
        actitud: { guardia: 15, mercader: 10 },
        recuerdo: { guardia: 'Le contó lo del encapuchado del tejado.' },
      },
      {
        clave: 'callar', patron: /no vi|nada|no se|no he visto|callo|ni idea/,
        habilidad: null, resuelveSiExito: true,
        exito: '{guardia} asiente sin mucha fe y sigue con el puesto de al lado.',
        fracaso: '',
      },
    ],
    siIgnorada: {
      tras: 3,
      texto: '{guardia} se cansa de esperar respuesta y sigue preguntando en otro puesto.',
      hecho: 'La guardia preguntó por el robo del mercado sin sacar nada en claro.',
    },
    sugerencia: { label: 'Contarle lo que viste', intent: 'talk' },
    tema: 'el robo de la bolsa',
    sugerencias: [
      { label: 'Decirle a {guardia} que no viste nada', intent: 'talk' },
    ],
  },

  madre_agradece: {
    refId: 'madre_agradece',
    sitio: 'delante de ti',
    donde: ['asentamiento'],
    soloSecuela: true,
    actores: [
      { clave: 'madre', rol: 'lavandera', genero: 'f' },
      { clave: 'nina', rol: 'niña', genero: 'f' },
    ],
    apertura: 'Un rato después, una mujer con las manos rojas de lavar se abre paso hasta ti con {nina} de la mano. Es {madre}, su madre. «Me han dicho que fuiste tú lo del pozo.»',
    agenda: '{madre} quiere dar las gracias como pueda, y no tiene dinero. Conoce a todo el pueblo.',
    detalle: '{nina} lleva el colgante al cuello, por fuera de la ropa, para que se vea.',
    claves: /madre|mujer|lavandera|gracias|nina|colgante/,
    vias: [
      {
        clave: 'aceptar', patron: /gracias|de nada|no fue nada|me alegro|acepto|no hay de que|no es nada|sonrio/,
        habilidad: null, resuelveSiExito: true,
        exito: '{madre} te pone en la mano un pañuelo con pan y queso todavía caliente. «Si necesitas algo del pueblo, pregúntame a mí. Aquí lavo la ropa de todos: sé quién llega y quién se va.»',
        fracaso: '',
        actitud: { madre: 40 },
        recuerdo: { madre: 'Sacó el colgante del pozo antes de que su hija se hiciera daño.' },
      },
    ],
    siIgnorada: {
      tras: 4,
      texto: '{madre} se va con {nina} de la mano sin molestarte más.',
      hecho: 'La madre de {nina} vino a darte las gracias.',
    },
    sugerencia: { label: 'Hablar con la madre', intent: 'talk' },
    tema: 'lo del pozo',
    sugerencias: [
      { label: 'Aceptar su agradecimiento', intent: 'talk' },
    ],
  },
});

/**
 * Plantillas posibles para un lugar.
 * @param {{tipo?: string}} lugar
 * @returns {Object[]}
 */
export function situacionesPara(lugar) {
  const tipo = lugar?.tipo ?? 'asentamiento';
  return Object.values(SITUACIONES).filter((s) => s.donde.includes(tipo)
    && !s.soloSecuela
    && (!s.lugares || s.lugares.includes(lugar?.refId)));
}

/**
 * @param {string} refId
 * @returns {Object|null}
 */
export function obtenerSituacion(refId) {
  return SITUACIONES[refId] ?? null;
}

export default SITUACIONES;
