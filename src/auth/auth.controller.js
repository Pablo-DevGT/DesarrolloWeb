const { crearServicio, ErrorAuth } = require('./auth.service');
const { iniciarSesion: ponerCookie, cerrarSesion: quitarCookie } = require('./auth.middleware');

const servicio = crearServicio();

async function responder(res, accion, estado = 200) {
  try {
    const resultado = await accion();
    if (estado === 204) return res.status(204).end();
    return res.status(estado).json(resultado);
  } catch (error) {
    if (error instanceof ErrorAuth) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}

const login = (req, res) => responder(res, async () => {
  const usuario = await servicio.iniciarSesion(req.datos);
  ponerCookie(res, usuario);
  return { usuario };
});

const logout = (req, res) => {
  quitarCookie(res);
  res.status(204).end();
};

const sesion = (req, res) => res.json({ usuario: req.usuario || null });

const listarUsuarios = (req, res) => responder(res, () => servicio.listar());
const crearUsuario = (req, res) => responder(res, () => servicio.crear(req.datos), 201);
const cambiarContrasena = (req, res) => responder(res, () => servicio.cambiarContrasena(req.usuario.id, req.datos), 204);

module.exports = { login, logout, sesion, listarUsuarios, crearUsuario, cambiarContrasena };
