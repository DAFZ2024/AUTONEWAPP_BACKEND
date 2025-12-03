const pool = require('../config/database');
const { deleteImage, getPublicIdFromUrl } = require('../config/cloudinary');

// Función para generar número de reserva único
const generarNumeroReserva = () => {
  const prefijo = 'ANW';
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letraAleatoria = letras.charAt(Math.floor(Math.random() * letras.length));
  const numeros = Math.floor(10000000 + Math.random() * 90000000); // 8 dígitos
  return `${prefijo}-${letraAleatoria}${numeros}`;
};

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

// Actualizar foto de perfil de la empresa
exports.actualizarFotoPerfil = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se ha proporcionado ninguna imagen'
      });
    }

    // Obtener la URL actual de la imagen (si existe) para eliminarla después
    const empresaActual = await client.query(
      'SELECT profile_image FROM lavado_auto_empresa WHERE id_empresa = $1',
      [empresaId]
    );

    const imagenAnterior = empresaActual.rows[0]?.profile_image;

    // La nueva URL viene del archivo subido a Cloudinary
    const nuevaImagenUrl = req.file.path;

    // Actualizar en la base de datos
    const result = await client.query(
      `UPDATE lavado_auto_empresa 
       SET profile_image = $1 
       WHERE id_empresa = $2 
       RETURNING id_empresa, nombre_empresa, profile_image`,
      [nuevaImagenUrl, empresaId]
    );

    // Eliminar imagen anterior de Cloudinary si existía
    if (imagenAnterior) {
      const publicId = getPublicIdFromUrl(imagenAnterior);
      if (publicId) {
        await deleteImage(publicId);
      }
    }

    res.json({
      success: true,
      message: 'Foto de perfil actualizada correctamente',
      data: {
        profile_image: buildCloudinaryUrl(result.rows[0].profile_image)
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

// Eliminar foto de perfil de la empresa
exports.eliminarFotoPerfil = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    // Obtener la URL actual de la imagen
    const empresaResult = await client.query(
      'SELECT profile_image FROM lavado_auto_empresa WHERE id_empresa = $1',
      [empresaId]
    );

    const imagenActual = empresaResult.rows[0]?.profile_image;

    if (!imagenActual) {
      return res.status(400).json({
        success: false,
        message: 'No hay foto de perfil para eliminar'
      });
    }

    // Eliminar de Cloudinary
    const publicId = getPublicIdFromUrl(imagenActual);
    if (publicId) {
      await deleteImage(publicId);
    }

    // Actualizar en la base de datos
    await client.query(
      'UPDATE lavado_auto_empresa SET profile_image = NULL WHERE id_empresa = $1',
      [empresaId]
    );

    res.json({
      success: true,
      message: 'Foto de perfil eliminada correctamente'
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

// Obtener estadísticas del dashboard de empresa
exports.getDashboardStats = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // 1. Obtener citas de hoy
    const citasHoyResult = await client.query(
      `SELECT COUNT(*) as total
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha = $2
       AND estado != 'cancelada'`,
      [empresaId, today]
    );
    const citasHoy = parseInt(citasHoyResult.rows[0].total) || 0;

    // 2. Calcular ingresos de hoy (solo reservas completadas)
    const ingresosHoyResult = await client.query(
      `SELECT COALESCE(SUM(rs.precio_aplicado), 0) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.fecha = $2
       AND r.estado = 'completado'`,
      [empresaId, today]
    );
    const ingresosHoy = parseFloat(ingresosHoyResult.rows[0].total) || 0;

    // 3. Obtener clientes activos (usuarios únicos que han hecho reservas en los últimos 30 días)
    const clientesActivosResult = await client.query(
      `SELECT COUNT(DISTINCT usuario_id) as total
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '30 days'`,
      [empresaId]
    );
    const clientesActivos = parseInt(clientesActivosResult.rows[0].total) || 0;

    // 4. Calcular satisfacción (basado en reservas completadas vs canceladas últimos 30 días)
    const satisfaccionResult = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE estado = 'completado') as completadas,
        COUNT(*) as total
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '30 days'`,
      [empresaId]
    );
    const completadas = parseInt(satisfaccionResult.rows[0].completadas) || 0;
    const totalReservas = parseInt(satisfaccionResult.rows[0].total) || 0;
    const satisfaccion = totalReservas > 0 ? Math.round((completadas / totalReservas) * 100) : 100;

    // 5. Citas pendientes por confirmar
    const citasPendientesResult = await client.query(
      `SELECT COUNT(*) as total
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND estado = 'pendiente'
       AND fecha >= $2`,
      [empresaId, today]
    );
    const citasPendientes = parseInt(citasPendientesResult.rows[0].total) || 0;

    // 6. Obtener próximas citas del día
    const proximasCitasResult = await client.query(
      `SELECT r.id_reserva, r.fecha, r.hora, r.estado, r.placa_vehiculo, r.tipo_vehiculo,
              u.nombre_completo as nombre_cliente, u.telefono as telefono_cliente,
              json_agg(json_build_object(
                'id_servicio', s.id_servicio,
                'nombre_servicio', s.nombre_servicio,
                'precio', rs.precio_aplicado
              )) as servicios
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
       WHERE r.empresa_id = $1 
       AND r.fecha = $2
       AND r.estado != 'cancelada'
       GROUP BY r.id_reserva, u.id_usuario
       ORDER BY r.hora ASC
       LIMIT 5`,
      [empresaId, today]
    );

    // 7. Ingresos del mes
    const ingresosMesResult = await client.query(
      `SELECT COALESCE(SUM(rs.precio_aplicado), 0) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND DATE_TRUNC('month', r.fecha) = DATE_TRUNC('month', CURRENT_DATE)
       AND r.estado = 'completado'`,
      [empresaId]
    );
    const ingresosMes = parseFloat(ingresosMesResult.rows[0].total) || 0;

    // 8. Total de reservas del mes
    const reservasMesResult = await client.query(
      `SELECT COUNT(*) as total
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)`,
      [empresaId]
    );
    const reservasMes = parseInt(reservasMesResult.rows[0].total) || 0;

    res.json({
      success: true,
      data: {
        citasHoy,
        ingresosHoy,
        clientesActivos,
        satisfaccion,
        citasPendientes,
        ingresosMes,
        reservasMes,
        proximasCitas: proximasCitasResult.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas del dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener todas las reservas de la empresa
exports.getReservasEmpresa = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { estado, fecha, pagina = 1, limite = 20 } = req.query;
    const offset = (pagina - 1) * limite;

    let whereClause = 'WHERE r.empresa_id = $1';
    const params = [empresaId];
    let paramIndex = 2;

    if (estado) {
      whereClause += ` AND r.estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }

    if (fecha) {
      whereClause += ` AND r.fecha = $${paramIndex}`;
      params.push(fecha);
      paramIndex++;
    }

    // Consulta principal con paginación
    const reservasResult = await client.query(
      `SELECT r.id_reserva, r.numero_reserva, r.fecha, r.hora, r.estado, 
              r.placa_vehiculo, r.tipo_vehiculo, r.conductor_asignado, 
              r.observaciones_empresariales, r.pagado_empresa,
              u.id_usuario, u.nombre_completo as nombre_cliente, u.correo as email_cliente,
              u.telefono as telefono_cliente,
              json_agg(json_build_object(
                'id_servicio', s.id_servicio,
                'nombre_servicio', s.nombre_servicio,
                'precio_original', rs.precio_original,
                'precio_aplicado', rs.precio_aplicado
              )) as servicios,
              SUM(rs.precio_aplicado) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
       ${whereClause}
       GROUP BY r.id_reserva, u.id_usuario
       ORDER BY r.fecha DESC, r.hora DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limite, offset]
    );

    // Contar total de registros
    const countResult = await client.query(
      `SELECT COUNT(*) as total
       FROM lavado_auto_reserva r
       ${whereClause}`,
      params
    );
    const totalRegistros = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        reservas: reservasResult.rows,
        paginacion: {
          pagina: parseInt(pagina),
          limite: parseInt(limite),
          totalRegistros,
          totalPaginas: Math.ceil(totalRegistros / limite)
        }
      }
    });

  } catch (error) {
    console.error('Error al obtener reservas de la empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener reservas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Actualizar estado de una reserva
exports.actualizarEstadoReserva = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { reservaId } = req.params;
    const { estado } = req.body;

    const estadosValidos = ['pendiente', 'completado', 'cancelada'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }

    // Verificar que la reserva pertenece a la empresa
    const checkResult = await client.query(
      `SELECT id_reserva, estado FROM lavado_auto_reserva 
       WHERE id_reserva = $1 AND empresa_id = $2`,
      [reservaId, empresaId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    // Actualizar estado
    await client.query(
      `UPDATE lavado_auto_reserva SET estado = $1 WHERE id_reserva = $2`,
      [estado, reservaId]
    );

    res.json({
      success: true,
      message: 'Estado actualizado correctamente'
    });

  } catch (error) {
    console.error('Error al actualizar estado de reserva:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar estado',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener servicios de la empresa
exports.getServiciosEmpresa = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    const result = await client.query(
      `SELECT s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       FROM lavado_auto_servicio s
       INNER JOIN lavado_auto_empresaservicio es ON s.id_servicio = es.servicio_id
       WHERE es.empresa_id = $1
       ORDER BY s.nombre_servicio`,
      [empresaId]
    );

    res.json({
      success: true,
      data: {
        servicios: result.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener servicios de la empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener servicios',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener analíticas detalladas
exports.getAnaliticas = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { periodo = 'month' } = req.query; // week, month, year

    // Determinar el intervalo según el período
    let intervalo;
    switch (periodo) {
      case 'week':
        intervalo = '7 days';
        break;
      case 'year':
        intervalo = '365 days';
        break;
      default:
        intervalo = '30 days';
    }

    // 1. Estadísticas generales del período
    const statsGeneralesResult = await client.query(
      `SELECT 
        COUNT(*) as total_reservas,
        COUNT(*) FILTER (WHERE estado = 'completado') as completadas,
        COUNT(*) FILTER (WHERE estado = 'cancelada') as canceladas,
        COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '${intervalo}'`,
      [empresaId]
    );

    // 2. Ingresos totales del período
    const ingresosTotalResult = await client.query(
      `SELECT COALESCE(SUM(rs.precio_aplicado), 0) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       AND r.estado = 'completado'`,
      [empresaId]
    );

    // 3. Ingresos mensuales (últimos 6 meses)
    const ingresosMensualesResult = await client.query(
      `SELECT 
        TO_CHAR(DATE_TRUNC('month', r.fecha), 'Mon') as mes,
        EXTRACT(MONTH FROM r.fecha) as mes_numero,
        COALESCE(SUM(rs.precio_aplicado), 0) as ingresos
       FROM lavado_auto_reserva r
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.fecha >= CURRENT_DATE - INTERVAL '6 months'
       AND r.estado = 'completado'
       GROUP BY DATE_TRUNC('month', r.fecha), EXTRACT(MONTH FROM r.fecha)
       ORDER BY DATE_TRUNC('month', r.fecha)`,
      [empresaId]
    );

    // 4. Reservas diarias (últimos 7 días)
    const reservasDiariasResult = await client.query(
      `SELECT 
        DATE(fecha) as fecha,
        TO_CHAR(fecha, 'Dy') as dia_semana,
        COUNT(*) as cantidad
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '7 days'
       AND fecha <= CURRENT_DATE
       GROUP BY DATE(fecha)
       ORDER BY DATE(fecha)`,
      [empresaId]
    );

    // 5. Ingresos por día del periodo
    const ingresosPorDiaResult = await client.query(
      `SELECT DATE(r.fecha) as fecha, 
              COALESCE(SUM(rs.precio_aplicado), 0) as ingresos,
              COUNT(DISTINCT r.id_reserva) as cantidad_reservas
       FROM lavado_auto_reserva r
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       AND r.estado = 'completado'
       GROUP BY DATE(r.fecha)
       ORDER BY fecha`,
      [empresaId]
    );

    // 6. Servicios más solicitados (Top 4)
    const serviciosPopularesResult = await client.query(
      `SELECT s.nombre_servicio, COUNT(*) as cantidad,
              COALESCE(SUM(rs.precio_aplicado), 0) as ingresos_total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       INNER JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
       WHERE r.empresa_id = $1 
       AND r.fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       GROUP BY s.id_servicio, s.nombre_servicio
       ORDER BY cantidad DESC
       LIMIT 4`,
      [empresaId]
    );

    // 7. Horas más concurridas
    const horasPopularesResult = await client.query(
      `SELECT EXTRACT(HOUR FROM hora) as hora, COUNT(*) as cantidad
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       GROUP BY EXTRACT(HOUR FROM hora)
       ORDER BY cantidad DESC`,
      [empresaId]
    );

    // 8. Resumen por estado
    const resumenEstadosResult = await client.query(
      `SELECT estado, COUNT(*) as cantidad
       FROM lavado_auto_reserva 
       WHERE empresa_id = $1 
       AND fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       GROUP BY estado`,
      [empresaId]
    );

    // 9. Clientes más frecuentes
    const clientesFrecuentesResult = await client.query(
      `SELECT u.nombre_completo, u.correo, COUNT(*) as total_reservas,
              COALESCE(SUM(rs.precio_aplicado), 0) as total_gastado
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.fecha >= CURRENT_DATE - INTERVAL '${intervalo}'
       GROUP BY u.id_usuario, u.nombre_completo, u.correo
       ORDER BY total_reservas DESC
       LIMIT 10`,
      [empresaId]
    );

    // 10. Tasa de éxito (completadas vs total)
    const stats = statsGeneralesResult.rows[0];
    const totalReservas = parseInt(stats.total_reservas) || 0;
    const completadas = parseInt(stats.completadas) || 0;
    const tasaExito = totalReservas > 0 ? Math.round((completadas / totalReservas) * 100) : 0;
    const tasaCancelacion = totalReservas > 0 ? Math.round((parseInt(stats.canceladas) / totalReservas) * 100) : 0;

    res.json({
      success: true,
      data: {
        // Estadísticas principales
        totalReservas,
        completadas,
        canceladas: parseInt(stats.canceladas) || 0,
        pendientes: parseInt(stats.pendientes) || 0,
        ingresosTotales: parseFloat(ingresosTotalResult.rows[0].total) || 0,
        tasaExito,
        tasaCancelacion,
        // Datos para gráficos
        ingresosMensuales: ingresosMensualesResult.rows,
        reservasDiarias: reservasDiariasResult.rows,
        ingresosPorDia: ingresosPorDiaResult.rows,
        serviciosPopulares: serviciosPopularesResult.rows,
        horasPopulares: horasPopularesResult.rows,
        resumenEstados: resumenEstadosResult.rows,
        clientesFrecuentes: clientesFrecuentesResult.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener analíticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener analíticas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener datos de una reserva para generar QR (solo empresa)
exports.getReservaParaQR = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { reservaId } = req.params;

    // Verificar que la reserva pertenece a la empresa y está pendiente
    const reservaResult = await client.query(
      `SELECT r.id_reserva, r.numero_reserva, r.fecha, r.hora, r.estado,
              u.nombre_completo as nombre_cliente,
              e.nombre_empresa
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       WHERE r.id_reserva = $1 AND r.empresa_id = $2`,
      [reservaId, empresaId]
    );

    if (reservaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    let reserva = reservaResult.rows[0];

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({
        success: false,
        message: 'Solo se puede generar QR para reservas pendientes'
      });
    }

    // Si la reserva no tiene numero_reserva, generar uno y guardarlo
    if (!reserva.numero_reserva) {
      const nuevoNumeroReserva = generarNumeroReserva();
      await client.query(
        'UPDATE lavado_auto_reserva SET numero_reserva = $1 WHERE id_reserva = $2',
        [nuevoNumeroReserva, reserva.id_reserva]
      );
      reserva.numero_reserva = nuevoNumeroReserva;
    }

    // Generar datos para el QR - usamos el numero_reserva como identificador único
    const qrData = {
      numero_reserva: reserva.numero_reserva,
      id_reserva: reserva.id_reserva,
      empresa: reserva.nombre_empresa,
      cliente: reserva.nombre_cliente,
      fecha: reserva.fecha,
      hora: reserva.hora
    };

    res.json({
      success: true,
      data: {
        qrData: JSON.stringify(qrData),
        numero_reserva: reserva.numero_reserva,
        reserva: reserva
      }
    });

  } catch (error) {
    console.error('Error al obtener datos para QR:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos para QR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener servicios asignados y disponibles para la empresa
exports.getServiciosCompletos = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    // 1. Obtener servicios asignados a la empresa
    const serviciosAsignadosResult = await client.query(
      `SELECT s.id_servicio, s.nombre_servicio, s.descripcion, s.precio,
              COUNT(rs.id) as total_reservas,
              COALESCE(SUM(CASE WHEN r.estado = 'completado' THEN rs.precio_aplicado ELSE 0 END), 0) as ingresos_generados
       FROM lavado_auto_servicio s
       INNER JOIN lavado_auto_empresaservicio es ON s.id_servicio = es.servicio_id
       LEFT JOIN lavado_auto_reservaservicio rs ON s.id_servicio = rs.servicio_id
       LEFT JOIN lavado_auto_reserva r ON rs.reserva_id = r.id_reserva AND r.empresa_id = $1
       WHERE es.empresa_id = $1
       GROUP BY s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       ORDER BY total_reservas DESC`,
      [empresaId]
    );

    // 2. Obtener todos los servicios disponibles que NO están asignados
    const serviciosDisponiblesResult = await client.query(
      `SELECT s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       FROM lavado_auto_servicio s
       WHERE s.id_servicio NOT IN (
         SELECT servicio_id FROM lavado_auto_empresaservicio WHERE empresa_id = $1
       )
       ORDER BY s.nombre_servicio`,
      [empresaId]
    );

    // 3. Obtener solicitudes pendientes de la empresa
    const solicitudesPendientesResult = await client.query(
      `SELECT ss.id_solicitud, ss.estado, ss.fecha_solicitud, ss.motivo_solicitud,
              ss.respuesta_admin, ss.fecha_respuesta,
              s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       FROM lavado_auto_solicitudservicioempresa ss
       INNER JOIN lavado_auto_servicio s ON ss.servicio_solicitado_id = s.id_servicio
       WHERE ss.empresa_id = $1
       ORDER BY ss.fecha_solicitud DESC`,
      [empresaId]
    );

    res.json({
      success: true,
      data: {
        serviciosAsignados: serviciosAsignadosResult.rows,
        serviciosDisponibles: serviciosDisponiblesResult.rows,
        solicitudesPendientes: solicitudesPendientesResult.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener servicios completos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener servicios',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Solicitar un nuevo servicio
exports.solicitarServicio = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { servicioId, motivo, usuarioResponsable, telefonoContacto } = req.body;

    // Validar campos requeridos
    if (!servicioId || !motivo || !usuarioResponsable || !telefonoContacto) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    // Verificar que el servicio existe
    const servicioResult = await client.query(
      'SELECT id_servicio, nombre_servicio FROM lavado_auto_servicio WHERE id_servicio = $1',
      [servicioId]
    );

    if (servicioResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Servicio no encontrado'
      });
    }

    // Verificar que no está ya asignado
    const yaAsignadoResult = await client.query(
      `SELECT id FROM lavado_auto_empresaservicio 
       WHERE empresa_id = $1 AND servicio_id = $2`,
      [empresaId, servicioId]
    );

    if (yaAsignadoResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Este servicio ya está asignado a tu empresa'
      });
    }

    // Verificar que no hay una solicitud pendiente para este servicio
    const solicitudExistenteResult = await client.query(
      `SELECT id_solicitud FROM lavado_auto_solicitudservicioempresa 
       WHERE empresa_id = $1 AND servicio_solicitado_id = $2 AND estado = 'pendiente'`,
      [empresaId, servicioId]
    );

    if (solicitudExistenteResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Ya tienes una solicitud pendiente para este servicio'
      });
    }

    // Crear la solicitud
    const insertResult = await client.query(
      `INSERT INTO lavado_auto_solicitudservicioempresa 
       (empresa_id, servicio_solicitado_id, estado, motivo_solicitud, usuario_responsable, telefono_contacto, fecha_solicitud, respuesta_admin)
       VALUES ($1, $2, 'pendiente', $3, $4, $5, NOW(), '')
       RETURNING id_solicitud, fecha_solicitud`,
      [empresaId, servicioId, motivo, usuarioResponsable, telefonoContacto]
    );

    res.status(201).json({
      success: true,
      message: 'Solicitud enviada correctamente. Será revisada por el administrador.',
      data: {
        id_solicitud: insertResult.rows[0].id_solicitud,
        fecha_solicitud: insertResult.rows[0].fecha_solicitud,
        servicio: servicioResult.rows[0].nombre_servicio,
        estado: 'pendiente'
      }
    });

  } catch (error) {
    console.error('Error al solicitar servicio:', error);
    res.status(500).json({
      success: false,
      message: 'Error al enviar solicitud',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Cancelar solicitud de servicio
exports.cancelarSolicitudServicio = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { solicitudId } = req.params;

    // Verificar que la solicitud pertenece a la empresa y está pendiente
    const solicitudResult = await client.query(
      `SELECT id_solicitud, estado FROM lavado_auto_solicitudservicioempresa 
       WHERE id_solicitud = $1 AND empresa_id = $2`,
      [solicitudId, empresaId]
    );

    if (solicitudResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }

    if (solicitudResult.rows[0].estado !== 'pendiente') {
      return res.status(400).json({
        success: false,
        message: 'Solo se pueden cancelar solicitudes pendientes'
      });
    }

    // Eliminar la solicitud
    await client.query(
      'DELETE FROM lavado_auto_solicitudservicioempresa WHERE id_solicitud = $1',
      [solicitudId]
    );

    res.json({
      success: true,
      message: 'Solicitud cancelada correctamente'
    });

  } catch (error) {
    console.error('Error al cancelar solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar solicitud',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// ==================== PERFIL DE EMPRESA ====================

// Obtener perfil completo de la empresa
exports.getPerfilEmpresa = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    const result = await client.query(
      `SELECT 
        id_empresa,
        nombre_empresa,
        direccion,
        telefono,
        email,
        fecha_registro,
        verificada,
        latitud,
        longitud,
        profile_image,
        -- Información bancaria
        titular_cuenta,
        tipo_documento_titular,
        numero_documento_titular,
        banco,
        tipo_cuenta,
        numero_cuenta,
        swift_code,
        iban,
        -- Información fiscal
        nit_empresa,
        razon_social,
        regimen_tributario,
        -- Contacto facturación
        email_facturacion,
        telefono_facturacion,
        responsable_pagos,
        -- Estado de verificación
        datos_bancarios_verificados,
        fecha_verificacion_bancaria,
        notas_bancarias,
        is_active
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

    const empresa = result.rows[0];

    // Calcular estadísticas adicionales
    const statsResult = await client.query(
      `SELECT 
        COUNT(*) as total_reservas,
        COUNT(*) FILTER (WHERE estado = 'completado') as reservas_completadas,
        COALESCE(SUM(CASE WHEN estado = 'completado' THEN (
          SELECT COALESCE(SUM(precio_aplicado), 0) 
          FROM lavado_auto_reservaservicio 
          WHERE reserva_id = lavado_auto_reserva.id_reserva
        ) ELSE 0 END), 0) as ingresos_totales
      FROM lavado_auto_reserva
      WHERE empresa_id = $1`,
      [empresaId]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        ...empresa,
        profile_image: buildCloudinaryUrl(empresa.profile_image),
        estadisticas: {
          totalReservas: parseInt(stats.total_reservas) || 0,
          reservasCompletadas: parseInt(stats.reservas_completadas) || 0,
          ingresosTotales: parseFloat(stats.ingresos_totales) || 0
        }
      }
    });

  } catch (error) {
    console.error('Error al obtener perfil de empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Actualizar información básica de la empresa
exports.actualizarPerfilBasico = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const {
      nombre_empresa,
      direccion,
      telefono,
      email,
      latitud,
      longitud
    } = req.body;

    // Validaciones básicas
    if (!nombre_empresa || !direccion || !telefono || !email) {
      return res.status(400).json({
        success: false,
        message: 'Los campos nombre, dirección, teléfono y email son obligatorios'
      });
    }

    // Verificar que el email no esté en uso por otra empresa
    const emailCheck = await client.query(
      'SELECT id_empresa FROM lavado_auto_empresa WHERE email = $1 AND id_empresa != $2',
      [email, empresaId]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El email ya está en uso por otra empresa'
      });
    }

    const result = await client.query(
      `UPDATE lavado_auto_empresa SET
        nombre_empresa = $1,
        direccion = $2,
        telefono = $3,
        email = $4,
        latitud = $5,
        longitud = $6
      WHERE id_empresa = $7
      RETURNING *`,
      [nombre_empresa, direccion, telefono, email, latitud || null, longitud || null, empresaId]
    );

    res.json({
      success: true,
      message: 'Perfil actualizado correctamente',
      data: result.rows[0]
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

// Actualizar información bancaria de la empresa
exports.actualizarInfoBancaria = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const {
      titular_cuenta,
      tipo_documento_titular,
      numero_documento_titular,
      banco,
      tipo_cuenta,
      numero_cuenta,
      swift_code,
      iban,
      nit_empresa,
      razon_social,
      regimen_tributario,
      email_facturacion,
      telefono_facturacion,
      responsable_pagos,
      notas_bancarias
    } = req.body;

    // Actualizar información bancaria (resetea la verificación al cambiar datos)
    const result = await client.query(
      `UPDATE lavado_auto_empresa SET
        titular_cuenta = $1,
        tipo_documento_titular = $2,
        numero_documento_titular = $3,
        banco = $4,
        tipo_cuenta = $5,
        numero_cuenta = $6,
        swift_code = $7,
        iban = $8,
        nit_empresa = $9,
        razon_social = $10,
        regimen_tributario = $11,
        email_facturacion = $12,
        telefono_facturacion = $13,
        responsable_pagos = $14,
        notas_bancarias = $15,
        datos_bancarios_verificados = false,
        fecha_verificacion_bancaria = NULL
      WHERE id_empresa = $16
      RETURNING *`,
      [
        titular_cuenta || null,
        tipo_documento_titular || null,
        numero_documento_titular || null,
        banco || null,
        tipo_cuenta || null,
        numero_cuenta || null,
        swift_code || null,
        iban || null,
        nit_empresa || null,
        razon_social || null,
        regimen_tributario || null,
        email_facturacion || null,
        telefono_facturacion || null,
        responsable_pagos || null,
        notas_bancarias || null,
        empresaId
      ]
    );

    res.json({
      success: true,
      message: 'Información bancaria actualizada correctamente. Pendiente de verificación por el administrador.',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error al actualizar información bancaria:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar información bancaria',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Cambiar contraseña de la empresa
exports.cambiarContrasena = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { contrasena_actual, nueva_contrasena } = req.body;

    if (!contrasena_actual || !nueva_contrasena) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar la contraseña actual y la nueva contraseña'
      });
    }

    if (nueva_contrasena.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres'
      });
    }

    // Obtener contraseña actual
    const empresaResult = await client.query(
      'SELECT contrasena FROM lavado_auto_empresa WHERE id_empresa = $1',
      [empresaId]
    );

    if (empresaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Empresa no encontrada'
      });
    }

    // Verificar contraseña actual (usando el mismo método de Django)
    const { verifyDjangoPassword, makeDjangoPassword } = require('../utils/djangoPassword');
    const passwordValida = await verifyDjangoPassword(contrasena_actual, empresaResult.rows[0].contrasena);

    if (!passwordValida) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña actual es incorrecta'
      });
    }

    // Hashear nueva contraseña
    const nuevaContrasenaHash = await makeDjangoPassword(nueva_contrasena);

    // Actualizar contraseña
    await client.query(
      'UPDATE lavado_auto_empresa SET contrasena = $1 WHERE id_empresa = $2',
      [nuevaContrasenaHash, empresaId]
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente'
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

// ==================== MIS PAGOS (LIQUIDACIONES) ====================

// Obtener resumen de pagos de la empresa
exports.getResumenPagos = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    // Obtener totales de períodos por estado
    const resumenResult = await client.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN estado = 'activo' THEN total_neto ELSE 0 END), 0) as pendiente_actual,
        COALESCE(SUM(CASE WHEN estado = 'cerrado' THEN total_neto ELSE 0 END), 0) as pendiente_pago,
        COALESCE(SUM(CASE WHEN estado = 'pagado' THEN total_neto ELSE 0 END), 0) as total_pagado,
        COUNT(*) FILTER (WHERE estado = 'activo') as periodos_activos,
        COUNT(*) FILTER (WHERE estado = 'cerrado') as periodos_pendientes,
        COUNT(*) FILTER (WHERE estado = 'pagado') as periodos_pagados
      FROM lavado_auto_periodoliquidacion
      WHERE empresa_id = $1`,
      [empresaId]
    );

    // Obtener último pago realizado
    const ultimoPagoResult = await client.query(
      `SELECT fecha_pago, total_neto, referencia_pago
       FROM lavado_auto_periodoliquidacion
       WHERE empresa_id = $1 AND estado = 'pagado'
       ORDER BY fecha_pago DESC
       LIMIT 1`,
      [empresaId]
    );

    // Obtener reservas del período activo actual (aún no liquidadas)
    const reservasActivasResult = await client.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(rs.precio_aplicado), 0) as valor
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.empresa_id = $1 
       AND r.estado = 'completado'
       AND (r.pagado_empresa = false OR r.pagado_empresa IS NULL)`,
      [empresaId]
    );

    const resumen = resumenResult.rows[0];
    const ultimoPago = ultimoPagoResult.rows[0] || null;
    const reservasActivas = reservasActivasResult.rows[0];

    res.json({
      success: true,
      data: {
        pendienteActual: parseFloat(resumen.pendiente_actual) || 0,
        pendientePago: parseFloat(resumen.pendiente_pago) || 0,
        totalPagado: parseFloat(resumen.total_pagado) || 0,
        periodosActivos: parseInt(resumen.periodos_activos) || 0,
        periodosPendientes: parseInt(resumen.periodos_pendientes) || 0,
        periodosPagados: parseInt(resumen.periodos_pagados) || 0,
        ultimoPago,
        reservasSinLiquidar: {
          cantidad: parseInt(reservasActivas.total) || 0,
          valor: parseFloat(reservasActivas.valor) || 0
        }
      }
    });

  } catch (error) {
    console.error('Error al obtener resumen de pagos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener resumen de pagos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener períodos de liquidación (pagos pendientes y realizados)
exports.getPeriodosLiquidacion = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { estado } = req.query; // 'pendiente', 'pagado', 'todos'

    let whereClause = 'WHERE pl.empresa_id = $1';
    if (estado === 'pendiente') {
      whereClause += " AND pl.estado IN ('activo', 'cerrado')";
    } else if (estado === 'pagado') {
      whereClause += " AND pl.estado = 'pagado'";
    }

    const periodosResult = await client.query(
      `SELECT 
        pl.id_periodo,
        pl.fecha_inicio,
        pl.fecha_fin,
        pl.fecha_cierre,
        pl.fecha_pago,
        pl.total_bruto,
        pl.total_descuentos,
        pl.comision_autonew,
        pl.total_comision,
        pl.total_neto,
        pl.estado,
        pl.cantidad_reservas,
        pl.metodo_pago,
        pl.referencia_pago,
        pl.observaciones
      FROM lavado_auto_periodoliquidacion pl
      ${whereClause}
      ORDER BY pl.fecha_inicio DESC`,
      [empresaId]
    );

    res.json({
      success: true,
      data: periodosResult.rows
    });

  } catch (error) {
    console.error('Error al obtener períodos de liquidación:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener períodos de liquidación',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener detalle de un período específico
exports.getDetallePeriodo = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;
    const { periodoId } = req.params;

    // Obtener información del período
    const periodoResult = await client.query(
      `SELECT 
        pl.*
      FROM lavado_auto_periodoliquidacion pl
      WHERE pl.id_periodo = $1 AND pl.empresa_id = $2`,
      [periodoId, empresaId]
    );

    if (periodoResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Período no encontrado'
      });
    }

    const periodo = periodoResult.rows[0];

    // Obtener detalles de reservas del período
    const detallesResult = await client.query(
      `SELECT 
        dl.id as id_detalle,
        dl.valor_bruto,
        dl.valor_descuento,
        dl.valor_neto,
        dl.comision_aplicada,
        dl.valor_comision,
        dl.valor_final_empresa,
        dl.fecha_servicio,
        dl.tipo_descuento,
        r.numero_reserva,
        r.fecha,
        r.hora,
        u.nombre_completo as cliente
      FROM lavado_auto_detalleliquidacion dl
      INNER JOIN lavado_auto_reserva r ON dl.reserva_id = r.id_reserva
      INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
      WHERE dl.periodo_id = $1
      ORDER BY dl.fecha_servicio DESC`,
      [periodoId]
    );

    res.json({
      success: true,
      data: {
        periodo,
        detalles: detallesResult.rows
      }
    });

  } catch (error) {
    console.error('Error al obtener detalle del período:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener detalle del período',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener reservas completadas pendientes de liquidar
exports.getReservasPendientesLiquidar = async (req, res) => {
  const client = await pool.connect();

  try {
    const empresaId = req.user.id;

    const reservasResult = await client.query(
      `SELECT 
        r.id_reserva,
        r.numero_reserva,
        r.fecha,
        r.hora,
        r.estado,
        u.nombre_completo as cliente,
        COALESCE(SUM(rs.precio_aplicado), 0) as total_servicio,
        array_agg(json_build_object(
          'nombre', s.nombre_servicio,
          'precio', rs.precio_aplicado
        )) as servicios
      FROM lavado_auto_reserva r
      INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
      LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
      LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
      WHERE r.empresa_id = $1 
      AND r.estado = 'completado'
      AND (r.pagado_empresa = false OR r.pagado_empresa IS NULL)
      GROUP BY r.id_reserva, r.numero_reserva, r.fecha, r.hora, r.estado, u.nombre_completo
      ORDER BY r.fecha DESC, r.hora DESC`,
      [empresaId]
    );

    res.json({
      success: true,
      data: reservasResult.rows
    });

  } catch (error) {
    console.error('Error al obtener reservas pendientes de liquidar:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener reservas pendientes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};
