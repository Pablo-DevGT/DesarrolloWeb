// Rutas de login y usuarios. Se montan en /api/auth (ver server.js).
//   POST   /api/auth/login        { usuario, contrasena }  -> { usuario } y cookie de sesión
//   POST   /api/auth/logout       borra la cookie (204)
//   GET    /api/auth/sesion       { usuario } del conectado, o { usuario: null }
//   POST   /api/auth/contrasena   { actual, nueva }  cambia la contraseña propia (204)
//   GET    /api/auth/usuarios     lista de usuarios (solo admin)
//   POST   /api/auth/usuarios     { usuario, nombre, contrasena, rol, medico_id? } (solo admin)
const express = require('express');
const controlador = require('./auth.controller');
const { requiereRol } = require('./auth.middleware');
const { validarLogin, validarUsuarioNuevo, validarCambioContrasena } = require('./auth.validacion');

const router = express.Router();

const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Ejecuta un validador sobre el cuerpo y deja los datos limpios en req.datos
const conValidacion = (validar, accion) => asincrono((req, res, next) => {
  const { errores, datos } = validar(req.body || {});
  if (errores.length) return res.status(400).json({ errores });
  req.datos = datos;
  return accion(req, res, next);
});

router.post('/login', conValidacion(validarLogin, controlador.login));
router.post('/logout', controlador.logout);
router.get('/sesion', controlador.sesion);
router.post('/contrasena', requiereRol(['admin', 'doctor']), conValidacion(validarCambioContrasena, controlador.cambiarContrasena));
router.get('/usuarios', requiereRol(['admin']), asincrono(controlador.listarUsuarios));
router.post('/usuarios', requiereRol(['admin']), conValidacion(validarUsuarioNuevo, controlador.crearUsuario));

module.exports = router;
