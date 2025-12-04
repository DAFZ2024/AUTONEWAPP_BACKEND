const express = require('express');
const router = express.Router();
const reservaController = require('../controllers/reservaController');
const { protect } = require('../middleware/authMiddleware');

// Rutas públicas (sin autenticación requerida para obtener datos básicos)
router.get('/servicios', reservaController.getServicios);
router.get('/empresas-por-servicios', reservaController.getEmpresasPorServicios);
router.get('/horarios-disponibles', reservaController.getHorariosDisponibles);

// Rutas protegidas (requieren autenticación)
router.get('/verificar-suscripcion', protect, reservaController.verificarSuscripcion);
router.post('/crear', protect, reservaController.crearReserva);
router.get('/usuario/:usuarioId', protect, reservaController.getReservasPorUsuario);
router.put('/cancelar/:reservaId', protect, reservaController.cancelarReserva);
router.put('/reagendar/:reservaId', protect, reservaController.reagendarReserva);

// Rutas para recuperación de reservas vencidas
router.get('/recargo-recuperacion/:reservaId', protect, reservaController.calcularRecargoRecuperacion);
router.put('/recuperar-vencida/:reservaId', protect, reservaController.recuperarReservaVencida);

// Rutas para verificación QR (cliente)
router.post('/verificar-qr', protect, reservaController.verificarYCompletarReservaQR);
router.get('/por-numero/:numeroReserva', protect, reservaController.getReservaPorNumero);

module.exports = router;
