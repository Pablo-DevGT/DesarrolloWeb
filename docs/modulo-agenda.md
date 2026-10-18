# Módulo de Agenda del Doctor (Integrante 5)

El doctor inicia sesión y ve su agenda del día: hora, nombre del paciente (con edad, teléfono y
alergias), motivo y estado de cada cita. Puede marcar una cita como atendida. La recepcionista
(admin) ve la agenda de cualquier médico. Usa las tablas `citas`, `pacientes` y `medicos` de
[base-de-datos.md](base-de-datos.md) y el login de [login-roles.md](login-roles.md).

## Qué incluye

| Archivo | Para qué sirve |
| --- | --- |
| `src/agenda/agenda.routes.js` | API REST `/api/agenda` y validación de ids |
| `src/agenda/agenda.controller.js` | Decide de qué médico es la agenda según el rol y convierte errores en HTTP |
| `src/agenda/agenda.service.js` | Consultas SQL parametrizadas y reglas para marcar atendida |
| `src/agenda/agenda.validacion.js` | Fecha (por defecto hoy) y `medico_id` |
| `public/agenda/index.html` | Página de la agenda: navegación por día, tabla y «Marcar atendida» |
| `public/agenda/agenda.css` | Estilos propios (la base es `/comun/estilos.css`) |
| `tests/agenda.test.js` | Pruebas automáticas (`npm test`) |

## Quién ve qué

| Rol | Agenda | Marcar atendida |
| --- | --- | --- |
| `doctor` | Solo la suya (el `medico_id` de su usuario; se ignora el de la URL) | Solo sus citas |
| `admin` | La de cualquier médico (`medico_id` obligatorio) | Cualquier cita |

La página exige sesión (ver [login-roles.md](login-roles.md)); sin ella redirige al login.
El doctor no ve el enlace al historial del paciente porque no tiene acceso a `/pacientes/`;
la recepcionista sí.

## API

| Método | Ruta | Qué hace | Respuesta correcta |
| --- | --- | --- | --- |
| GET | `/api/agenda?fecha=AAAA-MM-DD&medico_id=` | Citas del día. Sin `fecha` usa hoy (hora local del servidor). `medico_id` solo lo usa el admin | 200 (ver abajo) |
| PATCH | `/api/agenda/citas/:id/atender` | Marca la cita como `atendida` | 200, la cita actualizada |

Respuesta de `GET /api/agenda`:

```json
{
  "medico": { "id": 2, "nombre": "Dra. Ana Ruiz", "especialidad": "Pediatría", "activo": 1 },
  "fecha": "2026-10-22",
  "citas": [
    { "id": 4, "hora": "08:00", "motivo": "Fiebre y tos", "estado": "pendiente",
      "paciente_id": 3, "paciente": "Lucía Hernández", "edad": 9, "telefono": "3301-2244",
      "alergias": "Mariscos, ibuprofeno" }
  ],
  "resumen": { "total": 1, "activas": 1, "atendidas": 0, "canceladas": 0 }
}
```

Se incluyen **todas** las citas del día, también las canceladas y atendidas, para que el
doctor sepa qué horas se liberaron. `activas` cuenta `pendiente`, `confirmada` y `reagendada`.

### Errores

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| 400 | Fecha o `medico_id` inválidos | `{ "errores": ["..."] }` |
| 400 | Admin sin `medico_id` | `{ "errores": ["Selecciona un médico."] }` |
| 400 | Atender una cita de una fecha futura | `{ "error": "No se puede marcar como atendida una cita de una fecha futura." }` |
| 401 / 403 | Sin sesión / rol sin permiso | Ver [login-roles.md](login-roles.md) |
| 403 | Un doctor intenta atender una cita de otro médico | `{ "error": "Esa cita no pertenece a tu agenda." }` |
| 404 | Médico o cita inexistente | `{ "error": "Médico no encontrado." }` / `{ "error": "Cita no encontrada." }` |
| 409 | La cita ya está atendida o está cancelada | `{ "error": "La cita ya está marcada como atendida." }` / `{ "error": "No se puede atender una cita cancelada." }` |
| 409 | La cita cambió de estado entre la lectura y la actualización | `{ "error": "La cita cambió de estado mientras tanto. Actualiza la agenda." }` |
| 500 | Error inesperado | `{ "error": "Ocurrió un error en el servidor." }` |

## Reglas para marcar atendida

- Solo citas en estado activo (`pendiente`, `confirmada`, `reagendada`).
- Solo citas de hoy o de días anteriores (una cita de mañana no se puede atender hoy).
- El `UPDATE` filtra por estado activo: si recepción canceló la cita mientras el doctor la veía,
  no se pisa el cambio y se responde 409.
- Marcar atendida no revalida disponibilidad ni choques (regla de
  [integracion-recepcion-agenda.md](integracion-recepcion-agenda.md)); la cita deja de ocupar
  horario (`horario_activo` pasa a NULL) y aparece como `atendida` en el historial del paciente.
- La agenda **no** confirma, reagenda ni cancela citas: eso es del panel de recepción.

## Cómo correrlo

1. Crea la base de datos con los scripts de `database/` (incluye `05_usuarios.sql` y, para
   probar, `06_usuarios_prueba.sql`).
2. `npm install` y `npm run dev`.
3. Entra en http://localhost:3000/login.html como doctor (p. ej. `dra.ruiz` / `ruiz12345`):
   la agenda abre en el día de hoy. Como `recepcion` / `recepcion123` se elige el médico.
4. Pruebas: `npm test`.
