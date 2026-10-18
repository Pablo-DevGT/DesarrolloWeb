// Hash de contraseñas con scrypt (incluido en Node, sin dependencias).
// Formato guardado en usuarios.contrasena_hash:  scrypt$<sal hex>$<hash hex>
// Nunca se guarda la contraseña en texto plano.
const crypto = require('node:crypto');

const LARGO_SAL = 16;
const LARGO_HASH = 64;
const OPCIONES = { N: 16384, r: 8, p: 1 };

function scrypt(contrasena, sal) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(contrasena), sal, LARGO_HASH, OPCIONES, (error, clave) =>
      (error ? reject(error) : resolve(clave)));
  });
}

async function hashear(contrasena) {
  const sal = crypto.randomBytes(LARGO_SAL);
  const hash = await scrypt(contrasena, sal);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

// Devuelve true si la contraseña corresponde al hash. Un hash mal formado
// simplemente no verifica (no lanza error).
async function verificar(contrasena, hashGuardado) {
  const partes = String(hashGuardado ?? '').split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
  const sal = Buffer.from(partes[1], 'hex');
  const esperado = Buffer.from(partes[2], 'hex');
  if (sal.length !== LARGO_SAL || esperado.length !== LARGO_HASH) return false;
  const hash = await scrypt(contrasena, sal);
  return crypto.timingSafeEqual(hash, esperado);
}

module.exports = { hashear, verificar };
