// Usuarios del sistema: inicio de sesión, alta de usuarios y cambio de contraseña.
// Todas las consultas usan parámetros (?) para evitar inyección SQL.
const pool = require('../comun/db');
const contrasenas = require('./contrasenas');

const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos.';

// Columnas que se devuelven al cliente (nunca el hash)
const COLUMNAS_PUBLICAS = `u.id, u.usuario, u.nombre, u.rol, u.medico_id, u.activo, m.nombre AS medico`;

class ErrorAuth extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErrorAuth';
    this.status = status;
  }
}

function traducirError(error) {
  if (error instanceof ErrorAuth) return error;
  const mensaje = String(error.message || '');
  if (error.code === 'ER_DUP_ENTRY') {
    if (mensaje.includes('uq_usuario_medico')) return new ErrorAuth(409, 'Ese médico ya tiene un usuario.');
    return new ErrorAuth(409, 'Ya existe un usuario con ese nombre de usuario.');
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') return new ErrorAuth(404, 'Médico no encontrado.');
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.code === 'ER_DATA_TOO_LONG') {
    return new ErrorAuth(400, 'Los datos no cumplen las reglas de la base de datos. Revisa los campos.');
  }
  return error;
}

// Datos del usuario que viajan en la sesión y se devuelven al cliente
function perfil(fila) {
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    medico_id: fila.medico_id ?? null,
    medico: fila.medico ?? null,
  };
}

function crearServicio({ db = pool } = {}) {
  async function buscarPorUsuario(usuario) {
    const [filas] = await db.query(
      `SELECT ${COLUMNAS_PUBLICAS}, u.contrasena_hash
         FROM usuarios u
         LEFT JOIN medicos m ON m.id = u.medico_id
        WHERE u.usuario = ?`,
      [usuario]
    );
    return filas[0] || null;
  }

  async function buscarPorId(id) {
    const [filas] = await db.query(
      `SELECT ${COLUMNAS_PUBLICAS}, u.contrasena_hash
         FROM usuarios u
         LEFT JOIN medicos m ON m.id = u.medico_id
        WHERE u.id = ?`,
      [id]
    );
    return filas[0] || null;
  }

  // Devuelve el perfil si usuario y contraseña son correctos y el usuario está activo.
  // Un usuario inexistente, inactivo o con contraseña incorrecta recibe el mismo
  // mensaje, para no revelar qué usuarios existen.
  async function iniciarSesion({ usuario, contrasena }) {
    const fila = await buscarPorUsuario(usuario);
    const valida = fila ? await contrasenas.verificar(contrasena, fila.contrasena_hash) : false;
    if (!fila || !valida || !Number(fila.activo)) throw new ErrorAuth(401, MENSAJE_CREDENCIALES);
    return perfil(fila);
  }

  async function listar() {
    const [filas] = await db.query(
      `SELECT ${COLUMNAS_PUBLICAS}
         FROM usuarios u
         LEFT JOIN medicos m ON m.id = u.medico_id
        ORDER BY u.rol, u.nombre`
    );
    return filas.map((fila) => ({ ...perfil(fila), activo: Number(fila.activo) }));
  }

  async function crear(datos) {
    try {
      if (datos.rol === 'doctor') {
        const [medicos] = await db.query('SELECT id, nombre FROM medicos WHERE id = ?', [datos.medico_id]);
        if (!medicos.length) throw new ErrorAuth(404, 'Médico no encontrado.');
      }
      const hash = await contrasenas.hashear(datos.contrasena);
      const [resultado] = await db.query(
        'INSERT INTO usuarios (usuario, nombre, contrasena_hash, rol, medico_id) VALUES (?, ?, ?, ?, ?)',
        [datos.usuario, datos.nombre, hash, datos.rol, datos.medico_id]
      );
      const creado = await buscarPorId(resultado.insertId);
      return { ...perfil(creado), activo: Number(creado.activo) };
    } catch (error) {
      throw traducirError(error);
    }
  }

  async function cambiarContrasena(id, { actual, nueva }) {
    const fila = await buscarPorId(id);
    const valida = fila ? await contrasenas.verificar(actual, fila.contrasena_hash) : false;
    if (!fila || !valida) throw new ErrorAuth(401, 'La contraseña actual no es correcta.');
    const hash = await contrasenas.hashear(nueva);
    await db.query('UPDATE usuarios SET contrasena_hash = ? WHERE id = ?', [hash, id]);
  }

  return { iniciarSesion, listar, crear, cambiarContrasena };
}

module.exports = { crearServicio, ErrorAuth, perfil };
