-- =============================================================
-- Módulo de solicitud de citas.
-- Requiere que existan medicos(id) y citas con los campos usados
-- por src/citas/citas.service.js.
-- =============================================================
USE sistema_citas;

CREATE TABLE IF NOT EXISTS disponibilidad_medicos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  medico_id   INT NOT NULL,
  dia_semana  TINYINT UNSIGNED NOT NULL COMMENT 'Día ISO: lunes=1 ... domingo=7',
  hora_inicio TIME NOT NULL,
  hora_fin    TIME NOT NULL,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_disponibilidad_medico
    FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE CASCADE,
  CONSTRAINT chk_disponibilidad_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_disponibilidad_rango CHECK (hora_inicio < hora_fin),
  UNIQUE KEY uq_disponibilidad_inicio (medico_id, dia_semana, hora_inicio),
  INDEX idx_disponibilidad_medico_dia (medico_id, dia_semana, activo)
);

-- El índice del esquema local de prueba también bloquea reutilizar una
-- hora cancelada. La aplicación serializa reservas por médico en una
-- transacción y comprueba solapamientos de estados activos.
SET @citas_drop_test_index = IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'citas'
       AND index_name = 'uq_medico_horario'
  ),
  'ALTER TABLE citas DROP INDEX uq_medico_horario',
  'SELECT 1'
);
PREPARE citas_drop_test_index_stmt FROM @citas_drop_test_index;
EXECUTE citas_drop_test_index_stmt;
DEALLOCATE PREPARE citas_drop_test_index_stmt;
