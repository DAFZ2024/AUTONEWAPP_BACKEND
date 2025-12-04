const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const empresaController = require('../controllers/empresaController');
const { protectEmpresa } = require('../middleware/authMiddleware');
const { uploadEmpresaProfile } = require('../config/cloudinary');

// Rutas públicas
router.post('/login', authController.loginEmpresa);

// Rutas protegidas (requieren autenticación de empresa)
router.get('/profile', protectEmpresa, authController.getEmpresaProfile);
router.get('/dashboard', protectEmpresa, empresaController.getDashboardStats);
router.get('/reservas', protectEmpresa, empresaController.getReservasEmpresa);
router.put('/reservas/:reservaId/estado', protectEmpresa, empresaController.actualizarEstadoReserva);
router.get('/reservas/:reservaId/qr', protectEmpresa, empresaController.getReservaParaQR);
router.get('/servicios', protectEmpresa, empresaController.getServiciosEmpresa);
router.get('/servicios-completos', protectEmpresa, empresaController.getServiciosCompletos);
router.post('/servicios/solicitar', protectEmpresa, empresaController.solicitarServicio);
router.delete('/servicios/solicitud/:solicitudId', protectEmpresa, empresaController.cancelarSolicitudServicio);
router.get('/analiticas', protectEmpresa, empresaController.getAnaliticas);

// Rutas de perfil de empresa
router.get('/perfil', protectEmpresa, empresaController.getPerfilEmpresa);
router.put('/perfil/basico', protectEmpresa, empresaController.actualizarPerfilBasico);
router.put('/perfil/bancario', protectEmpresa, empresaController.actualizarInfoBancaria);
router.put('/perfil/contrasena', protectEmpresa, empresaController.cambiarContrasena);
router.put('/perfil/foto', protectEmpresa, uploadEmpresaProfile.single('profile_image'), empresaController.actualizarFotoPerfil);
router.delete('/perfil/foto', protectEmpresa, empresaController.eliminarFotoPerfil);

// Rutas de pagos/liquidaciones
router.get('/pagos/resumen', protectEmpresa, empresaController.getResumenPagos);
router.get('/pagos/periodos', protectEmpresa, empresaController.getPeriodosLiquidacion);
router.get('/pagos/periodos/:periodoId', protectEmpresa, empresaController.getDetallePeriodo);
router.get('/pagos/reservas-pendientes', protectEmpresa, empresaController.getReservasPendientesLiquidar);
router.get('/pagos/reservas-pagadas', protectEmpresa, empresaController.getReservasPagadas);
router.get('/pagos/mis-reservas', protectEmpresa, empresaController.getMisReservasPagos);

module.exports = router;
