// Funciones compartidas del frontend (Integrante 2).
// Cada página pone <header id="menu" data-activo="pacientes"></header>
// y enlaza este archivo para obtener el menú común.

// `roles` dice quién ve cada enlace (login y roles, Integrante 5):
// 'admin' = recepcionista, 'doctor' = médico, 'publico' = sin iniciar sesión.
const ENLACES_MENU = [
  { id: 'pacientes', texto: 'Pacientes', href: '/pacientes/', roles: ['admin'] },
  { id: 'medicos', texto: 'Médicos', href: '/medicos/', roles: ['admin'] },
  { id: 'citas', texto: 'Solicitar cita', href: '/citas/', roles: ['admin', 'doctor', 'publico'] },
  { id: 'recepcion', texto: 'Recepción', href: '/recepcion/', roles: ['admin'] },
  { id: 'agenda', texto: 'Agenda del doctor', href: '/agenda/', roles: ['admin', 'doctor'] },
];
const NOMBRE_ROL = { admin: 'Recepción', doctor: 'Doctor' };

// Usuario conectado (o null). Se consulta una sola vez por página.
let sesionPendiente = null;
function sesionActual() {
  if (!sesionPendiente) {
    sesionPendiente = fetch('/api/auth/sesion')
      .then((r) => (r.ok ? r.json() : { usuario: null }))
      .then((datos) => datos.usuario || null)
      .catch(() => null);
  }
  return sesionPendiente;
}

async function cerrarSesion() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login.html';
}

async function pintarMenu() {
  const header = document.getElementById('menu');
  if (!header) return;
  const activo = header.dataset.activo;
  header.className = 'menu';
  header.innerHTML = `
    <div class="menu-interno">
      <span class="menu-logo">Consultorio · Citas</span>
      <nav></nav>
      <div class="menu-usuario"></div>
    </div>`;

  const usuario = await sesionActual();
  const rol = usuario ? usuario.rol : 'publico';
  header.querySelector('nav').innerHTML = ENLACES_MENU
    .filter((e) => e.roles.includes(rol))
    .map((e) => `<a href="${e.href}" class="${e.id === activo ? 'activo' : ''}">${e.texto}</a>`)
    .join('');

  const bloqueUsuario = header.querySelector('.menu-usuario');
  if (usuario) {
    bloqueUsuario.innerHTML = `
      <span class="menu-nombre" title="${escaparHTML(usuario.usuario)}">${escaparHTML(usuario.nombre)}
        <small>${escaparHTML(NOMBRE_ROL[usuario.rol] || usuario.rol)}</small></span>
      <button type="button" class="btn btn-chico menu-salir" id="cerrar-sesion">Cerrar sesión</button>`;
    bloqueUsuario.querySelector('#cerrar-sesion').addEventListener('click', cerrarSesion);
  } else if (activo !== 'login') {
    bloqueUsuario.innerHTML = '<a class="btn btn-chico menu-salir" href="/login.html">Iniciar sesión</a>';
  }
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
  if (resp.status === 401 && !location.pathname.endsWith('/login.html')) {
    // La sesión venció o no existe: volver al login y regresar aquí después
    location.href = `/login.html?volver=${encodeURIComponent(location.pathname + location.search)}`;
  }
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
