const pool = require('./config/database');

const createTable = async () => {
    try {
        console.log('Creando tabla de calificaciones...');

        await pool.query(`
      CREATE TABLE IF NOT EXISTS lavado_auto_calificacionempresa (
        id_calificacion SERIAL PRIMARY KEY,
        reserva_id INTEGER NOT NULL UNIQUE,
        empresa_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        puntuacion INTEGER NOT NULL CHECK (puntuacion >= 1 AND puntuacion <= 5),
        comentario TEXT,
        fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_reserva FOREIGN KEY (reserva_id) REFERENCES lavado_auto_reserva(id_reserva),
        CONSTRAINT fk_empresa FOREIGN KEY (empresa_id) REFERENCES lavado_auto_empresa(id_empresa),
        CONSTRAINT fk_usuario FOREIGN KEY (usuario_id) REFERENCES lavado_auto_usuario(id_usuario)
      );
    `);

        console.log('✅ Tabla lavado_auto_calificacionempresa verificada/creada');
    } catch (error) {
        console.error('❌ Error al crear tabla:', error);
    } finally {
        pool.end();
    }
};

createTable();
