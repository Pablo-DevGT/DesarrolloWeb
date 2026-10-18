const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearServicio } = require('../src/citas/citas.service');
const { validarSolicitud } = require('../src/citas/citas.validacion');

class BaseDatosFalsa {
  constructor() {
    this.medicos = [
      { id: 1, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría', activo: 1 },
      { id: 2, nombre: 'Dr. Luis Castillo', especialidad: 'Cardiología', activo: 1 },
    ];
    // Médico inactivo con horarios: no debe listarse ni recibir citas
    this.inactivo = { id: 3, nombre: 'Dra. Sofía Morales', especialidad: 'Dermatología', activo: 0 };
    this.pacientes = [{ id: 1 }, { id: 2 }];
    this.disponibilidades = this.medicos.flatMap((medico) =>
      Array.from({ length: 7 }, (_, indice) => ({
        medico_id: medico.id,
        dia_semana: indice + 1,
        hora_inicio: '09:00',
        hora_fin: '12:00',
        activo: 1,
      }))
    );
    this.medicos.push(this.inactivo);
    this.disponibilidades.push({ medico_id: 3, dia_semana: 1, hora_inicio: '09:00', hora_fin: '12:00', activo: 1 });
    this.citas = [];
    this.siguienteId = 1;
    this.cierres = new Map();
    this.errorSiguiente = null;
  }

  async bloquear(medicoId, conexion) {
    const anterior = this.cierres.get(medicoId) || Promise.resolve();
    let liberar;
    const cierreActual = new Promise((resolve) => { liberar = resolve; });
    this.cierres.set(medicoId, anterior.then(() => cierreActual));
    await anterior;
    conexion.liberarBloqueo = liberar;
  }

  async ejecutar(sql, parametros, conexion) {
    if (this.errorSiguiente && sql.includes(this.errorSiguiente.coincide)) {
      const error = this.errorSiguiente.error;
      this.errorSiguiente.veces = (this.errorSiguiente.veces ?? 1) - 1;
      if (this.errorSiguiente.veces <= 0) this.errorSiguiente = null;
      throw error;
    }

    if (sql.includes('SELECT id, activo FROM medicos WHERE id = ? FOR UPDATE')) {
      const medicoId = Number(parametros[0]);
      if (conexion) await this.bloquear(medicoId, conexion);
      return [this.medicos.filter((medico) => medico.id === medicoId), []];
    }
    if (sql.includes('SELECT id, activo FROM medicos WHERE id = ?')) {
      return [this.medicos.filter((medico) => medico.id === Number(parametros[0])), []];
    }
    if (sql.includes('SELECT id FROM pacientes WHERE id = ?')) {
      return [this.pacientes.filter((paciente) => paciente.id === Number(parametros[0])), []];
    }
    if (sql.includes('SELECT m.id, m.nombre, m.especialidad')) {
      return [
        this.medicos.filter((medico) => (!sql.includes('m.activo = 1') || medico.activo === 1) &&
          this.disponibilidades.some((item) => item.medico_id === medico.id && item.activo === 1)
        ),
        [],
      ];
    }
    if (sql.includes('FROM disponibilidad_medicos')) {
      const [medicoId, fecha] = parametros;
      const weekday = new Date(`${fecha}T00:00:00.000Z`).getUTCDay() || 7;
      const filas = this.disponibilidades
        .filter((item) => item.medico_id === Number(medicoId) &&
          item.dia_semana === weekday && item.activo === 1)
        .map(({ hora_inicio, hora_fin }) => ({ hora_inicio, hora_fin }));
      return [filas, []];
    }
    if (sql.includes('FROM citas c') && sql.includes('c.estado IN')) {
      const [medicoId, ...filtros] = parametros;
      const fecha = filtros[filtros.length - 2];
      const fechaMinima = new Date(`${fecha}T00:00:00.000Z`);
      fechaMinima.setUTCDate(fechaMinima.getUTCDate() - 1);
      const desde = fechaMinima.toISOString().slice(0, 10);
      return [
        this.citas.filter((cita) =>
          cita.medico_id === Number(medicoId) &&
          filtros.slice(0, 3).includes(cita.estado) &&
          cita.fecha >= desde && cita.fecha <= fecha
        ).map(({ fecha: fechaCita, hora }) => ({ fecha: fechaCita, hora })),
        [],
      ];
    }
    if (sql.includes('INSERT INTO citas')) {
      const [paciente_id, medico_id, fecha, hora, motivo] = parametros;
      const cita = {
        id: this.siguienteId++,
        paciente_id: Number(paciente_id),
        medico_id: Number(medico_id),
        fecha,
        hora,
        motivo,
        estado: 'pendiente',
      };
      this.citas.push(cita);
      return [{ insertId: cita.id }, []];
    }
    if (sql.includes('SELECT c.id, c.paciente_id')) {
      const cita = this.citas.find((item) => item.id === Number(parametros[0]));
      if (!cita) return [[], []];
      const paciente = this.pacientes.find((item) => item.id === cita.paciente_id);
      const medico = this.medicos.find((item) => item.id === cita.medico_id);
      return [[{ ...cita, paciente: 'Paciente de prueba', medico: medico.nombre, especialidad: medico.especialidad }], []];
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  }

  async query(sql, parametros = []) {
    return this.ejecutar(sql, parametros, null);
  }

  async getConnection() {
    const conexion = {
      liberarBloqueo: null,
      query: (sql, parametros = []) => this.ejecutar(sql, parametros, conexion),
      beginTransaction: async () => {},
      commit: async () => { conexion.liberarBloqueo?.(); conexion.liberarBloqueo = null; },
      rollback: async () => { conexion.liberarBloqueo?.(); conexion.liberarBloqueo = null; },
      release: () => {},
    };
    return conexion;
  }
}

const fechaPrueba = '2030-01-07';
const ahoraPrueba = () => new Date(2030, 0, 1, 8, 0, 0);
const solicitud = (sobrescritura = {}) => ({
  paciente_id: 1,
  medico_id: 1,
  fecha: fechaPrueba,
  hora: '09:00',
  motivo: 'Consulta general',
  ...sobrescritura,
});

describe('validarSolicitud', () => {
  test('rechaza datos incompletos, ids inválidos y texto fuera de límites', () => {
    assert.ok(validarSolicitud({}).errores.length >= 5);
    assert.ok(validarSolicitud(solicitud({ medico_id: 0, motivo: 'x'.repeat(256) })).errores.length >= 2);
  });
});

describe('servicio de citas', () => {
  let db;
  let servicio;

  before(() => {
    db = new BaseDatosFalsa();
    servicio = crearServicio({ db, reloj: ahoraPrueba });
  });

  test('crea una cita pendiente en un horario disponible', async () => {
    const cita = await servicio.crearSolicitud(solicitud());
    assert.equal(cita.estado, 'pendiente');
    assert.equal(cita.id, 1);
  });

  test('rechaza una segunda cita para el mismo médico y horario; pendiente bloquea', async () => {
    await assert.rejects(servicio.crearSolicitud(solicitud()), { status: 409 });
    const { horarios } = await servicio.listarHorarios(1, fechaPrueba);
    assert.ok(!horarios.includes('09:00'));
  });

  test('permite médicos diferentes al mismo tiempo y al mismo médico en otra hora', async () => {
    assert.equal((await servicio.crearSolicitud(solicitud({ medico_id: 2 }))).estado, 'pendiente');
    assert.equal((await servicio.crearSolicitud(solicitud({ hora: '10:00' }))).estado, 'pendiente');
  });

  test('rechaza solicitudes en fechas y horas pasadas', async () => {
    await assert.rejects(
      servicio.crearSolicitud(solicitud({ fecha: '2029-12-31' })),
      { status: 400 }
    );
    await assert.rejects(
      servicio.crearSolicitud(solicitud({ fecha: '2030-01-01', hora: '07:59' })),
      { status: 400 }
    );
  });

  test('permite reservar otra vez el horario al cancelar la cita anterior', async () => {
    const cita = await servicio.crearSolicitud(solicitud({ hora: '11:00' }));
    db.citas.find((item) => item.id === cita.id).estado = 'cancelada';
    assert.ok((await servicio.listarHorarios(1, fechaPrueba)).horarios.includes('11:00'));
    assert.equal((await servicio.crearSolicitud(solicitud({ hora: '11:00' }))).estado, 'pendiente');
  });

  test('detecta solapamiento de intervalos, no solo hora inicial idéntica', async () => {
    db.citas.push({
      id: 99, paciente_id: 2, medico_id: 1, fecha: fechaPrueba,
      hora: '09:30', motivo: 'Prueba', estado: 'confirmada',
    });
    const { horarios } = await servicio.listarHorarios(1, fechaPrueba);
    assert.ok(!horarios.includes('09:00'));
    assert.ok(!horarios.includes('10:00'));
  });

  test('solo una de dos solicitudes simultáneas obtiene la reserva', async () => {
    const resultados = await Promise.allSettled([
      servicio.crearSolicitud(solicitud({ fecha: '2030-01-08', hora: '09:00' })),
      servicio.crearSolicitud(solicitud({ paciente_id: 2, fecha: '2030-01-08', hora: '09:00' })),
    ]);
    assert.equal(resultados.filter((resultado) => resultado.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter((resultado) => resultado.status === 'rejected' && resultado.reason.status === 409).length, 1);
  });

  test('propaga errores de base de datos para manejo HTTP 500', async () => {
    db.errorSiguiente = { coincide: 'FROM disponibilidad_medicos', error: new Error('fallo mysql de prueba') };
    await assert.rejects(servicio.listarHorarios(1, fechaPrueba), /fallo mysql de prueba/);
  });
});

describe('rutas /api/citas', () => {
  let servidor;
  let base;
  let apiDb;

  before(async () => {
    apiDb = new BaseDatosFalsa();
    const rutaDb = require.resolve('../src/comun/db');
    require.cache[rutaDb] = {
      id: rutaDb, filename: rutaDb, loaded: true, exports: apiDb,
    };
    for (const archivo of [
      '../src/citas/citas.service',
      '../src/citas/citas.controller',
      '../src/citas/citas.routes',
      '../server',
    ]) delete require.cache[require.resolve(archivo)];
    const app = require('../server');
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    base = `http://localhost:${servidor.address().port}/api/citas`;
  });

  after(() => new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())));

  test('expone médicos disponibles y horarios', async () => {
    const medicos = await fetch(`${base}/medicos`);
    assert.equal(medicos.status, 200);
    assert.equal((await medicos.json()).length, 2);
    const horarios = await fetch(`${base}/horarios?medico_id=1&fecha=${fechaPrueba}`);
    assert.deepEqual((await horarios.json()).horarios, ['09:00', '10:00', '11:00']);
  });

  test('registra por API, devuelve 409 ante duplicado y 400 ante datos inválidos', async () => {
    const enviar = (cuerpo) => fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    assert.equal((await enviar(solicitud())).status, 201);
    assert.equal((await enviar(solicitud())).status, 409);
    assert.equal((await enviar({ paciente_id: 'inválido' })).status, 400);
  });

  test('responde 500 si falla una consulta de disponibilidad', async () => {
    apiDb.errorSiguiente = {
      coincide: 'SELECT m.id, m.nombre, m.especialidad',
      error: new Error('fallo mysql simulado'),
    };
    const respuesta = await fetch(`${base}/medicos`);
    assert.equal(respuesta.status, 500);
    assert.match((await respuesta.json()).error, /error en el servidor/i);
  });

  test('médico inactivo: no se lista, no ofrece horarios y la solicitud responde 409', async () => {
    const medicos = await (await fetch(`${base}/medicos`)).json();
    assert.ok(!medicos.some((medico) => medico.id === 3));
    const horarios = await fetch(`${base}/horarios?medico_id=3&fecha=${fechaPrueba}`);
    assert.equal(horarios.status, 200);
    assert.deepEqual(await horarios.json(), { medico_id: 3, fecha: fechaPrueba, horarios: [] });
    const respuesta = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solicitud({ medico_id: 3, hora: '10:00' })),
    });
    assert.equal(respuesta.status, 409);
    assert.deepEqual(await respuesta.json(), { error: 'El médico seleccionado no está disponible para nuevas citas.' });
  });

  test('responde 503 cuando se agotan los reintentos por interbloqueo', async () => {
    const interbloqueo = Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
    apiDb.errorSiguiente = { coincide: 'INSERT INTO citas', error: interbloqueo, veces: 3 };
    const respuesta = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(solicitud({ fecha: '2030-01-14', hora: '11:00' })),
    });
    assert.equal(respuesta.status, 503);
    assert.deepEqual(await respuesta.json(), { error: 'El sistema está ocupado. Intenta nuevamente en unos momentos' });
  });
});

