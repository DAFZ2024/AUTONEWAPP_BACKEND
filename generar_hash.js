// Script para generar hash de contraseña para empresas
const bcrypt = require('bcryptjs');

async function generarHashes() {
  console.log('Generando hashes de contraseñas...\n');
  
  // Contraseña para empresa de ejemplo
  const password1 = 'empresa123';
  const hash1 = await bcrypt.hash(password1, 10);
  
  console.log('=====================================');
  console.log('EMPRESA DE EJEMPLO');
  console.log('=====================================');
  console.log('Contraseña:', password1);
  console.log('Hash:', hash1);
  console.log('\nCopia este hash y pégalo en el script SQL\n');
  
  // Verificar que el hash funciona
  const isValid = await bcrypt.compare(password1, hash1);
  console.log('Verificación:', isValid ? '✅ Hash correcto' : '❌ Hash inválido');
  console.log('=====================================\n');
}

generarHashes();
