# Despliegue (Integrante 5, tarea compartida)

Cómo poner el sistema en un servidor. Sirve para cualquier proveedor que corra Node.js
(Railway, Render, una máquina virtual, un servidor de la universidad): la aplicación solo
necesita Node 20 o superior, MySQL 8 y variables de entorno.

## Requisitos

| Qué | Versión |
| --- | --- |
| Node.js | 20 o superior (`engines` en `package.json`) |
| MySQL | 8.0 o superior (el esquema usa `VALUES ROW(...)`, columnas generadas y CHECK) |
| Zona horaria del servidor | La de la clínica: la validación de «fecha pasada» usa la hora local de Node |

## Variables de entorno

Todas vienen de `.env` en desarrollo (`.env.example` las documenta). En un servidor se
configuran en el panel del proveedor o en el entorno del proceso; **nunca se sube `.env`**.

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Sí | Conexión a MySQL (`src/comun/db.js`) |
| `PORT` | No (3000) | Puerto del servidor. Los proveedores suelen definirlo ellos |
| `SESSION_SECRET` | Sí | Firma de la cookie de sesión. Largo y aleatorio, distinto por servidor |
| `NODE_ENV` | Sí en producción (`production`) | Marca la cookie de sesión como `Secure` (solo HTTPS) |
| `COOKIE_SEGURA` | No | `0` si el servidor de producción **no** tiene HTTPS; si no, el login no funcionará |

Generar un secreto:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Pasos

1. **Base de datos.** Crea la base y ejecuta, en orden, `database/01_esquema.sql`,
   `02_pacientes.sql`, `03_citas_disponibilidad.sql` y `05_usuarios.sql`
   (ver [base-de-datos.md](base-de-datos.md)). **No** ejecutes `04_datos_prueba.sql` ni
   `06_usuarios_prueba.sql` en producción. Comprueba con `verificar_esquema.sql`.

   ```powershell
   mysql -h HOST -u USUARIO -p < database/01_esquema.sql
   mysql -h HOST -u USUARIO -p < database/02_pacientes.sql
   mysql -h HOST -u USUARIO -p < database/03_citas_disponibilidad.sql
   mysql -h HOST -u USUARIO -p < database/05_usuarios.sql
   ```

2. **Código.** En el servidor, con las variables de entorno definidas:

   ```powershell
   npm ci --omit=dev
   npm start
   ```

   `npm start` ejecuta `node server.js`. El proveedor debe reiniciar el proceso si se cae
   (Railway y Render lo hacen; en una máquina propia usa `pm2` o un servicio del sistema).

3. **Primer usuario.** Crea la cuenta de la recepcionista y una por doctor
   (los médicos se registran antes en `/medicos/` o en SQL):

   ```powershell
   npm run crear-usuario -- --usuario recepcion --nombre "Recepción" --rol admin
   npm run crear-usuario -- --usuario dr.perez --nombre "Dr. Pérez" --rol doctor --medico 1
   ```

   Después, la recepcionista puede crear más con `POST /api/auth/usuarios`
   (ver [login-roles.md](login-roles.md)).

4. **HTTPS.** Railway y Render lo dan solos. En una máquina propia, pon un proxy
   (nginx o Caddy) con certificado delante de Node y deja `NODE_ENV=production`.
   Si de verdad no hay HTTPS, agrega `COOKIE_SEGURA=0`.

5. **Comprobar.** Abre la URL pública: `/` debe llevar a `/login.html`, el login debe entrar
   con la cuenta creada y `/citas/` debe abrirse sin sesión.

## Railway o Render (resumen)

- Crea el servicio desde el repositorio de GitHub (rama `main`). Build: `npm ci`; start:
  `npm start`. Node se detecta por `package.json`.
- Agrega una base MySQL (en Railway, plugin MySQL; en Render, una base externa) y copia sus
  datos a `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Define `SESSION_SECRET` y `NODE_ENV=production`. `PORT` lo pone el proveedor.
- Ejecuta los scripts SQL contra esa base (desde MySQL Workbench o `mysql`) y crea el primer
  usuario con `npm run crear-usuario` desde tu máquina apuntando a la base remota.

## Actualizaciones

Cada versión nueva: `git pull`, `npm ci --omit=dev`, ejecutar los scripts SQL nuevos (todos se
pueden repetir sin borrar datos) y reiniciar el proceso. Cambiar `SESSION_SECRET` cierra todas
las sesiones abiertas.

## Lista de comprobación

- [ ] MySQL 8 con los scripts 01, 02, 03 y 05 ejecutados (sin datos de prueba).
- [ ] Variables de entorno definidas; `.env` no está en el repositorio.
- [ ] `SESSION_SECRET` aleatorio y `NODE_ENV=production`.
- [ ] HTTPS activo (o `COOKIE_SEGURA=0` si no lo hay).
- [ ] Zona horaria del servidor igual a la de la clínica.
- [ ] Usuario admin creado y login probado.
- [ ] `npm test` en verde antes de desplegar.
