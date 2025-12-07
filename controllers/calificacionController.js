const pool = require('../config/database');

/**
 * Crear una nueva calificación para una reserva
 */
exports.crearCalificacion = async (req, res) => {
    const client = await pool.connect();

    try {
        const { reserva_id, empresa_id, puntuacion, comentario } = req.body;
        const usuario_id = req.user.id; // Del middleware de autenticación

        // Validaciones básicas
        if (!reserva_id || !empresa_id || !puntuacion) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos'
            });
        }

        if (puntuacion < 1 || puntuacion > 5) {
            return res.status(400).json({
                success: false,
                message: 'La puntuación debe estar entre 1 y 5'
            });
        }

        // Verificar si ya existe una calificación para esta reserva
        const checkExist = await client.query(
            'SELECT id_calificacion FROM lavado_auto_calificacionempresa WHERE reserva_id = $1',
            [reserva_id]
        );

        if (checkExist.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe una calificación para esta reserva'
            });
        }

        // Insertar la calificación
        const result = await client.query(
            `INSERT INTO lavado_auto_calificacionempresa 
       (reserva_id, empresa_id, usuario_id, puntuacion, comentario, fecha_creacion, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id_calificacion, puntuacion, comentario, fecha_creacion`,
            [reserva_id, empresa_id, usuario_id, puntuacion, comentario || '']
        );

        res.status(201).json({
            success: true,
            message: 'Calificación enviada exitosamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error al crear calificación:', error);
        res.status(500).json({
            success: false,
            message: 'Error al guardar la calificación',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
};

/**
 * Obtener calificación de una reserva específica
 */
exports.getCalificacionPorReserva = async (req, res) => {
    try {
        const { reservaId } = req.params;

        const result = await pool.query(
            `SELECT * FROM lavado_auto_calificacionempresa WHERE reserva_id = $1`,
            [reservaId]
        );

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                data: null // No hay calificación aún
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error al obtener calificación:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener la calificación'
        });
    }
};
