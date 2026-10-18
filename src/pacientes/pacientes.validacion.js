// Valida y limpia los datos de un paciente antes de guardarlos.
// Devuelve { datos, errores }. Si `errores` tiene elementos, no se guarda.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_RE = /^[0-9+\-\s()]{8,20}$/;

function validarPaciente(entrada = {}) {
  const errores = [];

  const nombre = String(entrada.nombre ?? '').trim();
  const edadTexto = String(entrada.edad ?? '').trim();
  const telefono = String(entrada.telefono ?? '').trim();
  const email = String(entrada.email ?? '').trim().toLowerCase();
  const alergias = String(entrada.alergias ?? '').trim();

  if (nombre.length < 3) errores.push('El nombre debe tener al menos 3 caracteres.');
  if (nombre.length > 120) errores.push('El nombre no puede pasar de 120 caracteres.');

  const edad = Number(edadTexto);
  if (edadTexto === '' || !Number.isInteger(edad) || edad < 0 || edad > 120) {
    errores.push('La edad debe ser un número entero entre 0 y 120.');
  }

  if (!TELEFONO_RE.test(telefono)) {
    errores.push('El teléfono debe tener entre 8 y 20 dígitos (puede incluir guiones o espacios).');
  }

  if (email && !EMAIL_RE.test(email)) errores.push('El correo electrónico no es válido.');

  return {
    errores,
    datos: {
      nombre,
      edad,
      telefono,
      email: email || null,
      alergias: alergias || null,
    },
  };
}

module.exports = { validarPaciente };
