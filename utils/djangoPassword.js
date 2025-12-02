const crypto = require('crypto');

/**
 * Verifica una contraseña contra un hash de Django
 * Django usa el formato: algorithm$iterations$salt$hash
 * Por ejemplo: pbkdf2_sha256$260000$salt$hash
 * 
 * @param {string} password - Contraseña en texto plano
 * @param {string} djangoHash - Hash completo de Django
 * @returns {boolean} - true si la contraseña coincide
 */
function verifyDjangoPassword(password, djangoHash) {
    try {
        // Dividir el hash de Django en sus componentes
        const parts = djangoHash.split('$');

        if (parts.length !== 4) {
            console.error('Formato de hash Django inválido');
            return false;
        }

        const [algorithm, iterations, salt, originalHash] = parts;

        // Verificar que sea pbkdf2_sha256
        if (algorithm !== 'pbkdf2_sha256') {
            console.error('Algoritmo no soportado:', algorithm);
            return false;
        }

        // Generar hash con los mismos parámetros
        const hash = crypto.pbkdf2Sync(
            password,
            salt,
            parseInt(iterations),
            32, // Django usa 32 bytes para SHA256
            'sha256'
        );

        // Convertir a base64 (Django usa base64)
        const hashBase64 = hash.toString('base64');

        // Comparar hashes
        return hashBase64 === originalHash;

    } catch (error) {
        console.error('Error al verificar contraseña Django:', error);
        return false;
    }
}

/**
 * Crea un hash de contraseña compatible con Django
 * Usa PBKDF2-SHA256 con 260000 iteraciones (default de Django 3.2+)
 * 
 * @param {string} password - Contraseña en texto plano
 * @param {number} iterations - Número de iteraciones (default: 260000)
 * @returns {string} - Hash en formato Django
 */
function hashDjangoPassword(password, iterations = 260000) {
    try {
        // Generar salt aleatorio
        const salt = crypto.randomBytes(12).toString('base64').slice(0, 12);

        // Generar hash
        const hash = crypto.pbkdf2Sync(
            password,
            salt,
            iterations,
            32, // 32 bytes para SHA256
            'sha256'
        );

        // Convertir a base64
        const hashBase64 = hash.toString('base64');

        // Retornar en formato Django
        return `pbkdf2_sha256$${iterations}$${salt}$${hashBase64}`;

    } catch (error) {
        console.error('Error al crear hash Django:', error);
        throw error;
    }
}

/**
 * Verifica si un string es un hash de Django válido
 * 
 * @param {string} hash - String a verificar
 * @returns {boolean} - true si es un hash Django válido
 */
function isDjangoHash(hash) {
    if (!hash || typeof hash !== 'string') {
        return false;
    }

    const parts = hash.split('$');
    return parts.length === 4 && parts[0] === 'pbkdf2_sha256';
}

module.exports = {
    verifyDjangoPassword,
    hashDjangoPassword,
    isDjangoHash
};
