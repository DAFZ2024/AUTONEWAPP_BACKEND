const pool = require('../config/database');

/**
 * Genera un número único de reserva en formato ANW-B9636010
 * ANW = prefijo fijo
 * B = tipo de reserva (B=básica, E=empresarial)
 * 9636010 = número aleatorio de 7 dígitos
 * @param {boolean} esReservaEmpresarial - Si es una reserva empresarial
 * @param {object} client - Cliente de la BD para verificar existencia
 * @returns {Promise<string>} Número de reserva único
 */
const generarNumeroReserva = async (esReservaEmpresarial = false, client = null) => {
  const dbClient = client || pool;
  const tipoReserva = esReservaEmpresarial ? 'E' : 'B';

  let intentos = 0;
  const maxIntentos = 10;

  while (intentos < maxIntentos) {
    // Generar 7 dígitos aleatorios
    let numeroAleatorio = '';
    for (let i = 0; i < 7; i++) {
      numeroAleatorio += Math.floor(Math.random() * 10).toString();
    }

    const numeroPropuesto = `ANW-${tipoReserva}${numeroAleatorio}`;

    // Verificar que no exista en la base de datos
    const existe = await dbClient.query(
      'SELECT 1 FROM lavado_auto_reserva WHERE numero_reserva = $1',
      [numeroPropuesto]
    );

    if (existe.rows.length === 0) {
      return numeroPropuesto;
    }

    intentos++;
  }

  // Si después de 10 intentos no se encuentra uno único, usar timestamp
  const tipoReservaFallback = esReservaEmpresarial ? 'E' : 'B';
  const timestamp = Date.now().toString().slice(-7);
  return `ANW-${tipoReservaFallback}${timestamp}`;
};

// Obtener todos los servicios con información de tipo de vehículo
exports.getServicios = async (req, res) => {
  try {
    // Obtener servicios con conteo de empresas que lo ofrecen
    const result = await pool.query(
      `SELECT s.id_servicio, s.nombre_servicio, s.descripcion, s.precio,
              COUNT(DISTINCT es.empresa_id) as cantidad_empresas
       FROM lavado_auto_servicio s
       LEFT JOIN lavado_auto_empresaservicio es ON s.id_servicio = es.servicio_id
       LEFT JOIN lavado_auto_empresa e ON es.empresa_id = e.id_empresa AND e.verificada = true
       GROUP BY s.id_servicio, s.nombre_servicio, s.descripcion, s.precio
       ORDER BY s.precio`
    );

    // Clasificar servicios por categoría basándose en el nombre/descripción
    const serviciosConCategoria = result.rows.map(servicio => {
      let categoria = 'general';
      let tiposVehiculo = ['sedan', 'suv', 'camioneta', 'hatchback', 'van', 'camion', 'moto'];

      const nombreLower = servicio.nombre_servicio.toLowerCase();
      const descLower = (servicio.descripcion || '').toLowerCase();

      // Clasificar por tipo de servicio
      if (nombreLower.includes('básico') || nombreLower.includes('basico') || nombreLower.includes('express')) {
        categoria = 'basico';
      } else if (nombreLower.includes('premium') || nombreLower.includes('completo')) {
        categoria = 'premium';
      } else if (nombreLower.includes('detallado') || nombreLower.includes('full')) {
        categoria = 'detallado';
      } else if (nombreLower.includes('interior')) {
        categoria = 'interior';
      } else if (nombreLower.includes('exterior')) {
        categoria = 'exterior';
      } else if (nombreLower.includes('encerado') || nombreLower.includes('cera')) {
        categoria = 'encerado';
      } else if (nombreLower.includes('motor')) {
        categoria = 'motor';
      }

      // Filtrar tipos de vehículo si es específico
      if (nombreLower.includes('moto') || descLower.includes('moto')) {
        tiposVehiculo = ['moto'];
      } else if (nombreLower.includes('camion') || descLower.includes('camion') || nombreLower.includes('pesado')) {
        tiposVehiculo = ['camion', 'van'];
      }

      return {
        ...servicio,
        cantidad_empresas: parseInt(servicio.cantidad_empresas) || 0,
        categoria,
        tipos_vehiculo: tiposVehiculo
      };
    });

    res.json({
      success: true,
      servicios: serviciosConCategoria
    });
  } catch (error) {
    console.error('Error al obtener servicios:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener los servicios',
      error: error.message
    });
  }
};

