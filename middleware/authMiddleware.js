const jwt = require('jsonwebtoken');

// Middleware para proteger rutas - verificar token JWT
exports.protect = async (req, res, next) => {
  let token;

  console.log('[AuthMiddleware] Headers recibidos:', req.headers.authorization);

  // Verificar si hay token en los headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Obtener token del header
      token = req.headers.authorization.split(' ')[1];
      console.log('[AuthMiddleware] Token extraído:', token ? 'Token presente' : 'Token vacío');

      // Verificar token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('[AuthMiddleware] Token decodificado exitosamente. User ID:', decoded.id);

      // Agregar información del usuario al request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        rol: decoded.rol
      };

      next();
    } catch (error) {
      console.error('[AuthMiddleware] Error en autenticación:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }
  }

  if (!token) {
    console.error('[AuthMiddleware] No se proporcionó token');
    return res.status(401).json({
      success: false,
      message: 'No autorizado, no se proporcionó token'
    });
  }
};

// Middleware para proteger rutas de empresa - verificar token JWT
exports.protectEmpresa = async (req, res, next) => {
  let token;

  console.log('[AuthMiddleware-Empresa] Headers recibidos:', req.headers.authorization);

  // Verificar si hay token en los headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Obtener token del header
      token = req.headers.authorization.split(' ')[1];
      console.log('[AuthMiddleware-Empresa] Token extraído:', token ? 'Token presente' : 'Token vacío');

      // Verificar token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('[AuthMiddleware-Empresa] Token decodificado. ID:', decoded.id, 'Rol:', decoded.rol);

      // Verificar que el rol sea empresa
      if (decoded.rol !== 'empresa') {
        return res.status(403).json({
          success: false,
          message: 'Acceso denegado. Solo empresas pueden acceder a este recurso.'
        });
      }

      // Agregar información de la empresa al request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        rol: decoded.rol
      };

      next();
    } catch (error) {
      console.error('[AuthMiddleware-Empresa] Error en autenticación:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Token inválido o expirado'
      });
    }
  }

  if (!token) {
    console.error('[AuthMiddleware-Empresa] No se proporcionó token');
    return res.status(401).json({
      success: false,
      message: 'No autorizado, no se proporcionó token'
    });
  }
};

// Middleware para verificar que sea cliente
exports.isCliente = (req, res, next) => {
  if (req.user && req.user.rol === 'cliente') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Acceso denegado. Solo clientes pueden acceder a este recurso.'
    });
  }
};

// Middleware para verificar que sea empresa
exports.isEmpresa = (req, res, next) => {
  if (req.user && req.user.rol === 'empresa') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Acceso denegado. Solo empresas pueden acceder a este recurso.'
    });
  }
};

// Middleware para verificar que sea admin
exports.isAdmin = (req, res, next) => {
  if (req.user && req.user.rol === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Acceso denegado. Solo administradores pueden acceder a este recurso.'
    });
  }
};
