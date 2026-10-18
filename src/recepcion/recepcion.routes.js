
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

module.exports = router;
