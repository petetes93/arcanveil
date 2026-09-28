/**
 * Mejora opcional del retrato con un generador de imagen que corre en el PC.
 * La web nunca contiene un modelo ni una clave: habla solo con loopback. Si el
 * servicio no está levantado, el SVG procedural que ya está pintado permanece.
 */
// Puerto propio: el 11436 es del puente de Groq (ver tools/imagen-local-proxy.mjs).
const ORIGEN = 'http://127.0.0.1:11437';
const ESPERA_ESCRITURA = 850;
const pendientes = new WeakMap();

// Casi nadie tiene el puente levantado. Cada intento contra un puerto cerrado
// deja un error rojo en la consola del navegador (no se puede silenciar), y
// se intentaba en cada retrato pintado: decenas por partida. Si no contesta,
// se da por apagado un rato; si el jugador lo arranca después, se nota al
// volver a mirar.
const REINTENTO_AUSENTE = 5 * 60 * 1000;
let ausenteHasta = 0;

/** Avisa a la interfaz del estado del retrato: generando, listo o ausente. */
function avisar(nodo, estado) {
  nodo.dataset.retratoLocal = estado;
  nodo.dispatchEvent(new CustomEvent('retrato-local', { detail: { estado } }));
}

function firma(personaje) {
  return JSON.stringify({
    linaje: personaje.raza ?? 'valdes',
    nombre: personaje.nombre ?? '',
    descripcion: personaje.descripcion ?? personaje.retrato ?? '',
  });
}

/** Pide una imagen real local y sustituye el fallback solo cuando está lista. */
export function mejorarRetratoLocal(nodo, personaje = {}) {
  if (!nodo) return;
  const descripcion = (personaje.descripcion ?? personaje.retrato ?? '').trim();
  const anterior = pendientes.get(nodo);
  if (anterior) clearTimeout(anterior);
  if (descripcion.length < 8) return;
  if (Date.now() < ausenteHasta) return;

  const actual = firma(personaje);
  nodo.dataset.firmaRetratoLocal = actual;
  // Tras pulsar «Crear personaje» no hay nada más que esperar: se pide ya.
  const espera = personaje.inmediato ? 0 : ESPERA_ESCRITURA;
  const temporizador = setTimeout(async () => {
    if (Date.now() < ausenteHasta) return;
    avisar(nodo, 'generando');
    try {
      const respuesta = await fetch(`${ORIGEN}/v1/candidata`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo: 'personaje',
          clave: `pj:${String(personaje.id ?? personaje.nombre ?? 'x').replace(/[^\w:.-]/g, '').slice(0, 60) || 'x'}`,
          linaje: personaje.raza ?? 'valdes',
          descripcion: descripcion.slice(0, 300),
        }),
      });
      if (nodo.dataset.firmaRetratoLocal !== actual) return;
      if (!respuesta.ok) return avisar(nodo, 'ausente');
      const blob = await respuesta.blob();
      if (nodo.dataset.firmaRetratoLocal !== actual) return;
      if (!blob.type.startsWith('image/')) return avisar(nodo, 'ausente');

      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.className = 'arte arte--imagen arte--imagen-generada';
      img.alt = personaje.nombre ? `Retrato generado de ${personaje.nombre}` : 'Retrato generado';
      img.addEventListener('load', () => {
        if (nodo.dataset.firmaRetratoLocal !== actual) return URL.revokeObjectURL(url);
        const previa = nodo.dataset.urlRetratoLocal;
        nodo.replaceChildren(img);
        nodo.dataset.urlRetratoLocal = url;
        if (previa) URL.revokeObjectURL(previa);
        avisar(nodo, 'listo');
      }, { once: true });
      img.addEventListener('error', () => { URL.revokeObjectURL(url); avisar(nodo, 'ausente'); }, { once: true });
      img.src = url;
    } catch {
      // El generador es una mejora local opcional. Nunca rompe el juego.
      ausenteHasta = Date.now() + REINTENTO_AUSENTE;
      if (nodo.dataset.firmaRetratoLocal === actual) avisar(nodo, 'ausente');
    }
  }, espera);
  pendientes.set(nodo, temporizador);
}
