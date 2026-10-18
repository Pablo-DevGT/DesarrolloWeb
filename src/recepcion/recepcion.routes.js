
const express = require('express');
const db = require('../comun/db');

const router = express.Router();

// Consultar citas registradas en el sistema
router.get('/citas', async (req, res, next) => {
  try {
    const [citas] = await db.query(`
      SELECT
        c.id,
        DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(c.hora, '%H:%i') AS hora,
        c.motivo,
        c.estado,
        p.nombre AS paciente,
        m.nombre AS medico
      FROM citas c
      INNER JOIN pacientes p ON c.paciente_id = p.id
      INNER JOIN medicos m ON c.medico_id = m.id
      ORDER BY c.fecha DESC, c.hora DESC
      LIMIT 100
    `);

    res.json({ citas });
  } catch (error) {
    next(error);
  }
});

router.patch('/citas/:id/confirmar', async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      error: 'El ID de la cita no es válido.'
    });
  }

  try {
    const [resultado] = await db.query(
      `UPDATE citas
       SET estado = 'confirmada'
       WHERE id = ?
         AND estado = 'pendiente'
         AND TIMESTAMP(fecha, hora) > NOW()`,
      [id]
    );

    if (resultado.affectedRows === 0) {
      return res.status(409).json({
        error: 'La cita no existe, ya no está pendiente o su horario pasó.'
      });
    }

    res.json({
      mensaje: 'Cita confirmada correctamente.'
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/citas/:id/cancelar', async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      error: 'El ID de la cita no es válido.'
    });
  }

  try {
    const [resultado] = await db.query(
      `UPDATE citas
       SET estado = 'cancelada'
       WHERE id = ?
         AND estado IN ('pendiente', 'confirmada', 'reagendada')
         AND TIMESTAMP(fecha, hora) > NOW()`,
      [id]
    );

    if (resultado.affectedRows === 0) {
      return res.status(409).json({
        error: 'La cita no existe, ya fue cancelada o su horario pasó.'
      });
    }

    res.json({
      mensaje: 'Cita cancelada correctamente.'
    });

  } catch (error) {
    next(error);
  }
});

router.patch('/citas/:id/reagendar', async (req, res, next) => {
  const id = Number(req.params.id);
  const { fecha, hora } = req.body || {};

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      error: 'El ID de la cita no es válido.'
    });
  }

  if (typeof fecha !== 'string' ||
      typeof hora !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
    return res.status(400).json({
      error: 'Ingresá una fecha y hora válidas.'
    });
  }

  const fechaComprobacion = new Date(`${fecha}T00:00:00Z`);

  if (Number.isNaN(fechaComprobacion.getTime()) ||
      fechaComprobacion.toISOString().slice(0, 10) !== fecha) {
    return res.status(400).json({
      error: 'La fecha ingresada no existe.'
    });
  }

  try {
    const [resultado] = await db.query(
      `UPDATE citas
       SET fecha = ?, hora = ?, estado = 'reagendada'
       WHERE id = ?
         AND estado IN ('pendiente', 'confirmada', 'reagendada')
         AND TIMESTAMP(fecha, hora) > NOW()
         AND TIMESTAMP(?, ?) > NOW()
         AND (fecha <> ? OR hora <> ?)`,
      [fecha, hora, id, fecha, hora, fecha, hora]
    );

    if (resultado.affectedRows === 0) {
      return res.status(409).json({
        error: 'No se puede reagendar esta cita. Revisá su estado, fecha y hora.'
      });
    }

    res.json({
      mensaje: 'Cita reagendada correctamente.'
    });

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'El médico o el paciente ya tiene una cita en ese horario.'
      });
    }

    if (error.code === 'ER_SIGNAL_EXCEPTION') {
      return res.status(409).json({
        error: 'El nuevo horario no está disponible o el médico está inactivo.'
      });
    }

    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
      return res.status(503).json({
        error: 'Hubo un conflicto temporal. Intentá nuevamente.'
      });
    }

    next(error);
  }
});

module.exports = router;
