# Módulo de Gestión de Médicos (Integrante 1)

Registro, edición, búsqueda, activación/desactivación de médicos y administración de sus
horarios de atención. Usa las tablas `medicos` y `disponibilidad_medicos` descritas en
[base-de-datos.md](base-de-datos.md).

## Qué incluye

| Archivo | Para qué sirve |
| --- | --- |
| `src/medicos/medicos.routes.js` | API REST `/api/medicos` y validación de ids y cuerpos |
| `src/medicos/medicos.controller.js` | Convierte resultados y errores del servicio en respuestas HTTP |
| `src/medicos/medicos.service.js` | Consultas SQL parametrizadas, transacciones, solapamientos y citas afectadas |
| `src/medicos/medicos.validacion.js` | Ids, filtros y estado; reutiliza las reglas de `public/medicos/reglas.js` |
| `public/medicos/reglas.js` | Reglas de validación compartidas por el navegador y el servidor |
| `public/medicos/medicos.js` | Ayudas del frontend: peticiones, diálogos de confirmación, advertencias |
| `public/medicos/medicos.css` | Estilos propios del módulo (la base es `/comun/estilos.css`) |
| `public/medicos/index.html` | Listado con buscador y filtros por especialidad y estado; activar/desactivar |
| `public/medicos/formulario.html` | Registrar y editar médico |
| `public/medicos/detalle.html` | Ficha del médico y administración de horarios por día |
| `tests/medicos.test.js` | Pruebas automáticas (`npm test`) |

## Reglas de validación

Las mismas reglas se aplican en el navegador y en el servidor (un solo archivo,
`public/medicos/reglas.js`), y sus límites coinciden con las columnas de MySQL. Una prueba
automática comprueba que formulario, reglas y `database/01_esquema.sql` sigan alineados.

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| Nombre | Sí | 3 a 120 caracteres |
| Especialidad | Sí | 3 a 80 caracteres |
| Número de colegiado | Sí | 3 a 20 letras, números o guiones; se guarda en mayúsculas; **único** |
| Teléfono | No | Si se escribe: 8 a 20 caracteres (dígitos, espacios, guiones, paréntesis, +) |
| Correo | No | Si se escribe: formato válido, hasta 120 caracteres, se guarda en minúsculas; **único** |

Horarios: día de la semana 1 (lunes) a 7 (domingo), horas `HH:MM`, la hora de fin posterior a
la de inicio y al menos 60 minutos (la duración de una cita). Los horarios **activos** de un
médico no pueden superponerse en el mismo día; un rango que termina a las 12:00 y otro que
empieza a las 12:00 no se superponen.

## API

| Método | Ruta | Qué hace | Respuesta correcta |
| --- | --- | --- | --- |
| GET | `/api/medicos?q=&especialidad=&activo=1\|0` | Lista; `q` busca en nombre, especialidad y colegiado | 200, lista con `horarios_activos` |
| GET | `/api/medicos/especialidades` | Especialidades registradas | 200, lista de textos |
| GET | `/api/medicos/:id` | Médico con todos sus horarios | 200 |
| GET | `/api/medicos/:id/citas-futuras` | Citas futuras activas (se muestran antes de desactivar) | 200, lista `id, fecha, hora, estado, paciente` |
| GET | `/api/medicos/:id/citas-por-revisar` | Citas futuras activas fuera de horario o de médico inactivo (vista `v_citas_por_revisar`) | 200, lista `id, fecha, hora, estado, paciente, medico_inactivo, fuera_de_disponibilidad, motivo_revision` |
| POST | `/api/medicos` | Registra | 201, médico |
| PUT | `/api/medicos/:id` | Edita | 200, médico |
| PATCH | `/api/medicos/:id/estado` | `{ "activo": false, "confirmar": false, "citas_confirmadas": [] }` | 200, `{ medico, citas_futuras_activas }` |
| GET | `/api/medicos/:id/horarios` | Horarios del médico | 200 |
| POST | `/api/medicos/:id/horarios` | `{ "dia_semana": 1, "hora_inicio": "08:00", "hora_fin": "12:00" }` | 201, horario |
| PUT | `/api/medicos/:id/horarios/:horarioId` | Edita; admite `confirmar` | 200, `{ horario, citas_fuera_de_disponibilidad }` |
| PATCH | `/api/medicos/:id/horarios/:horarioId/estado` | `{ "activo": false, "confirmar": false }` | 200, `{ horario, citas_fuera_de_disponibilidad }` |

No hay `DELETE`: médicos y horarios nunca se eliminan físicamente, se desactivan. Así se
conservan las citas y el historial de los pacientes.

