-- =============================================================
-- SOLO PARA PRUEBAS LOCALES del historial (Integrante 2).
-- Crea versiones mínimas de `medicos` y `citas` si todavía no
-- existen, para probar el historial antes de que los Integrantes
-- 1 y 3 suban sus tablas. NO subir estos datos a producción.
-- =============================================================
USE sistema_citas;

CREATE TABLE IF NOT EXISTS medicos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  especialidad  VARCHAR(80)  NOT NULL
);

CREATE TABLE IF NOT EXISTS citas (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  paciente_id  INT NOT NULL,
  medico_id    INT NOT NULL,
  fecha        DATE NOT NULL,
  hora         TIME NOT NULL,
  motivo       VARCHAR(255),
  estado       ENUM('pendiente','confirmada','reagendada','cancelada','atendida') DEFAULT 'pendiente',
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
  FOREIGN KEY (medico_id)   REFERENCES medicos(id),
  UNIQUE KEY uq_medico_horario (medico_id, fecha, hora)
);

INSERT INTO medicos (nombre, especialidad) VALUES
  ('Dr. Carlos Méndez', 'Medicina general'),
  ('Dra. Ana Ruiz',     'Pediatría'),
  ('Dr. Luis Castillo', 'Cardiología');

INSERT INTO citas (paciente_id, medico_id, fecha, hora, motivo, estado) VALUES
  (1, 1, '2026-09-10', '08:00', 'Chequeo general',      'atendida'),
  (1, 3, '2026-10-05', '09:30', 'Dolor en el pecho',    'cancelada'),
  (1, 3, '2026-10-20', '10:00', 'Control de presión',   'confirmada'),
  (3, 2, '2026-10-22', '08:30', 'Fiebre y tos',         'pendiente'),
  (2, 1, '2026-10-01', '11:00', 'Renovar receta',       'atendida');