// Verificar suscripción activa del usuario
exports.verificarSuscripcion = async (req, res) => {
  try {
    const usuarioId = req.user.id;

    // Buscar suscripción activa del usuario
    const suscripcionResult = await pool.query(
      `SELECT 
        su.id_suscripcion,
        su.estado,
        su.fecha_inicio,
        su.fecha_fin,
        su.servicios_utilizados_mes,
        su.ultimo_reinicio_contador,
        p.id_plan,
        p.nombre as plan_nombre,
        p.tipo as plan_tipo,
        p.descripcion as plan_descripcion,
        p.precio_mensual,
        p.cantidad_servicios_mes
      FROM lavado_auto_suscripcionusuario su
      INNER JOIN lavado_auto_plan p ON su.plan_id = p.id_plan
      WHERE su.usuario_id = $1 
        AND su.estado = 'activa'
        AND su.fecha_fin >= CURRENT_DATE
      ORDER BY su.fecha_inicio DESC
      LIMIT 1`,
      [usuarioId]
    );

    if (suscripcionResult.rows.length === 0) {
      return res.json({
        success: true,
        tieneSuscripcion: false,
        suscripcion: null,
        serviciosPlan: [],
        serviciosDisponibles: 0
      });
    }

    const suscripcion = suscripcionResult.rows[0];

    // Verificar si necesita reiniciar el contador mensual
    const ultimoReinicio = new Date(suscripcion.ultimo_reinicio_contador);
    const ahora = new Date();
    const diasDesdeReinicio = Math.floor((ahora - ultimoReinicio) / (1000 * 60 * 60 * 24));

    let serviciosUtilizados = suscripcion.servicios_utilizados_mes;

    if (diasDesdeReinicio >= 30) {
      // Reiniciar contador
      await pool.query(
        `UPDATE lavado_auto_suscripcionusuario 
         SET servicios_utilizados_mes = 0, ultimo_reinicio_contador = NOW()
         WHERE id_suscripcion = $1`,
        [suscripcion.id_suscripcion]
      );
      serviciosUtilizados = 0;
    }

    // Obtener servicios incluidos en el plan con sus descuentos
    const serviciosPlanResult = await pool.query(
      `SELECT 
        s.id_servicio,
        s.nombre_servicio,
        s.descripcion,
        s.precio as precio_original,
        ps.porcentaje_descuento,
        ROUND((s.precio * (1 - ps.porcentaje_descuento / 100.0))::numeric, 2) as precio_con_descuento
      FROM lavado_auto_planservicio ps
      INNER JOIN lavado_auto_servicio s ON ps.servicio_id = s.id_servicio
      WHERE ps.plan_id = $1`,
      [suscripcion.id_plan]
    );

    // Calcular servicios disponibles
    const cantidadMes = suscripcion.cantidad_servicios_mes;
    const serviciosDisponibles = cantidadMes === 0
      ? -1 // -1 significa ilimitado
      : Math.max(0, cantidadMes - serviciosUtilizados);

    res.json({
      success: true,
      tieneSuscripcion: true,
      suscripcion: {
        id: suscripcion.id_suscripcion,
        estado: suscripcion.estado,
        fechaInicio: suscripcion.fecha_inicio,
        fechaFin: suscripcion.fecha_fin,
        serviciosUtilizadosMes: serviciosUtilizados,
        plan: {
          id: suscripcion.id_plan,
          nombre: suscripcion.plan_nombre,
          tipo: suscripcion.plan_tipo,
          descripcion: suscripcion.plan_descripcion,
          precioMensual: suscripcion.precio_mensual,
          cantidadServiciosMes: cantidadMes
        }
      },
      serviciosPlan: serviciosPlanResult.rows,
      serviciosDisponibles: serviciosDisponibles
    });

  } catch (error) {
    console.error('Error al verificar suscripción:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar la suscripción',
      error: error.message
    });
  }
};

