// Conexión compartida a MySQL (pool). La usan todos los módulos.
// Los datos de conexión vienen del archivo .env (nunca se sube a GitHub).
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sistema_citas',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // devuelve fechas como 'AAAA-MM-DD' en lugar de objetos Date
});

module.exports = pool;
