# Módulo de Pacientes e Historial (Integrante 2)

## Qué incluye

| Archivo | Para qué sirve |
| --- | --- |
| `database/02_pacientes.sql` | Crea la tabla `pacientes` (los datos de prueba están en `04_datos_prueba.sql`) |
| `database/prueba_historial.sql` | Obsoleto: lo reemplazan `01_esquema.sql`, `03_citas_disponibilidad.sql` y `04_datos_prueba.sql`. No ejecutar |
| `src/comun/db.js` | Conexión compartida a MySQL (la pueden usar todos) |
| `src/pacientes/pacientes.validacion.js` | Reglas de validación de los datos del paciente |
| `src/pacientes/pacientes.model.js` | Consultas SQL de pacientes e historial |
| `src/pacientes/pacientes.routes.js` | API REST `/api/pacientes` |
| `public/comun/estilos.css` | Plantilla visual común (tarea compartida) |
| `public/comun/comun.js` | Menú común y funciones de ayuda para todo el frontend |
| `public/pacientes/index.html` | Lista y búsqueda de pacientes |
| `public/pacientes/formulario.html` | Registrar y editar paciente |
| `public/pacientes/historial.html` | Historial de citas con filtros por estado y fechas |
| `tests/pacientes.test.js` | Pruebas automáticas (`npm test`) |

## API

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/api/pacientes?q=texto` | Lista o busca por nombre, teléfono o correo |
| GET | `/api/pacientes/:id` | Devuelve un paciente |
| POST | `/api/pacientes` | Registra un paciente |
| PUT | `/api/pacientes/:id` | Edita un paciente |
| GET | `/api/pacientes/:id/historial?estado=&desde=&hasta=` | Citas del paciente con médico y estado |

Cuerpo de POST/PUT:

```json
{ "nombre": "María López", "edad": 34, "telefono": "5512-3456",
  "email": "maria@ejemplo.com", "alergias": "Penicilina" }
```

Errores de validación responden `400` con `{ "errores": ["..."] }`; un correo repetido responde `409`.

## Cómo correrlo

1. En MySQL Workbench abre y ejecuta en orden (rayo ⚡) `database/01_esquema.sql`,
   `database/02_pacientes.sql` y `database/03_citas_disponibilidad.sql`.
2. Para tener datos de prueba ejecuta también `database/04_datos_prueba.sql`
   (ver [base-de-datos.md](base-de-datos.md)).
3. Copia `.env.example` como `.env` y escribe tu usuario y contraseña de MySQL.
4. En la terminal de VS Code:

```bash
npm install
npm run dev
```

5. Abre http://localhost:3000/pacientes/
6. Para correr las pruebas: `npm test`

## Para los demás integrantes

- **Usen la plantilla:** en cada página pongan
  `<link rel="stylesheet" href="/comun/estilos.css">`, `<header id="menu" data-activo="SU-MODULO"></header>`
  y `<script src="/comun/comun.js"></script>`. Los ids del menú son `pacientes`, `medicos`, `citas`, `recepcion`, `agenda`.
- **Clases disponibles:** `contenedor`, `tarjeta`, `form-grid`, `campo`, `btn`, `btn-secundario`, `tabla`, `alerta`, y `estado estado-pendiente` (también `confirmada`, `reagendada`, `cancelada`, `atendida`).
- **Funciones en `comun.js`:** `api()`, `escaparHTML()`, `mostrarAlerta()`, `formatearFecha()`, `etiquetaEstado()`.
- **Integrante 5 (agenda):** las alergias se obtienen con `GET /api/pacientes/:id`.
- **Integrantes 1 y 3:** el historial espera `medicos(id, nombre, especialidad)` y `citas(paciente_id, medico_id, fecha, hora, motivo, estado)`. Si usan otros nombres, avísenme para ajustar la consulta `historial` en `pacientes.model.js`.
