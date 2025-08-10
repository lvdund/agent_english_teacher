const crypto = require('crypto');

console.log('🔐 Generating secure keys for your .env file:\n');

console.log('JWT_SECRET=' + crypto.randomBytes(32).toString('hex'));
console.log('JWT_REFRESH_SECRET=' + crypto.randomBytes(32).toString('hex'));
console.log('SESSION_SECRET=' + crypto.randomBytes(32).toString('hex'));

console.log('\n📋 Copy the above values to your .env file');
console.log('💡 Each key is 64 characters (256-bit security)');