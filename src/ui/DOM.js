/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCANVEIL · ui/DOM.js
 * ---------------------------------------------------------------------------
 * Utilidades de manipulación del DOM sin framework.
 *
 * El eje es `h()`, un constructor de elementos con la ergonomía de JSX pero sin
 * compilador, sin dependencias y sin virtual DOM. Construye nodos reales.
 *
 * Regla de seguridad que atraviesa todo el archivo: el texto se inserta SIEMPRE
 * con textContent, nunca con innerHTML. El director de juego produce texto
 * arbitrario y no fiable. No hay puerta para HTML literal: `crudo` existía
 * sin que nadie la usara y se quitó (tools/auditar-xss.mjs vigila que no
 * vuelva ninguna).
 *
 * Dependencias: config/ui.config.js.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SELECTORES, ICONOS } from '../config/ui.config.js';

const NS_SVG = 'http://www.w3.org/2000/svg';

/** Etiquetas que deben crearse en el espacio de nombres SVG. */
const ETIQUETAS_SVG = new Set(['svg', 'use', 'path', 'circle', 'rect', 'g', 'line', 'polygon', 'text', 'defs', 'symbol']);

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTRUCCIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Crea un elemento.
 *
 * @param {string} etiqueta Nombre de etiqueta, admite atajos:
 *   'div.panel', 'button.btn.btn--primary', 'span#reloj.worldclock'
 * @param {Object} [props] Atributos, propiedades y manejadores.
 *   · Claves que empiezan por 'on' → oyentes de evento ('onClick', 'onInput')
 *   · `class` o `className` → clases (cadena, array u objeto condicional)
 *   · `style` → objeto de estilos; las claves con '--' se aplican como variables
 *   · `dataset` → objeto de atributos data-*
 *   · `text` → textContent (seguro)
 *   · `attrs` → atributos literales
 *   · resto → atributos, o propiedades si existen en el elemento
 * @param {...(Node|string|number|null|undefined|Array)} hijos
 * @returns {HTMLElement|SVGElement}
 *
 * @example
 * h('button.btn.btn--primary', { onClick: enviar, disabled: bloqueado },
 *   icono('enviar'), h('span.btn__label', { text: 'Enviar' }));
 */
export function h(etiqueta, props = {}, ...hijos) {
  // — Descomponer atajos de etiqueta —
  const partesId = etiqueta.split('#');
  const conClases = partesId[0].split('.');
  const nombre = conClases[0] || 'div';
  const clasesAtajo = conClases.slice(1);
  const idAtajo = partesId[1]?.split('.')[0];

  const el = ETIQUETAS_SVG.has(nombre)
    ? document.createElementNS(NS_SVG, nombre)
    : document.createElement(nombre);

  if (idAtajo) el.id = idAtajo;
  if (clasesAtajo.length) el.classList.add(...clasesAtajo);

  // — Propiedades —
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;

    if (clave.startsWith('on') && typeof valor === 'function') {
      const evento = clave.slice(2).toLowerCase();
      el.addEventListener(evento, valor);
      continue;
    }

    switch (clave) {
      case 'class':
      case 'className':
        aplicarClases(el, valor);
        break;

      case 'style':
        aplicarEstilos(el, valor);
        break;

      case 'dataset':
        for (const [k, v] of Object.entries(valor)) {
          if (v !== null && v !== undefined) el.dataset[k] = String(v);
        }
        break;

      case 'text':
        el.textContent = String(valor);
        break;

      case 'attrs':
        for (const [k, v] of Object.entries(valor)) {
          if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
        }
        break;

      case 'ref':
        if (typeof valor === 'function') valor(el);
        break;

      default:
        // Las propiedades reales (value, checked, disabled) se asignan como
        // propiedad; el resto, como atributo.
        if (clave in el && !(el instanceof SVGElement)) {
          try { el[clave] = valor; } catch { el.setAttribute(clave, String(valor)); }
        } else {
          el.setAttribute(clave, valor === true ? '' : String(valor));
        }
    }
  }

  añadir(el, hijos);
  return el;
}

/**
 * Añade hijos a un elemento, aplanando arrays e ignorando nulos.
 * Las cadenas se insertan como nodos de texto, nunca como HTML.
 *
 * @param {Node} padre
 * @param {*} hijos
 */
export function añadir(padre, hijos) {
  if (hijos === null || hijos === undefined || hijos === false) return;

  if (Array.isArray(hijos)) {
    for (const hijo of hijos) añadir(padre, hijo);
    return;
  }

  if (hijos instanceof Node) {
    padre.appendChild(hijos);
    return;
  }

  padre.appendChild(document.createTextNode(String(hijos)));
}

