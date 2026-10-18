// Pruebas de la agenda del doctor (Integrante 5). Se ejecutan con: npm test
// No necesitan MySQL: la base de datos se reemplaza por una en memoria.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearServicio, ErrorAgenda } = require('../src/agenda/agenda.service');
const { validarConsulta } = require('../src/agenda/agenda.validacion');
const { simularSesion, ADMIN, DOCTOR } = require('./ayudas/sesion');

const ESTADOS_ACTIVOS = ['pendiente', 'confirmada', 'reagendada'];

// Base de datos en memoria con médicos, pacientes y citas de dos doctores.
// 2030-01-07 es lunes; el reloj de las pruebas marca ese día a las 10:00.
class BaseDatosFalsa {
  constructor() {
    this.medicos = [
      { id: 1, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría', activo: 1 },
      { id: 2, nombre: 'Dr. Luis Castillo', especialidad: 'Cardiología', activo: 1 },
    ];
    this.pacientes = [
      { id: 41, nombre: 'María López', edad: 34, telefono: '5512-3456', alergias: 'Penicilina' },
      { id: 42, nombre: 'José Pérez', edad: 58, telefono: '4423-9876', alergias: null },
      { id: 43, nombre: 'Lucía Hernández', edad: 9, telefono: '3301-2244', alergias: 'Mariscos' },
    ];
    this.citas = [
      { id: 1, medico_id: 1, paciente_id: 42, fecha: '2030-01-07', hora: '11:00', motivo: 'Control de presión', estado: 'confirmada' },
      { id: 2, medico_id: 1, paciente_id: 41, fecha: '2030-01-07', hora: '09:00', motivo: 'Fiebre y tos', estado: 'pendiente' },
      { id: 3, medico_id: 1, paciente_id: 43, fecha: '2030-01-07', hora: '10:00', motivo: 'Vacuna', estado: 'cancelada' },
      { id: 4, medico_id: 1, paciente_id: 43, fecha: '2030-01-08', hora: '09:00', motivo: 'Revisión', estado: 'reagendada' },
      { id: 5, medico_id: 2, paciente_id: 41, fecha: '2030-01-07', hora: '09:00', motivo: 'Dolor en el pecho', estado: 'confirmada' },
      { id: 6, medico_id: 1, paciente_id: 42, fecha: '2030-01-06', hora: '08:00', motivo: 'Chequeo', estado: 'atendida' },
    ];
    this.errorSiguiente = null;
  }

  fila(cita) {
    const paciente = this.pacientes.find((p) => p.id === cita.paciente_id);
    return {
      id: cita.id, hora: cita.hora, motivo: cita.motivo, estado: cita.estado, paciente_id: cita.paciente_id,
      paciente: paciente.nombre, edad: paciente.edad, telefono: paciente.telefono, alergias: paciente.alergias,
    };
  }

  async query(sql, p = []) {
    if (this.errorSiguiente && sql.includes(this.errorSiguiente.coincide)) {
      const { error } = this.errorSiguiente;
      this.errorSiguiente = null;
      throw error;
    }
    if (sql.includes('FROM medicos') && sql.includes('WHERE id = ?')) {
      return [this.medicos.filter((m) => m.id === Number(p[0])), []];
    }
    if (sql.includes('FROM citas c') && sql.includes('c.medico_id = ?') && sql.includes('c.fecha = ?')) {
      const filas = this.citas
        .filter((c) => c.medico_id === Number(p[0]) && c.fecha === p[1])
        .sort((a, b) => a.hora.localeCompare(b.hora))
        .map((c) => this.fila(c));
      return [filas, []];
    }
    if (sql.includes('FROM citas c') && sql.includes('c.id = ?')) {
      return [this.citas.filter((c) => c.id === Number(p[0])).map((c) => ({ ...this.fila(c), medico_id: c.medico_id, fecha: c.fecha })), []];
    }
    if (sql.includes("UPDATE citas SET estado = 'atendida'")) {
      const cita = this.citas.find((c) => c.id === Number(p[0]) && ESTADOS_ACTIVOS.includes(c.estado));
      if (cita) cita.estado = 'atendida';
      return [{ affectedRows: cita ? 1 : 0 }, []];
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  }
}

const ahoraPrueba = () => new Date(2030, 0, 7, 10, 0, 0);

describe('validarConsulta de agenda', () => {
  test('usa la fecha de hoy si no se indica y acepta una fecha válida', () => {
    assert.deepEqual(validarConsulta({}, ahoraPrueba()), { errores: [], datos: { fecha: '2030-01-07', medicoId: null } });
    assert.deepEqual(validarConsulta({ fecha: '2030-02-28', medico_id: '2' }, ahoraPrueba()).datos, { fecha: '2030-02-28', medicoId: 2 });
  });

  test('rechaza fecha o médico inválidos', () => {
    assert.equal(validarConsulta({ fecha: '2030-02-30' }, ahoraPrueba()).errores.length, 1);
    assert.equal(validarConsulta({ fecha: 'hoy', medico_id: '0' }, ahoraPrueba()).errores.length, 2);
  });
});

describe('servicio de agenda', () => {
  let db;
  let servicio;

  before(() => {
    db = new BaseDatosFalsa();
    servicio = crearServicio({ db, reloj: ahoraPrueba });
  });

  test('devuelve las citas del día del médico en orden de hora, con datos del paciente y resumen', async () => {
    const agenda = await servicio.obtenerAgenda({ medicoId: 1, fecha: '2030-01-07' });
    assert.deepEqual(agenda.medico, { id: 1, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría', activo: 1 });
    assert.equal(agenda.fecha, '2030-01-07');
    assert.deepEqual(agenda.citas.map((c) => [c.hora, c.paciente, c.estado]), [
      ['09:00', 'María López', 'pendiente'],
      ['10:00', 'Lucía Hernández', 'cancelada'],
      ['11:00', 'José Pérez', 'confirmada'],
    ]);
    assert.equal(agenda.citas[0].alergias, 'Penicilina');
    assert.equal(agenda.citas[0].motivo, 'Fiebre y tos');
    assert.equal(agenda.citas[0].edad, 34);
    assert.deepEqual(agenda.resumen, { total: 3, activas: 2, atendidas: 0, canceladas: 1 });
  });

  test('un día sin citas devuelve lista vacía; un médico inexistente responde 404', async () => {
    const agenda = await servicio.obtenerAgenda({ medicoId: 2, fecha: '2030-01-09' });
    assert.deepEqual(agenda.citas, []);
    assert.deepEqual(agenda.resumen, { total: 0, activas: 0, atendidas: 0, canceladas: 0 });
    await assert.rejects(servicio.obtenerAgenda({ medicoId: 99, fecha: '2030-01-07' }), { status: 404, message: 'Médico no encontrado.' });
  });

  test('marca como atendida una cita activa de hoy y la devuelve actualizada', async () => {
    const cita = await servicio.marcarAtendida({ citaId: 2, medicoId: 1 });
    assert.equal(cita.estado, 'atendida');
    assert.equal(cita.paciente, 'María López');
    assert.equal(db.citas.find((c) => c.id === 2).estado, 'atendida');
  });

  test('no atiende dos veces ni una cita cancelada (409)', async () => {
    await assert.rejects(servicio.marcarAtendida({ citaId: 2, medicoId: 1 }),
      { status: 409, message: 'La cita ya está marcada como atendida.' });
    await assert.rejects(servicio.marcarAtendida({ citaId: 3, medicoId: 1 }),
      { status: 409, message: 'No se puede atender una cita cancelada.' });
  });

  test('un doctor no puede atender citas de otro médico (403), pero el admin sí', async () => {
    await assert.rejects(servicio.marcarAtendida({ citaId: 5, medicoId: 1 }),
      { status: 403, message: 'Esa cita no pertenece a tu agenda.' });
    assert.equal(db.citas.find((c) => c.id === 5).estado, 'confirmada');
    assert.equal((await servicio.marcarAtendida({ citaId: 5, medicoId: null })).estado, 'atendida');
  });

  test('no se atiende una cita de una fecha futura (400) ni una inexistente (404)', async () => {
    await assert.rejects(servicio.marcarAtendida({ citaId: 4, medicoId: 1 }),
      { status: 400, message: 'No se puede marcar como atendida una cita de una fecha futura.' });
    await assert.rejects(servicio.marcarAtendida({ citaId: 99, medicoId: 1 }), { status: 404 });
  });

  test('si la cita cambió de estado entre la lectura y la actualización responde 409', async () => {
    db.citas.push({ id: 7, medico_id: 1, paciente_id: 41, fecha: '2030-01-07', hora: '08:00', motivo: 'Prueba', estado: 'pendiente' });
    const original = db.query.bind(db);
    db.query = async (sql, p) => {
      if (sql.includes("UPDATE citas SET estado = 'atendida'")) db.citas.find((c) => c.id === 7).estado = 'cancelada';
      return original(sql, p);
    };
    await assert.rejects(servicio.marcarAtendida({ citaId: 7, medicoId: 1 }), { status: 409 });
    db.query = original;
  });

  test('propaga errores de base de datos para manejo HTTP 500', async () => {
    db.errorSiguiente = { coincide: 'FROM citas c', error: new Error('fallo mysql de prueba') };
    await assert.rejects(servicio.obtenerAgenda({ medicoId: 1, fecha: '2030-01-07' }), /fallo mysql de prueba/);
  });
});

describe('rutas /api/agenda', () => {
  let servidor;
  let base;
  let apiDb;

  // La API usa el reloj real: las citas "de hoy" de la base falsa se mueven a la fecha de hoy
  const { fechaLocal } = require('../src/agenda/agenda.validacion');
  const hoy = fechaLocal(new Date());

  before(async () => {
    apiDb = new BaseDatosFalsa();
    for (const cita of apiDb.citas) if (cita.fecha === '2030-01-07') cita.fecha = hoy;
    const rutaDb = require.resolve('../src/comun/db');
    require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: apiDb };
    // El servicio ya se cargó arriba con el pool real: se recarga para que use la base falsa
    for (const archivo of ['../src/agenda/agenda.service', '../src/agenda/agenda.controller',
      '../src/agenda/agenda.routes', '../server']) {
      delete require.cache[require.resolve(archivo)];
    }
    simularSesion(DOCTOR); // Dra. Ana Ruiz, medico_id 1
    const app = require('../server');
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    base = `http://localhost:${servidor.address().port}/api/agenda`;
  });

  after(() => new Promise((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve()))));

  const patch = (url) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });

  test('el doctor ve su propia agenda aunque pida otro médico; sin fecha usa hoy', async () => {
    const r = await fetch(`${base}?fecha=${hoy}&medico_id=2`);
    assert.equal(r.status, 200);
    const agenda = await r.json();
    assert.equal(agenda.medico.id, 1);
    assert.equal(agenda.citas.length, 3);
    const sinFecha = await (await fetch(base)).json();
    assert.equal(sinFecha.fecha, hoy);
    assert.equal((await fetch(`${base}?fecha=2030-13-01`)).status, 400);
  });

  test('el doctor atiende su cita (200) y no la de otro médico (403)', async () => {
    const r = await patch(`${base}/citas/2/atender`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).estado, 'atendida');
    assert.equal((await patch(`${base}/citas/5/atender`)).status, 403);
    assert.equal((await patch(`${base}/citas/abc/atender`)).status, 400);
    assert.equal((await patch(`${base}/citas/99/atender`)).status, 404);
  });

  test('el admin debe elegir médico y puede ver y atender cualquier agenda', async () => {
    simularSesion(ADMIN);
    const sinMedico = await fetch(`${base}?fecha=${hoy}`);
    assert.equal(sinMedico.status, 400);
    assert.deepEqual(await sinMedico.json(), { errores: ['Selecciona un médico.'] });
    const agenda = await (await fetch(`${base}?fecha=${hoy}&medico_id=2`)).json();
    assert.equal(agenda.medico.nombre, 'Dr. Luis Castillo');
    assert.equal((await patch(`${base}/citas/5/atender`)).status, 200);
    assert.equal((await fetch(`${base}?fecha=${hoy}&medico_id=99`)).status, 404);
  });

  test('errores inesperados responden 500 con mensaje genérico', async () => {
    apiDb.errorSiguiente = { coincide: 'FROM medicos', error: new Error('fallo mysql simulado') };
    const r = await fetch(`${base}?fecha=${hoy}&medico_id=1`);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /error en el servidor/i);
  });
});
