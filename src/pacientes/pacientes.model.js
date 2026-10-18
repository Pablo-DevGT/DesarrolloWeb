// Acceso a datos de pacientes e historial de citas.
// Todas las consultas usan parámetros (?) para evitar inyección SQL.
const pool = require('../comun/db');

const COLUMNAS = 'id, nombre, edad, telefono, email, alergias, creado_en';
const ESTADOS = ['pendiente', 'confirmada', 'reagendada', 'cancelada', 'atendida'];

async function listar(busqueda = '') {
  if (busqueda) {
    const filtro = `%${busqueda}%`;
    const [filas] = await pool.query(
      `SELECT ${COLUMNAS} FROM pacientes
       WHERE nombre LIKE ? OR telefono LIKE ? OR email LIKE ?
       ORDER BY nombre`,
      [filtro, filtro, filtro]
    );
    return filas;
  }
  const [filas] = await pool.query(`SELECT ${COLUMNAS} FROM pacientes ORDER BY nombre`);
  return filas;
}

async function obtener(id) {
  const [filas] = await pool.query(`SELECT ${COLUMNAS} FROM pacientes WHERE id = ?`, [id]);
  return filas[0] || null;
}

async function crear({ nombre, edad, telefono, email, alergias }) {
  const [res] = await pool.query(
    'INSERT INTO pacientes (nombre, edad, telefono, email, alergias) VALUES (?, ?, ?, ?, ?)',
    [nombre, edad, telefono, email, alergias]
  );
  return obtener(res.insertId);
}

async function actualizar(id, { nombre, edad, telefono, email, alergias }) {
  const [res] = await pool.query(
    'UPDATE pacientes SET nombre = ?, edad = ?, telefono = ?, email = ?, alergias = ? WHERE id = ?',
    [nombre, edad, telefono, email, alergias, id]
  );
  return res.affectedRows ? obtener(id) : null;
}

// Historial de citas de un paciente, con filtros opcionales:
//   estado: uno de ESTADOS · desde / hasta: 'AAAA-MM-DD'
async function historial(pacienteId, { estado, desde, hasta } = {}) {
  const condiciones = ['c.paciente_id = ?'];
  const valores = [pacienteId];

  if (estado && ESTADOS.includes(estado)) {
    condiciones.push('c.estado = ?');
    valores.push(estado);
  }
  if (desde) {
    condiciones.push('c.fecha >= ?');
    valores.push(desde);
  }
  if (hasta) {
    condiciones.push('c.fecha <= ?');
    valores.push(hasta);
  }

  const [filas] = await pool.query(
    `SELECT c.id, c.fecha, TIME_FORMAT(c.hora, '%H:%i') AS hora, c.motivo, c.estado,
            m.nombre AS medico, m.especialidad
       FROM citas c
       JOIN medicos m ON m.id = c.medico_id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY c.fecha DESC, c.hora DESC`,
    valores
  );
  return filas;
}

module.exports = { listar, obtener, crear, actualizar, historial, ESTADOS };
