const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { verifyDjangoPassword, hashDjangoPassword, isDjangoHash } = require('../utils/djangoPassword');

// URL base de Cloudinary
const CLOUDINARY_BASE_URL = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`;

// Función helper para construir URL completa de Cloudinary
const buildCloudinaryUrl = (path) => {
  if (!path) return null;
  // Si ya es una URL completa, devolverla tal cual
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // Construir URL completa
  return `${CLOUDINARY_BASE_URL}${path}`;
};

// Generar token JWT
const generateToken = (userId, email, rol) => {
  return jwt.sign(
    { id: userId, email, rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

// Registro de usuario cliente
exports.register = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nombre_completo,
      nombre_usuario,
      correo,
      password,
      telefono,
      direccion
    } = req.body;

    // Validar campos requeridos
    if (!nombre_completo || !nombre_usuario || !correo || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor completa todos los campos requeridos'
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de correo inválido'
      });
    }

    // Validar longitud de contraseña
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar si el correo ya existe
    const emailCheck = await client.query(
      'SELECT id_usuario FROM lavado_auto_usuario WHERE correo = $1',
      [correo]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'El correo electrónico ya está registrado'
      });
    }

    // Verificar si el nombre de usuario ya existe
    const usernameCheck = await client.query(
      'SELECT id_usuario FROM lavado_auto_usuario WHERE nombre_usuario = $1',
      [nombre_usuario]
    );

    if (usernameCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'El nombre de usuario ya está en uso'
      });
    }

    // Encriptar contraseña con formato Django
    const hashedPassword = hashDjangoPassword(password);

    // Insertar usuario con todos los campos requeridos según el modelo Django
    const result = await client.query(
      `INSERT INTO lavado_auto_usuario 
       (nombre_completo, nombre_usuario, correo, password, telefono, direccion, rol, 
        is_active, is_staff, is_superuser, fecha_registro, 
        failed_login_attempts, first_warning_sent) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12) 
       RETURNING id_usuario, nombre_completo, nombre_usuario, correo, rol, fecha_registro`,
      [
        nombre_completo,
        nombre_usuario,
        correo,
        hashedPassword,
        telefono || '',
        direccion || '',
        'cliente',
        true,
        false,
        false,
        0,      // failed_login_attempts
        false   // first_warning_sent
      ]
    );

    const newUser = result.rows[0];

    // Generar token
    const token = generateToken(newUser.id_usuario, newUser.correo, newUser.rol);

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: {
        user: {
          id: newUser.id_usuario,
          nombre_completo: newUser.nombre_completo,
          nombre_usuario: newUser.nombre_usuario,
          correo: newUser.correo,
          rol: newUser.rol,
          fecha_registro: newUser.fecha_registro
        },
        token
      }
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar usuario',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Login de usuario cliente
exports.login = async (req, res) => {
  const client = await pool.connect();

  try {
    const { correo, password } = req.body;

    // Validar campos
    if (!correo || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingresa correo y contraseña'
      });
    }

    // Buscar usuario por correo
    const result = await client.query(
      `SELECT id_usuario, nombre_completo, nombre_usuario, correo, password, rol, 
              is_active, failed_login_attempts, lockout_time, first_warning_sent, profile_picture
       FROM lavado_auto_usuario 
       WHERE correo = $1 AND rol = $2`,
      [correo, 'cliente']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales incorrectas'
      });
    }

    const user = result.rows[0];

    // Verificar si la cuenta está activa
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta ha sido desactivada. Contacta al administrador.'
      });
    }

    // Verificar si la cuenta está bloqueada temporalmente
    if (user.lockout_time) {
      const lockoutTime = new Date(user.lockout_time);
      const currentTime = new Date();
      const timeDiff = (currentTime - lockoutTime) / (1000 * 60); // minutos

      if (timeDiff < 15) {
        return res.status(423).json({
          success: false,
          message: `Cuenta bloqueada temporalmente. Intenta nuevamente en ${Math.ceil(15 - timeDiff)} minutos.`,
          remainingMinutes: Math.ceil(15 - timeDiff)
        });
      } else {
        // Desbloquear cuenta después de 15 minutos
        await client.query(
          `UPDATE lavado_auto_usuario 
           SET lockout_time = NULL 
           WHERE id_usuario = $1`,
          [user.id_usuario]
        );
      }
    }

    // Verificar contraseña usando Django password verification
    let isPasswordValid = false;

    if (isDjangoHash(user.password)) {
      // Verificar con formato Django
      isPasswordValid = verifyDjangoPassword(password, user.password);
    } else {
      // Fallback a bcrypt para compatibilidad
      isPasswordValid = await bcrypt.compare(password, user.password);
    }

    if (!isPasswordValid) {
      // Incrementar intentos fallidos
      const newAttempts = user.failed_login_attempts + 1;

      // Lógica de bloqueo según modelo Django
      if (!user.first_warning_sent && newAttempts >= 3) {
        // Primera vez que llega a 3 intentos: bloqueo temporal de 15 minutos
        await client.query(
          `UPDATE lavado_auto_usuario 
           SET failed_login_attempts = $1, 
               last_failed_login = NOW(), 
               lockout_time = NOW(),
               first_warning_sent = true
           WHERE id_usuario = $2`,
          [newAttempts, user.id_usuario]
        );

        return res.status(423).json({
          success: false,
          message: 'Cuenta bloqueada temporalmente por 15 minutos debido a múltiples intentos fallidos.',
          remainingMinutes: 15
        });
      } else if (user.first_warning_sent && newAttempts >= 6) {
        // Segunda vez (después del bloqueo): desactivar cuenta
        await client.query(
          `UPDATE lavado_auto_usuario 
           SET failed_login_attempts = $1, 
               last_failed_login = NOW(),
               is_active = false,
               lockout_time = NULL
           WHERE id_usuario = $2`,
          [newAttempts, user.id_usuario]
        );

        return res.status(403).json({
          success: false,
          message: 'Cuenta desactivada por seguridad. Contacta al administrador para reactivarla.'
        });
      } else {
        // Actualizar intentos fallidos
        await client.query(
          `UPDATE lavado_auto_usuario 
           SET failed_login_attempts = $1, last_failed_login = NOW() 
           WHERE id_usuario = $2`,
          [newAttempts, user.id_usuario]
        );

        const remainingAttempts = user.first_warning_sent ? (6 - newAttempts) : (3 - newAttempts);
        return res.status(401).json({
          success: false,
          message: `Credenciales incorrectas. Te quedan ${remainingAttempts} intentos.`,
          remainingAttempts
        });
      }
    }

    // Login exitoso - resetear intentos fallidos
    await client.query(
      `UPDATE lavado_auto_usuario 
       SET failed_login_attempts = 0, 
           last_failed_login = NULL, 
           lockout_time = NULL,
           first_warning_sent = false
       WHERE id_usuario = $1`,
      [user.id_usuario]
    );

    // Generar token
    const token = generateToken(user.id_usuario, user.correo, user.rol);

    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        user: {
          id: user.id_usuario,
          nombre_completo: user.nombre_completo,
          nombre_usuario: user.nombre_usuario,
          correo: user.correo,
          rol: user.rol,
          profile_picture: buildCloudinaryUrl(user.profile_picture)
        },
        token
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener perfil del usuario autenticado
exports.getProfile = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id; // Viene del middleware de autenticación

    const result = await client.query(
      `SELECT id_usuario, nombre_completo, nombre_usuario, correo, telefono, 
              direccion, rol, fecha_registro, profile_picture 
       FROM lavado_auto_usuario 
       WHERE id_usuario = $1 AND rol = $2`,
      [userId, 'cliente']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Formatear respuesta para coincidir con el formato esperado por el frontend
    const userData = result.rows[0];
    res.json({
      success: true,
      data: {
        id: userData.id_usuario,
        nombre_completo: userData.nombre_completo,
        nombre_usuario: userData.nombre_usuario,
        correo: userData.correo,
        telefono: userData.telefono,
        direccion: userData.direccion,
        rol: userData.rol,
        fecha_registro: userData.fecha_registro,
        profile_picture: buildCloudinaryUrl(userData.profile_picture)
      }
    });

  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener perfil de usuario',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Actualizar perfil del usuario
exports.updateProfile = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const { nombre_completo, telefono, direccion } = req.body;

    // Validar que al menos un campo esté presente
    if (!nombre_completo && !telefono && !direccion) {
      return res.status(400).json({
        success: false,
        message: 'Debes proporcionar al menos un campo para actualizar'
      });
    }

    // Construir consulta dinámica
    const updates = [];
    const values = [];
    let paramCounter = 1;

    if (nombre_completo) {
      updates.push(`nombre_completo = $${paramCounter}`);
      values.push(nombre_completo);
      paramCounter++;
    }
    if (telefono !== undefined) {
      updates.push(`telefono = $${paramCounter}`);
      values.push(telefono);
      paramCounter++;
    }
    if (direccion !== undefined) {
      updates.push(`direccion = $${paramCounter}`);
      values.push(direccion);
      paramCounter++;
    }

    values.push(userId);

    const result = await client.query(
      `UPDATE lavado_auto_usuario 
       SET ${updates.join(', ')} 
       WHERE id_usuario = $${paramCounter} AND rol = 'cliente'
       RETURNING id_usuario, nombre_completo, nombre_usuario, correo, telefono, direccion, rol`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Formatear respuesta para coincidir con el formato esperado por el frontend
    const userData = result.rows[0];
    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente',
      data: {
        id: userData.id_usuario,
        nombre_completo: userData.nombre_completo,
        nombre_usuario: userData.nombre_usuario,
        correo: userData.correo,
        telefono: userData.telefono,
        direccion: userData.direccion,
        rol: userData.rol
      }
    });

  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Cambiar contraseña del usuario
exports.changePassword = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Validar campos requeridos
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Debes proporcionar la contraseña actual y la nueva contraseña'
      });
    }

    // Validar longitud de nueva contraseña
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres'
      });
    }

    // Obtener usuario actual
    const userResult = await client.query(
      'SELECT id_usuario, password FROM lavado_auto_usuario WHERE id_usuario = $1 AND rol = $2',
      [userId, 'cliente']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const user = userResult.rows[0];

    // Verificar contraseña actual
    let isPasswordValid = false;

    if (isDjangoHash(user.password)) {
      isPasswordValid = verifyDjangoPassword(currentPassword, user.password);
    } else {
      isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    }

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'La contraseña actual es incorrecta'
      });
    }

    // Encriptar nueva contraseña con formato Django
    const hashedPassword = hashDjangoPassword(newPassword);

    // Actualizar contraseña
    await client.query(
      'UPDATE lavado_auto_usuario SET password = $1 WHERE id_usuario = $2',
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cambiar contraseña',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Actualizar foto de perfil del usuario cliente
exports.actualizarFotoPerfilUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;

    // Verificar que se subió una imagen
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se proporcionó ninguna imagen'
      });
    }

    // La URL de Cloudinary viene del middleware multer
    const imageUrl = req.file.path;

    // Obtener foto anterior para eliminar de Cloudinary
    const prevResult = await client.query(
      'SELECT profile_picture FROM lavado_auto_usuario WHERE id_usuario = $1',
      [userId]
    );

    const prevImage = prevResult.rows[0]?.profile_picture;

    // Actualizar en la base de datos
    const result = await client.query(
      `UPDATE lavado_auto_usuario 
       SET profile_picture = $1 
       WHERE id_usuario = $2 AND rol = 'cliente'
       RETURNING id_usuario, nombre_completo, nombre_usuario, correo, telefono, direccion, rol, profile_picture`,
      [imageUrl, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Si había una imagen anterior, intentar eliminarla de Cloudinary
    if (prevImage) {
      try {
        const cloudinary = require('cloudinary').v2;
        // Extraer public_id de la URL
        const urlParts = prevImage.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        if (uploadIndex !== -1) {
          const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
          const publicId = pathAfterUpload.replace(/\.[^/.]+$/, '');
          await cloudinary.uploader.destroy(publicId);
        }
      } catch (deleteError) {
        console.error('Error al eliminar imagen anterior:', deleteError);
      }
    }

    res.json({
      success: true,
      message: 'Foto de perfil actualizada exitosamente',
      data: {
        profile_picture: result.rows[0].profile_picture
      }
    });

  } catch (error) {
    console.error('Error al actualizar foto de perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar foto de perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Eliminar foto de perfil del usuario cliente
exports.eliminarFotoPerfilUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user.id;

    // Obtener foto actual
    const prevResult = await client.query(
      'SELECT profile_picture FROM lavado_auto_usuario WHERE id_usuario = $1 AND rol = $2',
      [userId, 'cliente']
    );

    if (prevResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const prevImage = prevResult.rows[0].profile_picture;

    if (!prevImage) {
      return res.status(400).json({
        success: false,
        message: 'No hay foto de perfil para eliminar'
      });
    }

    // Eliminar de la base de datos
    await client.query(
      'UPDATE lavado_auto_usuario SET profile_picture = NULL WHERE id_usuario = $1',
      [userId]
    );

    // Eliminar de Cloudinary
    try {
      const cloudinary = require('cloudinary').v2;
      const urlParts = prevImage.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1) {
        const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
        const publicId = pathAfterUpload.replace(/\.[^/.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (deleteError) {
      console.error('Error al eliminar imagen de Cloudinary:', deleteError);
    }

    res.json({
      success: true,
      message: 'Foto de perfil eliminada exitosamente'
    });

  } catch (error) {
    console.error('Error al eliminar foto de perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar foto de perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// ========================================
// FUNCIONES PARA EMPRESAS
// ========================================

// Login de empresa
exports.loginEmpresa = async (req, res) => {
  const client = await pool.connect();

  try {
    const { email, password } = req.body;

    // Validar campos
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingresa email y contraseña'
      });
    }

    // Buscar empresa por email
    const result = await client.query(
      `SELECT id_empresa, nombre_empresa, email, contrasena, verificada, is_active,
              direccion, telefono, latitud, longitud, profile_image, failed_login_attempts, lockout_time, first_warning_sent
       FROM lavado_auto_empresa 
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales incorrectas'
      });
    }

    const empresa = result.rows[0];

    // Verificar si la cuenta está activa
    if (!empresa.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Tu cuenta ha sido desactivada. Contacta al administrador.'
      });
    }

    // Verificar si la empresa está verificada
    if (!empresa.verificada) {
      return res.status(403).json({
        success: false,
        message: 'Tu empresa aún no ha sido verificada. Contacta al administrador.'
      });
    }

    // Verificar si la cuenta está bloqueada temporalmente
    if (empresa.lockout_time) {
      const lockoutTime = new Date(empresa.lockout_time);
      const currentTime = new Date();
      const timeDiff = (currentTime - lockoutTime) / (1000 * 60); // minutos

      if (timeDiff < 15) {
        return res.status(423).json({
          success: false,
          message: `Cuenta bloqueada temporalmente. Intenta nuevamente en ${Math.ceil(15 - timeDiff)} minutos.`,
          remainingMinutes: Math.ceil(15 - timeDiff)
        });
      } else {
        // Desbloquear cuenta después de 15 minutos
        await client.query(
          `UPDATE lavado_auto_empresa 
           SET lockout_time = NULL 
           WHERE id_empresa = $1`,
          [empresa.id_empresa]
        );
      }
    }

    // Verificar contraseña usando Django password verification
    let isPasswordValid = false;

    if (isDjangoHash(empresa.contrasena)) {
      // Verificar con formato Django
      isPasswordValid = verifyDjangoPassword(password, empresa.contrasena);
    } else {
      // Fallback a bcrypt para compatibilidad
      isPasswordValid = await bcrypt.compare(password, empresa.contrasena);
    }

    if (!isPasswordValid) {
      // Incrementar intentos fallidos
      const newAttempts = empresa.failed_login_attempts + 1;

      // Lógica de bloqueo similar a usuarios
      if (!empresa.first_warning_sent && newAttempts >= 3) {
        await client.query(
          `UPDATE lavado_auto_empresa 
           SET failed_login_attempts = $1, 
               last_failed_login = NOW(), 
               lockout_time = NOW(),
               first_warning_sent = true
           WHERE id_empresa = $2`,
          [newAttempts, empresa.id_empresa]
        );

        return res.status(423).json({
          success: false,
          message: 'Cuenta bloqueada temporalmente por 15 minutos debido a múltiples intentos fallidos.',
          remainingMinutes: 15
        });
      } else if (empresa.first_warning_sent && newAttempts >= 6) {
        await client.query(
          `UPDATE lavado_auto_empresa 
           SET failed_login_attempts = $1, 
               last_failed_login = NOW(),
               is_active = false,
               lockout_time = NULL
           WHERE id_empresa = $2`,
          [newAttempts, empresa.id_empresa]
        );

        return res.status(403).json({
          success: false,
          message: 'Cuenta desactivada por seguridad. Contacta al administrador para reactivarla.'
        });
      } else {
        await client.query(
          `UPDATE lavado_auto_empresa 
           SET failed_login_attempts = $1, last_failed_login = NOW() 
           WHERE id_empresa = $2`,
          [newAttempts, empresa.id_empresa]
        );

        const remainingAttempts = empresa.first_warning_sent ? (6 - newAttempts) : (3 - newAttempts);
        return res.status(401).json({
          success: false,
          message: `Credenciales incorrectas. Te quedan ${remainingAttempts} intentos.`,
          remainingAttempts
        });
      }
    }

    // Login exitoso - resetear intentos fallidos
    await client.query(
      `UPDATE lavado_auto_empresa 
       SET failed_login_attempts = 0, 
           last_failed_login = NULL, 
           lockout_time = NULL,
           first_warning_sent = false
       WHERE id_empresa = $1`,
      [empresa.id_empresa]
    );

    // Generar token
    const token = generateToken(empresa.id_empresa, empresa.email, 'empresa');

    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        empresa: {
          id: empresa.id_empresa,
          nombre_empresa: empresa.nombre_empresa,
          email: empresa.email,
          direccion: empresa.direccion,
          telefono: empresa.telefono,
          verificada: empresa.verificada,
          latitud: empresa.latitud,
          longitud: empresa.longitud,
          profile_image: buildCloudinaryUrl(empresa.profile_image)
        },
        token
      }
    });

  } catch (error) {
    console.error('Error en login de empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener perfil de empresa autenticada
exports.getEmpresaProfile = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id; // Viene del middleware de autenticación

    const result = await client.query(
      `SELECT id_empresa, nombre_empresa, email, direccion, telefono, 
              verificada, latitud, longitud, fecha_registro
       FROM lavado_auto_empresa 
       WHERE id_empresa = $1`,
      [empresaId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }

    // Obtener servicios de la empresa
    const servicios = await client.query(
      `SELECT s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       FROM lavado_auto_servicio s
       INNER JOIN lavado_auto_empresaservicio es ON s.id_servicio = es.servicio_id
       WHERE es.empresa_id = $1`,
      [empresaId]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        servicios: servicios.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener perfil de empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener perfil de empresa',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};
