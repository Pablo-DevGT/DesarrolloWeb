const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reglas = require('../public/medicos/reglas');
const validacion = require('../src/medicos/medicos.validacion');
const { crearServicio, citasQueQuedanFuera } = require('../src/medicos/medicos.service');

const errorMysql = (code, message, errno) => Object.assign(new Error(message), { code, errno });

// Base de datos en memoria que responde a las consultas de medicos.service.js.
// Simula el cerrojo SELECT ... FOR UPDATE por médico y los índices únicos.
class BaseDatosFalsa {
  constructor() {
    this.medicos = [
      { id: 1, nombre: 'Dra. Ana Ruiz', especialidad: 'Pediatría', colegiado: '10002', telefono: '2233-6677', email: 'ana.ruiz@ejemplo.com', activo: 1 },
      { id: 2, nombre: 'Dr. Luis Castillo', especialidad: 'Cardiología', colegiado: '10003', telefono: null, email: null, activo: 1 },
    ];
    this.horarios = [
      { id: 1, medico_id: 1, dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00', activo: 1 },
      { id: 2, medico_id: 1, dia_semana: 2, hora_inicio: '08:00', hora_fin: '12:00', activo: 1 },
    ];
    // 2030-01-07 es lunes y 2030-01-08 es martes
    this.citas = [
      { id: 1, medico_id: 1, fecha: '2030-01-07', hora: '09:00', estado: 'confirmada', paciente: 'María López' },
      { id: 2, medico_id: 1, fecha: '2030-01-07', hora: '11:00', estado: 'cancelada', paciente: 'José Pérez' },
      { id: 3, medico_id: 1, fecha: '2029-12-31', hora: '09:00', estado: 'pendiente', paciente: 'Cita pasada' },
    ];
    // Filas de la vista v_citas_por_revisar
    this.porRevisar = [
      { cita_id: 7, medico_id: 1, fecha: '2030-01-09', hora: '15:00', estado: 'confirmada', paciente: 'Ana Pérez',
        medico_inactivo: 0, fuera_de_disponibilidad: 1, motivo_revision: 'Fuera del horario de atención' },
    ];
    this.siguiente = { medicos: 3, horarios: 3 };
    this.cierres = new Map();
    this.errorSiguiente = null;
  }

  async bloquear(medicoId, conexion) {
    if (conexion.bloqueos.has(medicoId)) return;
    const anterior = this.cierres.get(medicoId) || Promise.resolve();
    let liberar;
    const actual = new Promise((resolve) => { liberar = resolve; });
    this.cierres.set(medicoId, anterior.then(() => actual));
    await anterior;
    conexion.bloqueos.set(medicoId, liberar);
  }

  duplicado(valor, clave) {
    return errorMysql('ER_DUP_ENTRY', `Duplicate entry '${valor}' for key '${clave}'`, 1062);
  }

  verificarUnicos(datos, idPropio = 0) {
    const otro = (campo) => this.medicos.find((m) => m.id !== idPropio && datos[campo] &&
      String(m[campo] || '').toLowerCase() === String(datos[campo]).toLowerCase());
    if (otro('colegiado')) throw this.duplicado(datos.colegiado, 'medicos.uq_medico_colegiado');
    if (otro('email')) throw this.duplicado(datos.email, 'medicos.uq_medico_email');
  }

  async ejecutar(sql, p = [], conexion = null) {
    if (this.errorSiguiente && sql.includes(this.errorSiguiente.coincide)) {
      const { error } = this.errorSiguiente;
      this.errorSiguiente.veces = (this.errorSiguiente.veces ?? 1) - 1;
      if (this.errorSiguiente.veces <= 0) this.errorSiguiente = null;
      throw error;
    }
    const horario = (h) => ({ ...h });

    if (sql.includes('SELECT id, activo FROM medicos WHERE id = ? FOR UPDATE')) {
      const id = Number(p[0]);
      if (conexion) await this.bloquear(id, conexion);
      return [this.medicos.filter((m) => m.id === id).map(({ id: i, activo }) => ({ id: i, activo })), []];
    }
    if (sql.includes('FROM v_citas_por_revisar')) {
      return [this.porRevisar.filter((c) => c.medico_id === Number(p[0]))
        .map(({ cita_id, medico_id, ...resto }) => ({ id: cita_id, ...resto })), []];
    }
    if (sql.includes('SELECT id FROM medicos WHERE id = ?')) {
      return [this.medicos.filter((m) => m.id === Number(p[0])).map(({ id }) => ({ id })), []];
    }
    if (sql.includes('FROM disponibilidad_medicos WHERE id = ? AND medico_id = ? FOR UPDATE')) {
      return [this.horarios.filter((h) => h.id === Number(p[0]) && h.medico_id === Number(p[1])).map(horario), []];
    }
    if (sql.includes('AND hora_inicio < ? AND ? < hora_fin')) {
      const [medicoId, dia, excluir, fin, inicio] = p;
      return [this.horarios.filter((h) => h.medico_id === medicoId && h.dia_semana === dia && h.activo === 1 &&
        h.id !== excluir && h.hora_inicio < fin && inicio < h.hora_fin).map(horario), []];
    }
    if (sql.includes('FROM disponibilidad_medicos WHERE medico_id = ? AND activo = 1')) {
      return [this.horarios.filter((h) => h.medico_id === p[0] && h.activo === 1).map(horario), []];
    }
    if (sql.includes('FROM disponibilidad_medicos WHERE medico_id = ?')) {
      return [this.horarios.filter((h) => h.medico_id === Number(p[0]))
        .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)).map(horario), []];
    }
    if (sql.includes('FROM disponibilidad_medicos WHERE id = ?')) {
      return [this.horarios.filter((h) => h.id === Number(p[0])).map(horario), []];
    }
    if (sql.includes('FROM citas c') && sql.includes('c.fecha > ?')) {
      const [medicoId, e1, e2, e3, fecha, , hora] = p;
      return [this.citas.filter((c) => c.medico_id === medicoId && [e1, e2, e3].includes(c.estado) &&
        (c.fecha > fecha || (c.fecha === fecha && c.hora >= hora))), []];
    }
    if (sql.includes('INSERT INTO disponibilidad_medicos')) {
      const [medico_id, dia_semana, hora_inicio, hora_fin] = p;
      if (this.horarios.some((h) => h.medico_id === medico_id && h.dia_semana === dia_semana && h.hora_inicio === hora_inicio)) {
        throw this.duplicado(`${medico_id}-${dia_semana}-${hora_inicio}`, 'disponibilidad_medicos.uq_disponibilidad_inicio');
      }
      const nuevo = { id: this.siguiente.horarios++, medico_id, dia_semana, hora_inicio, hora_fin, activo: 1 };
      this.horarios.push(nuevo);
      return [{ insertId: nuevo.id }, []];
    }
    if (sql.includes('UPDATE disponibilidad_medicos SET dia_semana')) {
      const [dia_semana, hora_inicio, hora_fin, id] = p;
      Object.assign(this.horarios.find((h) => h.id === id), { dia_semana, hora_inicio, hora_fin });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('UPDATE disponibilidad_medicos SET activo')) {
      this.horarios.find((h) => h.id === p[1]).activo = p[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO medicos')) {
      const [nombre, especialidad, colegiado, telefono, email] = p;
      this.verificarUnicos({ colegiado, email });
      const nuevo = { id: this.siguiente.medicos++, nombre, especialidad, colegiado, telefono, email, activo: 1 };
      this.medicos.push(nuevo);
      return [{ insertId: nuevo.id }, []];
    }
    if (sql.includes('UPDATE medicos SET nombre')) {
      const [nombre, especialidad, colegiado, telefono, email, id] = p;
      this.verificarUnicos({ colegiado, email }, id);
      Object.assign(this.medicos.find((m) => m.id === id), { nombre, especialidad, colegiado, telefono, email });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('UPDATE medicos SET activo')) {
      this.medicos.find((m) => m.id === p[1]).activo = p[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('FROM medicos m WHERE m.id = ?')) {
      return [this.medicos.filter((m) => m.id === Number(p[0])).map((m) => ({ ...m })), []];
    }
    if (sql.includes('SELECT DISTINCT especialidad')) {
      return [[...new Set(this.medicos.map((m) => m.especialidad))].sort().map((especialidad) => ({ especialidad })), []];
    }
    if (sql.includes('AS horarios_activos')) {
      const valores = [...p];
      let lista = this.medicos.map((m) => ({
        ...m, horarios_activos: this.horarios.filter((h) => h.medico_id === m.id && h.activo === 1).length,
      }));
      if (sql.includes('LIKE')) {
        const q = valores.splice(0, 3)[0].slice(1, -1).toLowerCase();
        lista = lista.filter((m) => [m.nombre, m.especialidad, m.colegiado].some((v) => v.toLowerCase().includes(q)));
      }
      if (sql.includes('m.especialidad = ?')) { const e = valores.shift(); lista = lista.filter((m) => m.especialidad === e); }
      if (sql.includes('m.activo = ?')) { const a = valores.shift(); lista = lista.filter((m) => m.activo === a); }
      return [lista, []];
    }
    throw new Error(`Consulta no simulada: ${sql}`);
  }

  query(sql, p) { return this.ejecutar(sql, p, null); }

  async getConnection() {
    const liberarTodo = () => { for (const liberar of conexion.bloqueos.values()) liberar(); conexion.bloqueos.clear(); };
    const conexion = {
      bloqueos: new Map(),
      query: (sql, p) => this.ejecutar(sql, p, conexion),
      beginTransaction: async () => {},
      commit: async () => liberarTodo(),
      rollback: async () => liberarTodo(),
      release: () => {},
    };
    return conexion;
  }
}

// 2030-01-01 08:00 hora local
const reloj = () => new Date(2030, 0, 1, 8, 0, 0);

describe('reglas de validación de médicos', () => {
  test('el servidor usa exactamente las reglas del navegador', () => {
    assert.equal(validacion.validarMedico, reglas.validarMedico);
    assert.equal(validacion.validarHorario, reglas.validarHorario);
  });

  test('acepta un médico solo con los campos obligatorios y limpia los datos', () => {
    const { errores, datos } = reglas.validarMedico({ nombre: '  Dr. Pablo Gómez ', especialidad: 'Neurología', colegiado: ' ab-123 ' });
    assert.deepEqual(errores, []);
    assert.deepEqual(datos, { nombre: 'Dr. Pablo Gómez', especialidad: 'Neurología', colegiado: 'AB-123', telefono: null, email: null });
  });

  test('valida teléfono y correo solo cuando se proporcionan', () => {
    const base = { nombre: 'Dr. Pablo Gómez', especialidad: 'Neurología', colegiado: 'NEU-200' };
    assert.deepEqual(reglas.validarMedico({ ...base, telefono: '(502) 2233-4455', email: 'PABLO@Ejemplo.com' }).errores, []);
    assert.equal(reglas.validarMedico({ ...base, email: 'PABLO@Ejemplo.com' }).datos.email, 'pablo@ejemplo.com');
    assert.equal(reglas.validarMedico({ ...base, telefono: '123' }).errores.length, 1);
    assert.equal(reglas.validarMedico({ ...base, telefono: '2233-4455x' }).errores.length, 1);
    assert.equal(reglas.validarMedico({ ...base, email: 'sin-arroba.com' }).errores.length, 1);
    assert.equal(reglas.validarMedico({ ...base, email: `${'a'.repeat(110)}@ejemplo.com` }).errores.length, 1);
  });

  test('rechaza campos obligatorios vacíos, demasiado largos o con formato inválido', () => {
    assert.equal(reglas.validarMedico({}).errores.length, 3);
    const largo = reglas.validarMedico({ nombre: 'x'.repeat(121), especialidad: 'y'.repeat(81), colegiado: '1'.repeat(21) });
    assert.equal(largo.errores.length, 3);
    assert.equal(reglas.validarMedico({ nombre: 'Dr. X Y', especialidad: 'General', colegiado: '12 34' }).errores.length, 1);
    assert.equal(reglas.validarMedico({ nombre: '  ab ', especialidad: 'General', colegiado: '1234' }).errores.length, 1);
  });

  test('valida día, formato y duración mínima de los horarios', () => {
    assert.deepEqual(reglas.validarHorario({ dia_semana: '3', hora_inicio: '08:00', hora_fin: '12:00' }),
      { errores: [], datos: { dia_semana: 3, hora_inicio: '08:00', hora_fin: '12:00' } });
    assert.equal(reglas.validarHorario({ dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '09:00:00' }).errores.length, 0);
    for (const dia of [0, 8, '1.5', '', 'lunes']) {
      assert.equal(reglas.validarHorario({ dia_semana: dia, hora_inicio: '08:00', hora_fin: '12:00' }).errores.length, 1, `día ${dia}`);
    }
    assert.equal(reglas.validarHorario({ dia_semana: 1, hora_inicio: '8:00', hora_fin: '24:00' }).errores.length, 2);
    assert.match(reglas.validarHorario({ dia_semana: 1, hora_inicio: '12:00', hora_fin: '08:00' }).errores[0], /posterior/);
    assert.match(reglas.validarHorario({ dia_semana: 1, hora_inicio: '08:00', hora_fin: '08:59' }).errores[0], /60 minutos/);
  });

  test('los límites coinciden con el formulario HTML y con las columnas de MySQL', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/medicos/formulario.html'), 'utf8');
    const sql = fs.readFileSync(path.join(__dirname, '../database/01_esquema.sql'), 'utf8');
    for (const [campo, { min, max }] of Object.entries(reglas.LIMITES)) {
      const input = html.match(new RegExp(`<input id="${campo}"[^>]*>`, 's'))[0];
      assert.match(input, new RegExp(`maxlength="${max}"`), `maxlength de ${campo}`);
      if (min) assert.match(input, new RegExp(`minlength="${min}"`), `minlength de ${campo}`);
      assert.match(sql, new RegExp(`\\n\\s+${campo}\\s+VARCHAR\\(${max}\\)`), `columna ${campo} VARCHAR(${max})`);
    }
  });

  test('filtros y estado del listado', () => {
    assert.deepEqual(validacion.validarFiltros({ q: ' ruiz ', activo: '0' }), { q: 'ruiz', especialidad: '', activo: false });
    assert.equal(validacion.validarFiltros({ activo: 'x' }).activo, null);
    assert.deepEqual(validacion.validarEstado({ activo: false, confirmar: true }),
      { errores: [], datos: { activo: false, confirmar: true, citasConfirmadas: null } });
    assert.deepEqual(validacion.validarConfirmacion({ confirmar: 'true', citas_confirmadas: [3, '7', 'x', -1] }),
      { confirmar: true, citasConfirmadas: [3, 7] });
    assert.deepEqual(validacion.validarConfirmacion({ confirmar: true, citas_confirmadas: 'todas' }).citasConfirmadas, []);
    assert.equal(validacion.validarEstado({}).errores.length, 1);
    assert.equal(validacion.idPositivo('0'), null);
    assert.equal(validacion.idPositivo('12'), 12);
  });
});

