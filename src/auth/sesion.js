// Sesión en una cookie firmada (sin guardar sesiones en el servidor).
// Token = base64url(JSON con los datos del usuario y su vencimiento) + "." + firma HMAC-SHA256.
// Si cambia el secreto (SESSION_SECRET) todas las sesiones dejan de ser válidas.
const crypto = require('node:crypto');

const NOMBRE_COOKIE = 'sesion';
const DURACION_SEGUNDOS = 8 * 60 * 60; // una jornada de trabajo

function firmar(datos, secreto) {
  return crypto.createHmac('sha256', secreto).update(datos).digest('base64url');
}

function crearToken(usuario, { secreto, ahora = () => new Date(), duracionSegundos = DURACION_SEGUNDOS }) {
  const exp = Math.floor(ahora().getTime() / 1000) + duracionSegundos;
  const datos = Buffer.from(JSON.stringify({ ...usuario, exp })).toString('base64url');
  return `${datos}.${firmar(datos, secreto)}`;
}

// Devuelve los datos del usuario, o null si el token falta, fue alterado o venció
function leerToken(token, { secreto, ahora = () => new Date() }) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const [datos, firma] = partes;
  const esperada = Buffer.from(firmar(datos, secreto));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  try {
    const { exp, ...usuario } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
    if (!Number.isFinite(exp) || exp <= Math.floor(ahora().getTime() / 1000)) return null;
    return usuario;
  } catch {
    return null;
  }
}

// 'a=1; sesion=abc' -> { a: '1', sesion: 'abc' }
function leerCookies(cabecera) {
  const cookies = {};
  for (const parte of String(cabecera ?? '').split(';')) {
    const indice = parte.indexOf('=');
    if (indice < 0) continue;
    const nombre = parte.slice(0, indice).trim();
    if (!nombre) continue;
    try {
      cookies[nombre] = decodeURIComponent(parte.slice(indice + 1).trim());
    } catch {
      cookies[nombre] = parte.slice(indice + 1).trim();
    }
  }
  return cookies;
}

module.exports = { NOMBRE_COOKIE, DURACION_SEGUNDOS, crearToken, leerToken, leerCookies };
