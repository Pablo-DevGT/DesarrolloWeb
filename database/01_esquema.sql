-- =============================================================
-- Sistema de Citas - Esquema base y tabla de médicos
-- Orden de ejecución (MySQL 8.4, InnoDB, utf8mb4):
--   01_esquema.sql               base de datos y medicos
--   02_pacientes.sql             pacientes
--   03_citas_disponibilidad.sql  disponibilidad_medicos, citas y reglas
--   04_datos_prueba.sql          datos de prueba (opcional, repetible)
-- Todos los scripts se pueden volver a ejecutar sin borrar datos.
-- =============================================================

CREATE DATABASE IF NOT EXISTS sistema_citas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE sistema_citas;

-- -------------------------------------------------------------
-- Control de estructura obsoleta: prueba_historial.sql creaba
-- versiones mínimas de medicos y citas. Como los CREATE TABLE usan
-- IF NOT EXISTS, esas tablas no se actualizarían en silencio; por
-- eso el script se detiene y pide migrarlas antes de continuar.
-- -------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_verificar_estructura_previa;
DELIMITER $$
CREATE PROCEDURE sp_verificar_estructura_previa()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = DATABASE() AND table_name = 'medicos')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = DATABASE() AND table_name = 'medicos'
                        AND column_name = 'colegiado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
      'La tabla medicos tiene la estructura de prueba anterior (prueba_historial.sql). Migrarla antes de continuar.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = DATABASE() AND table_name = 'citas')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = DATABASE() AND table_name = 'citas'
                        AND column_name = 'horario_activo') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
      'La tabla citas tiene la estructura de prueba anterior (prueba_historial.sql). Migrarla antes de continuar.';
  END IF;
END$$
DELIMITER ;
CALL sp_verificar_estructura_previa();
DROP PROCEDURE sp_verificar_estructura_previa;

-- -------------------------------------------------------------
-- medicos: id, nombre y especialidad son el contrato que usan
-- Pacientes/Historial y Solicitud de Citas. Un médico inactivo
-- conserva su historial, pero no puede recibir citas nuevas
-- (regla aplicada en sp_validar_cita, 03_citas_disponibilidad.sql).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medicos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(120) NOT NULL,
  especialidad    VARCHAR(80)  NOT NULL,
  colegiado       VARCHAR(20)  NOT NULL,          -- número de colegiado activo
  telefono        VARCHAR(20)  NULL,
  email           VARCHAR(120) NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_medico_nombre    CHECK (CHAR_LENGTH(TRIM(nombre)) >= 3),
  CONSTRAINT chk_medico_colegiado CHECK (CHAR_LENGTH(TRIM(colegiado)) > 0),
  CONSTRAINT chk_medico_activo    CHECK (activo IN (0, 1)),
  UNIQUE KEY uq_medico_colegiado (colegiado),
  UNIQUE KEY uq_medico_email (email),
  INDEX idx_medico_nombre (nombre),
  INDEX idx_medico_especialidad (especialidad, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;