// Obtener empresas que ofrecen los servicios seleccionados
exports.getEmpresasPorServicios = async (req, res) => {
  try {
    const { servicios } = req.query; // Viene como string "1,2,3"

    if (!servicios) {
      return res.status(400).json({
        success: false,
        message: 'Debes proporcionar al menos un servicio'
      });
    }

    const serviciosArray = servicios.split(',').map(id => parseInt(id));

    // Buscar empresas que tengan TODOS los servicios seleccionados
    // Nota: Usando solo las columnas que existen en la tabla lavado_auto_empresa según models.py
    const result = await pool.query(
      `SELECT DISTINCT e.id_empresa, e.nombre_empresa, e.direccion, e.telefono, 
              e.latitud, e.longitud, e.email,
              COUNT(DISTINCT es.servicio_id) as servicios_disponibles
       FROM lavado_auto_empresa e
       INNER JOIN lavado_auto_empresaservicio es ON e.id_empresa = es.empresa_id
       WHERE e.verificada = true 
       AND es.servicio_id = ANY($1)
       GROUP BY e.id_empresa
       HAVING COUNT(DISTINCT es.servicio_id) = $2
       ORDER BY e.nombre_empresa`,
      [serviciosArray, serviciosArray.length]
    );

    res.json({
      success: true,
      empresas: result.rows,
      mensaje: result.rows.length === 0 ? 'No hay empresas que ofrezcan todos los servicios seleccionados' : null
    });
  } catch (error) {
    console.error('Error al obtener empresas por servicios:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las empresas',
      error: error.message
    });
  }
};

