// Validación de la consulta de agenda (?fecha=AAAA-MM-DD&medico_id=).
const ID_RE = /^[1-9]\d*$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function idPositivo(valor) {
  const texto = String(valor ?? '').trim();
  if (!ID_RE.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) ? id : null;
}

function fechaValida(fecha) {
  if (!FECHA_RE.test(fecha)) return false;
  const fechaUTC = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(fechaUTC.valueOf()) && fechaUTC.toISOString().slice(0, 10) === fecha;
}

// 'AAAA-MM-DD' de una fecha en hora local del servidor
function fechaLocal(ahora) {
  return [
    ahora.getFullYear(),
    String(ahora.getMonth() + 1).padStart(2, '0'),
    String(ahora.getDate()).padStart(2, '0'),
  ].join('-');
}

// Sin fecha se usa la de hoy. medico_id es opcional: solo lo manda el admin
// (el doctor siempre ve su propia agenda).
function validarConsulta(consulta = {}, ahora = new Date()) {
  const errores = [];
  const fechaEntrada = String(consulta.fecha ?? '').trim();
  const fecha = fechaEntrada || fechaLocal(ahora);
  if (!fechaValida(fecha)) errores.push('La fecha debe ser válida y tener formato AAAA-MM-DD.');

  let medicoId = null;
  if (consulta.medico_id !== undefined && String(consulta.medico_id).trim() !== '') {
    medicoId = idPositivo(consulta.medico_id);
    if (!medicoId) errores.push('Selecciona un médico válido.');
  }

  return { errores, datos: { fecha, medicoId } };
}

module.exports = { idPositivo, fechaLocal, validarConsulta };
