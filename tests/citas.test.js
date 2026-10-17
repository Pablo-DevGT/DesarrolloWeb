const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearServicio } = require('../src/citas/citas.service');
const { validarSolicitud } = require('../src/citas/citas.validacion');

class BaseDatosFalsa {
  constructor() {
    this.medicos = [
      { id: 1, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría' },
      { id: 2, nombre: 'Dr. Luis Castillo', especialidad: 'Cardiología' },
    ];
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
      this.errorSiguiente = null;
      throw error;
    }

    if (sql.includes('SELECT id FROM medicos WHERE id = ? FOR UPDATE')) {
      const medicoId = Number(parametros[0]);
      if (conexion) await this.bloquear(medicoId, conexion);
      return [this.medicos.filter((medico) => medico.id === medicoId), []];
    }
    if (sql.includes('SELECT id FROM medicos WHERE id = ?')) {
      return [this.medicos.filter((medico) => medico.id === Number(parametros[0])), []];
    }
    if (sql.includes('SELECT id FROM pacientes WHERE id = ?')) {
      return [this.pacientes.filter((paciente) => paciente.id === Number(parametros[0])), []];
    }
    if (sql.includes('SELECT m.id, m.nombre, m.especialidad')) {
      return [
        this.medicos.filter((medico) =>
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
});
