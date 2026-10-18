// Servidor principal del Sistema de Citas.
// Cada integrante agrega aquí la línea app.use(...) de su módulo.
const path = require('path');
const express = require('express');
require('dotenv').config();
const auth = require('./src/auth/auth.middleware'); // Integrante 5: login y roles

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Sesión y páginas ----
// Lee la cookie de sesión (req.usuario) y protege las páginas HTML por rol.
// /citas/ y /login.html son públicas; ver src/auth/auth.middleware.js.
app.use(auth.cargarSesion);
app.use(auth.protegerPaginas);
app.use(express.static(path.join(__dirname, 'public')));

// ---- Rutas de cada módulo ----
// Solo la recepcionista (admin) administra pacientes y médicos. GET /api/pacientes
// sigue siendo público porque la página de solicitud de citas lo usa para elegir paciente.
const soloAdmin = auth.requiereRol(['admin']);
app.use('/api/auth', require('./src/auth/auth.routes')); // Integrante 5
app.use('/api/pacientes', auth.requiereRol(['admin'], { publico: [{ metodo: 'GET', ruta: '/' }] }),
  require('./src/pacientes/pacientes.routes')); // Integrante 2
app.use('/api/medicos', soloAdmin, require('./src/medicos/medicos.routes')); // Integrante 1
app.use('/api/citas', require('./src/citas/citas.routes')); // Integrante 3 (pública)
app.use('/api/recepcion', soloAdmin, require('./src/recepcion/recepcion.routes')); // Integrante 4
// app.use('/api/agenda', auth.requiereRol(['admin', 'doctor']), require('./src/agenda/agenda.routes')); // Integrante 5

app.get('/', (req, res) => res.redirect(auth.inicioDe(req.usuario)));

// Manejador de errores: registra el detalle y responde un mensaje genérico
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error en el servidor.' });
});

const PUERTO = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PUERTO, () => console.log(`Servidor en http://localhost:${PUERTO}`));
}

module.exports = app;
