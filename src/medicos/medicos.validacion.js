// Validación del módulo de médicos. Las reglas de médicos y horarios viven en
// public/medicos/reglas.js para que el navegador use exactamente las mismas.
const reglas = require('../../public/medicos/reglas');

const ID_RE = /^[1-9]\d*$/;

function idPositivo(valor) {
  const texto = String(valor ?? '');
  if (!ID_RE.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) ? id : null;
}

// Acepta true/false, 1/0 y '1'/'0'. Devuelve null si no es un valor válido
function booleano(valor) {
  if (valor === true || valor === 1 || valor === '1' || valor === 'true') return true;
  if (valor === false || valor === 0 || valor === '0' || valor === 'false') return false;
  return null;
}

// Ids de las citas que el usuario vio al confirmar. null si no se enviaron;
// los valores inválidos se descartan (si falta alguna cita se vuelve a pedir confirmación).
function citasConfirmadas(valor) {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) return [];
  return valor.map(idPositivo).filter(Boolean);
}

// Confirmación de cambios que afectan citas: { confirmar, citas_confirmadas }
function validarConfirmacion(entrada = {}) {
  return {
    confirmar: booleano(entrada.confirmar) === true,
    citasConfirmadas: citasConfirmadas(entrada.citas_confirmadas),
  };
}

function validarEstado(entrada = {}) {
  const activo = booleano(entrada.activo);
  const errores = activo === null ? ['Indica si el registro debe quedar activo (true) o inactivo (false).'] : [];
  return { errores, datos: { activo, ...validarConfirmacion(entrada) } };
}

// Filtros del listado: ?q=&especialidad=&activo=1|0
function validarFiltros(consulta = {}) {
  const activoTexto = String(consulta.activo ?? '').trim();
  return {
    q: String(consulta.q ?? '').trim().slice(0, 120),
    especialidad: String(consulta.especialidad ?? '').trim().slice(0, 80),
    activo: activoTexto === '' ? null : booleano(activoTexto),
  };
}

module.exports = {
  idPositivo,
  booleano,
  validarMedico: reglas.validarMedico,
  validarHorario: reglas.validarHorario,
  validarEstado,
  validarConfirmacion,
  validarFiltros,
};
