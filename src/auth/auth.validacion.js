// Reglas de validación de login y usuarios. Los límites coinciden con las
// columnas de database/05_usuarios.sql.
const ROLES = ['admin', 'doctor'];
const USUARIO_RE = /^[a-z0-9][a-z0-9._-]{2,59}$/;
const CONTRASENA_MIN = 8;
const CONTRASENA_MAX = 72;

function idPositivo(valor) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9]\d*$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizarUsuario(valor) {
  return String(valor ?? '').trim().toLowerCase();
}

function validarContrasena(valor, errores, etiqueta = 'La contraseña') {
  const contrasena = String(valor ?? '');
  if (contrasena.length < CONTRASENA_MIN) errores.push(`${etiqueta} debe tener al menos ${CONTRASENA_MIN} caracteres.`);
  else if (contrasena.length > CONTRASENA_MAX) errores.push(`${etiqueta} no puede superar los ${CONTRASENA_MAX} caracteres.`);
  return contrasena;
}

function validarLogin(entrada = {}) {
  const errores = [];
  const usuario = normalizarUsuario(entrada.usuario);
  const contrasena = String(entrada.contrasena ?? '');
  if (!usuario) errores.push('Escribe tu nombre de usuario.');
  if (!contrasena) errores.push('Escribe tu contraseña.');
  return { errores, datos: { usuario, contrasena } };
}

function validarUsuarioNuevo(entrada = {}) {
  const errores = [];
  const usuario = normalizarUsuario(entrada.usuario);
  const nombre = String(entrada.nombre ?? '').trim();
  const rol = String(entrada.rol ?? '').trim();
  const medicoEntrada = entrada.medico_id;
  const tieneMedico = medicoEntrada !== undefined && medicoEntrada !== null && String(medicoEntrada).trim() !== '';

  if (!USUARIO_RE.test(usuario)) {
    errores.push('El usuario debe tener de 3 a 60 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
  }
  if (nombre.length < 3 || nombre.length > 120) errores.push('El nombre debe tener de 3 a 120 caracteres.');
  const contrasena = validarContrasena(entrada.contrasena, errores);
  if (!ROLES.includes(rol)) errores.push('El rol debe ser admin o doctor.');

  let medicoId = null;
  if (rol === 'doctor') {
    medicoId = idPositivo(medicoEntrada);
    if (!medicoId) errores.push('Un usuario doctor debe estar ligado a un médico registrado.');
  } else if (rol === 'admin' && tieneMedico) {
    errores.push('Un usuario admin no se liga a un médico.');
  }

  return { errores, datos: { usuario, nombre, contrasena, rol, medico_id: medicoId } };
}

function validarCambioContrasena(entrada = {}) {
  const errores = [];
  const actual = String(entrada.actual ?? '');
  if (!actual) errores.push('Escribe tu contraseña actual.');
  const nueva = validarContrasena(entrada.nueva, errores, 'La contraseña nueva');
  return { errores, datos: { actual, nueva } };
}

module.exports = { ROLES, idPositivo, validarLogin, validarUsuarioNuevo, validarCambioContrasena };
