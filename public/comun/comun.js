// Funciones compartidas del frontend (Integrante 2).
// Cada página pone <header id="menu" data-activo="pacientes"></header>
// y enlaza este archivo para obtener el menú común.

const ENLACES_MENU = [
  { id: 'pacientes', texto: 'Pacientes', href: '/pacientes/' },
  { id: 'medicos', texto: 'Médicos', href: '/medicos/' },
  { id: 'citas', texto: 'Solicitar cita', href: '/citas/' },
  { id: 'recepcion', texto: 'Recepción', href: '/recepcion/' },
  { id: 'agenda', texto: 'Agenda del doctor', href: '/agenda/' },
];

function pintarMenu() {
  const header = document.getElementById('menu');
  if (!header) return;
  const activo = header.dataset.activo;
  header.className = 'menu';
  header.innerHTML = `
    <div class="menu-interno">
      <span class="menu-logo">Consultorio · Citas</span>
      <nav>
        ${ENLACES_MENU.map((e) =>
          `<a href="${e.href}" class="${e.id === activo ? 'activo' : ''}">${e.texto}</a>`
        ).join('')}
      </nav>
    </div>`;
}

// Escapa texto para insertarlo en HTML sin riesgo (evita inyección de código)
function escaparHTML(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Muestra un mensaje en un contenedor .alerta. `mensajes` puede ser texto o lista
function mostrarAlerta(elemento, tipo, mensajes) {
  const lista = Array.isArray(mensajes) ? mensajes : [mensajes];
  elemento.className = `alerta alerta-${tipo}`;
  elemento.innerHTML = lista.length > 1
    ? `<strong>Revisa lo siguiente:</strong><ul>${lista.map((m) => `<li>${escaparHTML(m)}</li>`).join('')}</ul>`
    : escaparHTML(lista[0]);
}

function ocultarAlerta(elemento) {
  elemento.className = 'oculto';
  elemento.innerHTML = '';
}

// fetch a la API que devuelve JSON o lanza un error con los mensajes del servidor
async function api(url, opciones = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = new Error('Error de la API');
    error.mensajes = datos.errores || [datos.error || 'No se pudo completar la operación.'];
    throw error;
  }
  return datos;
}

// '2026-10-20' -> '20/10/2026'
function formatearFecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function etiquetaEstado(estado) {
  return `<span class="estado estado-${escaparHTML(estado)}">${escaparHTML(estado)}</span>`;
}

document.addEventListener('DOMContentLoaded', pintarMenu);
