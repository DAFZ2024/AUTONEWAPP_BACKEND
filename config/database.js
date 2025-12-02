const { Pool } = require('pg');
require('dotenv').config();

// Configuración para Render PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para Render
  }
});

// Verificar conexión
pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en la conexión a PostgreSQL:', err);
  process.exit(-1);
});

// Test de conexión inicial
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Error al conectar con PostgreSQL:', err);
  } else {
    console.log('🕐 Hora del servidor PostgreSQL:', res.rows[0].now);
  }
});

module.exports = pool;
