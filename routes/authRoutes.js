const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, isCliente, isEmpresa } = require('../middleware/authMiddleware');
const { uploadProfilePicture } = require('../config/cloudinary');

// ========================================
// RUTAS PARA CLIENTES
// ========================================

// Rutas públicas (no requieren autenticación)
router.post('/register', authController.register);
router.post('/login', authController.login);

// Rutas protegidas (requieren autenticación)
router.get('/profile', protect, isCliente, authController.getProfile);
router.put('/profile', protect, isCliente, authController.updateProfile);
router.put('/change-password', protect, isCliente, authController.changePassword);

// Rutas para foto de perfil del cliente
router.put('/profile/foto', protect, isCliente, uploadProfilePicture.single('imagen'), authController.actualizarFotoPerfilUsuario);
router.delete('/profile/foto', protect, isCliente, authController.eliminarFotoPerfilUsuario);

// ========================================
// RUTAS PARA EMPRESAS
// ========================================

// Rutas públicas de empresas
router.post('/empresa/login', authController.loginEmpresa);

// Rutas protegidas de empresas (requieren autenticación)
router.get('/empresa/profile', protect, isEmpresa, authController.getEmpresaProfile);

module.exports = router;
