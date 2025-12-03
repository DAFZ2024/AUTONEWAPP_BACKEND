const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { protect } = require('../middleware/authMiddleware');

// Obtener todos los planes disponibles (públicos)
router.get('/disponibles', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id_plan,
        p.nombre,
        p.tipo,
        p.descripcion,
        p.precio_mensual,
        p.cantidad_servicios_mes,
        p.activo,
        p.incluye_lavado_asientos,
        p.incluye_aspirado,
        p.incluye_lavado_exterior,
        p.incluye_lavado_interior_humedo,
        p.incluye_encerado,
        p.incluye_detallado_completo,
        p.fecha_creacion
      FROM lavado_auto_plan p
      WHERE p.activo = true
      ORDER BY p.precio_mensual ASC
    `;
    
    const result = await pool.query(query);
    
    // Para cada plan, obtener los servicios incluidos
    const planes = await Promise.all(result.rows.map(async (plan) => {
      const serviciosQuery = `
        SELECT 
          s.id_servicio,
          s.nombre_servicio,
          s.descripcion,
          s.precio,
          ps.porcentaje_descuento
        FROM lavado_auto_planservicio ps
        JOIN lavado_auto_servicio s ON ps.servicio_id = s.id_servicio
        WHERE ps.plan_id = $1
      `;
      const serviciosResult = await pool.query(serviciosQuery, [plan.id_plan]);
      
      return {
        ...plan,
        servicios_incluidos: serviciosResult.rows
      };
    }));
    
    res.json({
      success: true,
      data: planes
    });
  } catch (error) {
    console.error('Error al obtener planes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los planes disponibles'
    });
  }
});

// Obtener suscripción activa del usuario (DEBE IR ANTES DE /:planId)
router.get('/mi-suscripcion/activa', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user.id_usuario;
    
    const query = `
      SELECT 
        su.id_suscripcion,
        su.fecha_inicio,
        su.fecha_fin,
        su.estado,
        su.servicios_utilizados_mes,
        su.ultimo_reinicio_contador,
        su.auto_renovar,
        p.id_plan,
        p.nombre as plan_nombre,
        p.tipo as plan_tipo,
        p.descripcion as plan_descripcion,
        p.precio_mensual,
        p.cantidad_servicios_mes,
        p.incluye_lavado_asientos,
        p.incluye_aspirado,
        p.incluye_lavado_exterior,
        p.incluye_lavado_interior_humedo,
        p.incluye_encerado,
        p.incluye_detallado_completo
      FROM lavado_auto_suscripcionusuario su
      JOIN lavado_auto_plan p ON su.plan_id = p.id_plan
      WHERE su.usuario_id = $1 
        AND su.estado = 'activa'
        AND su.fecha_fin >= CURRENT_DATE
      ORDER BY su.fecha_inicio DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'No tienes una suscripción activa'
      });
    }
    
    const suscripcion = result.rows[0];
    
    // Obtener servicios incluidos en el plan
    const serviciosQuery = `
      SELECT 
        s.id_servicio,
        s.nombre_servicio,
        s.descripcion,
        s.precio,
        ps.porcentaje_descuento
      FROM lavado_auto_planservicio ps
      JOIN lavado_auto_servicio s ON ps.servicio_id = s.id_servicio
      WHERE ps.plan_id = $1
    `;
    const serviciosResult = await pool.query(serviciosQuery, [suscripcion.id_plan]);
    
    // Calcular días restantes
    const fechaFin = new Date(suscripcion.fecha_fin);
    const hoy = new Date();
    const diasRestantes = Math.ceil((fechaFin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calcular servicios restantes
    const serviciosRestantes = suscripcion.cantidad_servicios_mes === 0 
      ? 'Ilimitado' 
      : Math.max(0, suscripcion.cantidad_servicios_mes - suscripcion.servicios_utilizados_mes);
    
    res.json({
      success: true,
      data: {
        ...suscripcion,
        servicios_incluidos: serviciosResult.rows,
        dias_restantes: diasRestantes,
        servicios_restantes: serviciosRestantes
      }
    });
  } catch (error) {
    console.error('Error al obtener suscripción:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la suscripción'
    });
  }
});

// Historial de suscripciones del usuario (DEBE IR ANTES DE /:planId)
router.get('/mi-suscripcion/historial', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user.id_usuario;
    
    const query = `
      SELECT 
        su.id_suscripcion,
        su.fecha_inicio,
        su.fecha_fin,
        su.estado,
        su.servicios_utilizados_mes,
        p.nombre as plan_nombre,
        p.tipo as plan_tipo,
        p.precio_mensual
      FROM lavado_auto_suscripcionusuario su
      JOIN lavado_auto_plan p ON su.plan_id = p.id_plan
      WHERE su.usuario_id = $1
      ORDER BY su.fecha_inicio DESC
    `;
    
    const result = await pool.query(query, [userId]);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el historial de suscripciones'
    });
  }
});

