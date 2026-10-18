-- =============================================================
-- Datos de prueba (opcional). Ejecutar después de 01, 02 y 03.
--
-- Se puede ejecutar varias veces: cada INSERT solo agrega los
-- registros que faltan y nunca modifica ni borra los existentes.
-- No usa ids fijos: los registros se relacionan por claves
-- naturales (colegiado del médico; email del paciente o, si no
-- tiene, nombre + teléfono).
-- NO cargar estos datos en producción.
-- =============================================================
USE sistema_citas;

START TRANSACTION;

-- Médicos. La Dra. Morales está inactiva y sin horarios: sirve para
-- probar que un médico inactivo no recibe citas nuevas.
INSERT INTO medicos (nombre, especialidad, colegiado, telefono, email, activo)
SELECT v.nombre, v.especialidad, v.colegiado, v.telefono, v.email, v.activo
  FROM (VALUES
    ROW('Dr. Carlos Méndez',  'Medicina general', '10001', '2233-4455', 'carlos.mendez@ejemplo.com',  1),
    ROW('Dra. Ana Ruiz',      'Pediatría',        '10002', '2233-6677', 'ana.ruiz@ejemplo.com',       1),
    ROW('Dr. Luis Castillo',  'Cardiología',      '10003', '2233-8899', 'luis.castillo@ejemplo.com',  1),
    ROW('Dra. Sofía Morales', 'Dermatología',     '10004', '2233-1122', 'sofia.morales@ejemplo.com',  0)
  ) AS v (nombre, especialidad, colegiado, telefono, email, activo)
 WHERE NOT EXISTS (SELECT 1 FROM medicos m WHERE m.colegiado = v.colegiado);

-- Pacientes (Lucía no tiene correo, se identifica por nombre + teléfono)
INSERT INTO pacientes (nombre, edad, telefono, email, alergias)
SELECT v.nombre, v.edad, v.telefono, v.email, v.alergias
  FROM (VALUES
    ROW('María Fernanda López', 34, '5512-3456', 'maria.lopez@ejemplo.com', 'Penicilina'),
    ROW('José Antonio Pérez',   58, '4423-9876', 'jose.perez@ejemplo.com',  NULL),
    ROW('Lucía Hernández',       9, '3301-2244', NULL,                      'Mariscos, ibuprofeno')
  ) AS v (nombre, edad, telefono, email, alergias)
 WHERE NOT EXISTS (
   SELECT 1 FROM pacientes p
    WHERE (v.email IS NOT NULL AND p.email = v.email)
       OR (v.email IS NULL AND p.nombre = v.nombre AND p.telefono = v.telefono)
 );

-- Disponibilidad semanal (lunes=1 ... domingo=7)
INSERT INTO disponibilidad_medicos (medico_id, dia_semana, hora_inicio, hora_fin)
SELECT m.id, v.dia_semana, v.hora_inicio, v.hora_fin
  FROM (VALUES
    ROW('10001', 1, '08:00:00', '12:00:00'),
    ROW('10001', 2, '08:00:00', '12:00:00'),
    ROW('10001', 3, '08:00:00', '12:00:00'),
    ROW('10001', 4, '08:00:00', '12:00:00'),
    ROW('10001', 5, '08:00:00', '12:00:00'),
    ROW('10002', 2, '08:00:00', '13:00:00'),
    ROW('10002', 4, '08:00:00', '13:00:00'),
    ROW('10003', 1, '09:00:00', '13:00:00'),
    ROW('10003', 2, '09:00:00', '13:00:00'),
    ROW('10003', 3, '09:00:00', '13:00:00'),
    ROW('10003', 4, '09:00:00', '13:00:00'),
    ROW('10003', 5, '09:00:00', '13:00:00')
  ) AS v (colegiado, dia_semana, hora_inicio, hora_fin)
  JOIN medicos m ON m.colegiado = v.colegiado
 WHERE NOT EXISTS (
   SELECT 1 FROM disponibilidad_medicos d
    WHERE d.medico_id = m.id
      AND d.dia_semana = v.dia_semana
      AND d.hora_inicio = v.hora_inicio
 );

-- Citas del historial (pasadas y futuras, en todos los estados)
INSERT INTO citas (paciente_id, medico_id, fecha, hora, motivo, estado)
SELECT p.id, m.id, v.fecha, v.hora, v.motivo, v.estado
  FROM (VALUES
    ROW('maria.lopez@ejemplo.com', NULL, NULL,       '10001', '2026-09-10', '08:00:00', 'Chequeo general',    'atendida'),
    ROW('maria.lopez@ejemplo.com', NULL, NULL,       '10003', '2026-10-05', '09:00:00', 'Dolor en el pecho',  'cancelada'),
    ROW('maria.lopez@ejemplo.com', NULL, NULL,       '10003', '2026-10-20', '10:00:00', 'Control de presión', 'confirmada'),
    ROW(NULL, 'Lucía Hernández',   '3301-2244',      '10002', '2026-10-22', '08:00:00', 'Fiebre y tos',       'pendiente'),
    ROW('jose.perez@ejemplo.com',  NULL, NULL,       '10001', '2026-10-01', '11:00:00', 'Renovar receta',     'atendida')
  ) AS v (email, nombre, telefono, colegiado, fecha, hora, motivo, estado)
  JOIN pacientes p
    ON (v.email IS NOT NULL AND p.email = v.email)
    OR (v.email IS NULL AND p.nombre = v.nombre AND p.telefono = v.telefono)
  JOIN medicos m ON m.colegiado = v.colegiado
 WHERE NOT EXISTS (
   SELECT 1 FROM citas c
    WHERE c.paciente_id = p.id
      AND c.medico_id = m.id
      AND c.fecha = v.fecha
      AND c.hora = v.hora
 );

COMMIT;
