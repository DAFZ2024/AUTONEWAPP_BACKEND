# AutoNew Backend API

Backend para la aplicación móvil AutoNew - Sistema de lavado de autos.

## 🚀 Tecnologías

- Node.js
- Express
- PostgreSQL
- JWT (JSON Web Tokens)
- bcryptjs

## 📋 Requisitos previos

- Node.js 14+ instalado
- PostgreSQL 17 corriendo en puerto 5433
- Base de datos `autonew_db` creada

## 🔧 Instalación

1. Navega a la carpeta del backend:
```bash
cd autonew-backend
```

2. Instala las dependencias:
```bash
npm install
```

3. Configura las variables de entorno en el archivo `.env`:
```env
PORT=3000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=autonew_db
DB_PASSWORD=tu_password_aqui
DB_PORT=5433
JWT_SECRET=tu_clave_secreta
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

## ▶️ Ejecutar el servidor

Modo desarrollo (con nodemon):
```bash
npm run dev
```

Modo producción:
```bash
npm start
```

## 📡 Endpoints disponibles

### Autenticación

#### Registro de usuario
```
POST /api/auth/register
```
Body:
```json
{
  "nombre_completo": "Juan Pérez",
  "nombre_usuario": "juanperez",
  "correo": "juan@example.com",
  "password": "123456",
  "telefono": "3001234567",
  "direccion": "Calle 123 #45-67"
}
```

#### Login
```
POST /api/auth/login
```
Body:
```json
{
  "correo": "juan@example.com",
  "password": "123456"
}
```

#### Obtener perfil (requiere token)
```
GET /api/auth/profile
```
Headers:
```
Authorization: Bearer {token}
```

#### Actualizar perfil (requiere token)
```
PUT /api/auth/profile
```
Headers:
```
Authorization: Bearer {token}
```
Body:
```json
{
  "nombre_completo": "Juan Carlos Pérez",
  "telefono": "3009876543",
  "direccion": "Carrera 45 #67-89"
}
```

### Health Check
```
GET /api/health
```

## 🔒 Seguridad

- Contraseñas hasheadas con bcrypt
- Autenticación mediante JWT
- Protección contra múltiples intentos de login (cuenta bloqueada después de 5 intentos fallidos)
- Bloqueo temporal de 15 minutos después de 5 intentos fallidos
- CORS configurado

## 📝 Notas

- Solo usuarios con rol "cliente" pueden registrarse y loguearse a través de estos endpoints
- Los tokens JWT expiran después de 7 días por defecto
- El servidor escucha en todas las interfaces (0.0.0.0) para permitir conexiones desde dispositivos móviles en la misma red