// Obtener detalle de un plan específico (RUTAS DINÁMICAS VAN AL FINAL)
router.get('/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    
    const query = `
      SELECT 
        p.id_plan,
        p.nombre,
        p.tipo,
        p.descripcion,
        p.precio_mensual,
        p.cantidad_servicios_mes,
        p.activo,
        p.incluye_lavado_asientos,
        p.incluye_aspirado,
        p.incluye_lavado_exterior,
        p.incluye_lavado_interior_humedo,
        p.incluye_encerado,
        p.incluye_detallado_completo,
        p.fecha_creacion
      FROM lavado_auto_plan p
      WHERE p.id_plan = $1
    `;
    
    const result = await pool.query(query, [planId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Plan no encontrado'
      });
    }
    
    const plan = result.rows[0];
    
    // Obtener servicios incluidos
    const serviciosQuery = `
      SELECT 
        s.id_servicio,
        s.nombre_servicio,
        s.descripcion,
        s.precio,
        ps.porcentaje_descuento
      FROM lavado_auto_planservicio ps
      JOIN lavado_auto_servicio s ON ps.servicio_id = s.id_servicio
      WHERE ps.plan_id = $1
    `;
    const serviciosResult = await pool.query(serviciosQuery, [planId]);
    
    res.json({
      success: true,
      data: {
        ...plan,
        servicios_incluidos: serviciosResult.rows
      }
    });
  } catch (error) {
    console.error('Error al obtener plan:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el plan'
    });
  }
});

// Suscribirse a un plan
router.post('/suscribirse', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user.id_usuario;
    const { plan_id, metodo_pago, referencia_pago } = req.body;
    
    if (!plan_id) {
      return res.status(400).json({
        success: false,
        message: 'El ID del plan es requerido'
      });
    }
    
    // Verificar que el plan existe y está activo
    const planQuery = `
      SELECT * FROM lavado_auto_plan 
      WHERE id_plan = $1 AND activo = true
    `;
    const planResult = await pool.query(planQuery, [plan_id]);
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'El plan seleccionado no está disponible'
      });
    }
    
    const plan = planResult.rows[0];
    
    // Verificar si ya tiene una suscripción activa
    const suscripcionActivaQuery = `
      SELECT * FROM lavado_auto_suscripcionusuario 
      WHERE usuario_id = $1 
        AND estado = 'activa'
        AND fecha_fin >= CURRENT_DATE
    `;
    const suscripcionActiva = await pool.query(suscripcionActivaQuery, [userId]);
    
    if (suscripcionActiva.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Ya tienes una suscripción activa. Debes esperar a que termine o cancelarla primero.'
      });
    }
    
    // Crear la suscripción
    const fechaInicio = new Date();
    const fechaFin = new Date();
    fechaFin.setDate(fechaFin.getDate() + 30); // 30 días
    
    const insertQuery = `
      INSERT INTO lavado_auto_suscripcionusuario 
        (usuario_id, plan_id, fecha_inicio, fecha_fin, estado, servicios_utilizados_mes, ultimo_reinicio_contador, auto_renovar)
      VALUES ($1, $2, $3, $4, 'activa', 0, $3, true)
      RETURNING *
    `;
    
    const insertResult = await pool.query(insertQuery, [userId, plan_id, fechaInicio, fechaFin]);
    const nuevaSuscripcion = insertResult.rows[0];
    
    // Crear registro de pago si se proporciona
    if (metodo_pago && referencia_pago) {
      const pagoQuery = `
        INSERT INTO lavado_auto_historialpagossuscripcion 
          (suscripcion_id, monto, estado, referencia_pago, metodo_pago, fecha_pago)
        VALUES ($1, $2, 'aprobado', $3, $4, NOW())
      `;
      await pool.query(pagoQuery, [nuevaSuscripcion.id_suscripcion, plan.precio_mensual, referencia_pago, metodo_pago]);
    }
    
    res.status(201).json({
      success: true,
      message: '¡Te has suscrito exitosamente!',
      data: {
        id_suscripcion: nuevaSuscripcion.id_suscripcion,
        plan_nombre: plan.nombre,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        precio_mensual: plan.precio_mensual
      }
    });
  } catch (error) {
    console.error('Error al crear suscripción:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar la suscripción'
    });
  }
});

// Cancelar suscripción
router.put('/cancelar/:suscripcionId', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user.id_usuario;
    const { suscripcionId } = req.params;
    
    // Verificar que la suscripción pertenece al usuario
    const verificarQuery = `
      SELECT * FROM lavado_auto_suscripcionusuario 
      WHERE id_suscripcion = $1 AND usuario_id = $2
    `;
    const verificar = await pool.query(verificarQuery, [suscripcionId, userId]);
    
    if (verificar.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Suscripción no encontrada'
      });
    }
    
    // Actualizar estado a cancelada
    const updateQuery = `
      UPDATE lavado_auto_suscripcionusuario 
      SET estado = 'cancelada', auto_renovar = false
      WHERE id_suscripcion = $1
      RETURNING *
    `;
    
    await pool.query(updateQuery, [suscripcionId]);
    
    res.json({
      success: true,
      message: 'Suscripción cancelada correctamente. Podrás seguir usando los beneficios hasta la fecha de vencimiento.'
    });
  } catch (error) {
    console.error('Error al cancelar suscripción:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar la suscripción'
    });
  }
});

module.exports = router;
