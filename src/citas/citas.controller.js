const { crearServicio, ErrorCitas } = require('./citas.service');

const servicio = crearServicio();

async function responder(res, accion, estado = 200) {
  try {
    const resultado = await accion();
    res.status(estado).json(resultado);
  } catch (error) {
    if (error instanceof ErrorCitas) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}

async function listarMedicos(req, res) {
  await responder(res, () => servicio.listarMedicos());
}

async function listarHorarios(req, res) {
  const { medicoId, fecha } = req.datosConsulta;
  await responder(res, () => servicio.listarHorarios(medicoId, fecha));
}

async function crearSolicitud(req, res) {
  await responder(res, () => servicio.crearSolicitud(req.datosSolicitud), 201);
}

async function obtenerSolicitud(req, res) {
  await responder(res, async () => {
    const cita = await servicio.obtenerSolicitud(req.params.id);
    if (!cita) throw new ErrorCitas(404, 'Solicitud de cita no encontrada.');
    return cita;
  });
}

module.exports = { listarMedicos, listarHorarios, crearSolicitud, obtenerSolicitud };
