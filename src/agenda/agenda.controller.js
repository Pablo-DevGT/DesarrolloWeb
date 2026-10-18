const { crearServicio, ErrorAgenda } = require('./agenda.service');

const servicio = crearServicio();

async function responder(res, accion, estado = 200) {
  try {
    const resultado = await accion();
    res.status(estado).json(resultado);
  } catch (error) {
    if (error instanceof ErrorAgenda) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}

// El doctor solo ve su agenda (medico_id de su usuario); el admin elige el médico.
function medicoDe(req) {
  return req.usuario.rol === 'doctor' ? req.usuario.medico_id : req.datos.medicoId;
}

async function obtenerAgenda(req, res) {
  const medicoId = medicoDe(req);
  if (!medicoId) return res.status(400).json({ errores: ['Selecciona un médico.'] });
  return responder(res, () => servicio.obtenerAgenda({ medicoId, fecha: req.datos.fecha }));
}

async function marcarAtendida(req, res) {
  const medicoId = req.usuario.rol === 'doctor' ? req.usuario.medico_id : null;
  return responder(res, () => servicio.marcarAtendida({ citaId: req.citaId, medicoId }));
}

module.exports = { obtenerAgenda, marcarAtendida };
