// Crea un usuario desde la terminal (necesita MySQL y el .env configurados).
//   npm run crear-usuario -- --usuario recepcion --nombre "Recepción" --rol admin
//   npm run crear-usuario -- --usuario dr.perez --nombre "Dr. Pérez" --rol doctor --medico 5
// Si no se pasa --contrasena, la pide por teclado sin mostrarla.
const readline = require('node:readline');
const pool = require('../src/comun/db');
const { crearServicio, ErrorAuth } = require('../src/auth/auth.service');
const { validarUsuarioNuevo } = require('../src/auth/auth.validacion');

function leerArgumentos(argv) {
  const opciones = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    opciones[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
  }
  return opciones;
}

function pedirContrasena(mensaje) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const escribir = rl._writeToOutput;
    rl.question(mensaje, (respuesta) => { rl._writeToOutput = escribir; rl.close(); process.stdout.write('\n'); resolve(respuesta); });
    rl._writeToOutput = () => {}; // no mostrar lo que se teclea
  });
}

async function principal() {
  const opciones = leerArgumentos(process.argv.slice(2));
  if (!opciones.usuario || !opciones.rol) {
    console.log('Uso: npm run crear-usuario -- --usuario <usuario> --nombre "<nombre>" --rol admin|doctor [--medico <id>] [--contrasena <texto>]');
    process.exitCode = 1;
    return;
  }
  const contrasena = opciones.contrasena ?? await pedirContrasena('Contraseña: ');
  const { errores, datos } = validarUsuarioNuevo({
    usuario: opciones.usuario, nombre: opciones.nombre, contrasena, rol: opciones.rol, medico_id: opciones.medico,
  });
  if (errores.length) {
    console.error(errores.map((e) => `- ${e}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  try {
    const creado = await crearServicio({ db: pool }).crear(datos);
    console.log(`Usuario creado: ${creado.usuario} (${creado.rol}${creado.medico ? `, ${creado.medico}` : ''}).`);
  } catch (error) {
    console.error(error instanceof ErrorAuth ? error.message : error);
    process.exitCode = 1;
  }
}

principal().finally(() => pool.end());
