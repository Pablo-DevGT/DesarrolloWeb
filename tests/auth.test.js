// Pruebas de login, sesión y roles (Integrante 5). Se ejecutan con: npm test
// No necesitan MySQL: la base de datos se reemplaza por una en memoria.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const contrasenas = require('../src/auth/contrasenas');
const sesion = require('../src/auth/sesion');

describe('contraseñas', () => {
  test('guarda un hash distinto de la contraseña y lo verifica', async () => {
    const hash = await contrasenas.hashear('secreta123');
    assert.notEqual(hash, 'secreta123');
    assert.ok(hash.startsWith('scrypt$'));
    assert.equal(await contrasenas.verificar('secreta123', hash), true);
    assert.equal(await contrasenas.verificar('otra', hash), false);
  });

  test('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
    assert.notEqual(await contrasenas.hashear('igual'), await contrasenas.hashear('igual'));
  });

  test('un hash mal formado no verifica ni lanza error', async () => {
    assert.equal(await contrasenas.verificar('x', 'basura'), false);
    assert.equal(await contrasenas.verificar('x', ''), false);
    assert.equal(await contrasenas.verificar('x', null), false);
  });
});

describe('token de sesión', () => {
  const secreto = 'secreto-de-prueba';
  const ahora = () => new Date(2030, 0, 1, 8, 0, 0);
  const usuario = { id: 7, usuario: 'ana', rol: 'doctor', medico_id: 3 };

  test('crea un token firmado y recupera los datos', () => {
    const token = sesion.crearToken(usuario, { secreto, ahora, duracionSegundos: 3600 });
    assert.deepEqual(sesion.leerToken(token, { secreto, ahora }), usuario);
  });

  test('rechaza un token alterado o firmado con otro secreto', () => {
    const token = sesion.crearToken(usuario, { secreto, ahora, duracionSegundos: 3600 });
    const [datos, firma] = token.split('.');
    const alterado = `${Buffer.from(JSON.stringify({ ...usuario, rol: 'admin', exp: 9e12 })).toString('base64url')}.${firma}`;
    assert.equal(sesion.leerToken(alterado, { secreto, ahora }), null);
    assert.equal(sesion.leerToken(`${datos}.firmafalsa`, { secreto, ahora }), null);
    assert.equal(sesion.leerToken(token, { secreto: 'otro', ahora }), null);
    assert.equal(sesion.leerToken('', { secreto, ahora }), null);
    assert.equal(sesion.leerToken(undefined, { secreto, ahora }), null);
  });

  test('rechaza un token vencido', () => {
    const token = sesion.crearToken(usuario, { secreto, ahora, duracionSegundos: 60 });
    const despues = () => new Date(2030, 0, 1, 8, 1, 1);
    assert.equal(sesion.leerToken(token, { secreto, ahora: despues }), null);
  });

  test('lee la cookie de sesión de la cabecera Cookie', () => {
    assert.deepEqual(sesion.leerCookies('a=1; sesion=abc.def; otra=x%20y'), { a: '1', sesion: 'abc.def', otra: 'x y' });
    assert.deepEqual(sesion.leerCookies(undefined), {});
  });
});

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const { validarLogin, validarUsuarioNuevo, validarCambioContrasena } = require('../src/auth/auth.validacion');

describe('validación de usuarios', () => {
  test('acepta un login válido y normaliza el usuario', () => {
    const { errores, datos } = validarLogin({ usuario: '  Ana.Ruiz ', contrasena: 'secreta123' });
    assert.deepEqual(errores, []);
    assert.deepEqual(datos, { usuario: 'ana.ruiz', contrasena: 'secreta123' });
  });

  test('rechaza un login incompleto', () => {
    assert.equal(validarLogin({}).errores.length, 2);
  });

  test('un doctor necesita médico y un admin no debe tenerlo', () => {
    const base = { usuario: 'dr.mendez', nombre: 'Dr. Carlos Méndez', contrasena: 'secreta123' };
    assert.deepEqual(validarUsuarioNuevo({ ...base, rol: 'doctor', medico_id: '4' }).datos,
      { ...base, rol: 'doctor', medico_id: 4 });
    assert.ok(validarUsuarioNuevo({ ...base, rol: 'doctor' }).errores.some((e) => e.includes('médico')));
    assert.ok(validarUsuarioNuevo({ ...base, rol: 'admin', medico_id: 4 }).errores.some((e) => e.includes('médico')));
    assert.equal(validarUsuarioNuevo({ ...base, rol: 'admin' }).datos.medico_id, null);
    assert.ok(validarUsuarioNuevo({ ...base, rol: 'otro' }).errores.some((e) => e.includes('rol')));
  });

  test('rechaza usuario, nombre o contraseña fuera de límites', () => {
    const { errores } = validarUsuarioNuevo({ usuario: 'a b', nombre: 'X', contrasena: '1234567', rol: 'admin' });
    assert.equal(errores.length, 3);
    assert.equal(validarCambioContrasena({ actual: '', nueva: 'corta' }).errores.length, 2);
    assert.deepEqual(validarCambioContrasena({ actual: 'vieja1234', nueva: 'nueva1234' }).errores, []);
  });
});

