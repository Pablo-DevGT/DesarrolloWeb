-- =============================================================
-- Sistema de Citas - Módulo de Pacientes (Integrante 2)
-- Ejecutar DESPUÉS de 01_esquema.sql y ANTES de
-- 03_citas_disponibilidad.sql (citas referencia a pacientes).
-- Los datos de prueba están en 04_datos_prueba.sql.
-- =============================================================

CREATE DATABASE IF NOT EXISTS sistema_citas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE sistema_citas;

CREATE TABLE IF NOT EXISTS pacientes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(120) NOT NULL,
  edad            TINYINT UNSIGNED NOT NULL,
  telefono        VARCHAR(20)  NOT NULL,
  email           VARCHAR(120) NULL,
  alergias        TEXT NULL,          -- texto libre: "Penicilina, mariscos". NULL = ninguna conocida
  creado_en       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_edad CHECK (edad BETWEEN 0 AND 120),
  UNIQUE KEY uq_paciente_email (email),
  INDEX idx_paciente_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;

-- -------------------------------------------------------------
-- El historial (src/pacientes/pacientes.model.js) lee:
--   medicos(id, nombre, especialidad)           -> 01_esquema.sql
--   citas(id, paciente_id, medico_id, fecha, hora, motivo, estado)
--   estado IN ('pendiente','confirmada','reagendada','cancelada','atendida')
--                                               -> 03_citas_disponibilidad.sql
-- -------------------------------------------------------------
