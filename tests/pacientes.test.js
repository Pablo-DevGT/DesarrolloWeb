// Pruebas del módulo de pacientes. Se ejecutan con: npm test
// No necesitan MySQL: la base de datos se reemplaza por un modelo en memoria.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { validarPaciente } = require('../src/pacientes/pacientes.validacion');

describe('validarPaciente', () => {
  test('acepta un paciente válido y limpia los datos', () => {
    const { errores, datos } = validarPaciente({
      nombre: '  Ana López ', edad: '30', telefono: '5512-3456',
      email: 'ANA@Ejemplo.com', alergias: '',
    });
    assert.deepEqual(errores, []);
    assert.equal(datos.nombre, 'Ana López');
    assert.equal(datos.edad, 30);
    assert.equal(datos.email, 'ana@ejemplo.com');
    assert.equal(datos.alergias, null);
  });

  test('rechaza datos incompletos o inválidos', () => {
    const { errores } = validarPaciente({ nombre: 'A', edad: '200', telefono: '12', email: 'malo' });
    assert.equal(errores.length, 4);
  });

  test('rechaza edad decimal o vacía', () => {
    assert.equal(validarPaciente({ nombre: 'Ana', edad: '3.5', telefono: '55123456' }).errores.length, 1);
    assert.equal(validarPaciente({ nombre: 'Ana', edad: '', telefono: '55123456' }).errores.length, 1);
  });
});

describe('API /api/pacientes', () => {
  let servidor;
  let base;
  const pacientes = [];

  before(async () => {
    // Reemplaza el modelo real por uno en memoria antes de cargar el servidor
    const rutaModelo = path.join(__dirname, '../src/pacientes/pacientes.model.js');
    const obtener = async (id) => pacientes.find((p) => p.id === id) || null;
    require.cache[rutaModelo] = {
      id: rutaModelo, filename: rutaModelo, loaded: true,
      exports: {
        listar: async (q) => pacientes.filter((p) => p.nombre.includes(q)),
        obtener,
        crear: async (d) => { const p = { id: pacientes.length + 1, ...d }; pacientes.push(p); return p; },
        actualizar: async (id, d) => { const p = await obtener(id); return p ? Object.assign(p, d) : null; },
        historial: async (id, filtros) => [{ id: 1, fecha: '2026-10-20', hora: '10:00', estado: filtros.estado || 'confirmada', medico: 'Dra. Ruiz', especialidad: 'Pediatría', motivo: 'Control' }],
      },
    };
    // La API de pacientes exige sesión de admin (login y roles, Integrante 5)
    require('./ayudas/sesion').simularSesion();
    const app = require('../server');
    servidor = app.listen(0);
    base = `http://localhost:${servidor.address().port}/api/pacientes`;
  });

  after(() => servidor.close());

  const enviar = (url, metodo, cuerpo) => fetch(url, {
    method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });

  test('registra un paciente válido (201)', async () => {
    const r = await enviar(base, 'POST', { nombre: 'María López', edad: 34, telefono: '5512-3456', alergias: 'Penicilina' });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).alergias, 'Penicilina');
  });

  test('rechaza un paciente inválido con mensajes (400)', async () => {
    const r = await enviar(base, 'POST', { nombre: '', edad: -1 });
    assert.equal(r.status, 400);
    assert.ok((await r.json()).errores.length >= 2);
  });

  test('edita un paciente existente', async () => {
    const r = await enviar(`${base}/1`, 'PUT', { nombre: 'María F. López', edad: 35, telefono: '5512-3456' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).edad, 35);
  });

  test('responde 404 para un paciente que no existe', async () => {
    assert.equal((await fetch(`${base}/99`)).status, 404);
    assert.equal((await fetch(`${base}/99/historial`)).status, 404);
  });

  test('responde 400 con un id no numérico', async () => {
    assert.equal((await fetch(`${base}/abc`)).status, 400);
  });

  test('devuelve el historial con el filtro de estado', async () => {
    const r = await fetch(`${base}/1/historial?estado=atendida`);
    const { paciente, citas } = await r.json();
    assert.equal(paciente.id, 1);
    assert.equal(citas[0].estado, 'atendida');
  });
});
