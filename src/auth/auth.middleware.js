// Sesión y permisos por rol. server.js lo usa así:
//   app.use(cargarSesion)        lee la cookie y deja el usuario en req.usuario (o null)
//   app.use(protegerPaginas)     páginas HTML: sin sesión -> /login.html; rol sin permiso -> su inicio
//   app.use('/api/x', requiereRol(['admin']), rutas)   APIs: 401 sin sesión, 403 sin permiso
//
// Roles: 'admin' (recepcionista, ve todo) y 'doctor' (solo su agenda).
// La página de solicitud de citas (/citas/) y las APIs que usa son públicas:
// los pacientes solicitan su cita sin cuenta.
const crypto = require('node:crypto');
const sesion = require('./sesion');

const MENSAJE_SIN_SESION = 'Debes iniciar sesión.';
const MENSAJE_SIN_PERMISO = 'No tienes permiso para esta operación.';

// Página de inicio de cada rol
const INICIO = { admin: '/pacientes/', doctor: '/agenda/' };

// Páginas que requieren sesión y qué roles pueden verlas. Todo lo demás
// (/, /login.html, /comun/, /citas/) es público.
const PAGINAS = [
  { prefijo: '/pacientes/', roles: ['admin'] },
  { prefijo: '/medicos/', roles: ['admin'] },
  { prefijo: '/recepcion/', roles: ['admin'] },
  { prefijo: '/agenda/', roles: ['admin', 'doctor'] },
];

let secreto = process.env.SESSION_SECRET;
if (!secreto) {
  secreto = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('SESSION_SECRET no está definido en .env: las sesiones se cerrarán al reiniciar el servidor.');
  }
}

function cookieSegura() {
  if (process.env.COOKIE_SEGURA !== undefined) return process.env.COOKIE_SEGURA === '1';
  return process.env.NODE_ENV === 'production';
}

function atributosCookie(maxAge) {
  const partes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (cookieSegura()) partes.push('Secure');
  return partes.join('; ');
}

function iniciarSesion(res, usuario) {
  const token = sesion.crearToken(usuario, { secreto });
  res.setHeader('Set-Cookie', `${sesion.NOMBRE_COOKIE}=${token}; ${atributosCookie(sesion.DURACION_SEGUNDOS)}`);
}

function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${sesion.NOMBRE_COOKIE}=; ${atributosCookie(0)}`);
}

function cargarSesion(req, res, next) {
  const cookies = sesion.leerCookies(req.headers.cookie);
  req.usuario = sesion.leerToken(cookies[sesion.NOMBRE_COOKIE], { secreto });
  next();
}

const inicioDe = (usuario) => (usuario ? INICIO[usuario.rol] || '/login.html' : '/login.html');

function protegerPaginas(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const pagina = PAGINAS.find((p) => req.path.startsWith(p.prefijo));
  if (!pagina) return next();
  if (!req.usuario) return res.redirect(`/login.html?volver=${encodeURIComponent(req.originalUrl)}`);
  if (!pagina.roles.includes(req.usuario.rol)) return res.redirect(inicioDe(req.usuario));
  return next();
}

// Middleware para APIs. `publico` lista excepciones [{ metodo, ruta }] relativas
// al punto de montaje (p. ej. GET / de /api/pacientes, que usa Solicitud de Citas).
function requiereRol(roles, { publico = [] } = {}) {
  return (req, res, next) => {
    if (publico.some((p) => p.metodo === req.method && p.ruta === req.path)) return next();
    if (!req.usuario) return res.status(401).json({ error: MENSAJE_SIN_SESION });
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: MENSAJE_SIN_PERMISO });
    return next();
  };
}

module.exports = {
  cargarSesion, protegerPaginas, requiereRol, iniciarSesion, cerrarSesion, inicioDe, PAGINAS, INICIO,
};
