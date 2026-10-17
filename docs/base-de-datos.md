# Base de datos `sistema_citas`

MySQL 8.4, motor InnoDB, `utf8mb4` / `utf8mb4_spanish_ci`.

## Cómo crearla desde cero

Ejecuta los scripts de `database/` en este orden (MySQL Workbench: abrir y ejecutar con ⚡,
o desde la terminal con `mysql -u root -p < database/01_esquema.sql`, etc.):

| Orden | Script | Crea | Depende de |
| --- | --- | --- | --- |
| 1 | `01_esquema.sql` | Base de datos y `medicos` | — |
| 2 | `02_pacientes.sql` | `pacientes` | — |
| 3 | `03_citas_disponibilidad.sql` | `disponibilidad_medicos`, `citas`, `bloqueos_agenda`, `sp_validar_cita`, `sp_validar_disponibilidad`, sus triggers y la vista `v_citas_por_revisar` | `medicos`, `pacientes` |
| 4 | `04_datos_prueba.sql` | Datos de prueba (opcional, no usar en producción) | 1–3 |
| — | `verificar_esquema.sql` | Nada: consultas de comprobación de solo lectura | 1–3 |

Todos los scripts se pueden volver a ejecutar: las tablas usan `IF NOT EXISTS`, el
procedimiento y los triggers se recrean, y `04_datos_prueba.sql` solo agrega lo que falta.
Ningún script borra tablas ni datos.

`database/prueba_historial.sql` está **obsoleto**: creaba versiones mínimas de `medicos` y
`citas` antes de que existiera el esquema definitivo. No lo ejecutes. Si ya lo ejecutaste en tu
base local, `01_esquema.sql` se detiene con un mensaje y hay que migrar esas tablas (o, si
solo tienen datos de prueba, borrar la base local y crearla de nuevo con los scripts).

## Tablas

```
medicos 1───* disponibilidad_medicos
   1
   │
   *
 citas *───1 pacientes
```

### `medicos`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | INT PK | |
| `nombre` | VARCHAR(120) | Obligatorio, mínimo 3 caracteres |
| `especialidad` | VARCHAR(80) | Obligatorio |
| `colegiado` | VARCHAR(20) | Obligatorio y único |
| `telefono` | VARCHAR(20) | Opcional |
| `email` | VARCHAR(120) | Opcional y único |
| `activo` | TINYINT(1) | 1 = activo (por defecto), 0 = inactivo |
| `creado_en`, `actualizado_en` | TIMESTAMP | Automáticos |

Un médico inactivo conserva sus citas e historial, pero **no puede recibir citas nuevas**.

### `pacientes`

Sin cambios respecto al módulo de pacientes: `id, nombre, edad, telefono, email (único),
alergias, creado_en, actualizado_en`.

### `disponibilidad_medicos`

