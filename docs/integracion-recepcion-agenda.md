# Guía de integración para Recepción y Agenda (Integrantes 4 y 5)

Reglas de disponibilidad y de citas que ya aplican la base de datos, Solicitud de Citas y
Gestión de Médicos, y cómo deben respetarlas los módulos de Recepción y Agenda. Detalle del
esquema en [base-de-datos.md](base-de-datos.md).

## 1. Cómo consultar la disponibilidad

**Recomendado:** reutilizar las APIs existentes en lugar de repetir la lógica.

| Necesidad | API |
| --- | --- |
| Médicos que pueden recibir citas (activos y con horario activo) | `GET /api/citas/medicos` |
| Horas libres de un médico en una fecha | `GET /api/citas/horarios?medico_id=&fecha=AAAA-MM-DD` |
| Horarios semanales de un médico (activos e inactivos) | `GET /api/medicos/:id/horarios` |
| Citas futuras activas de un médico | `GET /api/medicos/:id/citas-futuras` |
| Citas que Recepción debe revisar | `GET /api/medicos/:id/citas-por-revisar` o la vista `v_citas_por_revisar` |

Si se consulta MySQL directamente, la disponibilidad es:

- Solo médicos con `medicos.activo = 1`.
- Solo rangos de `disponibilidad_medicos` con `activo = 1` y `dia_semana = WEEKDAY(fecha) + 1`
  (lunes = 1 … domingo = 7).
- Cada rango se divide en citas de **60 minutos** contadas desde `hora_inicio`
  (08:00–12:00 → 08:00, 09:00, 10:00, 11:00). Un sobrante menor de 60 minutos no genera cita.
- Se descartan las horas que se superponen con citas **activas** del médico
  (`horario_activo = 1`, es decir `pendiente`, `confirmada` o `reagendada`).
- No se ofrecen fechas u horas pasadas (hora local del servidor).

## 2. Validaciones al crear o reagendar una cita

| Validación | ¿La garantiza MySQL? | Qué debe hacer el módulo |
| --- | --- | --- |
| Paciente y médico existen | Sí (claves foráneas) | Responder 404 con mensaje claro antes de insertar |
| Motivo de 3 a 255 caracteres | Sí (`chk_cita_motivo`) | Validar en el formulario y en el servidor |
| El médico está activo | Sí, para citas nuevas, reactivadas o movidas (trigger) | No ofrecer médicos inactivos |
| La cita cabe completa (60 min) en un horario **activo** del médico | Sí, para citas nuevas, reactivadas o movidas (trigger) | Ofrecer solo horas disponibles |
| El médico no tiene otra cita activa que se superponga | Sí (índice único + trigger) | Mostrar el 409 |
| El paciente no tiene otra cita activa que se superponga, aunque sea con otro médico | Sí (índice único + trigger) | Mostrar el 409 |
| Fecha y hora futuras | **No** | Validar en el servidor |
| La hora coincide con un bloque de 60 minutos del horario (08:00, 09:00…; no 08:30) | **No** | Validar en el servidor |

No hay sobrecupos: MySQL rechaza cualquier cita activa nueva o movida fuera del horario
(«La cita está fuera del horario de atención del médico.»).

**Crear citas:** usar `POST /api/citas`, que ya aplica todas las validaciones.

**Reagendar** (cambiar fecha, hora o médico de una cita existente) dentro de una transacción:

```sql
START TRANSACTION;
-- 1. Bloquear al médico de destino (el mismo cerrojo que usan Solicitud de Citas y Médicos).
--    Si se cambia de médico, bloquear ambos en orden ascendente de id.
SELECT id, activo FROM medicos WHERE id = ? FOR UPDATE;
-- 2. Comprobar en el servidor: fecha/hora futura y hora alineada a un bloque de 60 minutos.
-- 3. Mover la cita. Los triggers rechazan médico inactivo, hora fuera de horario y choques
--    de médico o paciente.
UPDATE citas SET medico_id = ?, fecha = ?, hora = ?, estado = 'reagendada' WHERE id = ?;
COMMIT;
```