/**
 * Aplica clases desde cadena, array u objeto condicional.
 * @param {Element} el
 * @param {string|string[]|Record<string, boolean>} valor
 */
export function aplicarClases(el, valor) {
  if (typeof valor === 'string') {
    el.classList.add(...valor.split(/\s+/).filter(Boolean));
  } else if (Array.isArray(valor)) {
    el.classList.add(...valor.filter(Boolean));
  } else if (valor && typeof valor === 'object') {
    for (const [clase, activa] of Object.entries(valor)) {
      if (activa) el.classList.add(clase);
    }
  }
}

/**
 * Aplica estilos, distinguiendo las variables CSS.
 * @param {HTMLElement} el
 * @param {Record<string, string|number>} estilos
 */
export function aplicarEstilos(el, estilos) {
  for (const [prop, valor] of Object.entries(estilos)) {
    if (valor === null || valor === undefined) continue;
    if (prop.startsWith('--')) el.style.setProperty(prop, String(valor));
    else el.style[prop] = typeof valor === 'number' && prop !== 'zIndex' ? `${valor}px` : String(valor);
  }
}

/**
 * Fragmento con varios hijos, para insertar en un solo reflujo.
 * @param {...*} hijos
 * @returns {DocumentFragment}
 */
export function fragmento(...hijos) {
  const f = document.createDocumentFragment();
  añadir(f, hijos);
  return f;
}

/**
 * Icono del sprite SVG embebido en index.html.
 *
 * @param {string} clave Clave lógica de ICONOS ('espada', 'vida'…) o un id
 *   directo del sprite ('ic-sword').
 * @param {Object} [props] Props adicionales para el <svg>.
 * @returns {SVGElement}
 */
export function icono(clave, props = {}) {
  const idSprite = ICONOS[clave] ?? clave;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', ['icon', props.class].filter(Boolean).join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const uso = document.createElementNS(NS_SVG, 'use');
  uso.setAttribute('href', `#${idSprite}`);
  svg.appendChild(uso);

  if (props.title) {
    const titulo = document.createElementNS(NS_SVG, 'title');
    titulo.textContent = props.title;
    svg.appendChild(titulo);
    svg.removeAttribute('aria-hidden');
  }

  return svg;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONSULTA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Primer elemento que coincide.
 * @param {string} selector
 * @param {ParentNode} [raiz=document]
 * @returns {HTMLElement|null}
 */
/**
 * Crea un nodo SVG.
 *
 * Los elementos SVG necesitan su espacio de nombres: crearlos con
 * `createElement` produce nodos que el navegador no dibuja.
 *
 * @param {string} tag
 * @param {Object} [opciones]
 * @param {...*} hijos
 * @returns {SVGElement}
 */
export function svg(tag, opciones = {}, ...hijos) {
  const nodo = document.createElementNS('http://www.w3.org/2000/svg', tag);

  for (const [clave, valor] of Object.entries(opciones.attrs ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    nodo.setAttribute(clave, String(valor));
  }

  if (opciones.class) nodo.setAttribute('class', opciones.class);
  if (opciones.style) nodo.setAttribute('style', opciones.style);
  if (opciones.text !== undefined) nodo.textContent = String(opciones.text);

  for (const [clave, valor] of Object.entries(opciones.dataset ?? {})) {
    nodo.dataset[clave] = String(valor);
  }

  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo);
  }

  return nodo;
}

export function qs(selector, raiz = document) {
  return raiz.querySelector(selector);
}

/**
 * Todos los elementos que coinciden, como array.
 * @param {string} selector
 * @param {ParentNode} [raiz=document]
 * @returns {HTMLElement[]}
 */
export function qsa(selector, raiz = document) {
  return Array.from(raiz.querySelectorAll(selector));
}

/**
 * Resuelve un punto de montaje declarado en ui.config.js.
 *
 * @param {string} clave Valor de MONTAJES ('character', 'narrative'…).
 * @param {ParentNode} [raiz=document]
 * @returns {HTMLElement|null}
 */
export function montaje(clave, raiz = document) {
  return raiz.querySelector(`[data-mount="${clave}"]`);
}

/**
 * Resuelve un selector del catálogo SELECTORES por ruta con puntos.
 * @param {string} ruta 'accion.entrada', 'capas.modal'
 * @returns {HTMLElement|null}
 */