Horario semanal: `medico_id, dia_semana` (ISO, lunes=1 … domingo=7), `hora_inicio, hora_fin,
activo`. Cada rango genera citas de 60 minutos. Se borra en cascada con el médico.
Reglas (triggers, ver [Reglas de los horarios](#reglas-de-los-horarios-de-atención)): al menos
60 minutos y sin solapamientos entre horarios activos del mismo médico y día.

### `citas`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | INT PK | |
| `paciente_id` | INT FK → `pacientes` | No se puede borrar un paciente con citas |
| `medico_id` | INT FK → `medicos` | No se puede borrar un médico con citas |
| `fecha` | DATE | |
| `hora` | TIME | Hora de inicio; cada cita dura 60 minutos |
| `motivo` | VARCHAR(255) | Obligatorio, de 3 a 255 caracteres |
| `estado` | ENUM | `pendiente` (por defecto), `confirmada`, `reagendada`, `cancelada`, `atendida` |
| `horario_activo` | generada | 1 si el estado ocupa horario, NULL si está `cancelada` o `atendida`. No se escribe |
| `creado_en`, `actualizado_en` | TIMESTAMP | Automáticos |

Estados **activos** (ocupan horario): `pendiente`, `confirmada`, `reagendada`.

### `bloqueos_agenda`

Tabla interna de cerrojos (`tipo` = `medico`/`paciente`, `ref_id`). La usan solo
`sp_validar_cita` y `sp_validar_disponibilidad`; la aplicación no debe leerla ni escribirla.

## Reglas de integridad de las citas

| Regla | Dónde se aplica |
| --- | --- |
| Un médico no tiene dos citas activas con la misma hora de inicio | Índice único `uq_cita_medico_horario_activo` y trigger |
| Un paciente no tiene dos citas activas con la misma hora de inicio | Índice único `uq_cita_paciente_horario_activo` y trigger |
| Un médico no tiene dos citas activas que se superpongan parcialmente (p. ej. 10:00 y 10:30) | Trigger (`sp_validar_cita`) y validación transaccional de `citas.service.js` |
| Un paciente no tiene dos citas activas que se superpongan, aunque sean con médicos diferentes | Trigger (`sp_validar_cita`) |
| Un médico inactivo no recibe citas activas nuevas | Trigger (`sp_validar_cita`) |
| Una cita activa nueva, reactivada o movida (otro médico, fecha u hora) cabe completa (60 minutos) en un horario **activo** del médico ese día; no hay sobrecupos | Trigger (`sp_validar_cita`) y validación transaccional de `citas.service.js` |
| Una cita cancelada o atendida libera el horario | `horario_activo` = NULL |

Los triggers `trg_citas_validar_insert` y `trg_citas_validar_update` llaman a
`sp_validar_cita` en cada `INSERT` y en cada `UPDATE` que haga que una cita ocupe un horario
nuevo (reactivarla o cambiar médico, paciente, fecha u hora). Confirmar, cancelar, atender o
cambiar el motivo no revalida. Las reglas protegen cualquier escritura en `citas`, venga de la
API de Solicitud de Citas o de otro módulo (recepción, agenda).

Registrar una cita ya `atendida` o `cancelada` (historial) no se valida: no ocupa horario.
Si solo cambia el paciente de una cita que ya estaba activa (mismo médico, fecha y hora), se
validan los choques del nuevo paciente pero no la disponibilidad; si además se reactiva, se
valida todo.

Una cita activa puede quedar fuera de la disponibilidad **después** de registrada, si se
confirma un recorte o una desactivación de horario en la API de médicos, o si se desactiva el
médico. No se modifica: aparece en la vista `v_citas_por_revisar` (ver abajo) hasta que
Recepción la confirme, la reagende dentro del horario o la cancele.

### Concurrencia

Todas las escrituras siguen el mismo orden de bloqueo, así no forman ciclos:

1. Fila de `medicos` (`FOR UPDATE` en los servicios Node; `FOR SHARE` en los triggers y en la
   clave foránea).
2. Fila del horario que cubre la cita (`FOR SHARE` por clave primaria, sin bloquear rangos).
3. `bloqueos_agenda('medico')`.
4. `bloqueos_agenda('paciente')`.
5. Lecturas `FOR SHARE` de `citas` (solapamientos).

Por eso dos reservas simultáneas del mismo médico, o del mismo paciente con médicos
diferentes, se ejecutan una después de otra: la segunda ve la cita de la primera y se rechaza.
Y un horario no puede recortarse ni desactivarse mientras se registra una cita que lo usa:
o la cita se registra primero (y queda «por revisar» tras el cambio) o el cambio se aplica
primero (y la cita se rechaza). Nunca se guarda una cita nueva fuera de horario. InnoDB puede
abortar alguna operación simultánea con `ER_LOCK_DEADLOCK` (1213) en casos excepcionales; las
APIs la reintentan y nunca se guardan datos inconsistentes.

### Errores que devuelve MySQL

| Caso | Código | Mensaje |
| --- | --- | --- |
| Choque de horario del médico | `ER_DUP_ENTRY` (1062, SQLSTATE 23000) | El médico ya tiene una cita activa que se superpone con ese horario. |
| Choque de horario del paciente | `ER_DUP_ENTRY` (1062, SQLSTATE 23000) | El paciente ya tiene una cita activa que se superpone con ese horario. |
| Médico inactivo | `ER_SIGNAL_EXCEPTION` (1644, SQLSTATE 45000) | El médico está inactivo y no puede recibir nuevas citas. |
| Cita fuera del horario de atención | `ER_SIGNAL_EXCEPTION` (1644, SQLSTATE 45000) | La cita está fuera del horario de atención del médico. |
| Horario de atención superpuesto | `ER_DUP_ENTRY` (1062, SQLSTATE 23000) | El horario se superpone con otro horario activo del lunes (08:00–12:00). |
| Horario de atención de menos de 60 minutos | `ER_SIGNAL_EXCEPTION` (1644, SQLSTATE 45000) | El horario debe durar al menos 60 minutos (la duración de una cita). |

Los choques usan el mismo código que un índice único duplicado para que las APIs sigan
respondiendo `409`.

## Reglas de los horarios de atención

| Regla | Dónde se aplica |
| --- | --- |
| Un horario dura al menos 60 minutos | Trigger (`sp_validar_disponibilidad`) y validación de la API de médicos |
| La hora de fin es posterior a la de inicio | `chk_disponibilidad_rango` |
| Los horarios **activos** de un médico no se superponen el mismo día | Trigger (`sp_validar_disponibilidad`) y validación transaccional de `medicos.service.js` |
| Los horarios inactivos sí pueden superponerse | — |
| Un médico no tiene dos horarios que empiecen el mismo día a la misma hora (aunque uno esté inactivo) | Índice único `uq_disponibilidad_inicio` |

Los triggers `trg_disponibilidad_validar_insert` y `trg_disponibilidad_validar_update`
validan cada `INSERT` y cada `UPDATE` que cambie médico, día u horas (duración y
solapamiento) o que active un horario inactivo (solapamiento). Desactivar un horario no se
valida. Un rango que termina a las 12:00 y otro que empieza a las 12:00 no se superponen.

Concurrencia: `sp_validar_disponibilidad` lee los horarios del día con `FOR SHARE`. En un
`INSERT` además bloquea, en este orden, la fila del médico y `bloqueos_agenda('medico')`, para
que dos altas simultáneas se ejecuten una tras otra; un `UPDATE` no toma `bloqueos_agenda`
porque su fila ya está bloqueada antes del trigger y tomarlo después invertiría el orden. Dos
horarios superpuestos enviados al mismo tiempo, por la API o por SQL directo, nunca se guardan
los dos.

Las reglas de la base de datos **no** impiden que un cambio de horario deje citas existentes
fuera de la disponibilidad: es una decisión del negocio (la API de médicos pide confirmación y
no modifica las citas). Esas citas aparecen en `v_citas_por_revisar`. Ver
[integracion-recepcion-agenda.md](integracion-recepcion-agenda.md).

## Vista `v_citas_por_revisar`

Citas futuras activas (`pendiente`, `confirmada`, `reagendada`; fecha y hora a partir de
`NOW()`) que Recepción debe revisar. No agrega estados ni modifica citas.

| Columna | Contenido |
| --- | --- |
| `cita_id`, `medico_id`, `medico`, `paciente_id`, `paciente` | Identificación |
| `fecha`, `hora` (`HH:MM`), `estado` | Datos de la cita |
| `medico_inactivo` | 1 si el médico está inactivo |
| `fuera_de_disponibilidad` | 1 si ningún horario activo del médico contiene los 60 minutos de la cita |
| `motivo_revision` | `Médico inactivo`, `Fuera del horario de atención` o ambos unidos con «y» |

Una cita sale de la vista cuando deja de cumplir la condición: se cancela, se atiende, se
reagenda dentro del horario, se reactiva al médico o se restaura el horario. La API la expone en
`GET /api/medicos/:id/citas-por-revisar` y la ficha del médico la muestra en la tarjeta «Citas
por revisar».

La duración de 60 minutos está en `sp_validar_cita` y en `DURACION_MINUTOS` de
`src/citas/citas.service.js`; si cambia, hay que cambiarla en ambos sitios.

## Datos de prueba

`04_datos_prueba.sql` relaciona los registros por claves naturales, no por ids:
médicos por `colegiado`, pacientes por `email` (o nombre + teléfono si no tienen correo).

| Médico | Colegiado | Horario |
| --- | --- | --- |
| Dr. Carlos Méndez, Medicina general | 10001 | Lunes a viernes 08:00–12:00 |
| Dra. Ana Ruiz, Pediatría | 10002 | Martes y jueves 08:00–13:00 |
| Dr. Luis Castillo, Cardiología | 10003 | Lunes a viernes 09:00–13:00 |
| Dra. Sofía Morales, Dermatología (**inactiva**) | 10004 | Sin horario |

Pacientes: María Fernanda López, José Antonio Pérez y Lucía Hernández (sin correo), con
cinco citas en todos los estados para probar el historial.

## Comprobación

Ejecuta `database/verificar_esquema.sql`. Debe mostrar 5 tablas InnoDB y la vista
`v_citas_por_revisar`, 3 claves foráneas, 7 restricciones CHECK, los 2 procedimientos, los 4
triggers, 13 columnas de contrato y 0 en las consultas de solapamientos de citas y de horarios.
Las citas por revisar se informan aparte: pueden existir legítimamente.