Qué revalida MySQL en un `UPDATE` de `citas`:

| Cambio | Disponibilidad | Choques de médico y paciente |
| --- | --- | --- |
| Solo estado activo → activo (confirmar) o motivo | No | No |
| Cancelar o atender | No | No |
| Reactivar una cita cancelada o atendida | Sí | Sí |
| Cambiar médico, fecha u hora | Sí | Sí |
| Cambiar solo el paciente de una cita activa | No | Sí (del nuevo paciente) |
| Cambiar el paciente y reactivar a la vez | Sí | Sí |

## 3. Cómo se evitan las citas duplicadas

Tres capas, todas activas a la vez:

1. **Índices únicos** con la columna generada `horario_activo` (1 si la cita ocupa horario,
   NULL si está cancelada o atendida): no puede haber dos citas activas con la misma hora de
   inicio para un médico ni para un paciente. Una cita cancelada libera el horario.
2. **Triggers** (`sp_validar_cita`): rechazan solapamientos parciales (10:00 y 10:30) del
   médico y del paciente, también entre días (23:30 y 00:00), y serializan las reservas
   simultáneas del mismo médico o paciente.
3. **Servicio de Solicitud de Citas**: bloquea la fila del médico, revisa la disponibilidad y
   los solapamientos antes de insertar, y reintenta ante interbloqueos.

No hace falta (ni conviene) repetir las comprobaciones de solapamiento: basta con capturar el
error de MySQL y mostrar su mensaje.

## 4. Médicos inactivos

- No aparecen en `GET /api/citas/medicos` y `GET /api/citas/horarios` les devuelve
  `horarios: []`. Recepción y Agenda **no deben ofrecerlos** para citas nuevas.
- MySQL rechaza crear una cita activa para un médico inactivo o mover una cita existente a otra
  fecha u hora de ese médico (error 1644, «El médico está inactivo y no puede recibir nuevas
  citas.»).
- Sus **citas existentes se conservan** y siguen activas: desactivar un médico no las cancela
  ni reasigna. Aparecen en `v_citas_por_revisar` con motivo «Médico inactivo». Recepción debe
  confirmarlas, cancelarlas o **reagendarlas con otro médico activo** dentro de su horario.
- Confirmar, cancelar o marcar como atendida una cita de un médico inactivo está permitido.

## 5. Qué pasa si un horario cambia mientras se registra una cita

La base de datos coordina ambas operaciones para **cualquier** módulo, incluso con SQL directo:

- Al registrar o mover una cita, el trigger relee el horario que la cubre con la última versión
  confirmada y lo bloquea hasta el `COMMIT`.
- Si el horario se recorta o desactiva **antes**, la cita se rechaza (la API responde 400
  «El horario no corresponde a la disponibilidad del médico.»).
- Si la cita se registra **antes**, el cambio de horario espera a que termine. Con la API de
  médicos, el cambio detecta la cita y pide confirmación; si se confirma (o si se hizo por
  SQL directo), la cita queda activa y aparece en `v_citas_por_revisar` con motivo «Fuera del
  horario de atención».

Nunca se guarda una cita nueva fuera de horario. Esto se comprobó con una reproducción de la
condición de carrera original y con 120 rondas concurrentes aleatorias (0 citas fuera de
horario, 0 interbloqueos).

Orden de bloqueo que siguen todas las operaciones (y que debe seguir cualquier transacción
manual): fila de `medicos` → fila del horario → `bloqueos_agenda` (médico, luego paciente) →
`citas`. Las transacciones que crean o mueven citas deben empezar con
`SELECT ... FROM medicos WHERE id = ? FOR UPDATE`.

### Citas por revisar

Un cambio de horario confirmado en la API de médicos, o desactivar un médico, puede dejar citas
activas fuera de la disponibilidad **a propósito**: nunca se cancelan, eliminan ni reasignan
automáticamente. Recepción las encuentra en:

