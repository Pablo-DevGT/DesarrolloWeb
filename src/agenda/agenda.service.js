// Agenda del doctor: citas de un médico en un día y marcar citas como atendidas.
// Todas las consultas usan parámetros (?) para evitar inyección SQL.
//
// Marcar una cita como atendida solo cambia su estado: según
// docs/integracion-recepcion-agenda.md ese cambio no revalida disponibilidad ni
// choques (la cita deja de ocupar horario, horario_activo pasa a NULL).
const pool = require('../comun/db');
const { fechaLocal } = require('./agenda.validacion');

const ESTADOS_ACTIVOS = ['pendiente', 'confirmada', 'reagendada'];

const COLUMNAS_CITA = `c.id, TIME_FORMAT(c.hora, '%H:%i') AS hora, c.motivo, c.estado, c.paciente_id,
       p.nombre AS paciente, p.edad, p.telefono, p.alergias`;

class ErrorAgenda extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErrorAgenda';
    this.status = status;
  }
}

function resumir(citas) {
  return {
    total: citas.length,
    activas: citas.filter((c) => ESTADOS_ACTIVOS.includes(c.estado)).length,
    atendidas: citas.filter((c) => c.estado === 'atendida').length,
    canceladas: citas.filter((c) => c.estado === 'cancelada').length,
  };
}

function crearServicio({ db = pool, reloj = () => new Date() } = {}) {
  async function obtenerMedico(medicoId) {
    const [medicos] = await db.query(
      'SELECT id, nombre, especialidad, activo FROM medicos WHERE id = ?',
      [medicoId]
    );
    if (!medicos.length) throw new ErrorAgenda(404, 'Médico no encontrado.');
    return medicos[0];
  }

  // Todas las citas del médico ese día (también canceladas y atendidas, para
  // que el doctor vea qué horas se liberaron), en orden de hora.
  async function obtenerAgenda({ medicoId, fecha }) {
    const medico = await obtenerMedico(medicoId);
    const [citas] = await db.query(
      `SELECT ${COLUMNAS_CITA}
         FROM citas c
         JOIN pacientes p ON p.id = c.paciente_id
        WHERE c.medico_id = ? AND c.fecha = ?
        ORDER BY c.hora`,
      [medicoId, fecha]
    );
    return { medico, fecha, citas, resumen: resumir(citas) };
  }

  // medicoId: el del doctor conectado; null si es la recepcionista (puede atender cualquiera)
  async function marcarAtendida({ citaId, medicoId = null }) {
    const [citas] = await db.query(
      `SELECT ${COLUMNAS_CITA}, c.medico_id, c.fecha
         FROM citas c
         JOIN pacientes p ON p.id = c.paciente_id
        WHERE c.id = ?`,
      [citaId]
    );
    const cita = citas[0];
    if (!cita) throw new ErrorAgenda(404, 'Cita no encontrada.');
    if (medicoId && cita.medico_id !== medicoId) throw new ErrorAgenda(403, 'Esa cita no pertenece a tu agenda.');
    if (cita.estado === 'atendida') throw new ErrorAgenda(409, 'La cita ya está marcada como atendida.');
    if (cita.estado === 'cancelada') throw new ErrorAgenda(409, 'No se puede atender una cita cancelada.');
    if (String(cita.fecha).slice(0, 10) > fechaLocal(reloj())) {
      throw new ErrorAgenda(400, 'No se puede marcar como atendida una cita de una fecha futura.');
    }

    // El filtro por estado evita pisar un cambio hecho mientras tanto (p. ej. recepción la canceló)
    const [resultado] = await db.query(
      `UPDATE citas SET estado = 'atendida' WHERE id = ? AND estado IN (?, ?, ?)`,
      [citaId, ...ESTADOS_ACTIVOS]
    );
    if (!resultado.affectedRows) throw new ErrorAgenda(409, 'La cita cambió de estado mientras tanto. Actualiza la agenda.');

    const { medico_id, fecha, ...publica } = cita;
    return { ...publica, estado: 'atendida' };
  }

  return { obtenerAgenda, marcarAtendida };
}

module.exports = { crearServicio, ErrorAgenda, ESTADOS_ACTIVOS };
