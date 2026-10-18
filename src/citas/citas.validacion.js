const ID_RE = /^[1-9]\d*$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function idPositivo(valor) {
  const texto = String(valor ?? '');
  if (!ID_RE.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) ? id : null;
}

function fechaValida(fecha) {
  if (!FECHA_RE.test(fecha)) return false;
  const fechaUTC = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(fechaUTC.valueOf()) && fechaUTC.toISOString().slice(0, 10) === fecha;
}

function fechaHoraFutura(fecha, hora, ahora = new Date()) {
  const fechaActual = [
    ahora.getFullYear(),
    String(ahora.getMonth() + 1).padStart(2, '0'),
    String(ahora.getDate()).padStart(2, '0'),
  ].join('-');
  const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  return fecha > fechaActual || (fecha === fechaActual && hora > horaActual);
}

function validarSolicitud(entrada = {}) {
  const errores = [];
  const pacienteId = idPositivo(entrada.paciente_id);
  const medicoId = idPositivo(entrada.medico_id);
  const fecha = String(entrada.fecha ?? '').trim();
  const hora = String(entrada.hora ?? '').trim();
  const motivo = String(entrada.motivo ?? '').trim();

  if (!pacienteId) errores.push('Selecciona un paciente válido.');
  if (!medicoId) errores.push('Selecciona un médico válido.');
  if (!fechaValida(fecha)) errores.push('La fecha debe ser válida y tener formato AAAA-MM-DD.');
  if (!HORA_RE.test(hora)) errores.push('La hora debe ser válida y tener formato HH:MM.');
  if (motivo.length < 3) errores.push('El motivo debe tener al menos 3 caracteres.');
  if (motivo.length > 255) errores.push('El motivo no puede superar los 255 caracteres.');

  return {
    errores,
    datos: { paciente_id: pacienteId, medico_id: medicoId, fecha, hora, motivo },
  };
}

function validarConsultaHorarios(medicoIdEntrada, fechaEntrada) {
  const medicoId = idPositivo(medicoIdEntrada);
  const fecha = String(fechaEntrada ?? '').trim();
  const errores = [];

  if (!medicoId) errores.push('Selecciona un médico válido.');
  if (!fechaValida(fecha)) errores.push('La fecha debe ser válida y tener formato AAAA-MM-DD.');

  return { errores, datos: { medicoId, fecha } };
}

module.exports = {
  fechaHoraFutura,
  validarConsultaHorarios,
  validarSolicitud,
};
