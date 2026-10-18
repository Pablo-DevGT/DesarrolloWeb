# Sistema de Citas para Consultorio Médico

Proyecto en equipo (5 integrantes): los pacientes solicitan citas en los horarios disponibles,
la recepcionista las confirma y los doctores ven su agenda del día. Node.js + Express + MySQL,
sin frameworks de frontend.

| Integrante | Módulo | Documentación |
| --- | --- | --- |
| 1 | Médicos y horarios · Diseño de la base de datos | [docs/modulo-medicos.md](docs/modulo-medicos.md), [docs/base-de-datos.md](docs/base-de-datos.md) |
| 2 | Pacientes e historial · Plantilla visual | [docs/modulo-pacientes.md](docs/modulo-pacientes.md) |
| 3 | Solicitud de cita · Regla de «no doble cita» | [docs/modulo-citas.md](docs/modulo-citas.md) |
| 4 | Panel de la recepcionista · Notificaciones | [docs/integracion-recepcion-agenda.md](docs/integracion-recepcion-agenda.md) |
| 5 | Agenda del doctor · Login, roles y despliegue | [docs/modulo-agenda.md](docs/modulo-agenda.md), [docs/login-roles.md](docs/login-roles.md), [docs/despliegue.md](docs/despliegue.md) |

## Cómo correrlo

1. Crea la base de datos ejecutando en orden los scripts de `database/` (ver
   [docs/base-de-datos.md](docs/base-de-datos.md)); para probar, incluye los de datos de prueba.
2. Copia `.env.example` como `.env` y completa los datos de MySQL y `SESSION_SECRET`.
3. `npm install` y `npm run dev`.
4. Abre http://localhost:3000/ e inicia sesión (usuarios de prueba en
   [docs/login-roles.md](docs/login-roles.md)). Los pacientes solicitan cita en `/citas/` sin cuenta.
5. Pruebas: `npm test` (no necesitan MySQL).
