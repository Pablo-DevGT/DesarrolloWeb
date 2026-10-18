// Rutas de la API de médicos. Se montan en /api/medicos (ver server.js).
//   GET    /api/medicos?q=&especialidad=&activo=1|0     lista / busca / filtra
//   GET    /api/medicos/especialidades                   especialidades registradas
//   GET    /api/medicos/:id                              médico con sus horarios
//   GET    /api/medicos/:id/citas-futuras                citas futuras activas (antes de desactivar)
//   GET    /api/medicos/:id/citas-por-revisar            citas activas fuera de horario o de médico inactivo
//   POST   /api/medicos                                  registra un médico
//   PUT    /api/medicos/:id                              edita un médico
//   PATCH  /api/medicos/:id/estado                       { activo, confirmar?, citas_confirmadas? }
//   GET    /api/medicos/:id/horarios                     horarios del médico
//   POST   /api/medicos/:id/horarios                     agrega un horario
//   PUT    /api/medicos/:id/horarios/:horarioId          edita un horario { ..., confirmar?, citas_confirmadas? }
//   PATCH  /api/medicos/:id/horarios/:horarioId/estado   { activo, confirmar?, citas_confirmadas? }
// No hay DELETE: médicos y horarios se desactivan.
const express = require('express');
const controlador = require('./medicos.controller');
const {
  idPositivo, validarMedico, validarHorario, validarEstado, validarConfirmacion, validarFiltros,
} = require('./medicos.validacion');

const router = express.Router();

const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Valida :id y :horarioId antes de llegar a las rutas
router.param('id', (req, res, next, valor) => {
  req.medicoId = idPositivo(valor);
  if (!req.medicoId) return res.status(400).json({ error: 'El id del médico no es válido.' });
  next();
});
router.param('horarioId', (req, res, next, valor) => {
  req.horarioId = idPositivo(valor);
  if (!req.horarioId) return res.status(400).json({ error: 'El id del horario no es válido.' });
  next();
});

// Ejecuta un validador sobre el cuerpo y deja los datos limpios en req.datos
const conValidacion = (validar, accion) => asincrono((req, res, next) => {
  const { errores, datos } = validar(req.body || {});
  if (errores.length) return res.status(400).json({ errores });
  req.datos = datos;
  req.confirmacion = validarConfirmacion(req.body || {});
  return accion(req, res, next);
});

router.get('/', asincrono((req, res, next) => {
  req.filtros = validarFiltros(req.query);
  return controlador.listar(req, res, next);
}));
router.get('/especialidades', asincrono(controlador.especialidades));
router.get('/:id', asincrono(controlador.obtener));
router.get('/:id/citas-futuras', asincrono(controlador.citasFuturas));
router.get('/:id/citas-por-revisar', asincrono(controlador.citasPorRevisar));
router.post('/', conValidacion(validarMedico, controlador.crear));
router.put('/:id', conValidacion(validarMedico, controlador.actualizar));
router.patch('/:id/estado', conValidacion(validarEstado, controlador.cambiarEstado));

router.get('/:id/horarios', asincrono(controlador.listarHorarios));
router.post('/:id/horarios', conValidacion(validarHorario, controlador.crearHorario));
router.put('/:id/horarios/:horarioId', conValidacion(validarHorario, controlador.actualizarHorario));
router.patch('/:id/horarios/:horarioId/estado', conValidacion(validarEstado, controlador.cambiarEstadoHorario));

module.exports = router;