describe('citas que quedan fuera de la disponibilidad', () => {
  const lunes = { dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00' };
  const citas = [{ fecha: '2030-01-07', hora: '08:00' }, { fecha: '2030-01-07', hora: '11:00' }];

  test('solo cuenta citas cubiertas antes y no después del cambio', () => {
    assert.deepEqual(citasQueQuedanFuera(citas, [lunes], [lunes]), []);
    assert.deepEqual(citasQueQuedanFuera(citas, [lunes], []), citas);
    assert.deepEqual(citasQueQuedanFuera(citas, [lunes], [{ ...lunes, hora_fin: '11:30' }]), [citas[1]]);
    assert.deepEqual(citasQueQuedanFuera(citas, [lunes], [{ ...lunes, dia_semana: 2 }]), citas);
    assert.deepEqual(citasQueQuedanFuera(citas, [], []), [], 'citas que ya estaban fuera no se atribuyen al cambio');
  });
});

describe('servicio de médicos', () => {
  let db;
  let servicio;

  before(() => {
    db = new BaseDatosFalsa();
    servicio = crearServicio({ db, reloj });
  });

  test('registra, lista, busca y filtra médicos', async () => {
    const nuevo = await servicio.crear({ nombre: 'Dr. Pablo Gómez', especialidad: 'Neurología', colegiado: 'N-100', telefono: null, email: null });
    assert.equal(nuevo.activo, 1);
    assert.deepEqual(nuevo.horarios, []);
    assert.equal((await servicio.listar()).length, 3);
    assert.deepEqual((await servicio.listar({ q: 'n-1' })).map((m) => m.id), [nuevo.id]);
    assert.deepEqual((await servicio.listar({ q: 'cardio' })).map((m) => m.id), [2]);
    assert.deepEqual((await servicio.listar({ especialidad: 'Pediatría' })).map((m) => m.id), [1]);
    assert.deepEqual(await servicio.especialidades(), ['Cardiología', 'Neurología', 'Pediatría']);
  });

  test('rechaza colegiado y correo duplicados con 409 y mensaje específico', async () => {
    const base = { nombre: 'Dr. Duplicado', especialidad: 'General', telefono: null, email: null };
    await assert.rejects(servicio.crear({ ...base, colegiado: '10002' }),
      { status: 409, message: 'Ya existe un médico registrado con ese número de colegiado.' });
    await assert.rejects(servicio.crear({ ...base, colegiado: '99999', email: 'ANA.RUIZ@ejemplo.com' }),
      { status: 409, message: 'Ya existe un médico registrado con ese correo electrónico.' });
    await assert.rejects(servicio.actualizar(2, { ...base, colegiado: '10002' }), { status: 409 });
  });

  test('edita un médico y responde 404 si no existe', async () => {
    const editado = await servicio.actualizar(2, {
      nombre: 'Dr. Luis A. Castillo', especialidad: 'Cardiología', colegiado: '10003', telefono: '2233-8899', email: null,
    });
    assert.equal(editado.nombre, 'Dr. Luis A. Castillo');
    assert.equal(editado.telefono, '2233-8899');
    await assert.rejects(servicio.actualizar(99, editado), { status: 404, message: 'Médico no encontrado.' });
  });

  test('desactivar con citas futuras activas pide confirmación y no cambia nada', async () => {
    await assert.rejects(servicio.cambiarEstado(1, { activo: false }), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.detalle.requiere_confirmacion, true);
      assert.deepEqual(error.detalle.citas_afectadas.map((c) => c.id), [1], 'excluye canceladas y pasadas');
      return true;
    });
    assert.equal(db.medicos[0].activo, 1);
    assert.equal(db.citas[0].estado, 'confirmada');
  });

  test('consulta las citas futuras activas antes de desactivar', async () => {
    assert.deepEqual((await servicio.citasFuturas(1)).map((c) => c.id), [1]);
    assert.deepEqual(await servicio.citasFuturas(2), []);
    await assert.rejects(servicio.citasFuturas(99), { status: 404 });
  });

  test('lista las citas por revisar con su motivo', async () => {
    assert.deepEqual(await servicio.citasPorRevisar(1), [{
      id: 7, fecha: '2030-01-09', hora: '15:00', estado: 'confirmada', paciente: 'Ana Pérez',
      medico_inactivo: false, fuera_de_disponibilidad: true, motivo_revision: 'Fuera del horario de atención',
    }]);
    assert.deepEqual(await servicio.citasPorRevisar(2), []);
    await assert.rejects(servicio.citasPorRevisar(99), { status: 404, message: 'Médico no encontrado.' });
  });

  test('si aparece una cita que el usuario no vio, vuelve a pedir confirmación', async () => {
    db.citas.push({ id: 50, medico_id: 1, fecha: '2030-01-07', hora: '10:00', estado: 'pendiente', paciente: 'Cita nueva' });
    await assert.rejects(servicio.cambiarEstado(1, { activo: false, confirmar: true, citasConfirmadas: [1] }), (error) => {
      assert.equal(error.status, 409);
      assert.deepEqual(error.detalle.citas_afectadas.map((c) => c.id), [1, 50]);
      return true;
    });
    assert.equal(db.medicos[0].activo, 1, 'no se aplicó');
    await assert.rejects(servicio.cambiarEstadoHorario(1, 1, { activo: false, confirmar: true, citasConfirmadas: [1] }), { status: 409 });
    assert.equal(db.horarios[0].activo, 1, 'no se aplicó');
    const { medico } = await servicio.cambiarEstado(1, { activo: false, confirmar: true, citasConfirmadas: [1, 50] });
    assert.equal(medico.activo, 0);
    db.citas.pop();
    await servicio.cambiarEstado(1, { activo: true });
  });

  test('desactiva al confirmar sin tocar las citas y vuelve a activar', async () => {
    const { medico, citas_futuras_activas } = await servicio.cambiarEstado(1, { activo: false, confirmar: true });
    assert.equal(medico.activo, 0);
    assert.equal(citas_futuras_activas.length, 1);
    assert.equal(db.citas[0].estado, 'confirmada');
    assert.equal((await servicio.listar({ activo: false })).length, 1);
    assert.equal((await servicio.cambiarEstado(1, { activo: true })).medico.activo, 1);
  });

  test('desactiva sin confirmación si no tiene citas futuras', async () => {
    const { medico, citas_futuras_activas } = await servicio.cambiarEstado(2, { activo: false });
    assert.equal(medico.activo, 0);
    assert.deepEqual(citas_futuras_activas, []);
    await servicio.cambiarEstado(2, { activo: true });
  });

  test('agrega horarios y rechaza los que se superponen en el mismo día', async () => {
    const tarde = await servicio.crearHorario(1, { dia_semana: 1, hora_inicio: '12:00', hora_fin: '16:00' });
    assert.equal(tarde.activo, 1);
    await assert.rejects(servicio.crearHorario(1, { dia_semana: 1, hora_inicio: '11:00', hora_fin: '13:00' }),
      { status: 409, message: 'El horario se superpone con otro horario activo del lunes (08:00–12:00).' });
    await assert.rejects(servicio.crearHorario(1, { dia_semana: 1, hora_inicio: '07:00', hora_fin: '18:00' }), { status: 409 });
    assert.ok(await servicio.crearHorario(1, { dia_semana: 3, hora_inicio: '11:00', hora_fin: '13:00' }), 'otro día no choca');
    assert.ok(await servicio.crearHorario(2, { dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00' }), 'otro médico no choca');
    await assert.rejects(servicio.crearHorario(99, { dia_semana: 1, hora_inicio: '08:00', hora_fin: '09:00' }), { status: 404 });
  });

  test('de dos horarios simultáneos superpuestos solo se guarda uno', async () => {
    const resultados = await Promise.allSettled([
      servicio.crearHorario(1, { dia_semana: 5, hora_inicio: '08:00', hora_fin: '12:00' }),
      servicio.crearHorario(1, { dia_semana: 5, hora_inicio: '10:00', hora_fin: '14:00' }),
    ]);
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter((r) => r.status === 'rejected' && r.reason.status === 409).length, 1);
    assert.equal(db.horarios.filter((h) => h.medico_id === 1 && h.dia_semana === 5).length, 1);
  });

  test('un horario inactivo que empieza a la misma hora responde 409 claro', async () => {
    const h = await servicio.crearHorario(1, { dia_semana: 6, hora_inicio: '08:00', hora_fin: '10:00' });
    await servicio.cambiarEstadoHorario(1, h.id, { activo: false });
    await assert.rejects(servicio.crearHorario(1, { dia_semana: 6, hora_inicio: '08:00', hora_fin: '09:00' }),
      { status: 409, message: /Ya existe otro horario/ });
  });

  test('modificar un horario que deja citas fuera pide confirmación; al confirmar no toca las citas', async () => {
    const recorte = { dia_semana: 1, hora_inicio: '10:00', hora_fin: '12:00' };
    await assert.rejects(servicio.actualizarHorario(1, 1, recorte), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.detalle.requiere_confirmacion, true);
      assert.deepEqual(error.detalle.citas_afectadas.map((c) => c.id), [1]);
      return true;
    });
    assert.equal(db.horarios[0].hora_inicio, '08:00', 'sin confirmar no cambia');
    const { horario, citas_fuera_de_disponibilidad } = await servicio.actualizarHorario(1, 1, recorte, { confirmar: true });
    assert.equal(horario.hora_inicio, '10:00');
    assert.equal(citas_fuera_de_disponibilidad.length, 1);
    assert.equal(db.citas[0].estado, 'confirmada');
    await servicio.actualizarHorario(1, 1, { dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00' });
  });

  test('ampliar un horario no pide confirmación y editar no puede crear solapamientos', async () => {
    const { citas_fuera_de_disponibilidad } = await servicio.actualizarHorario(1, 2, { dia_semana: 2, hora_inicio: '07:00', hora_fin: '13:00' });
    assert.deepEqual(citas_fuera_de_disponibilidad, []);
    await assert.rejects(servicio.actualizarHorario(1, 2, { dia_semana: 1, hora_inicio: '09:00', hora_fin: '10:00' }), { status: 409 });
    await assert.rejects(servicio.actualizarHorario(1, 99, { dia_semana: 2, hora_inicio: '07:00', hora_fin: '13:00' }),
      { status: 404, message: 'Horario no encontrado.' });
    await assert.rejects(servicio.actualizarHorario(2, 1, { dia_semana: 2, hora_inicio: '07:00', hora_fin: '13:00' }),
      { status: 404 }, 'un horario de otro médico no se encuentra');
  });

  test('desactivar un horario con citas futuras pide confirmación; activarlo revisa solapamientos', async () => {
    await assert.rejects(servicio.cambiarEstadoHorario(1, 1, { activo: false }), { status: 409 });
    const { horario, citas_fuera_de_disponibilidad } = await servicio.cambiarEstadoHorario(1, 1, { activo: false, confirmar: true });
    assert.equal(horario.activo, 0);
    assert.equal(citas_fuera_de_disponibilidad.length, 1);
    const solapado = await servicio.crearHorario(1, { dia_semana: 1, hora_inicio: '09:00', hora_fin: '11:00' });
    await assert.rejects(servicio.cambiarEstadoHorario(1, 1, { activo: true }), { status: 409, message: /se superpone/ });
    await servicio.cambiarEstadoHorario(1, solapado.id, { activo: false, confirmar: true });
    assert.equal((await servicio.cambiarEstadoHorario(1, 1, { activo: true })).horario.activo, 1);
  });

  test('reintenta tras un interbloqueo y responde 503 al agotar los tres intentos', async () => {
    db.errorSiguiente = { coincide: 'INSERT INTO disponibilidad_medicos', error: errorMysql('ER_LOCK_DEADLOCK', 'Deadlock', 1213), veces: 2 };
    assert.ok(await servicio.crearHorario(2, { dia_semana: 4, hora_inicio: '08:00', hora_fin: '10:00' }));
    db.errorSiguiente = { coincide: 'INSERT INTO disponibilidad_medicos', error: errorMysql('ER_LOCK_DEADLOCK', 'Deadlock', 1213), veces: 3 };
    await assert.rejects(servicio.crearHorario(2, { dia_semana: 4, hora_inicio: '12:00', hora_fin: '14:00' }),
      { status: 503, message: 'El sistema está ocupado. Intenta nuevamente en unos momentos' });
    assert.equal(db.horarios.filter((h) => h.medico_id === 2 && h.dia_semana === 4).length, 1);
  });

  test('traduce los rechazos de los triggers de disponibilidad (solapamiento 409, duración 400)', async () => {
    const solape = 'El horario se superpone con otro horario activo del jueves (08:00–10:00).';
    db.errorSiguiente = { coincide: 'INSERT INTO disponibilidad_medicos', error: errorMysql('ER_DUP_ENTRY', solape, 1062) };
    await assert.rejects(servicio.crearHorario(2, { dia_semana: 6, hora_inicio: '08:00', hora_fin: '10:00' }), { status: 409, message: solape });
    const duracion = 'El horario debe durar al menos 60 minutos (la duración de una cita).';
    db.errorSiguiente = { coincide: 'UPDATE disponibilidad_medicos SET dia_semana', error: errorMysql('ER_SIGNAL_EXCEPTION', duracion, 1644) };
    await assert.rejects(servicio.actualizarHorario(2, db.horarios.find((h) => h.medico_id === 2).id,
      { dia_semana: 1, hora_inicio: '08:00', hora_fin: '12:00' }), { status: 400, message: duracion });
  });

  test('traduce violaciones CHECK a 400 y propaga los errores desconocidos', async () => {
    db.errorSiguiente = { coincide: 'INSERT INTO medicos', error: errorMysql('ER_CHECK_CONSTRAINT_VIOLATED', "Check constraint 'chk_medico_nombre' is violated.", 3819) };
    await assert.rejects(servicio.crear({ nombre: 'Dr. X', especialidad: 'General', colegiado: 'C-1', telefono: null, email: null }), { status: 400 });
    db.errorSiguiente = { coincide: 'FROM medicos m WHERE m.id = ?', error: new Error('fallo mysql de prueba') };
    await assert.rejects(servicio.obtener(1), /fallo mysql de prueba/);
  });
});

describe('rutas /api/medicos', () => {
  let servidor;
  let base;
  let apiDb;

  before(async () => {
    apiDb = new BaseDatosFalsa();
    const rutaDb = require.resolve('../src/comun/db');
    require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: apiDb };
    for (const archivo of ['../src/medicos/medicos.service', '../src/medicos/medicos.controller',
      '../src/medicos/medicos.routes', '../server']) {
      delete require.cache[require.resolve(archivo)];
    }
    const app = require('../server');
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once('listening', resolve));
    base = `http://localhost:${servidor.address().port}/api/medicos`;
  });

  after(() => new Promise((resolve, reject) => servidor.close((e) => (e ? reject(e) : resolve()))));

  const enviar = (url, metodo, cuerpo) => fetch(url, {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });

  test('registra (201), valida (400) y rechaza colegiado duplicado (409)', async () => {
    const r = await enviar(base, 'POST', { nombre: 'Dra. Sara Paz', especialidad: 'Ginecología', colegiado: 'g-77', email: '' });
    assert.equal(r.status, 201);
    const medico = await r.json();
    assert.equal(medico.colegiado, 'G-77');
    assert.equal(medico.email, null);

    const invalido = await enviar(base, 'POST', { nombre: 'A', telefono: '1' });
    assert.equal(invalido.status, 400);
    assert.equal((await invalido.json()).errores.length, 4);

    const duplicado = await enviar(base, 'POST', { nombre: 'Dr. Otro', especialidad: 'General', colegiado: 'G-77' });
    assert.equal(duplicado.status, 409);
    assert.deepEqual(await duplicado.json(), { error: 'Ya existe un médico registrado con ese número de colegiado.' });
  });

  test('lista con filtros, consulta detalle y edita', async () => {
    const lista = await (await fetch(`${base}?q=ruiz&activo=1`)).json();
    assert.deepEqual(lista.map((m) => m.id), [1]);
    assert.ok(Array.isArray(await (await fetch(`${base}/especialidades`)).json()));
    const detalle = await (await fetch(`${base}/1`)).json();
    assert.equal(detalle.horarios.length, 2);
    const r = await enviar(`${base}/2`, 'PUT', { nombre: 'Dr. Luis Castillo', especialidad: 'Cardiología', colegiado: '10003', telefono: '2233-8899' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).telefono, '2233-8899');
  });

  test('responde 404 y 400 ante ids inexistentes o inválidos', async () => {
    assert.equal((await fetch(`${base}/99`)).status, 404);
    assert.equal((await fetch(`${base}/abc`)).status, 400);
    assert.equal((await fetch(`${base}/1/horarios/abc/estado`, { method: 'PATCH' })).status, 400);
    assert.equal((await enviar(`${base}/99/horarios`, 'POST', { dia_semana: 1, hora_inicio: '08:00', hora_fin: '09:00' })).status, 404);
    assert.equal((await fetch(base, { method: 'DELETE' })).status, 404, 'no existe eliminación física');
  });

  test('GET /:id/citas-por-revisar devuelve citas y motivo; 404 y 400 en ids inválidos', async () => {
    const r = await fetch(`${base}/1/citas-por-revisar`);
    assert.equal(r.status, 200);
    const [cita] = await r.json();
    assert.equal(cita.motivo_revision, 'Fuera del horario de atención');
    assert.equal(cita.fuera_de_disponibilidad, true);
    assert.equal((await fetch(`${base}/99/citas-por-revisar`)).status, 404);
    assert.equal((await fetch(`${base}/x/citas-por-revisar`)).status, 400);
  });

  test('GET /:id/citas-futuras devuelve las citas que verá el diálogo', async () => {
    const r = await fetch(`${base}/1/citas-futuras`);
    assert.equal(r.status, 200);
    const ids = (await r.json()).map((c) => c.id);
    assert.ok(ids.includes(1) && !ids.includes(2));
    assert.equal((await fetch(`${base}/99/citas-futuras`)).status, 404);
  });

  test('desactivar con citas futuras devuelve 409 con las citas; con confirmar desactiva', async () => {
    const r = await enviar(`${base}/1/estado`, 'PATCH', { activo: false });
    assert.equal(r.status, 409);
    const cuerpo = await r.json();
    assert.equal(cuerpo.requiere_confirmacion, true);
    const ids = cuerpo.citas_afectadas.map((c) => c.id);
    assert.ok(ids.includes(1) && !ids.includes(2), 'incluye la confirmada y excluye la cancelada');
    assert.match(cuerpo.error, /no se cancelan ni se reasignan/);
    const confirmado = await enviar(`${base}/1/estado`, 'PATCH', { activo: false, confirmar: true });
    assert.equal(confirmado.status, 200);
    assert.equal((await confirmado.json()).medico.activo, 0);
    assert.equal((await enviar(`${base}/1/estado`, 'PATCH', {})).status, 400);
    await enviar(`${base}/1/estado`, 'PATCH', { activo: true });
  });

  test('gestiona horarios: crea, valida, rechaza solapados y pide confirmación', async () => {
    const creado = await enviar(`${base}/2/horarios`, 'POST', { dia_semana: 2, hora_inicio: '14:00', hora_fin: '18:00' });
    assert.equal(creado.status, 201);
    const { id } = await creado.json();
    assert.equal((await enviar(`${base}/2/horarios`, 'POST', { dia_semana: 2, hora_inicio: '17:00', hora_fin: '19:00' })).status, 409);
    const invalido = await enviar(`${base}/2/horarios`, 'POST', { dia_semana: 9, hora_inicio: '18:00', hora_fin: '14:00' });
    assert.equal(invalido.status, 400);
    assert.equal((await invalido.json()).errores.length, 2);
    assert.equal((await enviar(`${base}/2/horarios/${id}`, 'PUT', { dia_semana: 2, hora_inicio: '15:00', hora_fin: '18:00' })).status, 200);
    assert.equal((await (await fetch(`${base}/2/horarios`)).json()).length, 1);

    const sinConfirmar = await enviar(`${base}/1/horarios/1/estado`, 'PATCH', { activo: false });
    assert.equal(sinConfirmar.status, 409);
    assert.equal((await sinConfirmar.json()).citas_afectadas[0].paciente, 'María López');
  });

  test('responde 503 tras tres interbloqueos', async () => {
    apiDb.errorSiguiente = { coincide: 'UPDATE medicos SET activo', error: errorMysql('ER_LOCK_DEADLOCK', 'Deadlock', 1213), veces: 3 };
    const r = await enviar(`${base}/2/estado`, 'PATCH', { activo: false });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'El sistema está ocupado. Intenta nuevamente en unos momentos' });
  });

  test('errores inesperados responden 500 con mensaje genérico', async () => {
    apiDb.errorSiguiente = { coincide: 'AS horarios_activos', error: new Error('fallo mysql simulado') };
    const r = await fetch(base);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /error en el servidor/i);
  });
});