describe('servicio de citas: reglas de la base de datos e interbloqueos', () => {
  const errorMysql = (code, message, errno) => Object.assign(new Error(message), { code, errno });
  let db;
  let servicio;

  before(() => {
    db = new BaseDatosFalsa();
    servicio = crearServicio({ db, reloj: ahoraPrueba });
  });

  test('rechaza con 409 la solicitud para un médico inactivo sin insertar', async () => {
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 3 })),
      { status: 409, message: 'El médico seleccionado no está disponible para nuevas citas.' });
    assert.equal(db.citas.length, 0);
  });

  test('distingue el conflicto del paciente (trigger) del conflicto del médico', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas',
      error: errorMysql('ER_DUP_ENTRY', 'El paciente ya tiene una cita activa que se superpone con ese horario.', 1062),
    };
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 2 })),
      { status: 409, message: 'El paciente ya tiene una cita activa que se superpone con ese horario.' });

    db.errorSiguiente = {
      coincide: 'INSERT INTO citas',
      error: errorMysql('ER_DUP_ENTRY', "Duplicate entry '1-2030-01-07-09:00:00-1' for key 'citas.uq_cita_paciente_horario_activo'", 1062),
    };
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 2 })),
      { status: 409, message: 'El paciente ya tiene una cita activa que se superpone con ese horario.' });

    db.errorSiguiente = {
      coincide: 'INSERT INTO citas',
      error: errorMysql('ER_DUP_ENTRY', 'El médico ya tiene una cita activa que se superpone con ese horario.', 1062),
    };
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 2 })),
      { status: 409, message: 'El horario ya está ocupado. Selecciona otro horario.' });
  });

  test('traduce el rechazo del trigger por médico inactivo a 409', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas',
      error: errorMysql('ER_SIGNAL_EXCEPTION', 'El médico está inactivo y no puede recibir nuevas citas.', 1644),
    };
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 2, hora: '11:00' })),
      { status: 409, message: 'El médico seleccionado no está disponible para nuevas citas.' });
  });

  test('si el horario cambió antes del registro (trigger de disponibilidad) responde el 400 existente', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas',
      error: errorMysql('ER_SIGNAL_EXCEPTION', 'La cita está fuera del horario de atención del médico.', 1644),
    };
    const antes = db.citas.length;
    await assert.rejects(servicio.crearSolicitud(solicitud({ medico_id: 2, hora: '10:00' })),
      { status: 400, message: 'El horario no corresponde a la disponibilidad del médico.' });
    assert.equal(db.citas.length, antes);
  });

  test('reintenta la transacción tras un interbloqueo 1213 y registra la cita una sola vez', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas', error: errorMysql('ER_LOCK_DEADLOCK', 'Deadlock found', 1213), veces: 2,
    };
    const antes = db.citas.length;
    const cita = await servicio.crearSolicitud(solicitud({ fecha: '2030-01-14', hora: '09:00' }));
    assert.equal(cita.estado, 'pendiente');
    assert.equal(db.citas.length, antes + 1);
  });

  test('tras tres interbloqueos responde 503 y no lo confunde con un conflicto de horario', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas', error: errorMysql('ER_LOCK_DEADLOCK', 'Deadlock found', 1213), veces: 3,
    };
    const antes = db.citas.length;
    await assert.rejects(servicio.crearSolicitud(solicitud({ fecha: '2030-01-14', hora: '10:00' })),
      { status: 503, message: 'El sistema está ocupado. Intenta nuevamente en unos momentos' });
    assert.equal(db.citas.length, antes);
    assert.equal(db.errorSiguiente, null);
  });

  test('otros errores de MySQL no se reintentan y se propagan para HTTP 500', async () => {
    db.errorSiguiente = {
      coincide: 'INSERT INTO citas', error: errorMysql('ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout', 1205), veces: 2,
    };
    await assert.rejects(servicio.crearSolicitud(solicitud({ fecha: '2030-01-14', hora: '11:00' })), { code: 'ER_LOCK_WAIT_TIMEOUT' });
    assert.equal(db.errorSiguiente.veces, 1, 'debe intentarse una sola vez');
    db.errorSiguiente = null;
  });
});
