const { crearServicio, ErrorMedicos } = require('./medicos.service');

const servicio = crearServicio();

async function responder(res, accion, estado = 200) {
  try {
    const resultado = await accion();
    res.status(estado).json(resultado);
  } catch (error) {
    if (error instanceof ErrorMedicos) {
      return res.status(error.status).json({ error: error.message, ...(error.detalle || {}) });
    }
    throw error;
  }
}

const listar = (req, res) => responder(res, () => servicio.listar(req.filtros));
const especialidades = (req, res) => responder(res, () => servicio.especialidades());

const obtener = (req, res) => responder(res, async () => {
  const medico = await servicio.obtener(req.medicoId);
  if (!medico) throw new ErrorMedicos(404, 'Médico no encontrado.');
  return medico;
});

const crear = (req, res) => responder(res, () => servicio.crear(req.datos), 201);

const actualizar = (req, res) => responder(res, async () => {
  const medico = await servicio.actualizar(req.medicoId, req.datos);
  if (!medico) throw new ErrorMedicos(404, 'Médico no encontrado.');
  return medico;
});

const citasFuturas = (req, res) => responder(res, () => servicio.citasFuturas(req.medicoId));
const citasPorRevisar = (req, res) => responder(res, () => servicio.citasPorRevisar(req.medicoId));
const cambiarEstado = (req, res) => responder(res, () => servicio.cambiarEstado(req.medicoId, req.datos));
const listarHorarios = (req, res) => responder(res, () => servicio.listarHorarios(req.medicoId));
const crearHorario = (req, res) => responder(res, () => servicio.crearHorario(req.medicoId, req.datos), 201);

const actualizarHorario = (req, res) => responder(res, () =>
  servicio.actualizarHorario(req.medicoId, req.horarioId, req.datos, req.confirmacion));

const cambiarEstadoHorario = (req, res) => responder(res, () =>
  servicio.cambiarEstadoHorario(req.medicoId, req.horarioId, req.datos));

module.exports = {
  listar, especialidades, obtener, crear, actualizar, citasFuturas, citasPorRevisar, cambiarEstado,
  listarHorarios, crearHorario, actualizarHorario, cambiarEstadoHorario,
};
