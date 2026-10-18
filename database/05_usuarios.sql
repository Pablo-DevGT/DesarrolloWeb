-- =============================================================
-- Sistema de Citas - Usuarios, login y roles (Integrante 5)
-- Ejecutar DESPUÉS de 01_esquema.sql (usuarios referencia a medicos).
-- Se puede volver a ejecutar sin borrar datos.
--
-- Roles:
--   admin   recepcionista: administra pacientes, médicos y citas
--   doctor  ligado a un médico (medico_id): solo ve su agenda
-- La contraseña se guarda como hash scrypt (src/auth/contrasenas.js),
-- nunca en texto plano. Para crear usuarios:
--   npm run crear-usuario -- --usuario dr.perez --nombre "Dr. Pérez" --rol doctor --medico 5
-- o POST /api/auth/usuarios como admin. Usuarios de prueba: 06_usuarios_prueba.sql.
-- =============================================================

CREATE DATABASE IF NOT EXISTS sistema_citas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE sistema_citas;

CREATE TABLE IF NOT EXISTS usuarios (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  usuario         VARCHAR(60)  NOT NULL,          -- nombre de inicio de sesión, en minúsculas
  nombre          VARCHAR(120) NOT NULL,          -- nombre para mostrar
  contrasena_hash VARCHAR(255) NOT NULL,          -- 'scrypt$<sal>$<hash>'
  rol             ENUM('admin','doctor') NOT NULL,
  medico_id       INT NULL,                       -- obligatorio si rol = doctor
  activo          TINYINT(1)   NOT NULL DEFAULT 1, -- 0 = no puede iniciar sesión
  creado_en       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_medico
    FOREIGN KEY (medico_id) REFERENCES medicos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_usuario_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) >= 3),
  CONSTRAINT chk_usuario_usuario CHECK (CHAR_LENGTH(TRIM(usuario)) >= 3),
  CONSTRAINT chk_usuario_activo CHECK (activo IN (0, 1)),
  -- Un doctor siempre tiene médico; un admin nunca
  CONSTRAINT chk_usuario_rol_medico CHECK (
    (rol = 'doctor' AND medico_id IS NOT NULL) OR (rol = 'admin' AND medico_id IS NULL)
  ),
  UNIQUE KEY uq_usuario_usuario (usuario),
  UNIQUE KEY uq_usuario_medico (medico_id)       -- un solo usuario por médico
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci;
