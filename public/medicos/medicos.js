// Funciones del frontend de médicos. Usa comun.js (escaparHTML, mostrarAlerta,
// formatearFecha, etiquetaEstado) y reglas.js (ReglasMedicos).

// Como api() de comun.js, pero el error conserva el estado HTTP y el cuerpo,
// necesarios para las respuestas 409 que piden confirmación.
async function peticion(url, opciones = {}) {
  const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = new Error('Error de la API');
    error.status = resp.status;
    error.datos = datos;
    error.mensajes = datos.errores || [datos.error || 'No se pudo completar la operación.'];
    throw error;
  }
  return datos;
}

const enviarJSON = (url, metodo, cuerpo) => peticion(url, { method: metodo, body: JSON.stringify(cuerpo) });

function etiquetaActivo(activo) {
  return Number(activo)
    ? '<span class="estado estado-activo">Activo</span>'
    : '<span class="estado estado-inactivo">Inactivo</span>';
}

function tablaCitas(citas) {
  return `
    <div class="tabla-contenedor">
      <table class="tabla tabla-compacta">
        <thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Estado</th></tr></thead>
        <tbody>${citas.map((c) => `
          <tr>
            <td>${formatearFecha(c.fecha)}</td>
            <td>${escaparHTML(c.hora)}</td>
            <td>${escaparHTML(c.paciente)}</td>
            <td>${etiquetaEstado(c.estado)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Diálogo de confirmación. `mensaje` puede ser un texto o una lista de párrafos;
// `aviso` se muestra destacado arriba. Resuelve true si el usuario confirma.
function confirmar({ titulo, mensaje, aviso = '', citas = [], textoConfirmar = 'Confirmar', peligro = false }) {
  const parrafos = Array.isArray(mensaje) ? mensaje : [mensaje];
  return new Promise((resolve) => {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'dialogo';
    dialogo.innerHTML = `
      <h2>${escaparHTML(titulo)}</h2>
      ${aviso ? `<div class="alerta alerta-advertencia">${escaparHTML(aviso)}</div>` : ''}
      ${parrafos.map((p) => `<p>${escaparHTML(p)}</p>`).join('')}
      ${citas.length ? tablaCitas(citas) : ''}
      <div class="dialogo-acciones">
        <button type="button" class="btn btn-secundario" value="no">Cancelar</button>
        <button type="button" class="btn ${peligro ? 'btn-peligro' : ''}" value="si">${escaparHTML(textoConfirmar)}</button>
      </div>`;
    const cerrar = (respuesta) => { dialogo.close(); dialogo.remove(); resolve(respuesta); };
    dialogo.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') cerrar(e.target.value === 'si');
    });
    dialogo.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(false); });
    document.body.appendChild(dialogo);
    dialogo.showModal();
    dialogo.querySelector('button[value="no"]').focus();
  });
}

const esPeticionDeConfirmacion = (error) => error.status === 409 && error.datos?.requiere_confirmacion;
const AVISO_CITAS_NUEVAS = 'Se registraron citas nuevas mientras revisabas. Revisa la lista actualizada antes de continuar.';

// Ejecuta enviar({}). Si el servidor pide confirmación (409 con
// requiere_confirmacion), muestra las citas afectadas y, si el usuario acepta,
// repite con enviar({ confirmar: true, citas_confirmadas }). Si mientras tanto
// apareció otra cita afectada, el servidor vuelve a pedir confirmación y se
// muestra la lista actualizada. Devuelve null si el usuario cancela.
async function conConfirmacion(enviar, { titulo, textoConfirmar }) {
  let confirmacion = {};
  let aviso = '';
  for (;;) {
    try {
      return await enviar(confirmacion);
    } catch (error) {
      if (!esPeticionDeConfirmacion(error)) throw error;
      if (confirmacion.confirmar) aviso = AVISO_CITAS_NUEVAS;
      const citas = error.datos.citas_afectadas || [];
      const acepta = await confirmar({ titulo, aviso, mensaje: error.datos.error, citas, textoConfirmar, peligro: true });
      if (!acepta) return null;
      confirmacion = { confirmar: true, citas_confirmadas: citas.map((c) => c.id) };
    }
  }
}

// Desactivación de un médico con un único diálogo: muestra qué médico se
// desactiva y sus citas futuras activas, que no se cancelan ni se reasignan.
// Devuelve la respuesta del servidor o null si el usuario cancela.
async function desactivarMedico(medico) {
  let citas = await peticion(`/api/medicos/${medico.id}/citas-futuras`);
  let aviso = '';
  for (;;) {
    const n = citas.length;
    const acepta = await confirmar({
      titulo: `Desactivar a ${medico.nombre}`,
      aviso,
      mensaje: [
        `${medico.nombre} (${medico.especialidad}, colegiado ${medico.colegiado}) dejará de aparecer en ` +
          'Solicitud de Citas y no podrá recibir citas nuevas. Su historial se conserva.',
        n
          ? `Tiene ${n === 1 ? '1 cita futura activa' : `${n} citas futuras activas`}. ` +
            'No se cancelarán ni se reasignarán automáticamente: recepción deberá revisarlas.'
          : 'No tiene citas futuras activas.',
      ],
      citas,
      textoConfirmar: 'Desactivar médico',
      peligro: true,
    });
    if (!acepta) return null;
    try {
      return await enviarJSON(`/api/medicos/${medico.id}/estado`, 'PATCH',
        { activo: false, confirmar: true, citas_confirmadas: citas.map((c) => c.id) });
    } catch (error) {
      if (!esPeticionDeConfirmacion(error)) throw error;
      citas = error.datos.citas_afectadas || [];
      aviso = AVISO_CITAS_NUEVAS;
    }
  }
}

// Activa o desactiva un médico y devuelve { resultado, mensaje, tipo } o null si se cancela
async function cambiarEstadoMedico(medico) {
  const activar = !Number(medico.activo);
  const resultado = activar
    ? await enviarJSON(`/api/medicos/${medico.id}/estado`, 'PATCH', { activo: true })
    : await desactivarMedico(medico);
  if (!resultado) return null;
  const texto = `Médico ${activar ? 'activado' : 'desactivado'}: ${medico.nombre}.`;
  return resultado.citas_futuras_activas.length
    ? { resultado, tipo: 'advertencia', mensaje: advertenciaCitas(resultado.citas_futuras_activas, texto) }
    : { resultado, tipo: 'exito', mensaje: texto };
}

// Texto de advertencia cuando quedan citas futuras que recepción debe revisar
function advertenciaCitas(citas, contexto) {
  const n = citas.length;
  return n === 1
    ? `${contexto} Hay 1 cita futura activa que no se modificó: recepción debe confirmarla, reagendarla o cancelarla.`
    : `${contexto} Hay ${n} citas futuras activas que no se modificaron: recepción debe confirmarlas, reagendarlas o cancelarlas.`;
}

// Mensaje de éxito que llega por la URL (?creado=1, ?guardado=1)
function mensajeDeURL(alerta, mensajes) {
  const parametros = new URLSearchParams(location.search);
  for (const [clave, texto] of Object.entries(mensajes)) {
    if (parametros.get(clave)) {
      mostrarAlerta(alerta, 'exito', texto);
      parametros.delete(clave);
      history.replaceState(null, '', `${location.pathname}${parametros.size ? `?${parametros}` : ''}`);
    }
  }
}
