// Ayuda para las pruebas de las APIs protegidas por login (Integrante 5).
// Llamar simularSesion() ANTES de require('../server'): reemplaza la lectura de
// la cookie por un usuario fijo, así las pruebas de cada módulo no necesitan
// iniciar sesión. Las reglas de roles (requiereRol, protegerPaginas) siguen
// siendo las reales. Llamarla otra vez (con otro usuario o null) cambia quién
// está conectado en las siguientes peticiones. Las pruebas del propio login
// (tests/auth.test.js) no la usan.
const path = require('node:path');

const ADMIN = { id: 1, usuario: 'recepcion', nombre: 'Recepción', rol: 'admin', medico_id: null, medico: null };
const DOCTOR = { id: 2, usuario: 'dra.ruiz', nombre: 'Dra. Ana Ruiz', rol: 'doctor', medico_id: 1, medico: 'Dra. Ana Ruiz' };

let usuarioActual = ADMIN;
let instalada = false;

function simularSesion(usuario = ADMIN) {
  usuarioActual = usuario;
  if (instalada) return;
  const ruta = path.join(__dirname, '../../src/auth/auth.middleware.js');
  delete require.cache[ruta];
  const real = require(ruta);
  require.cache[ruta].exports = {
    ...real,
    cargarSesion: (req, res, next) => { req.usuario = usuarioActual; next(); },
  };
  instalada = true;
}

module.exports = { simularSesion, ADMIN, DOCTOR };
