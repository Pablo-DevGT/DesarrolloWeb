// Rutas de la agenda del doctor. Se montan en /api/agenda (ver server.js) y
// exigen sesión de doctor o admin (src/auth/auth.middleware.js).
//   GET    /api/agenda?fecha=AAAA-MM-DD&medico_id=   citas del día (medico_id solo lo usa el admin)
//   PATCH  /api/agenda/citas/:id/atender             marca la cita como atendida
const express = require('express');
const controlador = require('./agenda.controller');
const { idPositivo, validarConsulta } = require('./agenda.validacion');

const router = express.Router();

const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.param('id', (req, res, next, valor) => {
  req.citaId = idPositivo(valor);
  if (!req.citaId) return res.status(400).json({ error: 'El id de la cita no es válido.' });
  next();
});

router.get('/', asincrono((req, res, next) => {
  const { errores, datos } = validarConsulta(req.query, new Date());
  if (errores.length) return res.status(400).json({ errores });
  req.datos = datos;
  return controlador.obtenerAgenda(req, res, next);
}));

router.patch('/citas/:id/atender', asincrono(controlador.marcarAtendida));

module.exports = router;