```sql
SELECT cita_id, fecha, hora, estado, paciente, medico, motivo_revision
  FROM v_citas_por_revisar
 ORDER BY fecha, hora;
```

o en `GET /api/medicos/:id/citas-por-revisar`, que responde
`[{ id, fecha, hora, estado, paciente, medico_inactivo, fuera_de_disponibilidad, motivo_revision }]`.
La ficha del médico (`/medicos/detalle.html`) las muestra en la tarjeta «Citas por revisar».
Una cita sale de la lista al cancelarla, atenderla, reagendarla dentro del horario, reactivar
al médico o restaurar el horario.

## 6. Códigos de error que deben manejar

### APIs existentes

| HTTP | Significado | Qué mostrar |
| --- | --- | --- |
| 400 | Datos inválidos (`{ errores: [...] }`) o regla de negocio (`{ error }`), incluida la hora fuera de la disponibilidad | Los mensajes tal cual |
| 404 | Paciente, médico, horario o cita inexistente | El mensaje |
| 409 | Choque de horario del médico o del paciente, médico inactivo, horario superpuesto o cambio que requiere confirmación (`requiere_confirmacion: true`) | El mensaje; si pide confirmación, mostrar `citas_afectadas` y repetir con `confirmar: true` y `citas_confirmadas` |
| 503 | Interbloqueo de MySQL tras 3 intentos | «El sistema está ocupado. Intenta nuevamente en unos momentos» y permitir reintentar |
| 500 | Error inesperado | Mensaje genérico; revisar el registro del servidor |

### MySQL directo

| Código (`error.code` en mysql2) | errno / SQLSTATE | Caso | HTTP sugerido |
| --- | --- | --- | --- |
| `ER_DUP_ENTRY` | 1062 / 23000 | Choque de médico o paciente (mensaje del trigger o índice `uq_cita_*`), horario superpuesto, colegiado o correo repetido | 409 |
| `ER_SIGNAL_EXCEPTION` | 1644 / 45000 | «El médico está inactivo…» | 409 |
| `ER_SIGNAL_EXCEPTION` | 1644 / 45000 | «La cita está fuera del horario de atención del médico.» | 400 |
| `ER_SIGNAL_EXCEPTION` | 1644 / 45000 | Horario de atención de menos de 60 minutos | 400 |
| `ER_CHECK_CONSTRAINT_VIOLATED` | 3819 | Motivo, día u horas fuera de rango | 400 |
| `ER_NO_REFERENCED_ROW_2` | 1452 | Paciente o médico inexistente | 404 |
| `ER_ROW_IS_REFERENCED_2` | 1451 | Borrar un paciente o médico con citas (no se debe borrar: desactivar) | 409 |
| `ER_LOCK_DEADLOCK` | 1213 | Interbloqueo: InnoDB revirtió la transacción completa | Repetir la transacción desde el inicio (máx. 3) y luego 503 |
| `ER_LOCK_WAIT_TIMEOUT` | 1205 | Espera de bloqueo agotada | 503 o 500 |

Distinguir el conflicto del paciente del conflicto del médico: el mensaje empieza por
«El paciente ya tiene…» o menciona el índice `uq_cita_paciente_horario_activo`.

## 7. Lista de comprobación

- [ ] Las citas nuevas se crean con `POST /api/citas` o siguiendo el punto 2.
- [ ] Las transacciones que crean o mueven citas bloquean primero la fila del médico.
- [ ] Solo se ofrecen médicos activos y horas alineadas dentro de sus horarios activos.
- [ ] Los horarios se cambian con la API de médicos (pide confirmación si afecta citas).
- [ ] Se manejan 400, 409 y 503 con mensajes en español, y se reintenta ante 1213.
- [ ] Nunca se borran médicos, pacientes ni horarios: se desactivan.
- [ ] Recepción revisa periódicamente `v_citas_por_revisar`.
