// Servidor principal del Sistema de Citas.
// Cada integrante agrega aquí la línea app.use(...) de su módulo.
const path = require('path');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Rutas de cada módulo ----
app.use('/api/pacientes', require('./src/pacientes/pacientes.routes')); // Integrante 2
// app.use('/api/medicos',   require('./src/medicos/medicos.routes'));   // Integrante 1
// app.use('/api/citas',     require('./src/citas/citas.routes'));       // Integrante 3
// app.use('/api/recepcion', require('./src/recepcion/recepcion.routes'));// Integrante 4
// app.use('/api/agenda',    require('./src/agenda/agenda.routes'));     // Integrante 5

app.get('/', (req, res) => res.redirect('/pacientes/'));

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
