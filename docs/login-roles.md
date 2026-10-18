# Login y roles (Integrante 5, tarea compartida)

Inicio de sesión con usuario y contraseña, dos roles y protección de páginas y APIs.
No agrega dependencias: usa `crypto` de Node para el hash de contraseñas (scrypt) y una
cookie firmada (HMAC) como sesión. El despliegue está en [despliegue.md](despliegue.md).

## Qué incluye

| Archivo | Para qué sirve |
| --- | --- |
| `database/05_usuarios.sql` | Tabla `usuarios` (ver [base-de-datos.md](base-de-datos.md#usuarios)) |
| `database/06_usuarios_prueba.sql` | Usuarios de prueba ligados a los médicos de `04_datos_prueba.sql` |
| `src/auth/contrasenas.js` | Hash y verificación de contraseñas con scrypt |
| `src/auth/sesion.js` | Token de sesión firmado y lectura de cookies |
| `src/auth/auth.middleware.js` | `cargarSesion`, `protegerPaginas`, `requiereRol`: quién puede ver qué |
| `src/auth/auth.validacion.js` | Reglas de login, alta de usuario y cambio de contraseña |
| `src/auth/auth.service.js` | Consultas SQL de usuarios |
| `src/auth/auth.controller.js`, `auth.routes.js` | API REST `/api/auth` |
| `public/login.html` | Página de inicio de sesión |
| `public/comun/comun.js` | Menú según el rol, nombre del usuario y «Cerrar sesión»; `api()` vuelve al login ante un 401 |
| `scripts/crear-usuario.js` | `npm run crear-usuario`: crea usuarios desde la terminal |
| `tests/auth.test.js` | Pruebas automáticas (`npm test`) |
| `tests/ayudas/sesion.js` | Simula una sesión en las pruebas de los otros módulos |

## Roles

| Rol | Quién | Puede ver |
| --- | --- | --- |
| `admin` | La recepcionista | Todo: pacientes, médicos, solicitud de citas, recepción y la agenda de cualquier doctor |
| `doctor` | Cada médico (su usuario está ligado a `medicos.id`) | Solo su agenda y la página de solicitud de citas |
| sin sesión | Pacientes | Solo `/citas/` (solicitar cita) y `/login.html` |

Los pacientes **no** inician sesión: solicitan su cita desde `/citas/`, como antes.

### Páginas

`protegerPaginas` revisa cada página HTML antes de servirla:

| Ruta | Sin sesión | `doctor` | `admin` |
| --- | --- | --- | --- |
| `/citas/`, `/login.html`, `/comun/` | ✔ | ✔ | ✔ |
| `/agenda/` | → `/login.html?volver=…` | ✔ | ✔ |
| `/pacientes/`, `/medicos/`, `/recepcion/` | → `/login.html?volver=…` | → `/agenda/` | ✔ |
| `/` | → `/login.html` | → `/agenda/` | → `/pacientes/` |

### APIs

| Ruta | Quién | Nota |
| --- | --- | --- |
| `/api/auth/login`, `/logout`, `/sesion` | Público | |
| `/api/citas/*` | Público | La usa la solicitud de citas |
| `GET /api/pacientes` (solo la lista) | Público | La solicitud de citas la usa para elegir paciente |
| `/api/pacientes/*` (resto), `/api/medicos/*`, `/api/recepcion/*` | `admin` | |
| `/api/agenda/*` | `doctor`, `admin` | |
| `/api/auth/usuarios` | `admin` | |
| `/api/auth/contrasena` | Cualquier usuario conectado | |

Sin sesión la API responde `401 { "error": "Debes iniciar sesión." }`; con un rol sin permiso,
`403 { "error": "No tienes permiso para esta operación." }`. En el navegador, `api()` de
`comun.js` manda al login al recibir un 401 y vuelve a la página al entrar.

Para proteger un módulo nuevo en `server.js`:

```js
app.use('/api/recepcion', auth.requiereRol(['admin']), require('./src/recepcion/recepcion.routes'));
```

y agregar su prefijo a `PAGINAS` en `src/auth/auth.middleware.js` si tiene páginas propias
(`/recepcion/` y `/agenda/` ya están).

## API `/api/auth`

| Método | Ruta | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | `{ "usuario", "contrasena" }` | 200 `{ usuario: { id, usuario, nombre, rol, medico_id, medico } }` y cookie `sesion` |
| POST | `/api/auth/logout` | — | 204, borra la cookie |
| GET | `/api/auth/sesion` | — | 200 `{ usuario }` o `{ usuario: null }` |
| POST | `/api/auth/contrasena` | `{ "actual", "nueva" }` | 204 |
| GET | `/api/auth/usuarios` | — | 200, lista (sin hash) |
| POST | `/api/auth/usuarios` | `{ "usuario", "nombre", "contrasena", "rol", "medico_id" }` | 201, usuario |

### Errores

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| 400 | Datos inválidos | `{ "errores": ["..."] }` |
| 401 | Usuario inexistente, inactivo o contraseña incorrecta (mismo mensaje a propósito) | `{ "error": "Usuario o contraseña incorrectos." }` |
| 401 | Contraseña actual incorrecta | `{ "error": "La contraseña actual no es correcta." }` |
| 404 | `medico_id` inexistente | `{ "error": "Médico no encontrado." }` |
| 409 | Usuario repetido | `{ "error": "Ya existe un usuario con ese nombre de usuario." }` |
| 409 | El médico ya tiene usuario | `{ "error": "Ese médico ya tiene un usuario." }` |

### Reglas de validación

| Campo | Regla |
| --- | --- |
| Usuario | 3 a 60 caracteres: minúsculas, números, `.`, `-`, `_`; se guarda en minúsculas; **único** |
| Nombre | 3 a 120 caracteres |
| Contraseña | 8 a 72 caracteres |
| Rol | `admin` o `doctor` |
| `medico_id` | Obligatorio si el rol es `doctor` (un usuario por médico); no se admite si es `admin` |

## Cómo funciona la sesión

1. `POST /api/auth/login` busca el usuario, verifica la contraseña contra el hash scrypt y, si
   está activo, responde una cookie `sesion` **HttpOnly, SameSite=Lax** (y `Secure` en producción).
2. La cookie contiene los datos del usuario (`id, usuario, nombre, rol, medico_id, medico`) y su
   vencimiento (8 horas), firmados con HMAC-SHA256 y `SESSION_SECRET`. No se guarda nada en el
   servidor, así funciona igual con varios procesos o al reiniciar.
3. `cargarSesion` lee la cookie en cada petición y deja el usuario en `req.usuario` (o `null`).
   Un token alterado, vencido o firmado con otro secreto se ignora.
4. `POST /api/auth/logout` borra la cookie.

Consecuencia: desactivar un usuario (`activo = 0`) impide que vuelva a entrar, pero una sesión ya
abierta sigue válida hasta vencer (máximo 8 horas). Para cerrar todas las sesiones de inmediato,
cambia `SESSION_SECRET` y reinicia el servidor.

## Crear usuarios

Con la base de datos y el `.env` configurados:

```powershell
npm run crear-usuario -- --usuario recepcion --nombre "Recepción" --rol admin
npm run crear-usuario -- --usuario dr.perez --nombre "Dr. Pérez" --rol doctor --medico 5
```

Pide la contraseña por teclado (o pásala con `--contrasena`). También se puede usar
`POST /api/auth/usuarios` con sesión de admin. Para desactivar un usuario, por ahora, en MySQL:
`UPDATE usuarios SET activo = 0 WHERE usuario = '...'`.

Usuarios de prueba (`06_usuarios_prueba.sql`): `recepcion` / `recepcion123` (admin),
`dr.mendez` / `mendez123`, `dra.ruiz` / `ruiz12345`, `dr.castillo` / `castillo123` (doctores).

## Pruebas de otros módulos

Las APIs de pacientes y médicos exigen sesión de admin, así que sus pruebas llaman
`require('./ayudas/sesion').simularSesion()` antes de `require('../server')`. Eso reemplaza solo
la lectura de la cookie por un usuario fijo (`ADMIN` por defecto, o `DOCTOR`); las reglas de
roles siguen siendo las reales. `tests/auth.test.js` prueba el login completo con cookies reales.

## Cómo correrlo

1. Ejecuta `database/05_usuarios.sql` y, para probar, `database/06_usuarios_prueba.sql`.
2. En `.env` agrega `SESSION_SECRET` (ver `.env.example`).
3. `npm install`, `npm run dev` y abre http://localhost:3000/ (lleva al login).
4. Pruebas: `npm test`.
