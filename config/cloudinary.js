const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configurar storage para fotos de perfil de empresas
const empresaProfileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'autonew/empresas/profile',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 500, height: 500, crop: 'fill', gravity: 'face' },
      { quality: 'auto' }
    ],
  },
});

// Configurar storage para fotos de perfil de usuarios/clientes
const userProfileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'autonew/profile_pictures',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 500, height: 500, crop: 'fill', gravity: 'face' },
      { quality: 'auto' }
    ],
  },
});

// Middleware de multer para subir imágenes de perfil de empresas
const uploadEmpresaProfile = multer({
  storage: empresaProfileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo
  },
  fileFilter: (req, file, cb) => {
    // Verificar que sea una imagen
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'), false);
    }
  },
});

// Middleware de multer para subir imágenes de perfil de usuarios
const uploadProfilePicture = multer({
  storage: userProfileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo
  },
  fileFilter: (req, file, cb) => {
    // Verificar que sea una imagen
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'), false);
    }
  },
});

// Función para eliminar imagen de Cloudinary
const deleteImage = async (publicId) => {
  try {
    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error al eliminar imagen de Cloudinary:', error);
    return false;
  }
};

// Extraer public_id de una URL de Cloudinary
const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  try {
    // URL típica: https://res.cloudinary.com/cloud_name/image/upload/v123/folder/filename.ext
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;
    
    // Obtener todo después de 'upload/v...' sin la extensión
    const pathAfterUpload = parts.slice(uploadIndex + 2).join('/');
    const publicId = pathAfterUpload.replace(/\.[^/.]+$/, ''); // Remover extensión
    return publicId;
  } catch (error) {
    console.error('Error al extraer public_id:', error);
    return null;
  }
};

module.exports = {
  cloudinary,
  uploadEmpresaProfile,
  uploadProfilePicture,
  deleteImage,
  getPublicIdFromUrl,
};
