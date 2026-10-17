const express = require('express');
const controlador = require('./citas.controller');
const { validarConsultaHorarios, validarSolicitud } = require('./citas.validacion');

const router = express.Router();

const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/medicos', asincrono(controlador.listarMedicos));

router.get('/horarios', asincrono((req, res, next) => {
  const { errores, datos } = validarConsultaHorarios(req.query.medico_id, req.query.fecha);
  if (errores.length) return res.status(400).json({ errores });
  req.datosConsulta = datos;
  return controlador.listarHorarios(req, res, next);
}));

router.post('/', asincrono((req, res, next) => {
  const { errores, datos } = validarSolicitud(req.body);
  if (errores.length) return res.status(400).json({ errores });
  req.datosSolicitud = datos;
  return controlador.crearSolicitud(req, res, next);
}));

router.get('/:id', asincrono((req, res, next) => {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(400).json({ error: 'El id de la cita no es válido.' });
  }
  req.params.id = Number(req.params.id);
  return controlador.obtenerSolicitud(req, res, next);
}));

module.exports = router;
