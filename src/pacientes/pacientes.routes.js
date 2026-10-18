// Rutas de la API de pacientes. Se montan en /api/pacientes (ver server.js).
//   GET    /api/pacientes?q=texto        lista / busca pacientes
//   GET    /api/pacientes/:id            un paciente
//   POST   /api/pacientes                registra un paciente
//   PUT    /api/pacientes/:id            edita un paciente
//   GET    /api/pacientes/:id/historial  citas del paciente (?estado=&desde=&hasta=)
const express = require('express');
const modelo = require('./pacientes.model');
const { validarPaciente } = require('./pacientes.validacion');

const router = express.Router();

// Envuelve rutas async para que los errores lleguen al manejador de errores
const asincrono = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function idValido(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'El id del paciente no es válido.' });
    return null;
  }
  return id;
}

function errorDuplicado(err, res) {
  if (err.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ errores: ['Ya existe un paciente registrado con ese correo.'] });
    return true;
  }
  return false;
}

router.get('/', asincrono(async (req, res) => {
  const busqueda = String(req.query.q ?? '').trim();
  res.json(await modelo.listar(busqueda));
}));

router.get('/:id', asincrono(async (req, res) => {
  const id = idValido(req, res);
  if (!id) return;
  const paciente = await modelo.obtener(id);
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado.' });
  res.json(paciente);
}));

router.post('/', asincrono(async (req, res) => {
  const { datos, errores } = validarPaciente(req.body);
  if (errores.length) return res.status(400).json({ errores });
  try {
    res.status(201).json(await modelo.crear(datos));
  } catch (err) {
    if (!errorDuplicado(err, res)) throw err;
  }
}));

router.put('/:id', asincrono(async (req, res) => {
  const id = idValido(req, res);
  if (!id) return;
  const { datos, errores } = validarPaciente(req.body);
  if (errores.length) return res.status(400).json({ errores });
  try {
    const paciente = await modelo.actualizar(id, datos);
    if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado.' });
    res.json(paciente);
  } catch (err) {
    if (!errorDuplicado(err, res)) throw err;
  }
}));

router.get('/:id/historial', asincrono(async (req, res) => {
  const id = idValido(req, res);
  if (!id) return;
  const paciente = await modelo.obtener(id);
  if (!paciente) return res.status(404).json({ error: 'Paciente no encontrado.' });
  const { estado, desde, hasta } = req.query;
  const citas = await modelo.historial(id, { estado, desde, hasta });
  res.json({ paciente, citas });
}));

module.exports = router;
