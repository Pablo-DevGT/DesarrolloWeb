-- =============================================================
-- Sistema de Citas - Módulo de Pacientes (Integrante 2)
-- Ejecutar en MySQL Workbench DESPUÉS del esquema del Integrante 1
-- (01_esquema.sql), porque usa la misma base de datos.
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
);

-- -------------------------------------------------------------
-- El historial lee las tablas `medicos` y `citas`, que pertenecen
-- a los Integrantes 1 y 3. Este módulo espera estas columnas:
--   medicos(id, nombre, especialidad)
--   citas(id, paciente_id, medico_id, fecha, hora, motivo, estado)
--   estado IN ('pendiente','confirmada','reagendada','cancelada','atendida')
-- Si el esquema real usa otros nombres, ajustar SOLO la consulta
-- de src/pacientes/pacientes.model.js (función historial).
-- -------------------------------------------------------------

-- Datos de prueba
INSERT INTO pacientes (nombre, edad, telefono, email, alergias) VALUES
  ('María Fernanda López', 34, '5512-3456', 'maria.lopez@ejemplo.com', 'Penicilina'),
  ('José Antonio Pérez',   58, '4423-9876', 'jose.perez@ejemplo.com',  NULL),
  ('Lucía Hernández',       9, '3301-2244', NULL,                      'Mariscos, ibuprofeno');
