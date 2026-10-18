
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

module.exports = router;