// ---------------------------------------------------------------------------
// API y protección de rutas
// ---------------------------------------------------------------------------
const { before, after } = require('node:test');

// Base de datos en memoria para usuarios y médicos
class BaseDatosFalsa {
  constructor() {
    this.medicos = [
      { id: 1, nombre: 'Dr. Carlos Méndez', especialidad: 'Medicina general', activo: 1 },
      { id: 2, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría', activo: 1 },
    ];
    this.usuarios = [];
    this.siguienteId = 1;
  }

  agregar(usuario) {
    const fila = { id: this.siguienteId++, activo: 1, medico_id: null, ...usuario };
    this.usuarios.push(fila);
    return fila;
  }

  conMedico(u) {
    const medico = this.medicos.find((m) => m.id === u.medico_id);
    return { ...u, medico: medico ? medico.nombre : null };
  }

  async query(sql, p = []) {
    if (sql.includes('FROM usuarios u') && sql.includes('WHERE u.usuario = ?')) {
      return [this.usuarios.filter((u) => u.usuario === p[0]).map((u) => this.conMedico(u)), []];
    }
    if (sql.includes('FROM usuarios u') && sql.includes('WHERE u.id = ?')) {
      return [this.usuarios.filter((u) => u.id === Number(p[0])).map((u) => this.conMedico(u)), []];
    }
    if (sql.includes('FROM usuarios u') && sql.includes('ORDER BY')) {
      return [this.usuarios.map(({ contrasena_hash, ...u }) => this.conMedico(u)), []];
    }
    if (sql.includes('SELECT id, nombre FROM medicos WHERE id = ?')) {
      return [this.medicos.filter((m) => m.id === Number(p[0])), []];
    }
    if (sql.includes('INSERT INTO usuarios')) {
      const [usuario, nombre, contrasena_hash, rol, medico_id] = p;
      const duplicado = (campo, valor, clave) => {
        if (valor != null && this.usuarios.some((u) => u[campo] === valor)) {
          throw Object.assign(new Error(`Duplicate entry '${valor}' for key 'usuarios.${clave}'`), { code: 'ER_DUP_ENTRY', errno: 1062 });
        }
      };
      duplicado('usuario', usuario, 'uq_usuario_usuario');
      duplicado('medico_id', medico_id, 'uq_usuario_medico');
      const fila = this.agregar({ usuario, nombre, contrasena_hash, rol, medico_id });
      return [{ insertId: fila.id }, []];
    }
    if (sql.includes('UPDATE usuarios SET contrasena_hash = ?')) {
      const fila = this.usuarios.find((u) => u.id === Number(p[1]));
      if (fila) fila.contrasena_hash = p[0];
      return [{ affectedRows: fila ? 1 : 0 }, []];
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

describe('API /api/auth y rutas protegidas', () => {
  let servidor;
  let base;
  let db;

  const enviar = (url, metodo, cuerpo, cookie = '') => fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    redirect: 'manual',
  });
  const cookieDe = (respuesta) => String(respuesta.headers.get('set-cookie') || '').split(';')[0];
  const login = async (usuario, contrasena) => {
    const r = await enviar(`${base}/api/auth/login`, 'POST', { usuario, contrasena });
    assert.equal(r.status, 200);
    return cookieDe(r);
  };

  before(async () => {
    process.env.SESSION_SECRET = 'secreto-de-pruebas';
    db = new BaseDatosFalsa();
    db.agregar({ usuario: 'recepcion', nombre: 'Recepción', contrasena_hash: await contrasenas.hashear('recepcion123'), rol: 'admin' });
    db.agregar({ usuario: 'dra.ruiz', nombre: 'Dra. Ana Ruiz', contrasena_hash: await contrasenas.hashear('ruiz12345'), rol: 'doctor', medico_id: 2 });
    db.agregar({ usuario: 'inactivo', nombre: 'Ex empleado', contrasena_hash: await contrasenas.hashear('inactivo123'), rol: 'admin', activo: 0 });

    const rutaDb = require.resolve('../src/comun/db');
    require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: db };
    const app = require('../server');
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    base = `http://localhost:${servidor.address().port}`;
  });

  after(() => new Promise((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve()))));

  test('inicia sesión con cookie HttpOnly y devuelve el usuario sin el hash', async () => {
    const r = await enviar(`${base}/api/auth/login`, 'POST', { usuario: 'Recepcion', contrasena: 'recepcion123' });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /^sesion=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const { usuario } = await r.json();
    assert.deepEqual(usuario, { id: 1, usuario: 'recepcion', nombre: 'Recepción', rol: 'admin', medico_id: null, medico: null });
  });

  test('rechaza contraseña incorrecta, usuario inexistente e inactivo con el mismo mensaje (401)', async () => {
    for (const cuerpo of [
      { usuario: 'recepcion', contrasena: 'mala' },
      { usuario: 'nadie', contrasena: 'recepcion123' },
      { usuario: 'inactivo', contrasena: 'inactivo123' },
    ]) {
      const r = await enviar(`${base}/api/auth/login`, 'POST', cuerpo);
      assert.equal(r.status, 401);
      assert.deepEqual(await r.json(), { error: 'Usuario o contraseña incorrectos.' });
      assert.equal(r.headers.get('set-cookie'), null);
    }
    assert.equal((await enviar(`${base}/api/auth/login`, 'POST', {})).status, 400);
  });

  test('GET /api/auth/sesion informa el usuario conectado o null, y logout borra la cookie', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/auth/sesion`)).json(), { usuario: null });
    const cookie = await login('dra.ruiz', 'ruiz12345');
    const { usuario } = await (await enviar(`${base}/api/auth/sesion`, 'GET', undefined, cookie)).json();
    assert.equal(usuario.rol, 'doctor');
    assert.equal(usuario.medico_id, 2);
    assert.equal(usuario.medico, 'Dra. Ana Ruiz');

    const salida = await enviar(`${base}/api/auth/logout`, 'POST', undefined, cookie);
    assert.equal(salida.status, 204);
    assert.match(salida.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual(await (await enviar(`${base}/api/auth/sesion`, 'GET', undefined, 'sesion=basura.falsa')).json(), { usuario: null });
  });

  test('las páginas protegidas redirigen al login y las públicas no', async () => {
    const r = await fetch(`${base}/pacientes/`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login.html?volver=%2Fpacientes%2F');
    assert.equal((await fetch(`${base}/medicos/detalle.html?id=1`, { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(`${base}/citas/`, { redirect: 'manual' })).status, 200);
    assert.equal((await fetch(`${base}/login.html`, { redirect: 'manual' })).status, 200);
    assert.equal((await fetch(`${base}/comun/estilos.css`, { redirect: 'manual' })).status, 200);
  });

  test('la raíz lleva al login, o al inicio de cada rol', async () => {
    assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).headers.get('location'), '/login.html');
    const admin = await login('recepcion', 'recepcion123');
    assert.equal((await enviar(`${base}/`, 'GET', undefined, admin)).headers.get('location'), '/pacientes/');
    const doctor = await login('dra.ruiz', 'ruiz12345');
    assert.equal((await enviar(`${base}/`, 'GET', undefined, doctor)).headers.get('location'), '/agenda/');
  });

  test('un doctor no entra a las páginas de administración: vuelve a su inicio', async () => {
    const doctor = await login('dra.ruiz', 'ruiz12345');
    const r = await enviar(`${base}/pacientes/`, 'GET', undefined, doctor);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/agenda/');
  });

  test('las APIs de administración responden 401 sin sesión y 403 con rol doctor', async () => {
    assert.equal((await enviar(`${base}/api/medicos`, 'GET')).status, 401);
    assert.deepEqual(await (await enviar(`${base}/api/pacientes`, 'POST', {})).json(), { error: 'Debes iniciar sesión.' });
    const doctor = await login('dra.ruiz', 'ruiz12345');
    const r = await enviar(`${base}/api/medicos`, 'GET', undefined, doctor);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'No tienes permiso para esta operación.' });
  });

  test('lo que usa Solicitud de Citas sigue siendo público: GET /api/pacientes y /api/citas/*', async () => {
    const original = db.query.bind(db);
    db.query = async (sql, p) => {
      if (sql.includes('FROM pacientes')) return [[], []];
      if (sql.includes('FROM medicos m')) return [[], []];
      return original(sql, p);
    };
    assert.equal((await fetch(`${base}/api/pacientes`)).status, 200);
    assert.equal((await fetch(`${base}/api/citas/medicos`)).status, 200);
    assert.equal((await fetch(`${base}/api/pacientes/1`)).status, 401);
  });

  test('el admin crea usuarios; rechaza duplicados (409) y médico inexistente (404)', async () => {
    const admin = await login('recepcion', 'recepcion123');
    const nuevo = { usuario: 'dr.mendez', nombre: 'Dr. Carlos Méndez', contrasena: 'mendez123', rol: 'doctor', medico_id: 1 };
    const r = await enviar(`${base}/api/auth/usuarios`, 'POST', nuevo, admin);
    assert.equal(r.status, 201);
    const creado = await r.json();
    assert.equal(creado.usuario, 'dr.mendez');
    assert.equal(creado.medico, 'Dr. Carlos Méndez');
    assert.equal(creado.contrasena_hash, undefined);

    assert.equal((await enviar(`${base}/api/auth/usuarios`, 'POST', nuevo, admin)).status, 409);
    const otroMismoMedico = await enviar(`${base}/api/auth/usuarios`, 'POST', { ...nuevo, usuario: 'otro' }, admin);
    assert.equal(otroMismoMedico.status, 409);
    assert.deepEqual(await otroMismoMedico.json(), { error: 'Ese médico ya tiene un usuario.' });
    assert.equal((await enviar(`${base}/api/auth/usuarios`, 'POST', { ...nuevo, usuario: 'x.y', medico_id: 99 }, admin)).status, 404);
    assert.equal((await enviar(`${base}/api/auth/usuarios`, 'POST', { ...nuevo, usuario: 'ab' }, admin)).status, 400);

    const lista = await (await enviar(`${base}/api/auth/usuarios`, 'GET', undefined, admin)).json();
    assert.ok(lista.some((u) => u.usuario === 'dr.mendez' && u.medico === 'Dr. Carlos Méndez'));
    assert.ok(lista.every((u) => u.contrasena_hash === undefined));

    const doctor = await login('dra.ruiz', 'ruiz12345');
    assert.equal((await enviar(`${base}/api/auth/usuarios`, 'GET', undefined, doctor)).status, 403);
    assert.ok((await login('dr.mendez', 'mendez123')).length > 10);
  });

  test('cambiar la contraseña exige la actual y permite entrar con la nueva', async () => {
    const doctor = await login('dra.ruiz', 'ruiz12345');
    const mala = await enviar(`${base}/api/auth/contrasena`, 'POST', { actual: 'incorrecta', nueva: 'nueva12345' }, doctor);
    assert.equal(mala.status, 401);
    assert.deepEqual(await mala.json(), { error: 'La contraseña actual no es correcta.' });
    assert.equal((await enviar(`${base}/api/auth/contrasena`, 'POST', { actual: 'ruiz12345', nueva: 'nueva12345' }, doctor)).status, 204);
    assert.equal((await enviar(`${base}/api/auth/login`, 'POST', { usuario: 'dra.ruiz', contrasena: 'ruiz12345' })).status, 401);
    await login('dra.ruiz', 'nueva12345');
    assert.equal((await enviar(`${base}/api/auth/contrasena`, 'POST', { actual: 'x', nueva: 'y' })).status, 401);
  });
});