// Crear una nueva reserva
exports.crearReserva = async (req, res) => {
  const client = await pool.connect();

  try {
    // Obtener el usuario_id del token JWT (req.user.id viene del middleware protect)
    const usuario_id = req.user.id;

    const {
      fecha,
      hora,
      empresa_id,
      servicios, // Array de objetos { id_servicio, es_servicio_plan, descuento }
      placa_vehiculo,
      tipo_vehiculo,
      conductor_asignado,
      observaciones_empresariales,
      es_pago_individual,
      es_reserva_empresarial,
      usar_suscripcion,
      suscripcion_id
    } = req.body;

    // Validaciones
    if (!fecha || !hora || !empresa_id || !servicios || servicios.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Faltan datos requeridos para crear la reserva'
      });
    }

    // Obtener el nombre del usuario para conductor_asignado si no se proporcionó
    let conductorFinal = conductor_asignado;
    if (!conductorFinal) {
      const userResult = await pool.query(
        'SELECT nombre_completo FROM lavado_auto_usuario WHERE id_usuario = $1',
        [usuario_id]
      );
      conductorFinal = userResult.rows[0]?.nombre_completo || '';
    }

    await client.query('BEGIN');

    // Si usa suscripción, verificar que tenga servicios disponibles
    let suscripcionUtilizada = null;
    if (usar_suscripcion && suscripcion_id) {
      const suscResult = await client.query(
        `SELECT su.*, p.cantidad_servicios_mes 
         FROM lavado_auto_suscripcionusuario su
         INNER JOIN lavado_auto_plan p ON su.plan_id = p.id_plan
         WHERE su.id_suscripcion = $1 AND su.usuario_id = $2 AND su.estado = 'activa'`,
        [suscripcion_id, usuario_id]
      );

      if (suscResult.rows.length > 0) {
        const susc = suscResult.rows[0];
        const cantidadMes = susc.cantidad_servicios_mes;

        // Verificar si tiene servicios disponibles (0 = ilimitado)
        if (cantidadMes > 0 && susc.servicios_utilizados_mes >= cantidadMes) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'No tienes servicios disponibles en tu plan este mes'
          });
        }

        suscripcionUtilizada = suscripcion_id;

        // Incrementar contador de servicios utilizados
        await client.query(
          `UPDATE lavado_auto_suscripcionusuario 
           SET servicios_utilizados_mes = servicios_utilizados_mes + 1
           WHERE id_suscripcion = $1`,
          [suscripcion_id]
        );
      }
    }

    // Determinar tipo de vehículo: solo se usa en reservas empresariales
    // Para reservas individuales, usar valor por defecto
    const tipoVehiculoFinal = es_reserva_empresarial === true
      ? (tipo_vehiculo || 'No especificado')
      : 'No especificado';

    // Generar número de reserva único (formato ANW-B1234567 o ANW-E1234567)
    const numeroReserva = await generarNumeroReserva(es_reserva_empresarial === true, client);

    // Insertar la reserva
    const reservaResult = await client.query(
      `INSERT INTO lavado_auto_reserva 
       (numero_reserva, fecha, hora, estado, empresa_id, usuario_id, es_pago_individual, es_reserva_empresarial,
        placa_vehiculo, tipo_vehiculo, conductor_asignado, observaciones_empresariales, suscripcion_utilizada_id, pagado_empresa, fue_recuperada, recargo_recuperacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id_reserva, numero_reserva`,
      [
        numeroReserva,
        fecha,
        hora,
        'pendiente',
        empresa_id,
        usuario_id,
        es_pago_individual !== false && !suscripcionUtilizada,
        es_reserva_empresarial === true,
        placa_vehiculo || null,
        tipoVehiculoFinal,
        conductorFinal,
        observaciones_empresariales || '',
        suscripcionUtilizada,
        false, // pagado_empresa: false por defecto
        false, // fue_recuperada: false por defecto
        0      // recargo_recuperacion: 0 por defecto
      ]
    );

    const reservaId = reservaResult.rows[0].id_reserva;

    // Insertar los servicios asociados a la reserva
    for (const servicioData of servicios) {
      const servicioId = typeof servicioData === 'object' ? servicioData.id_servicio : servicioData;
      const esServicioPlan = typeof servicioData === 'object' ? servicioData.es_servicio_plan : false;
      const descuentoPlan = typeof servicioData === 'object' ? servicioData.descuento : 0;

      // Obtener el precio del servicio
      const precioResult = await client.query(
        'SELECT precio FROM lavado_auto_servicio WHERE id_servicio = $1',
        [servicioId]
      );

      const precioOriginal = parseFloat(precioResult.rows[0]?.precio || 0);
      const precioAplicado = esServicioPlan
        ? precioOriginal * (1 - descuentoPlan / 100)
        : precioOriginal;

      await client.query(
        `INSERT INTO lavado_auto_reservaservicio 
         (reserva_id, servicio_id, precio_aplicado, precio_original, es_servicio_plan, descuento_plan_individual, descuento_empresarial)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reservaId, servicioId, precioAplicado, precioOriginal, esServicioPlan, descuentoPlan, 0]
      );
    }

    await client.query('COMMIT');

    // Obtener los datos completos de la reserva creada
    const reservaCompleta = await pool.query(
      `SELECT r.*, 
              u.nombre_completo, u.correo, u.telefono,
              e.nombre_empresa, e.direccion as direccion_empresa,
              json_agg(json_build_object(
                'id_servicio', s.id_servicio,
                'nombre_servicio', s.nombre_servicio,
                'precio_original', rs.precio_original,
                'precio_aplicado', rs.precio_aplicado,
                'es_servicio_plan', rs.es_servicio_plan,
                'descuento', rs.descuento_plan_individual
              )) as servicios,
              SUM(rs.precio_aplicado) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
       WHERE r.id_reserva = $1
       GROUP BY r.id_reserva, u.id_usuario, e.id_empresa`,
      [reservaId]
    );

    res.status(201).json({
      success: true,
      message: 'Reserva creada exitosamente',
      reserva: reservaCompleta.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al crear reserva:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear la reserva',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Obtener reservas de un usuario
exports.getReservasPorUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const { estado } = req.query; // Filtro opcional por estado

    console.log('[getReservasPorUsuario] Iniciando consulta para usuario:', usuarioId);
    console.log('[getReservasPorUsuario] Filtro estado:', estado);

    // 1. Actualizar reservas vencidas (más de 1 hora pasada)
    // Combinar fecha y hora para comparar con el tiempo actual
    // Intervalo: fecha + hora + 1 hora < NOW()
    const updateQuery = `
      UPDATE lavado_auto_reserva
      SET estado = 'vencida'
      WHERE usuario_id = $1
      AND estado IN ('pendiente', 'confirmada')
      AND (fecha + hora + INTERVAL '1 hour') < NOW()
    `;

    await pool.query(updateQuery, [usuarioId]);
    console.log('[getReservasPorUsuario] Reservas vencidas actualizadas');

    let query = `
      SELECT r.*, 
             e.nombre_empresa, e.direccion as direccion_empresa, e.telefono as telefono_empresa,
             json_agg(json_build_object(
               'id_servicio', s.id_servicio,
               'nombre_servicio', s.nombre_servicio,
               'precio', rs.precio_aplicado
             )) as servicios,
             SUM(rs.precio_aplicado) as total
      FROM lavado_auto_reserva r
      INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
      LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
      LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
      WHERE r.usuario_id = $1
    `;

    const params = [usuarioId];

    if (estado) {
      query += ` AND r.estado = $2`;
      params.push(estado);
    }

    query += `
      GROUP BY r.id_reserva, e.id_empresa
      ORDER BY r.fecha DESC, r.hora DESC
    `;

    console.log('[getReservasPorUsuario] Ejecutando query con params:', params);
    const result = await pool.query(query, params);
    console.log('[getReservasPorUsuario] Query ejecutada. Filas encontradas:', result.rows.length);

    res.json({
      success: true,
      data: {
        reservas: result.rows
      }
    });
  } catch (error) {
    console.error('[getReservasPorUsuario] Error al obtener reservas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las reservas',
      error: error.message
    });
  }
};

// Cancelar una reserva
exports.cancelarReserva = async (req, res) => {
  try {
    const { reservaId } = req.params;
    const { usuario_id } = req.body;

    // Verificar que la reserva pertenece al usuario y está en estado que permite cancelación
    const checkResult = await pool.query(
      `SELECT estado, usuario_id FROM lavado_auto_reserva WHERE id_reserva = $1`,
      [reservaId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    const reserva = checkResult.rows[0];

    if (reserva.usuario_id !== parseInt(usuario_id)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para cancelar esta reserva'
      });
    }

    if (reserva.estado === 'cancelada' || reserva.estado === 'completado') {
      return res.status(400).json({
        success: false,
        message: `No se puede cancelar una reserva en estado: ${reserva.estado}`
      });
    }

    // Actualizar el estado a cancelada
    await pool.query(
      `UPDATE lavado_auto_reserva SET estado = 'cancelada' WHERE id_reserva = $1`,
      [reservaId]
    );

    res.json({
      success: true,
      message: 'Reserva cancelada exitosamente'
    });
  } catch (error) {
    console.error('Error al cancelar reserva:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cancelar la reserva',
      error: error.message
    });
  }
};

// Reagendar una reserva (cambiar fecha y hora)
exports.reagendarReserva = async (req, res) => {
  try {
    const { reservaId } = req.params;
    const { nueva_fecha, nueva_hora, usuario_id } = req.body;

    if (!nueva_fecha || !nueva_hora) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere nueva_fecha y nueva_hora'
      });
    }

    // Verificar que la reserva existe y pertenece al usuario
    const checkResult = await pool.query(
      `SELECT r.id_reserva, r.estado, r.usuario_id, r.empresa_id, r.fecha, r.hora
       FROM lavado_auto_reserva r
       WHERE r.id_reserva = $1`,
      [reservaId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    const reserva = checkResult.rows[0];

    if (reserva.usuario_id !== parseInt(usuario_id)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para modificar esta reserva'
      });
    }

    if (reserva.estado === 'cancelada' || reserva.estado === 'completado') {
      return res.status(400).json({
        success: false,
        message: `No se puede reagendar una reserva en estado: ${reserva.estado}`
      });
    }

    // Verificar que el nuevo horario esté disponible
    const horarioOcupado = await pool.query(
      `SELECT id_reserva FROM lavado_auto_reserva 
       WHERE empresa_id = $1 AND fecha = $2 AND hora = $3 
       AND estado != 'cancelada' AND id_reserva != $4`,
      [reserva.empresa_id, nueva_fecha, nueva_hora, reservaId]
    );

    if (horarioOcupado.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El horario seleccionado ya no está disponible'
      });
    }

    // Actualizar la reserva con la nueva fecha y hora
    await pool.query(
      `UPDATE lavado_auto_reserva 
       SET fecha = $1, hora = $2 
       WHERE id_reserva = $3`,
      [nueva_fecha, nueva_hora, reservaId]
    );

    // Obtener la reserva actualizada
    const updatedReserva = await pool.query(
      `SELECT r.*, e.nombre_empresa 
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       WHERE r.id_reserva = $1`,
      [reservaId]
    );

    res.json({
      success: true,
      message: 'Reserva reagendada exitosamente',
      data: {
        reserva: updatedReserva.rows[0]
      }
    });
  } catch (error) {
    console.error('Error al reagendar reserva:', error);
    res.status(500).json({
      success: false,
      message: 'Error al reagendar la reserva',
      error: error.message
    });
  }
};

// Obtener horarios disponibles para una fecha y empresa
exports.getHorariosDisponibles = async (req, res) => {
  try {
    const { empresaId, fecha } = req.query;

    if (!empresaId || !fecha) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere empresaId y fecha'
      });
    }

    // Obtener todas las reservas para esa empresa y fecha
    const result = await pool.query(
      `SELECT hora FROM lavado_auto_reserva 
       WHERE empresa_id = $1 AND fecha = $2 AND estado != 'cancelada'`,
      [empresaId, fecha]
    );

    const horasOcupadas = result.rows.map(row => {
      // Convertir TIME a string en formato HH:MM
      const horaString = row.hora.toString();
      return horaString.substring(0, 5); // Obtener solo HH:MM
    });

    // Todos los horarios posibles (de 8:00 AM a 6:00 PM en lapsos de 1 hora)
    const todosLosHorarios = [
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
      '14:00', '15:00', '16:00', '17:00', '18:00'
    ];

    // Verificar si la fecha es hoy para filtrar horas pasadas
    const hoy = new Date();
    const fechaSeleccionada = new Date(fecha + 'T00:00:00');
    const esHoy = hoy.toDateString() === fechaSeleccionada.toDateString();
    const horaActual = hoy.getHours();

    // Crear array con todos los horarios y su estado
    const horariosConEstado = todosLosHorarios.map(hora => {
      const horaNum = parseInt(hora.split(':')[0]);
      const ocupado = horasOcupadas.includes(hora);
      const pasado = esHoy && horaNum <= horaActual;

      return {
        hora,
        disponible: !ocupado && !pasado,
        ocupado,
        pasado
      };
    });

    // Filtrar horarios disponibles (para compatibilidad)
    const horariosDisponibles = horariosConEstado
      .filter(h => h.disponible)
      .map(h => h.hora);

    res.json({
      success: true,
      horariosDisponibles,
      todosLosHorarios: horariosConEstado,
      horasOcupadas,
      esHoy
    });
  } catch (error) {
    console.error('Error al obtener horarios disponibles:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener horarios disponibles',
      error: error.message
    });
  }
};

// Verificar y completar reserva mediante escaneo de código QR (para el cliente)
exports.verificarYCompletarReservaQR = async (req, res) => {
  const client = await pool.connect();

  try {
    const usuarioId = req.user.id;
    const { numero_reserva, id_reserva } = req.body;

    if (!numero_reserva && !id_reserva) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el número de reserva o ID de reserva'
      });
    }

    // Buscar la reserva
    let query = `
      SELECT r.id_reserva, r.numero_reserva, r.fecha, r.hora, r.estado, r.usuario_id,
             e.nombre_empresa, e.id_empresa,
             u.nombre_completo as nombre_cliente
      FROM lavado_auto_reserva r
      INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
      INNER JOIN lavado_auto_usuario u ON r.usuario_id = u.id_usuario
      WHERE `;

    const params = [];
    if (numero_reserva) {
      query += `r.numero_reserva = $1`;
      params.push(numero_reserva);
    } else {
      query += `r.id_reserva = $1`;
      params.push(id_reserva);
    }

    const reservaResult = await client.query(query, params);

    if (reservaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada. El código QR puede ser inválido.'
      });
    }

    const reserva = reservaResult.rows[0];

    // Verificar que la reserva pertenece al usuario que escanea
    if (reserva.usuario_id !== usuarioId) {
      return res.status(403).json({
        success: false,
        message: 'Esta reserva no te pertenece. Solo puedes completar tus propias reservas.'
      });
    }

    // Verificar que la reserva está pendiente
    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({
        success: false,
        message: `Esta reserva ya está ${reserva.estado}. No se puede completar.`,
        estado_actual: reserva.estado
      });
    }

    // Verificar que la fecha de la reserva es hoy (opcional pero recomendado para seguridad)
    const hoy = new Date().toISOString().split('T')[0];
    const fechaReserva = new Date(reserva.fecha).toISOString().split('T')[0];

    if (fechaReserva !== hoy) {
      return res.status(400).json({
        success: false,
        message: 'Solo puedes completar reservas del día de hoy.',
        fecha_reserva: fechaReserva,
        fecha_actual: hoy
      });
    }

    // Todo validado - marcar como completada
    await client.query(
      `UPDATE lavado_auto_reserva SET estado = 'completado' WHERE id_reserva = $1`,
      [reserva.id_reserva]
    );

    res.json({
      success: true,
      message: '¡Reserva completada exitosamente!',
      data: {
        id_reserva: reserva.id_reserva,
        numero_reserva: reserva.numero_reserva,
        empresa: reserva.nombre_empresa,
        cliente: reserva.nombre_cliente,
        fecha: reserva.fecha,
        hora: reserva.hora,
        estado: 'completado'
      }
    });

  } catch (error) {
    console.error('Error al verificar y completar reserva por QR:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar la verificación',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
};

// Obtener reserva por número de reserva (para verificación previa)
exports.getReservaPorNumero = async (req, res) => {
  try {
    const usuarioId = req.user.id;
    const { numeroReserva } = req.params;

    const result = await pool.query(
      `SELECT r.id_reserva, r.numero_reserva, r.fecha, r.hora, r.estado,
              e.nombre_empresa,
              json_agg(json_build_object(
                'nombre_servicio', s.nombre_servicio,
                'precio', rs.precio_aplicado
              )) as servicios,
              SUM(rs.precio_aplicado) as total
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       LEFT JOIN lavado_auto_servicio s ON rs.servicio_id = s.id_servicio
       WHERE r.numero_reserva = $1 AND r.usuario_id = $2
       GROUP BY r.id_reserva, e.id_empresa`,
      [numeroReserva, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada o no te pertenece'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al obtener reserva por número:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la reserva',
      error: error.message
    });
  }
};

// Calcular recargo para recuperar reserva vencida
exports.calcularRecargoRecuperacion = async (req, res) => {
  try {
    const { reservaId } = req.params;
    const { usuario_id } = req.query;

    // Obtener la reserva con su total
    const result = await pool.query(
      `SELECT r.id_reserva, r.numero_reserva, r.estado, r.usuario_id, r.empresa_id,
              r.fecha, r.hora, e.nombre_empresa,
              COALESCE(SUM(rs.precio_aplicado), 0) as total_original
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.id_reserva = $1
       GROUP BY r.id_reserva, e.id_empresa`,
      [reservaId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    const reserva = result.rows[0];

    if (reserva.usuario_id !== parseInt(usuario_id)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para ver esta reserva'
      });
    }

    if (reserva.estado !== 'vencida') {
      return res.status(400).json({
        success: false,
        message: 'Solo se pueden recuperar reservas vencidas'
      });
    }

    const totalOriginal = parseFloat(reserva.total_original) || 0;
    const recargo = totalOriginal * 0.25; // 25% de recargo

    res.json({
      success: true,
      data: {
        reserva: {
          id_reserva: reserva.id_reserva,
          numero_reserva: reserva.numero_reserva,
          empresa_id: reserva.empresa_id,
          nombre_empresa: reserva.nombre_empresa,
          fecha_original: reserva.fecha,
          hora_original: reserva.hora
        },
        total_original: totalOriginal,
        porcentaje_recargo: 25,
        recargo: recargo,
        total_a_pagar: recargo // Solo paga el recargo para recuperar
      }
    });
  } catch (error) {
    console.error('Error al calcular recargo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al calcular el recargo',
      error: error.message
    });
  }
};

// Recuperar reserva vencida (reagendar con recargo del 25%)
exports.recuperarReservaVencida = async (req, res) => {
  try {
    const { reservaId } = req.params;
    const { nueva_fecha, nueva_hora, usuario_id, pago_confirmado } = req.body;

    if (!nueva_fecha || !nueva_hora) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere nueva_fecha y nueva_hora'
      });
    }

    if (!pago_confirmado) {
      return res.status(400).json({
        success: false,
        message: 'Debe confirmar el pago del recargo para recuperar la reserva'
      });
    }

    // Obtener la reserva con su total
    const checkResult = await pool.query(
      `SELECT r.id_reserva, r.numero_reserva, r.estado, r.usuario_id, r.empresa_id,
              COALESCE(SUM(rs.precio_aplicado), 0) as total_original
       FROM lavado_auto_reserva r
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.id_reserva = $1
       GROUP BY r.id_reserva`,
      [reservaId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reserva no encontrada'
      });
    }

    const reserva = checkResult.rows[0];

    if (reserva.usuario_id !== parseInt(usuario_id)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para modificar esta reserva'
      });
    }

    if (reserva.estado !== 'vencida') {
      return res.status(400).json({
        success: false,
        message: 'Solo se pueden recuperar reservas con estado vencida'
      });
    }

    // Verificar que el nuevo horario esté disponible
    const horarioOcupado = await pool.query(
      `SELECT id_reserva FROM lavado_auto_reserva 
       WHERE empresa_id = $1 AND fecha = $2 AND hora = $3 
       AND estado NOT IN ('cancelada', 'vencida') AND id_reserva != $4`,
      [reserva.empresa_id, nueva_fecha, nueva_hora, reservaId]
    );

    if (horarioOcupado.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'El horario seleccionado ya no está disponible'
      });
    }

    // Calcular el recargo (25%)
    const totalOriginal = parseFloat(reserva.total_original) || 0;
    const recargo = totalOriginal * 0.25;

    // Actualizar la reserva: cambiar fecha/hora, estado a pendiente, marcar como recuperada
    await pool.query(
      `UPDATE lavado_auto_reserva 
       SET fecha = $1, 
           hora = $2, 
           estado = 'pendiente',
           fue_recuperada = true,
           recargo_recuperacion = $3
       WHERE id_reserva = $4`,
      [nueva_fecha, nueva_hora, recargo, reservaId]
    );

    // Obtener la reserva actualizada con todos los detalles
    const updatedReserva = await pool.query(
      `SELECT r.*, e.nombre_empresa,
              COALESCE(SUM(rs.precio_aplicado), 0) as total_servicios
       FROM lavado_auto_reserva r
       INNER JOIN lavado_auto_empresa e ON r.empresa_id = e.id_empresa
       LEFT JOIN lavado_auto_reservaservicio rs ON r.id_reserva = rs.reserva_id
       WHERE r.id_reserva = $1
       GROUP BY r.id_reserva, e.id_empresa`,
      [reservaId]
    );

    res.json({
      success: true,
      message: 'Reserva recuperada exitosamente. Se aplicó un recargo del 25%.',
      data: {
        reserva: updatedReserva.rows[0],
        recargo_aplicado: recargo,
        total_original: totalOriginal
      }
    });
  } catch (error) {
    console.error('Error al recuperar reserva vencida:', error);
    res.status(500).json({
      success: false,
      message: 'Error al recuperar la reserva',
      error: error.message
    });
  }
};
