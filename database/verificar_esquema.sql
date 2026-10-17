-- =============================================================
-- Comprobación del esquema (solo lectura). Ejecutar después de
-- 01, 02 y 03 para confirmar que la estructura está completa.
-- =============================================================
USE sistema_citas;

-- 1. Tablas: bloqueos_agenda, citas, disponibilidad_medicos, medicos y
--    pacientes (InnoDB / utf8mb4_spanish_ci) y la vista v_citas_por_revisar
SELECT table_name, table_type, engine, table_collation
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
 ORDER BY table_name;

-- 2. Claves foráneas y su comportamiento al borrar
SELECT rc.table_name, rc.constraint_name, rc.referenced_table_name,
       rc.delete_rule, rc.update_rule
  FROM information_schema.referential_constraints rc
 WHERE rc.constraint_schema = DATABASE()
 ORDER BY rc.table_name, rc.constraint_name;

-- 3. Restricciones CHECK
SELECT tc.table_name, cc.constraint_name, cc.check_clause
  FROM information_schema.check_constraints cc
  JOIN information_schema.table_constraints tc
    ON tc.constraint_schema = cc.constraint_schema
   AND tc.constraint_name = cc.constraint_name
 WHERE cc.constraint_schema = DATABASE()
 ORDER BY tc.table_name, cc.constraint_name;

-- 4. Índices únicos y secundarios
SELECT table_name, index_name, non_unique,
       GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnas
  FROM information_schema.statistics
 WHERE table_schema = DATABASE()
 GROUP BY table_name, index_name, non_unique
 ORDER BY table_name, index_name;

-- 5. Procedimientos (2) y triggers (4) de citas y disponibilidad
SELECT routine_name, routine_type
  FROM information_schema.routines
 WHERE routine_schema = DATABASE();

SELECT trigger_name, action_timing, event_manipulation, event_object_table
  FROM information_schema.triggers
 WHERE trigger_schema = DATABASE()
 ORDER BY trigger_name;

-- 6. Columnas del contrato que leen los módulos de citas y pacientes
--    (deben devolverse 13 filas)
SELECT table_name, column_name, column_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND (table_name, column_name) IN (
     ('medicos','id'), ('medicos','nombre'), ('medicos','especialidad'),
     ('citas','id'), ('citas','paciente_id'), ('citas','medico_id'),
     ('citas','fecha'), ('citas','hora'), ('citas','motivo'), ('citas','estado'),
     ('disponibilidad_medicos','medico_id'), ('disponibilidad_medicos','dia_semana'),
     ('pacientes','id')
   )
 ORDER BY table_name, column_name;

-- 7. Informativo: citas por revisar (médico inactivo o fuera de horario
--    tras un cambio confirmado). Pueden existir legítimamente.
SELECT motivo_revision, COUNT(*) AS citas
  FROM v_citas_por_revisar
 GROUP BY motivo_revision;

-- 8. Integridad de datos: cada consulta debe devolver 0
SELECT COUNT(*) AS solapamientos_por_medico
  FROM citas a JOIN citas b
    ON a.medico_id = b.medico_id AND a.id < b.id
 WHERE a.horario_activo = 1 AND b.horario_activo = 1
   AND TIMESTAMP(a.fecha, a.hora) < TIMESTAMP(b.fecha, b.hora) + INTERVAL 60 MINUTE
   AND TIMESTAMP(b.fecha, b.hora) < TIMESTAMP(a.fecha, a.hora) + INTERVAL 60 MINUTE;

SELECT COUNT(*) AS horarios_activos_superpuestos
  FROM disponibilidad_medicos a JOIN disponibilidad_medicos b
    ON a.medico_id = b.medico_id AND a.dia_semana = b.dia_semana AND a.id < b.id
 WHERE a.activo = 1 AND b.activo = 1
   AND a.hora_inicio < b.hora_fin AND b.hora_inicio < a.hora_fin;

SELECT COUNT(*) AS horarios_de_menos_de_60_minutos
  FROM disponibilidad_medicos
 WHERE TIME_TO_SEC(TIMEDIFF(hora_fin, hora_inicio)) < 3600;

SELECT COUNT(*) AS solapamientos_por_paciente
  FROM citas a JOIN citas b
    ON a.paciente_id = b.paciente_id AND a.id < b.id
 WHERE a.horario_activo = 1 AND b.horario_activo = 1
   AND TIMESTAMP(a.fecha, a.hora) < TIMESTAMP(b.fecha, b.hora) + INTERVAL 60 MINUTE
   AND TIMESTAMP(b.fecha, b.hora) < TIMESTAMP(a.fecha, a.hora) + INTERVAL 60 MINUTE;
