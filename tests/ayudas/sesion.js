// Ayuda para las pruebas de las APIs protegidas por login (Integrante 5).
// Llamar simularSesion() ANTES de require('../server'): reemplaza la lectura de
// la cookie por un usuario fijo, así las pruebas de cada módulo no necesitan
// iniciar sesión. Las reglas de roles (requiereRol, protegerPaginas) siguen
// siendo las reales. Las pruebas del propio login (tests/auth.test.js) no la usan.
const path = require('node:path');

const ADMIN = { id: 1, usuario: 'recepcion', nombre: 'Recepción', rol: 'admin', medico_id: null, medico: null };
const DOCTOR = { id: 2, usuario: 'dra.ruiz', nombre: 'Dra. Ana Ruiz', rol: 'doctor', medico_id: 1, medico: 'Dra. Ana Ruiz' };

function simularSesion(usuario = ADMIN) {
  const ruta = path.join(__dirname, '../../src/auth/auth.middleware.js');
  delete require.cache[ruta];
  const real = require(ruta);
  require.cache[ruta].exports = {
    ...real,
    cargarSesion: (req, res, next) => { req.usuario = usuario; next(); },
  };
}

module.exports = { simularSesion, ADMIN, DOCTOR };
