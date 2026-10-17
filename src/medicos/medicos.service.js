// Gestión de médicos y de sus horarios de atención.
// Todas las consultas usan parámetros (?) para evitar inyección SQL.
//
// Concurrencia: los cambios de horarios y de estado bloquean la fila del médico
// con SELECT ... FOR UPDATE, el mismo cerrojo que usa Solicitud de Citas
// (src/citas/citas.service.js). Así dos cambios simultáneos de horarios del mismo
// médico no pueden crear rangos superpuestos, y una reserva no puede colarse
// entre la revisión de citas afectadas y el cambio.
const pool = require('../comun/db');
const { DIAS, DURACION_CITA_MINUTOS, minutos } = require('../../public/medicos/reglas');

const ESTADOS_ACTIVOS = ['pendiente', 'confirmada', 'reagendada'];
const MAX_INTENTOS = 3;
const MENSAJE_OCUPADO = 'El sistema está ocupado. Intenta nuevamente en unos momentos';

const COLUMNAS_MEDICO = `m.id, m.nombre, m.especialidad, m.colegiado, m.telefono, m.email, m.activo,
       m.creado_en, m.actualizado_en`;
const COLUMNAS_HORARIO = `id, medico_id, dia_semana,
       TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio,
       TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin, activo`;

class ErrorMedicos extends Error {
  // `detalle` se agrega a la respuesta JSON (p. ej. citas que requieren confirmación)
  constructor(status, message, detalle = null) {
    super(message);
    this.name = 'ErrorMedicos';
    this.status = status;
    this.detalle = detalle;
  }
}

// Convierte los errores de MySQL conocidos en mensajes para el usuario
function traducirError(error) {
  if (error instanceof ErrorMedicos) return error;
  const mensaje = String(error.message || '');
  if (error.code === 'ER_DUP_ENTRY') {
    if (mensaje.includes('uq_medico_colegiado')) {
      return new ErrorMedicos(409, 'Ya existe un médico registrado con ese número de colegiado.');
    }
    if (mensaje.includes('uq_medico_email')) {
      return new ErrorMedicos(409, 'Ya existe un médico registrado con ese correo electrónico.');
    }
    if (mensaje.includes('uq_disponibilidad_inicio')) {
      return new ErrorMedicos(409,
        'Ya existe otro horario de este médico que empieza a esa hora ese día (puede estar inactivo). Edítalo o actívalo.');
    }
    // Trigger de disponibilidad_medicos (sp_validar_disponibilidad)
    if (mensaje.startsWith('El horario se superpone')) return new ErrorMedicos(409, mensaje);
  }
  if (error.code === 'ER_SIGNAL_EXCEPTION' && mensaje.includes('60 minutos')) {
    return new ErrorMedicos(400, mensaje);
  }
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.code === 'ER_DATA_TOO_LONG') {
    return new ErrorMedicos(400, 'Los datos no cumplen las reglas de la base de datos. Revisa los campos.');
  }
  return error;
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios.replace('{n}', n));

// Hay que pedir (o volver a pedir) confirmación si existen citas afectadas y el
// usuario no confirmó, o si confirmó una lista que no incluye alguna cita actual
// (se registró una cita nueva mientras revisaba el diálogo).
function faltaConfirmacion(citas, { confirmar = false, citasConfirmadas = null } = {}) {
  if (!citas.length) return false;
  if (!confirmar) return true;
  return Array.isArray(citasConfirmadas) && citas.some((c) => !citasConfirmadas.includes(c.id));
}

// Una cita está cubierta si algún rango del mismo día contiene sus 60 minutos
function diaIso(fecha) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() || 7;
}
function cubre(rangos, cita) {
  const dia = diaIso(cita.fecha);
  const inicio = minutos(cita.hora);
  return rangos.some((r) => Number(r.dia_semana) === dia &&
    minutos(r.hora_inicio) <= inicio && inicio + DURACION_CITA_MINUTOS <= minutos(r.hora_fin));
}
// Citas que hoy están dentro de la disponibilidad y dejarían de estarlo
function citasQueQuedanFuera(citas, rangosAntes, rangosDespues) {
  return citas.filter((cita) => cubre(rangosAntes, cita) && !cubre(rangosDespues, cita));
}

