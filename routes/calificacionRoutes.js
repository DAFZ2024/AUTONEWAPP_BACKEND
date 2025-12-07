const express = require('express');
const router = express.Router();
const calificacionController = require('../controllers/calificacionController');
const auth = require('../middleware/auth'); // Middleware de autenticación

// Todas las rutas requieren autenticación
router.use(auth);

// Crear nueva calificación
router.post('/crear', calificacionController.crearCalificacion);

// Obtener calificación por ID de reserva
router.get('/reserva/:reservaId', calificacionController.getCalificacionPorReserva);

module.exports = router;
