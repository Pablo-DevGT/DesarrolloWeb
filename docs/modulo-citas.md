# Solicitud de citas médicas

## Integración requerida

El repositorio no incluye el esquema real de médicos ni de citas. El módulo usa
las columnas documentadas por pacientes y presentes en `database/prueba_historial.sql`:

- `medicos(id, nombre, especialidad)`
- `citas(id, paciente_id, medico_id, fecha, hora, motivo, estado)`
- `pacientes(id)`

La migración presupone que `medicos` y `citas` ya fueron creadas por el módulo
de médicos/agenda y que son tablas InnoDB. No crea ni reemplaza esas tablas.
Si el esquema entregado por esos módulos usa otros nombres, hay que adaptar las
consultas de `src/citas/citas.service.js` y la clave foránea de la migración.

La disponibilidad semanal, que no estaba modelada en el proyecto, pertenece a
este módulo en `disponibilidad_medicos`. Sus días usan ISO (lunes=1 a domingo=7)
y cada rango genera citas consecutivas de 60 minutos desde `hora_inicio` hasta
antes de `hora_fin`. No hay excepciones por feriados ni disponibilidad por fecha.

## Preparación de MySQL

1. Ejecuta el esquema oficial de médicos y citas del equipo y el script de
   pacientes (`database/02_pacientes.sql`), si todavía no se han ejecutado.
2. Ejecuta una vez `database/03_citas_disponibilidad.sql` en la base
   `sistema_citas`. Requiere que la tabla `medicos` ya exista.
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

La migración elimina condicionalmente el índice `uq_medico_horario` creado por
el SQL de prueba local. Ese índice único no distingue estados y por eso impide
reservar de nuevo una hora cancelada. La ruta de citas sustituye esa protección
para sus solicitudes con bloqueo transaccional por médico y comprobación de
solapamientos. No se borran ni actualizan citas existentes.

## API

| Método | Ruta | Respuesta |
| --- | --- | --- |
| `GET` | `/api/citas/medicos` | Médicos con al menos un horario activo |
| `GET` | `/api/citas/horarios?medico_id=1&fecha=AAAA-MM-DD` | Horarios libres en bloques de 60 minutos |
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

Validación incorrecta responde `400`, entidades inexistentes `404`, y un horario
ocupado `409`. Los errores inesperados de base de datos se registran y responden
`500`. Las respuestas JSON de error usan `{ "error": "..." }` o
`{ "errores": ["..."] }` para validaciones.

## No doble cita y cancelaciones

Al registrar, MySQL bloquea la fila del médico con `SELECT ... FOR UPDATE` hasta
que se confirme o revierta la transacción. Así, dos solicitudes simultáneas
atendidas por este endpoint para el mismo médico se serializan. Después del
bloqueo se comprueba disponibilidad y se buscan intervalos solapados en estado
`pendiente`, `confirmada` o `reagendada`; las citas de otros médicos no se
afectan. Un error de clave duplicada también se devuelve como `409`.

`cancelada` no bloquea y libera el horario. La API de este módulo no cambia el
estado de una cita; cuando recepción/agenda cancele una, debe guardar
`estado='cancelada'` en `citas`. Las demás rutas que creen o muevan citas deben
adoptar el mismo bloqueo de la fila `medicos` para coordinarse con estas
reservas.

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