### Errores

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| 400 | Datos inválidos | `{ "errores": ["..."] }` |
| 400 | Id no numérico | `{ "error": "El id del médico no es válido." }` |
| 404 | Médico u horario inexistente | `{ "error": "Médico no encontrado." }` |
| 409 | Colegiado o correo repetido | `{ "error": "Ya existe un médico registrado con ese número de colegiado." }` |
| 409 | Horario superpuesto | `{ "error": "El horario se superpone con otro horario activo del lunes (08:00–12:00)." }` |
| 409 | El cambio requiere confirmación (ver abajo) | `{ "error": "...", "requiere_confirmacion": true, "citas_afectadas": [...] }` |
| 503 | Interbloqueo de MySQL tras 3 intentos | `{ "error": "El sistema está ocupado. Intenta nuevamente en unos momentos" }` |
| 500 | Error inesperado | `{ "error": "Ocurrió un error en el servidor." }` |

### Cambios que piden confirmación

Ninguna operación de este módulo cancela, reagenda ni reasigna citas. Cuando un cambio afecta
citas futuras activas (`pendiente`, `confirmada`, `reagendada`), la API responde `409` con
`requiere_confirmacion: true` y la lista `citas_afectadas` (`id, fecha, hora, estado, paciente`)
**sin aplicar el cambio**. Para aplicarlo se repite la misma petición con `"confirmar": true`
y, opcionalmente, `"citas_confirmadas": [ids]` con las citas que vio el usuario. Si se envía esa
lista y mientras tanto se registró otra cita afectada, la API vuelve a responder `409` con la
lista actualizada en lugar de aplicar el cambio. La interfaz siempre envía la lista.

| Operación | Pide confirmación si… |
| --- | --- |
| Desactivar médico | Tiene citas futuras activas |
| Editar horario | Alguna cita futura activa que hoy está dentro de la disponibilidad quedaría fuera |
| Desactivar horario | Igual que editar |

La interfaz muestra esas citas en un diálogo y, tras confirmar, una advertencia para que
recepción las revise. Activar un médico, agregar un horario o ampliarlo no pide confirmación.

Las citas que quedan fuera de la disponibilidad tras confirmar un cambio, o cuyo médico se
desactivó, siguen activas y se listan en la tarjeta **«Citas por revisar»** de la ficha del
médico (fecha, hora, paciente, estado y motivo de revisión), hasta que Recepción las confirme,
las reagende dentro del horario o las cancele.

**Desactivar un médico** usa un único diálogo: antes de enviar nada consulta
`GET /api/medicos/:id/citas-futuras` y muestra qué médico se desactiva (nombre, especialidad y
colegiado), sus citas futuras activas (o «No tiene citas futuras activas.») y el aviso de que no
se cancelarán ni se reasignarán. «Cancelar» no envía nada. «Desactivar médico» envía
`{ activo: false, confirmar: true, citas_confirmadas }`; si apareció una cita nueva, el mismo
diálogo se vuelve a mostrar con un aviso y la lista actualizada.

## Concurrencia

Además de la validación del servicio, MySQL impide por sí mismo los horarios activos
superpuestos y los de menos de 60 minutos (triggers de `disponibilidad_medicos`), aunque se
inserten desde otro módulo o con SQL directo. Ver
[base-de-datos.md](base-de-datos.md#reglas-de-los-horarios-de-atención).

Los cambios de horarios y de estado se hacen en una transacción que bloquea la fila del médico
con `SELECT ... FOR UPDATE`, el mismo cerrojo que usa Solicitud de Citas. Por eso dos
horarios superpuestos enviados al mismo tiempo nunca se guardan los dos, y una cita no puede
registrarse entre la revisión de citas afectadas y el cambio. Ante un interbloqueo de MySQL
(1213) la transacción se repite completa hasta 3 veces; si sigue fallando se responde 503.

## Relación con Solicitud de Citas

- Un médico inactivo no aparece en `GET /api/citas/medicos`, `GET /api/citas/horarios` le
  devuelve `horarios: []` y `POST /api/citas` responde `409` «El médico seleccionado no está
  disponible para nuevas citas.». La base de datos también lo impide (trigger).
- Solicitud de Citas solo ofrece horas dentro de los horarios **activos** del médico.
- Reglas para Recepción y Agenda: [integracion-recepcion-agenda.md](integracion-recepcion-agenda.md).

## Cómo correrlo

1. Crea la base de datos con los scripts de `database/` (ver [base-de-datos.md](base-de-datos.md)).
2. `npm install` y `npm run dev`.
3. Abre http://localhost:3000/medicos/
4. Pruebas: `npm test`.