function crearServicio({ db = pool, reloj = () => new Date() } = {}) {
  function ahora() {
    const d = reloj();
    const dos = (n) => String(n).padStart(2, '0');
    return {
      fecha: `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`,
      hora: `${dos(d.getHours())}:${dos(d.getMinutes())}`,
    };
  }

  // Ejecuta fn(conexion) en una transacción. Ante un interbloqueo (1213) InnoDB
  // revierte la transacción completa, así que es seguro repetirla desde el inicio.
  async function enTransaccion(fn) {
    for (let intento = 1; ; intento++) {
      const conexion = await db.getConnection();
      let iniciada = false;
      try {
        await conexion.beginTransaction();
        iniciada = true;
        const resultado = await fn(conexion);
        await conexion.commit();
        iniciada = false;
        return resultado;
      } catch (error) {
        if (error.code === 'ER_LOCK_DEADLOCK') {
          if (intento < MAX_INTENTOS) {
            await new Promise((r) => setTimeout(r, 20 * intento + Math.floor(Math.random() * 30)));
            continue;
          }
          throw new ErrorMedicos(503, MENSAJE_OCUPADO);
        }
        throw traducirError(error);
      } finally {
        if (iniciada) {
          try {
            await conexion.rollback();
          } catch (errorRollback) {
            console.error('No se pudo revertir la transacción de médicos.', errorRollback);
          }
        }
        conexion.release();
      }
    }
  }

  async function bloquearMedico(conexion, medicoId) {
    const [filas] = await conexion.query('SELECT id, activo FROM medicos WHERE id = ? FOR UPDATE', [medicoId]);
    if (!filas.length) throw new ErrorMedicos(404, 'Médico no encontrado.');
    return filas[0];
  }

  async function bloquearHorario(conexion, medicoId, horarioId) {
    const [filas] = await conexion.query(
      `SELECT ${COLUMNAS_HORARIO} FROM disponibilidad_medicos WHERE id = ? AND medico_id = ? FOR UPDATE`,
      [horarioId, medicoId]
    );
    if (!filas.length) throw new ErrorMedicos(404, 'Horario no encontrado.');
    return filas[0];
  }

  async function citasFuturasActivas(conexion, medicoId) {
    const { fecha, hora } = ahora();
    const [citas] = await conexion.query(
      `SELECT c.id, c.fecha, TIME_FORMAT(c.hora, '%H:%i') AS hora, c.estado, p.nombre AS paciente, c.paciente_id
         FROM citas c
         JOIN pacientes p ON p.id = c.paciente_id
        WHERE c.medico_id = ?
          AND c.estado IN (?, ?, ?)
          AND (c.fecha > ? OR (c.fecha = ? AND c.hora >= ?))
        ORDER BY c.fecha, c.hora`,
      [medicoId, ...ESTADOS_ACTIVOS, fecha, fecha, hora]
    );
    return citas;
  }

  async function rangosActivos(conexion, medicoId) {
    const [rangos] = await conexion.query(
      `SELECT ${COLUMNAS_HORARIO} FROM disponibilidad_medicos WHERE medico_id = ? AND activo = 1`,
      [medicoId]
    );
    return rangos;
  }

  async function verificarSinSolapamiento(conexion, medicoId, rango, excluirId = 0) {
    const [choques] = await conexion.query(
      `SELECT ${COLUMNAS_HORARIO} FROM disponibilidad_medicos
        WHERE medico_id = ? AND dia_semana = ? AND activo = 1 AND id <> ?
          AND hora_inicio < ? AND ? < hora_fin
        ORDER BY hora_inicio LIMIT 1`,
      [medicoId, rango.dia_semana, excluirId, rango.hora_fin, rango.hora_inicio]
    );
    if (choques.length) {
      const c = choques[0];
      throw new ErrorMedicos(409,
        `El horario se superpone con otro horario activo del ${DIAS[c.dia_semana].toLowerCase()} (${c.hora_inicio}–${c.hora_fin}).`);
    }
  }

  // Si el cambio deja citas futuras fuera de la disponibilidad, exige confirmación
  async function revisarCitasAfectadas(conexion, medicoId, horarioId, rangoNuevo, confirmacion) {
    const antes = await rangosActivos(conexion, medicoId);
    const despues = antes.filter((r) => r.id !== horarioId).concat(rangoNuevo ? [rangoNuevo] : []);
    const afectadas = citasQueQuedanFuera(await citasFuturasActivas(conexion, medicoId), antes, despues);
    if (faltaConfirmacion(afectadas, confirmacion)) {
      throw new ErrorMedicos(409,
        `Este cambio deja ${plural(afectadas.length, '1 cita futura activa', '{n} citas futuras activas')} ` +
        'fuera de la disponibilidad del médico. Las citas no se modificarán automáticamente. Confirma para continuar.',
        { requiere_confirmacion: true, citas_afectadas: afectadas });
    }
    return afectadas;
  }

  // ---------------- Médicos ----------------

  async function listar({ q = '', especialidad = '', activo = null } = {}) {
    const condiciones = [];
    const valores = [];
    if (q) {
      const filtro = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      condiciones.push('(m.nombre LIKE ? OR m.especialidad LIKE ? OR m.colegiado LIKE ?)');
      valores.push(filtro, filtro, filtro);
    }
    if (especialidad) {
      condiciones.push('m.especialidad = ?');
      valores.push(especialidad);
    }
    if (activo !== null) {
      condiciones.push('m.activo = ?');
      valores.push(activo ? 1 : 0);
    }
    const [medicos] = await db.query(
      `SELECT ${COLUMNAS_MEDICO},
              (SELECT COUNT(*) FROM disponibilidad_medicos d
                WHERE d.medico_id = m.id AND d.activo = 1) AS horarios_activos
         FROM medicos m
        ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
        ORDER BY m.activo DESC, m.nombre`,
      valores
    );
    return medicos;
  }

  async function especialidades() {
    const [filas] = await db.query('SELECT DISTINCT especialidad FROM medicos ORDER BY especialidad');
    return filas.map((f) => f.especialidad);
  }

  async function obtener(id) {
    const [filas] = await db.query(`SELECT ${COLUMNAS_MEDICO} FROM medicos m WHERE m.id = ?`, [id]);
    if (!filas.length) return null;
    const [horarios] = await db.query(
      `SELECT ${COLUMNAS_HORARIO} FROM disponibilidad_medicos WHERE medico_id = ?
        ORDER BY dia_semana, hora_inicio`,
      [id]
    );
    return { ...filas[0], horarios };
  }

  async function crear({ nombre, especialidad, colegiado, telefono, email }) {
    let resultado;
    try {
      [resultado] = await db.query(
        'INSERT INTO medicos (nombre, especialidad, colegiado, telefono, email) VALUES (?, ?, ?, ?, ?)',
        [nombre, especialidad, colegiado, telefono, email]
      );
    } catch (error) {
      throw traducirError(error);
    }
    return obtener(resultado.insertId);
  }

  async function actualizar(id, { nombre, especialidad, colegiado, telefono, email }) {
    await enTransaccion(async (conexion) => {
      await bloquearMedico(conexion, id);
      await conexion.query(
        `UPDATE medicos SET nombre = ?, especialidad = ?, colegiado = ?, telefono = ?, email = ?
          WHERE id = ?`,
        [nombre, especialidad, colegiado, telefono, email, id]
      );
    });
    return obtener(id);
  }

  // Citas futuras activas del médico, para mostrarlas antes de desactivarlo
  async function citasFuturas(id) {
    const [filas] = await db.query('SELECT id FROM medicos WHERE id = ?', [id]);
    if (!filas.length) throw new ErrorMedicos(404, 'Médico no encontrado.');
    return citasFuturasActivas(db, id);
  }

  // Citas futuras activas que Recepción debe revisar (vista v_citas_por_revisar):
  // médico inactivo o fuera de la disponibilidad tras un cambio de horario confirmado
  async function citasPorRevisar(id) {
    const [filas] = await db.query('SELECT id FROM medicos WHERE id = ?', [id]);
    if (!filas.length) throw new ErrorMedicos(404, 'Médico no encontrado.');
    const [citas] = await db.query(
      `SELECT cita_id AS id, fecha, hora, estado, paciente, paciente_id,
              medico_inactivo, fuera_de_disponibilidad, motivo_revision
         FROM v_citas_por_revisar
        WHERE medico_id = ?
        ORDER BY fecha, hora`,
      [id]
    );
    return citas.map((c) => ({
      ...c,
      medico_inactivo: Boolean(Number(c.medico_inactivo)),
      fuera_de_disponibilidad: Boolean(Number(c.fuera_de_disponibilidad)),
    }));
  }

  // Desactivar no cancela ni reasigna citas: si tiene citas futuras activas,
  // exige confirmación y las devuelve para que el usuario las vea.
  async function cambiarEstado(id, { activo, confirmar = false, citasConfirmadas = null }) {
    const citas = await enTransaccion(async (conexion) => {
      const medico = await bloquearMedico(conexion, id);
      let futuras = [];
      if (!activo && medico.activo) {
        futuras = await citasFuturasActivas(conexion, id);
        if (faltaConfirmacion(futuras, { confirmar, citasConfirmadas })) {
          throw new ErrorMedicos(409,
            `El médico tiene ${plural(futuras.length, '1 cita futura activa', '{n} citas futuras activas')}. ` +
            'Al desactivarlo no recibirá citas nuevas, pero esas citas no se cancelan ni se reasignan. ' +
            'Confirma para continuar.',
            { requiere_confirmacion: true, citas_afectadas: futuras });
        }
      }
      await conexion.query('UPDATE medicos SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
      return futuras;
    });
    return { medico: await obtener(id), citas_futuras_activas: citas };
  }

  // ---------------- Horarios ----------------

  async function listarHorarios(medicoId) {
    const medico = await obtener(medicoId);
    if (!medico) throw new ErrorMedicos(404, 'Médico no encontrado.');
    return medico.horarios;
  }

  async function obtenerHorario(conexion, id) {
    const [filas] = await conexion.query(`SELECT ${COLUMNAS_HORARIO} FROM disponibilidad_medicos WHERE id = ?`, [id]);
    return filas[0];
  }

  async function crearHorario(medicoId, rango) {
    return enTransaccion(async (conexion) => {
      await bloquearMedico(conexion, medicoId);
      await verificarSinSolapamiento(conexion, medicoId, rango);
      const [resultado] = await conexion.query(
        'INSERT INTO disponibilidad_medicos (medico_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)',
        [medicoId, rango.dia_semana, rango.hora_inicio, rango.hora_fin]
      );
      return obtenerHorario(conexion, resultado.insertId);
    });
  }

  async function actualizarHorario(medicoId, horarioId, rango, confirmacion = {}) {
    return enTransaccion(async (conexion) => {
      await bloquearMedico(conexion, medicoId);
      const actual = await bloquearHorario(conexion, medicoId, horarioId);
      let afectadas = [];
      if (actual.activo) {
        await verificarSinSolapamiento(conexion, medicoId, rango, horarioId);
        afectadas = await revisarCitasAfectadas(conexion, medicoId, horarioId, rango, confirmacion);
      }
      await conexion.query(
        'UPDATE disponibilidad_medicos SET dia_semana = ?, hora_inicio = ?, hora_fin = ? WHERE id = ?',
        [rango.dia_semana, rango.hora_inicio, rango.hora_fin, horarioId]
      );
      return { horario: await obtenerHorario(conexion, horarioId), citas_fuera_de_disponibilidad: afectadas };
    });
  }

  async function cambiarEstadoHorario(medicoId, horarioId, { activo, ...confirmacion }) {
    return enTransaccion(async (conexion) => {
      await bloquearMedico(conexion, medicoId);
      const actual = await bloquearHorario(conexion, medicoId, horarioId);
      let afectadas = [];
      if (activo && !actual.activo) {
        await verificarSinSolapamiento(conexion, medicoId, actual, horarioId);
      } else if (!activo && actual.activo) {
        afectadas = await revisarCitasAfectadas(conexion, medicoId, horarioId, null, confirmacion);
      }
      await conexion.query('UPDATE disponibilidad_medicos SET activo = ? WHERE id = ?', [activo ? 1 : 0, horarioId]);
      return { horario: await obtenerHorario(conexion, horarioId), citas_fuera_de_disponibilidad: afectadas };
    });
  }

  return {
    listar, especialidades, obtener, crear, actualizar, citasFuturas, citasPorRevisar, cambiarEstado,
    listarHorarios, crearHorario, actualizarHorario, cambiarEstadoHorario,
  };
}

module.exports = { crearServicio, ErrorMedicos, citasQueQuedanFuera, traducirError, MENSAJE_OCUPADO };
