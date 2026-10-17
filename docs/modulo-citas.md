# Solicitud de citas médicas

## Integración requerida

El esquema definitivo está descrito en [base-de-datos.md](base-de-datos.md). El
módulo usa estas columnas:

- `medicos(id, nombre, especialidad)` (`01_esquema.sql`)
- `citas(id, paciente_id, medico_id, fecha, hora, motivo, estado)` (`03_citas_disponibilidad.sql`)
- `pacientes(id)` (`02_pacientes.sql`)

La disponibilidad semanal pertenece a este módulo en `disponibilidad_medicos`. Sus días usan ISO (lunes=1 a domingo=7)
y cada rango genera citas consecutivas de 60 minutos desde `hora_inicio` hasta
antes de `hora_fin`. No hay excepciones por feriados ni disponibilidad por fecha.

## Preparación de MySQL

1. Ejecuta en orden `database/01_esquema.sql`, `database/02_pacientes.sql` y
   `database/03_citas_disponibilidad.sql` (ver [base-de-datos.md](base-de-datos.md)).
2. Opcional: `database/04_datos_prueba.sql` carga médicos, pacientes, horarios
   y citas de prueba, y se puede ejecutar varias veces.
3. Registra al menos un rango semanal por médico. Ejemplo (lunes a viernes,
   09:00–17:00; cada cita dura una hora):

```sql
INSERT INTO disponibilidad_medicos
  (medico_id, dia_semana, hora_inicio, hora_fin)
VALUES
  (1, 1, '09:00:00', '17:00:00'),
  (1, 2, '09:00:00', '17:00:00'),
  (1, 3, '09:00:00', '17:00:00'),
  (1, 4, '09:00:00', '17:00:00'),
  (1, 5, '09:00:00', '17:00:00');
```

Los índices únicos de `citas` incluyen la columna generada `horario_activo`
(NULL en citas canceladas o atendidas), así que una hora cancelada se puede
reservar de nuevo.

## API

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/api/citas/medicos` | Médicos activos con al menos un horario activo |
| `GET` | `/api/citas/horarios?medico_id=1&fecha=AAAA-MM-DD` | Horarios libres en bloques de 60 minutos (lista vacía si el médico está inactivo) |
| `POST` | `/api/citas` | Crea una cita `pendiente` (201) |
| `GET` | `/api/citas/:id` | Solicitud creada con datos de paciente y médico |

Cuerpo para `POST /api/citas`:

```json
{
  "paciente_id": 1,
  "medico_id": 1,
  "fecha": "2030-01-07",
  "hora": "09:00",
  "motivo": "Consulta general"
}
```

Las respuestas JSON de error usan `{ "error": "..." }` o `{ "errores": ["..."] }`
para validaciones:

| Código | Cuándo | Mensaje |
| --- | --- | --- |
| `400` | Datos inválidos, fecha pasada u hora fuera de la disponibilidad (también si el horario cambió mientras se registraba la cita y MySQL la rechaza) | Según el caso; fuera de horario: `El horario no corresponde a la disponibilidad del médico.` |
| `404` | Paciente o médico inexistente | `Paciente no encontrado.` / `Médico no encontrado.` |
| `409` | El médico ya tiene una cita que se superpone | `El horario ya está ocupado. Selecciona otro horario.` |
| `409` | El paciente ya tiene una cita activa que se superpone, aunque sea con otro médico | `El paciente ya tiene una cita activa que se superpone con ese horario.` |
| `409` | El médico está inactivo | `El médico seleccionado no está disponible para nuevas citas.` |
| `503` | Interbloqueo de MySQL (1213) en los 3 intentos | `El sistema está ocupado. Intenta nuevamente en unos momentos` |
| `500` | Error inesperado de base de datos (se registra en el servidor) | `Ocurrió un error en el servidor.` |

Ante un interbloqueo (1213), InnoDB revierte la transacción completa y el
servicio la repite desde el principio, con todas sus validaciones, hasta 3 veces
con una espera corta. Un interbloqueo nunca se informa como horario ocupado.

## No doble cita y cancelaciones

Al registrar, MySQL bloquea la fila del médico con `SELECT ... FOR UPDATE` hasta
que se confirme o revierta la transacción. Así, dos solicitudes simultáneas
atendidas por este endpoint para el mismo médico se serializan. Después del
bloqueo se comprueba disponibilidad y se buscan intervalos solapados en estado
`pendiente`, `confirmada` o `reagendada`; las citas de otros médicos no se
afectan. Si el médico está inactivo se responde `409` antes de registrar nada.
Un choque detectado por la base de datos (índice único o trigger) también se
devuelve como `409`, distinguiendo si el conflicto es del médico o del paciente.
El módulo de médicos (`docs/modulo-medicos.md`) usa el mismo bloqueo al cambiar
horarios o desactivar médicos.

`cancelada` no bloquea y libera el horario. La API de este módulo no cambia el
estado de una cita; cuando recepción/agenda cancele una, debe guardar
`estado='cancelada'` en `citas`.

Además, la base de datos aplica las reglas a cualquier escritura en `citas`,
incluidas las de otros módulos: triggers que rechazan solapamientos del médico,
solapamientos del mismo paciente con médicos diferentes, citas nuevas para
médicos inactivos y citas nuevas o reagendadas fuera de un horario activo del
médico, con un bloqueo transaccional propio. Detalle en
[base-de-datos.md](base-de-datos.md#reglas-de-integridad-de-las-citas).

La validación de fecha/hora pasada usa la hora local del proceso Node.js.
Configura el servidor con la zona horaria local de la clínica. Los intervalos
persistidos se consideran de 60 minutos.

## Ejecución y pruebas

Desde la raíz del repositorio:

```powershell
npm ci
npm test
npm start
```

Configura la conexión en `.env` usando `.env.example`; no subas credenciales.
Abre `http://localhost:3000/citas/`. Se necesita MySQL con el esquema y los
horarios configurados para probar la integración real. Las pruebas automatizadas
de `tests/citas.test.js` usan una base de datos simulada y no requieren MySQL.
