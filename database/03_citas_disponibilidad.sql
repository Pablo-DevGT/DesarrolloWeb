-- =============================================================
-- Módulo de solicitud de citas: disponibilidad, citas y reglas.
-- Ejecutar DESPUÉS de 01_esquema.sql (medicos) y 02_pacientes.sql
-- (pacientes). Se puede volver a ejecutar: las tablas usan
-- IF NOT EXISTS y el procedimiento y los triggers se recrean.
-- =============================================================
USE sistema_citas;

-- -------------------------------------------------------------
-- disponibilidad_medicos: rangos semanales. Cada rango genera
-- citas consecutivas de 60 minutos (src/citas/citas.service.js).
-- Duración mínima y no solapamiento: sp_validar_disponibilidad.
-- -------------------------------------------------------------
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;

-- -------------------------------------------------------------
-- citas: id, paciente_id, medico_id, fecha, hora, motivo y estado
-- son el contrato de Solicitud de Citas y Pacientes/Historial.
--
-- horario_activo vale 1 en estados que ocupan horario (pendiente,
-- confirmada, reagendada) y NULL en cancelada/atendida. Como un
-- índice UNIQUE admite varios NULL, los índices únicos impiden dos
-- citas activas con la misma hora de inicio para un médico o para
-- un paciente, y una cita cancelada libera el horario.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citas (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  paciente_id     INT NOT NULL,
  medico_id       INT NOT NULL,
  fecha           DATE NOT NULL,
  hora            TIME NOT NULL,
  motivo          VARCHAR(255) NOT NULL,
  estado          ENUM('pendiente','confirmada','reagendada','cancelada','atendida')
                  NOT NULL DEFAULT 'pendiente',
  horario_activo  TINYINT UNSIGNED GENERATED ALWAYS AS
                  (IF(estado IN ('pendiente','confirmada','reagendada'), 1, NULL)) STORED,
  creado_en       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cita_paciente
    FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cita_medico
    FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_cita_motivo CHECK (CHAR_LENGTH(TRIM(motivo)) BETWEEN 3 AND 255),
  -- También sirven para las búsquedas por (medico_id, fecha) y (paciente_id, fecha)
  UNIQUE KEY uq_cita_medico_horario_activo (medico_id, fecha, hora, horario_activo),
  UNIQUE KEY uq_cita_paciente_horario_activo (paciente_id, fecha, hora, horario_activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;

-- -------------------------------------------------------------
-- bloqueos_agenda: tabla interna de cerrojos, una fila por médico
-- o paciente que ha reservado. sp_validar_cita la bloquea para
-- serializar las reservas. No usarla desde la aplicación: bloquear
-- aquí, y no en medicos/pacientes, evita el error 1442 cuando una
-- sentencia sobre citas también lee medicos o pacientes
-- (INSERT ... SELECT, UPDATE ... JOIN).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  tipo    ENUM('medico','paciente') NOT NULL,
  ref_id  INT NOT NULL,
  PRIMARY KEY (tipo, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;

-- -------------------------------------------------------------
-- sp_validar_cita: reglas que los índices no pueden expresar.
-- Se ejecuta desde los triggers de citas, así protege cualquier
-- INSERT/UPDATE, venga de la API de citas o de otro módulo.
--
--   1. Un médico inactivo no recibe citas activas nuevas.
--   2. Una cita activa nueva, reactivada o movida (otro médico, fecha
--      u hora) debe caber completa (60 minutos) en un horario ACTIVO
--      del médico ese día. No hay sobrecupos. Si solo cambia el
--      paciente de una cita que ya estaba activa no se revalida
--      (p_validar_disponibilidad = 0).
--   3. Un médico no tiene dos citas activas que se superpongan.
--   4. Un paciente no tiene dos citas activas que se superpongan,
--      aunque sean con médicos diferentes.
--
-- Concurrencia (orden de bloqueo único: fila de medicos -> horario ->
-- bloqueos_agenda médico -> bloqueos_agenda paciente -> citas):
--   0) Lee la fila del médico con FOR SHARE (estado activo vigente),
--      antes que bloqueos_agenda, igual que los servicios Node y la
--      clave foránea.
--   a) Disponibilidad: busca los
--      horarios candidatos con una lectura normal y bloquea con
--      FOR SHARE solo la fila del horario que cubre la cita, por su
--      clave primaria. Esa lectura ve la última versión confirmada y
--      deja el horario bloqueado hasta el COMMIT: nadie puede
--      recortarlo ni desactivarlo mientras se registra la cita. No
--      bloquea rangos (sin gap locks) ni retiene bloqueos_agenda
--      mientras espera, así no forma ciclos con los UPDATE/INSERT de
--      disponibilidad_medicos. Si la lectura normal está desfasada, en
--      el peor caso rechaza una cita válida; nunca acepta una fuera de
--      horario.
--   b) Solapamientos: bloquea en bloqueos_agenda la fila del médico y
--      luego la del paciente (siempre en ese orden), así las reservas
--      simultáneas del mismo médico o del mismo paciente se serializan
--      hasta el COMMIT, y lee las citas con FOR SHARE para ver lo
--      confirmado por otras transacciones (REPEATABLE READ).
-- En casos raros InnoDB puede abortar una de dos operaciones
-- simultáneas con ER_LOCK_DEADLOCK (1213); nunca se guardan citas
-- superpuestas ni fuera de horario.
--
-- Errores: los choques de horario usan SQLSTATE 23000 / errno 1062
-- (ER_DUP_ENTRY), igual que los índices únicos, para que la API
-- responda 409. El médico inactivo y la cita fuera de horario usan
-- SQLSTATE 45000.
--
-- Duración de cada cita: 60 minutos (DURACION_MINUTOS en
-- src/citas/citas.service.js). Si cambia, cambiarla en ambos sitios.
-- -------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_validar_cita;
DELIMITER $$
CREATE PROCEDURE sp_validar_cita(
  IN p_cita_id     INT,
  IN p_paciente_id INT,
  IN p_medico_id   INT,
  IN p_fecha       DATE,
  IN p_hora        TIME,
  IN p_estado      VARCHAR(20),
  IN p_validar_disponibilidad TINYINT
)
BEGIN
  DECLARE v_activo        TINYINT DEFAULT NULL;
  DECLARE v_inicio        DATETIME;
  DECLARE v_choques       INT DEFAULT 0;
  DECLARE v_horarios      INT DEFAULT 0;
  DECLARE v_horario_id    INT;
  DECLARE v_sin_filas     TINYINT DEFAULT 0;
  -- Horarios activos del médico ese día (lectura normal, sin bloqueos)
  DECLARE cur_horarios CURSOR FOR
    SELECT id FROM disponibilidad_medicos
     WHERE medico_id = p_medico_id
       AND dia_semana = WEEKDAY(p_fecha) + 1
       AND activo = 1
     ORDER BY hora_inicio;
  -- Sin filas: médico inexistente (lo rechaza la clave foránea) o fin del cursor
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_sin_filas = 1;

  IF p_estado IN ('pendiente','confirmada','reagendada') THEN
    -- Fila del médico primero (mismo orden que los servicios Node y que la
    -- clave foránea); FOR SHARE ve el estado confirmado más reciente
    SELECT activo INTO v_activo FROM medicos WHERE id = p_medico_id FOR SHARE;
    IF v_activo = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El médico está inactivo y no puede recibir nuevas citas.';
    END IF;

    -- a) Disponibilidad. v_activo NULL: el médico no existe y lo rechaza la clave foránea
    IF p_validar_disponibilidad = 1 AND v_activo IS NOT NULL THEN
      SET v_sin_filas = 0;
      OPEN cur_horarios;
      buscar: LOOP
        FETCH cur_horarios INTO v_horario_id;
        IF v_sin_filas = 1 THEN
          LEAVE buscar;
        END IF;
        -- Relee y bloquea solo esa fila por su clave primaria
        SELECT COUNT(*) INTO v_horarios
          FROM disponibilidad_medicos
         WHERE id = v_horario_id
           AND medico_id = p_medico_id
           AND dia_semana = WEEKDAY(p_fecha) + 1
           AND activo = 1
           AND hora_inicio <= p_hora
           AND ADDTIME(p_hora, '01:00:00') <= hora_fin
           FOR SHARE;
        IF v_horarios > 0 THEN
          LEAVE buscar;
        END IF;
      END LOOP;
      CLOSE cur_horarios;
      IF v_horarios = 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'La cita está fuera del horario de atención del médico.';
      END IF;
    END IF;

    -- b) Solapamientos
    INSERT INTO bloqueos_agenda (tipo, ref_id) VALUES ('medico', p_medico_id)
      ON DUPLICATE KEY UPDATE ref_id = ref_id;
    INSERT INTO bloqueos_agenda (tipo, ref_id) VALUES ('paciente', p_paciente_id)
      ON DUPLICATE KEY UPDATE ref_id = ref_id;

    SET v_inicio = TIMESTAMP(p_fecha, p_hora);

    SELECT COUNT(*) INTO v_choques
      FROM citas
     WHERE medico_id = p_medico_id
       AND fecha BETWEEN p_fecha - INTERVAL 1 DAY AND p_fecha + INTERVAL 1 DAY
       AND estado IN ('pendiente','confirmada','reagendada')
       AND id <> COALESCE(p_cita_id, 0)
       AND TIMESTAMP(fecha, hora) < v_inicio + INTERVAL 60 MINUTE
       AND v_inicio < TIMESTAMP(fecha, hora) + INTERVAL 60 MINUTE
       FOR SHARE;
    IF v_choques > 0 THEN
      SIGNAL SQLSTATE '23000'
        SET MYSQL_ERRNO = 1062,
            MESSAGE_TEXT = 'El médico ya tiene una cita activa que se superpone con ese horario.';
    END IF;

    SELECT COUNT(*) INTO v_choques
      FROM citas
     WHERE paciente_id = p_paciente_id
       AND fecha BETWEEN p_fecha - INTERVAL 1 DAY AND p_fecha + INTERVAL 1 DAY
       AND estado IN ('pendiente','confirmada','reagendada')
       AND id <> COALESCE(p_cita_id, 0)
       AND TIMESTAMP(fecha, hora) < v_inicio + INTERVAL 60 MINUTE
       AND v_inicio < TIMESTAMP(fecha, hora) + INTERVAL 60 MINUTE
       FOR SHARE;
    IF v_choques > 0 THEN
      SIGNAL SQLSTATE '23000'
        SET MYSQL_ERRNO = 1062,
            MESSAGE_TEXT = 'El paciente ya tiene una cita activa que se superpone con ese horario.';
    END IF;
  END IF;