export function porRuta(ruta) {
  let nodo = SELECTORES;
  for (const tramo of ruta.split('.')) {
    nodo = nodo?.[tramo];
    if (nodo === undefined) return null;
  }
  return typeof nodo === 'string' ? qs(nodo) : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MUTACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vacía un elemento.
 * Se usa removeChild en bucle en vez de innerHTML = '' porque así el navegador
 * libera correctamente los oyentes asociados a los hijos.
 * @param {Element} el
 * @returns {Element} El mismo elemento.
 */
export function vaciar(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/**
 * Sustituye el contenido de un elemento.
 * @param {Element} el
 * @param {...*} hijos
 * @returns {Element}
 */
export function reemplazar(el, ...hijos) {
  vaciar(el);
  añadir(el, hijos);
  return el;
}

/**
 * Aplica o retira una clase.
 * @param {Element} el
 * @param {string} clase
 * @param {boolean} activa
 */
export function clase(el, clase_, activa) {
  if (!el) return;
  el.classList.toggle(clase_, Boolean(activa));
}

/**
 * Muestra u oculta con el atributo `hidden`.
 * @param {Element} el
 * @param {boolean} visible
 */
export function visible(el, visible_) {
  if (!el) return;
  if (visible_) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

/**
 * Fija un atributo, retirándolo si el valor es nulo o falso.
 * @param {Element} el
 * @param {string} nombre
 * @param {*} valor
 */
export function atributo(el, nombre, valor) {
  if (!el) return;
  if (valor === null || valor === undefined || valor === false) el.removeAttribute(nombre);
  else el.setAttribute(nombre, valor === true ? '' : String(valor));
}

/**
 * Escribe texto de forma segura.
 * @param {Element} el
 * @param {*} valor
 */
export function texto(el, valor) {
  if (el) el.textContent = valor === null || valor === undefined ? '' : String(valor);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENTOS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Registra un oyente y devuelve su función de baja.
 * Devolver la baja no es un detalle: es lo que permite que Component limpie
 * automáticamente al destruirse.
 *
 * @param {EventTarget} el
 * @param {string} evento
 * @param {EventListener} fn
 * @param {AddEventListenerOptions|boolean} [opciones]
 * @returns {() => void}
 */
export function on(el, evento, fn, opciones) {
  if (!el) return () => {};
  el.addEventListener(evento, fn, opciones);
  return () => el.removeEventListener(evento, fn, opciones);
}

/**
 * Delegación de eventos: un solo oyente en el contenedor atiende a todos los
 * descendientes que coincidan con el selector, presentes o futuros.
 *
 * Es como funcionan las listas de objetos y de opciones: da igual cuántos
 * elementos se rendericen, el coste es un oyente.
 *
 * @param {Element} contenedor
 * @param {string} evento
 * @param {string} selector
 * @param {(e: Event, objetivo: HTMLElement) => void} fn
 * @returns {() => void}
 */
export function delegar(contenedor, evento, selector, fn) {
  if (!contenedor) return () => {};
  const manejador = (e) => {
    const objetivo = e.target.closest(selector);
    if (objetivo && contenedor.contains(objetivo)) fn(e, objetivo);
  };
  contenedor.addEventListener(evento, manejador);
  return () => contenedor.removeEventListener(evento, manejador);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DESPLAZAMIENTO Y FOCO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Comprueba si un contenedor está desplazado hasta el fondo, con margen.
 * Es lo que decide si la bitácora debe seguir al contenido nuevo o respetar
 * que el jugador esté leyendo algo anterior.
 *
 * @param {Element} el
 * @param {number} [margen=120]
 * @returns {boolean}
 */
export function alFondo(el, margen = 120) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= margen;
}

/**
 * Desplaza un contenedor hasta el fondo.
 * @param {Element} el
 * @param {boolean} [suave=true]
 */
export function irAlFondo(el, suave = true) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
}

/**
 * Enfoca un elemento sin provocar desplazamiento.
 * @param {HTMLElement} el
 */
export function enfocar(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
}

/**
 * Confina la navegación por tabulador dentro de un contenedor, para modales.
 * @param {HTMLElement} contenedor
 * @returns {() => void} Baja del oyente.
 */
export function atraparFoco(contenedor) {
  const SELECTOR_FOCO = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const manejador = (e) => {
    if (e.key !== 'Tab') return;
    const focos = qsa(SELECTOR_FOCO, contenedor).filter((el) => el.offsetParent !== null);
    if (!focos.length) return;

    const primero = focos[0];
    const ultimo = focos[focos.length - 1];

    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  contenedor.addEventListener('keydown', manejador);
  return () => contenedor.removeEventListener('keydown', manejador);
}

export default {
  h, añadir, fragmento, icono,
  qs, qsa, montaje, porRuta,
  vaciar, reemplazar, clase, visible, atributo, texto,
  on, delegar,
  alFondo, irAlFondo, enfocar, atraparFoco,
  aplicarClases, aplicarEstilos,
};
