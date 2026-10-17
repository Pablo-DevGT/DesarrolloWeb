// Reglas de validación de médicos y horarios, compartidas por el navegador
// (public/medicos/*.html) y el servidor (src/medicos/medicos.validacion.js),
// para que ambos validen exactamente lo mismo. Los límites coinciden con las
// columnas y restricciones CHECK de MySQL (database/01_esquema.sql y
// database/03_citas_disponibilidad.sql).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ReglasMedicos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITES = {
    nombre: { min: 3, max: 120 },
    especialidad: { min: 3, max: 80 },
    colegiado: { min: 3, max: 20 },
    telefono: { max: 20 },
    email: { max: 120 },
  };
  const COLEGIADO_RE = /^[A-Za-z0-9-]{3,20}$/;
  const TELEFONO_RE = /^[0-9+\-\s()]{8,20}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const HORA_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const DURACION_CITA_MINUTOS = 60;
  const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  const texto = (valor) => String(valor ?? '').trim();

  function minutos(hora) {
    const [h, m] = String(hora).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  }

  function validarMedico(entrada = {}) {
    const errores = [];
    const nombre = texto(entrada.nombre);
    const especialidad = texto(entrada.especialidad);
    const colegiado = texto(entrada.colegiado).toUpperCase();
    const telefono = texto(entrada.telefono);
    const email = texto(entrada.email).toLowerCase();

    if (nombre.length < LIMITES.nombre.min) errores.push('El nombre debe tener al menos 3 caracteres.');
    if (nombre.length > LIMITES.nombre.max) errores.push('El nombre no puede pasar de 120 caracteres.');
    if (especialidad.length < LIMITES.especialidad.min) errores.push('La especialidad debe tener al menos 3 caracteres.');
    if (especialidad.length > LIMITES.especialidad.max) errores.push('La especialidad no puede pasar de 80 caracteres.');
    if (!COLEGIADO_RE.test(colegiado)) {
      errores.push('El número de colegiado debe tener entre 3 y 20 caracteres: letras, números o guiones.');
    }
    if (telefono && !TELEFONO_RE.test(telefono)) {
      errores.push('El teléfono debe tener entre 8 y 20 caracteres: dígitos, espacios, guiones, paréntesis o +.');
    }
    if (email && (email.length > LIMITES.email.max || !EMAIL_RE.test(email))) {
      errores.push('El correo electrónico no es válido.');
    }

    return {
      errores,
      datos: { nombre, especialidad, colegiado, telefono: telefono || null, email: email || null },
    };
  }

  function validarHorario(entrada = {}) {
    const errores = [];
    const diaTexto = texto(entrada.dia_semana);
    const dia = Number(diaTexto);
    const horaInicio = texto(entrada.hora_inicio).slice(0, 5);
    const horaFin = texto(entrada.hora_fin).slice(0, 5);

    if (!/^[1-7]$/.test(diaTexto)) errores.push('Selecciona un día de la semana válido.');
    if (!HORA_RE.test(horaInicio)) errores.push('La hora de inicio debe tener formato HH:MM.');
    if (!HORA_RE.test(horaFin)) errores.push('La hora de fin debe tener formato HH:MM.');
    if (HORA_RE.test(horaInicio) && HORA_RE.test(horaFin)) {
      if (minutos(horaInicio) >= minutos(horaFin)) {
        errores.push('La hora de fin debe ser posterior a la hora de inicio.');
      } else if (minutos(horaFin) - minutos(horaInicio) < DURACION_CITA_MINUTOS) {
        errores.push('El horario debe durar al menos 60 minutos (la duración de una cita).');
      }
    }

    return { errores, datos: { dia_semana: dia, hora_inicio: horaInicio, hora_fin: horaFin } };
  }

  return {
    LIMITES, DIAS, DURACION_CITA_MINUTOS, COLEGIADO_RE, TELEFONO_RE, EMAIL_RE, HORA_RE,
    minutos, validarMedico, validarHorario,
  };
});