END$$

-- -------------------------------------------------------------
-- sp_validar_disponibilidad: reglas de los horarios de atención,
-- aplicadas a cualquier INSERT/UPDATE de disponibilidad_medicos
-- (API de médicos, otro módulo o SQL directo).
--
--   1. Un horario dura al menos 60 minutos (la duración de una cita).
--      Se valida al crear y cuando cambian día u horas.
--   2. Los horarios ACTIVOS de un médico no se superponen el mismo
--      día. Los inactivos sí pueden superponerse; al activarlos o
--      editarlos se vuelve a comprobar. Un rango que termina a las
--      12:00 y otro que empieza a las 12:00 no se superponen.
--
-- Concurrencia: la comprobación de solapamientos lee los horarios con
-- FOR SHARE, así ve los ya confirmados y bloquea filas y huecos hasta
-- el COMMIT: dos cambios que se superpondrían nunca se guardan los dos.
--   - INSERT: además bloquea la fila del médico (FOR SHARE) y después
--     bloqueos_agenda('medico'), en el mismo orden que sp_validar_cita
--     y los servicios Node, para que dos altas simultáneas del mismo
--     médico se ejecuten una tras otra en lugar de interbloquearse.
--   - UPDATE: no toma bloqueos_agenda. Su fila ya está bloqueada antes
--     del trigger; tomar bloqueos_agenda después invertiría el orden y
--     provocaría interbloqueos con las altas y las reservas.
--
-- Errores: el solapamiento usa SQLSTATE 23000 / errno 1062, con el
-- mismo mensaje que src/medicos/medicos.service.js; la duración usa
-- SQLSTATE 45000.
-- -------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_validar_disponibilidad$$
CREATE PROCEDURE sp_validar_disponibilidad(
  IN p_horario_id       INT,
  IN p_medico_id        INT,
  IN p_dia              TINYINT,
  IN p_inicio           TIME,
  IN p_fin              TIME,
  IN p_activo           TINYINT,
  IN p_validar_duracion TINYINT
)
BEGIN
  DECLARE v_choque_inicio TIME DEFAULT NULL;
  DECLARE v_choque_fin    TIME DEFAULT NULL;
  DECLARE v_medico        INT DEFAULT NULL;
  DECLARE v_mensaje       VARCHAR(128);
  DECLARE CONTINUE HANDLER FOR NOT FOUND BEGIN END;

  -- Si fin <= inicio lo rechaza chk_disponibilidad_rango
  IF p_validar_duracion = 1 AND p_fin > p_inicio
     AND TIME_TO_SEC(TIMEDIFF(p_fin, p_inicio)) < 60 * 60 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El horario debe durar al menos 60 minutos (la duración de una cita).';
  END IF;

  IF p_activo = 1 THEN
    IF p_horario_id IS NULL THEN
      SELECT id INTO v_medico FROM medicos WHERE id = p_medico_id FOR SHARE;
      INSERT INTO bloqueos_agenda (tipo, ref_id) VALUES ('medico', p_medico_id)
        ON DUPLICATE KEY UPDATE ref_id = ref_id;
    END IF;

    SELECT hora_inicio, hora_fin INTO v_choque_inicio, v_choque_fin
      FROM disponibilidad_medicos
     WHERE medico_id = p_medico_id
       AND dia_semana = p_dia
       AND activo = 1
       AND id <> COALESCE(p_horario_id, 0)
       AND hora_inicio < p_fin
       AND p_inicio < hora_fin
     ORDER BY hora_inicio
     LIMIT 1
       FOR SHARE;

    IF v_choque_inicio IS NOT NULL THEN
      SET v_mensaje = CONCAT('El horario se superpone con otro horario activo del ',
        ELT(p_dia, 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'),
        ' (', TIME_FORMAT(v_choque_inicio, '%H:%i'), '–', TIME_FORMAT(v_choque_fin, '%H:%i'), ').');
      SIGNAL SQLSTATE '23000' SET MYSQL_ERRNO = 1062, MESSAGE_TEXT = v_mensaje;
    END IF;
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_disponibilidad_validar_insert$$
CREATE TRIGGER trg_disponibilidad_validar_insert
BEFORE INSERT ON disponibilidad_medicos
FOR EACH ROW
BEGIN
  CALL sp_validar_disponibilidad(NULL, NEW.medico_id, NEW.dia_semana, NEW.hora_inicio, NEW.hora_fin, NEW.activo, 1);
END$$

-- Al actualizar se valida si cambian médico, día u horas (duración y
-- solapamiento) o si el horario pasa de inactivo a activo (solapamiento).
DROP TRIGGER IF EXISTS trg_disponibilidad_validar_update$$
CREATE TRIGGER trg_disponibilidad_validar_update
BEFORE UPDATE ON disponibilidad_medicos
FOR EACH ROW
BEGIN
  DECLARE v_cambia_rango TINYINT DEFAULT 0;
  SET v_cambia_rango = (NEW.medico_id <> OLD.medico_id OR NEW.dia_semana <> OLD.dia_semana
                        OR NEW.hora_inicio <> OLD.hora_inicio OR NEW.hora_fin <> OLD.hora_fin);
  IF v_cambia_rango = 1 OR (NEW.activo = 1 AND OLD.activo <> 1) THEN
    CALL sp_validar_disponibilidad(OLD.id, NEW.medico_id, NEW.dia_semana, NEW.hora_inicio, NEW.hora_fin,
                                   NEW.activo, v_cambia_rango);
  END IF;
END$$

DROP TRIGGER IF EXISTS trg_citas_validar_insert$$
CREATE TRIGGER trg_citas_validar_insert
BEFORE INSERT ON citas
FOR EACH ROW
BEGIN
  CALL sp_validar_cita(NULL, NEW.paciente_id, NEW.medico_id, NEW.fecha, NEW.hora, NEW.estado, 1);
END$$

-- Al actualizar solo se valida si la cita pasa a ocupar un horario
-- nuevo: se reactiva o cambia de médico, paciente, fecha u hora.
-- Confirmar, cancelar, atender o editar el motivo no revalida.
-- La disponibilidad se revalida al reactivar o al cambiar médico,
-- fecha u hora; si solo cambia el paciente de una cita que ya estaba
-- activa se validan únicamente los choques del nuevo paciente.
DROP TRIGGER IF EXISTS trg_citas_validar_update$$
CREATE TRIGGER trg_citas_validar_update
BEFORE UPDATE ON citas
FOR EACH ROW
BEGIN
  DECLARE v_ocupa_horario_nuevo TINYINT DEFAULT 0;
  SET v_ocupa_horario_nuevo = (OLD.estado NOT IN ('pendiente','confirmada','reagendada')
                               OR NEW.medico_id <> OLD.medico_id
                               OR NEW.fecha <> OLD.fecha
                               OR NEW.hora <> OLD.hora);
  IF NEW.estado IN ('pendiente','confirmada','reagendada')
     AND (v_ocupa_horario_nuevo = 1 OR NEW.paciente_id <> OLD.paciente_id) THEN
    CALL sp_validar_cita(OLD.id, NEW.paciente_id, NEW.medico_id, NEW.fecha, NEW.hora, NEW.estado,
                         v_ocupa_horario_nuevo);
  END IF;
END$$
DELIMITER ;

-- -------------------------------------------------------------
-- v_citas_por_revisar: citas futuras activas que Recepción debe
-- revisar porque su médico está inactivo o porque un cambio de
-- horario confirmado las dejó fuera de la disponibilidad. Las citas
-- no se modifican automáticamente: siguen activas hasta que alguien
-- las confirme, las reagende dentro del horario o las cancele.
-- "Futuras" según la hora del servidor MySQL (NOW()).
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_citas_por_revisar AS
SELECT r.cita_id, r.medico_id, r.medico, r.paciente_id, r.paciente,
       r.fecha, r.hora, r.estado, r.medico_inactivo, r.fuera_de_disponibilidad,
       CONCAT_WS(' y ',
         IF(r.medico_inactivo = 1, 'Médico inactivo', NULL),
         IF(r.fuera_de_disponibilidad = 1, 'Fuera del horario de atención', NULL)) AS motivo_revision
  FROM (
    SELECT c.id AS cita_id, c.medico_id, m.nombre AS medico, c.paciente_id, p.nombre AS paciente,
           c.fecha, TIME_FORMAT(c.hora, '%H:%i') AS hora, c.estado,
           IF(m.activo = 0, 1, 0) AS medico_inactivo,
           IF(EXISTS (
                SELECT 1 FROM disponibilidad_medicos d
                 WHERE d.medico_id = c.medico_id
                   AND d.dia_semana = WEEKDAY(c.fecha) + 1
                   AND d.activo = 1
                   AND d.hora_inicio <= c.hora
                   AND ADDTIME(c.hora, '01:00:00') <= d.hora_fin), 0, 1) AS fuera_de_disponibilidad
      FROM citas c
      JOIN medicos m ON m.id = c.medico_id
      JOIN pacientes p ON p.id = c.paciente_id
     WHERE c.horario_activo = 1
       AND TIMESTAMP(c.fecha, c.hora) >= NOW()
  ) AS r
 WHERE r.medico_inactivo = 1 OR r.fuera_de_disponibilidad = 1;
