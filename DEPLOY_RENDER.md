# Despliegue del Backend en Render

## Pasos para desplegar en Render (GRATIS)

### 1. Preparar el repositorio
Primero, sube tu proyecto a GitHub:

```bash
cd autonew-backend
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/autonew-backend.git
git push -u origin main
```

### 2. Crear cuenta en Render
1. Ve a https://render.com
2. Regístrate con tu cuenta de GitHub

### 3. Crear la Base de Datos PostgreSQL
1. En el Dashboard, clic en **"New +"** → **"PostgreSQL"**
2. Configura:
   - **Name**: `autonew-db`
   - **Database**: `autonew`
   - **User**: `autonew_user`
   - **Region**: `Ohio (US East)` (o la más cercana)
   - **Plan**: `Free`
3. Clic en **"Create Database"**
4. Copia el **Internal Database URL** (lo necesitarás después)

### 4. Importar datos a la base de datos
Una vez creada, ve a la pestaña **"Info"** de tu base de datos y copia los datos de conexión.

Usa una herramienta como DBeaver, pgAdmin o el CLI de PostgreSQL para ejecutar tu script SQL:

```bash
# Conéctate usando el External Database URL
psql "TU_EXTERNAL_DATABASE_URL" -f autonew_database_mysql.sql
```

### 5. Crear el Web Service (Backend)
1. En el Dashboard, clic en **"New +"** → **"Web Service"**
2. Conecta tu repositorio de GitHub
3. Configura:
   - **Name**: `autonew-backend`
   - **Region**: Misma que la base de datos
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

### 6. Configurar Variables de Entorno
En la sección **"Environment"** del Web Service, añade:

| Variable | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `[Internal Database URL de tu PostgreSQL]` |
| `JWT_SECRET` | `[genera una clave segura con: openssl rand -base64 32]` |
| `CLOUDINARY_CLOUD_NAME` | `[tu valor de Cloudinary]` |
| `CLOUDINARY_API_KEY` | `[tu API key de Cloudinary]` |
| `CLOUDINARY_API_SECRET` | `[tu API secret de Cloudinary]` |

### 7. Desplegar
Clic en **"Create Web Service"**. Render construirá y desplegará automáticamente.

Tu URL será algo como: `https://autonew-backend.onrender.com`

### 8. Verificar
Visita `https://TU_URL.onrender.com/api/health` para confirmar que funciona.

---

## Notas Importantes

⚠️ **Plan Gratuito de Render:**
- El servicio se "duerme" después de 15 minutos de inactividad
- La primera petición después de dormir tarda ~30 segundos
- Para evitar esto, puedes usar un servicio como UptimeRobot para hacer ping cada 14 minutos

📌 **Para producción real:** Considera el plan **Starter ($7/mes)** que nunca duerme.
