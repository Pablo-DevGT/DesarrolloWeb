const pool = require('../comun/db');
const { fechaHoraFutura } = require('./citas.validacion');

const DURACION_MINUTOS = 60;
const ESTADOS_ACTIVOS = ['pendiente', 'confirmada', 'reagendada'];

class ErrorCitas extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErrorCitas';
    this.status = status;
  }
}

function minutos(hora) {
  const [horas, minutosHora] = String(hora).slice(0, 5).split(':').map(Number);
  return horas * 60 + minutosHora;
}

function instanteEnMinutos(fecha, hora) {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  const [horas, minutosHora] = String(hora).slice(0, 5).split(':').map(Number);
  return Date.UTC(anio, mes - 1, dia, horas, minutosHora) / 60000;
}

function generarHoras(disponibilidades) {
  const horas = new Set();
  for (const disponibilidad of disponibilidades) {
    const inicio = minutos(disponibilidad.hora_inicio);
    const fin = minutos(disponibilidad.hora_fin);
    for (let hora = inicio; hora + DURACION_MINUTOS <= fin; hora += DURACION_MINUTOS) {
      const hh = String(Math.floor(hora / 60)).padStart(2, '0');
      const mm = String(hora % 60).padStart(2, '0');
      horas.add(`${hh}:${mm}`);
    }
  }
  return [...horas].sort();
}

function seSuperponen(fechaA, horaA, fechaB, horaB) {
  const inicioA = instanteEnMinutos(fechaA, horaA);
  const inicioB = instanteEnMinutos(fechaB, horaB);
  return inicioA < inicioB + DURACION_MINUTOS && inicioB < inicioA + DURACION_MINUTOS;
}

function crearServicio({ db = pool, reloj = () => new Date() } = {}) {
  async function obtenerDisponibilidad(connection, medicoId, fecha) {
    const [disponibilidades] = await connection.query(
      `SELECT TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio,
              TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin
         FROM disponibilidad_medicos
        WHERE medico_id = ? AND dia_semana = WEEKDAY(?) + 1 AND activo = 1
        ORDER BY hora_inicio`,
      [medicoId, fecha]
    );
    return disponibilidades;
  }

  async function obtenerCitasActivas(connection, medicoId, fecha) {
    const [citas] = await connection.query(
      `SELECT c.fecha, TIME_FORMAT(c.hora, '%H:%i') AS hora
         FROM citas c
        WHERE c.medico_id = ?
          AND c.estado IN (?, ?, ?)
          AND c.fecha BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ?`,
      [medicoId, ...ESTADOS_ACTIVOS, fecha, fecha]
    );
    return citas;
  }

  async function listarMedicos() {
    const [medicos] = await db.query(
      `SELECT m.id, m.nombre, m.especialidad
         FROM medicos m
        WHERE EXISTS (
          SELECT 1 FROM disponibilidad_medicos d
           WHERE d.medico_id = m.id AND d.activo = 1
        )
        ORDER BY m.nombre`
    );
    return medicos;
  }

  async function listarHorarios(medicoId, fecha) {
    if (!fechaHoraFutura(fecha, '23:59', reloj())) {
      throw new ErrorCitas(400, 'No se pueden consultar horarios de una fecha pasada.');
    }
    const [medicos] = await db.query('SELECT id FROM medicos WHERE id = ?', [medicoId]);
    if (!medicos.length) throw new ErrorCitas(404, 'Médico no encontrado.');

    const disponibilidades = await obtenerDisponibilidad(db, medicoId, fecha);
    const horas = generarHoras(disponibilidades);
    if (!horas.length) return { medico_id: medicoId, fecha, horarios: [] };

    const citas = await obtenerCitasActivas(db, medicoId, fecha);
    const horarios = horas.filter((hora) =>
      fechaHoraFutura(fecha, hora, reloj()) &&
      !citas.some((cita) => seSuperponen(fecha, hora, cita.fecha, cita.hora))
    );
    return { medico_id: medicoId, fecha, horarios };
  }

  async function crearSolicitud(datos) {
    if (!fechaHoraFutura(datos.fecha, datos.hora, reloj())) {
      throw new ErrorCitas(400, 'No se pueden solicitar citas en fechas u horas pasadas.');
    }

    const connection = await db.getConnection();
    let transaccionIniciada = false;
    try {
      await connection.beginTransaction();
      transaccionIniciada = true;

      const [medicos] = await connection.query(
        'SELECT id FROM medicos WHERE id = ? FOR UPDATE',
        [datos.medico_id]
      );
      if (!medicos.length) throw new ErrorCitas(404, 'Médico no encontrado.');

      const [pacientes] = await connection.query(
        'SELECT id FROM pacientes WHERE id = ?',
        [datos.paciente_id]
      );
      if (!pacientes.length) throw new ErrorCitas(404, 'Paciente no encontrado.');

      if (!fechaHoraFutura(datos.fecha, datos.hora, reloj())) {
        throw new ErrorCitas(400, 'No se pueden solicitar citas en fechas u horas pasadas.');
      }

      const disponibilidades = await obtenerDisponibilidad(connection, datos.medico_id, datos.fecha);
      if (!generarHoras(disponibilidades).includes(datos.hora)) {
        throw new ErrorCitas(400, 'El horario no corresponde a la disponibilidad del médico.');
      }

      const citas = await obtenerCitasActivas(connection, datos.medico_id, datos.fecha);
      if (citas.some((cita) => seSuperponen(datos.fecha, datos.hora, cita.fecha, cita.hora))) {
        throw new ErrorCitas(409, 'El horario ya está ocupado. Selecciona otro horario.');
      }

      const [resultado] = await connection.query(
        `INSERT INTO citas (paciente_id, medico_id, fecha, hora, motivo, estado)
         VALUES (?, ?, ?, ?, ?, 'pendiente')`,
        [datos.paciente_id, datos.medico_id, datos.fecha, datos.hora, datos.motivo]
      );
      await connection.commit();
      transaccionIniciada = false;
      return {
        id: resultado.insertId,
        ...datos,
        estado: 'pendiente',
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ErrorCitas(409, 'El horario ya está ocupado. Selecciona otro horario.');
      }
      throw error;
    } finally {
      if (transaccionIniciada) {
        try {
          await connection.rollback();
        } catch (errorRollback) {
          console.error('No se pudo revertir la transacción de solicitud de cita.', errorRollback);
        }
      }
      connection.release();
    }
  }

  async function obtenerSolicitud(id) {
    const [citas] = await db.query(
      `SELECT c.id, c.paciente_id, c.medico_id, c.fecha,
              TIME_FORMAT(c.hora, '%H:%i') AS hora, c.motivo, c.estado,
              p.nombre AS paciente, m.nombre AS medico, m.especialidad
         FROM citas c
         JOIN pacientes p ON p.id = c.paciente_id
         JOIN medicos m ON m.id = c.medico_id
        WHERE c.id = ?`,
      [id]
    );
    return citas[0] || null;
  }

  return { listarMedicos, listarHorarios, crearSolicitud, obtenerSolicitud };
}

module.exports = { crearServicio, ErrorCitas };
