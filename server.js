const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const reservaRoutes = require('./routes/reservaRoutes');
const empresaRoutes = require('./routes/empresaRoutes');
const planRoutes = require('./routes/planRoutes');
const pool = require('./config/database');

const app = express();

// Middleware de CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://tudominio.com'] 
    : '*', // En desarrollo permite todos los orígenes
  credentials: true
}));

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware para desarrollo
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Rutas principales
app.use('/api/auth', authRoutes);
app.use('/api/reservas', reservaRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/planes', planRoutes);

// Ruta de prueba/health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'API de AutoNew funcionando correctamente',
    timestamp: new Date().toISOString(),
    database: 'PostgreSQL conectado'
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Bienvenido a la API de AutoNew',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile (requiere token)',
        updateProfile: 'PUT /api/auth/profile (requiere token)'
      },
      reservas: {
        empresas: 'GET /api/reservas/empresas',
        servicios: 'GET /api/reservas/servicios',
        serviciosPorEmpresa: 'GET /api/reservas/servicios/empresa/:empresaId',
        horariosDisponibles: 'GET /api/reservas/horarios-disponibles?empresaId=X&fecha=YYYY-MM-DD',
        crear: 'POST /api/reservas/crear (requiere token)',
        misReservas: 'GET /api/reservas/usuario/:usuarioId (requiere token)',
        cancelar: 'PUT /api/reservas/cancelar/:reservaId (requiere token)'
      }
    }
  });
});

// Manejo de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada',
    path: req.path
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🚀 Servidor AutoNew Backend iniciado');
  console.log('='.repeat(50));
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`📝 Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 URL Local: http://localhost:${PORT}`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🗄️  Base de datos: PostgreSQL (${process.env.DB_NAME})`);
  console.log('='.repeat(50));
});

// Manejo de cierre graceful
const gracefulShutdown = () => {
  console.log('\n⚠️  Señal de cierre recibida, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor HTTP cerrado');
    pool.end(() => {
      console.log('✅ Pool de conexiones de PostgreSQL cerrado');
      process.exit(0);
    });
  });

  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    console.error('⛔ Forzando cierre después de 10 segundos');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
  console.error('❌ Error no manejado (Unhandled Rejection):', err);
  gracefulShutdown();
});

process.on('uncaughtException', (err) => {
  console.error('❌ Excepción no capturada (Uncaught Exception):', err);
  gracefulShutdown();
});

module.exports = app;
