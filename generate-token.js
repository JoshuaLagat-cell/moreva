const jwt = require('jsonwebtoken');
require('dotenv').config();

// User data
const user = {
  id: 1,
  email: 'superadmin@moreva.com',
  role: 'super_admin'
};

// Use the exact secret from .env
const secret = process.env.JWT_SECRET;
console.log('Using JWT_SECRET from .env:', secret);
console.log('Secret length:', secret.length);

// Generate new token
const token = jwt.sign(user, secret, { expiresIn: '7d' });
console.log('\n🔑 YOUR NEW TOKEN:\n');
console.log(token);
console.log('\n📋 Copy this entire token for testing\n');

// Verify the token works
try {
  const verified = jwt.verify(token, secret);
  console.log('✅ Token verification test: PASSED');
  console.log('Decoded payload:', verified);
} catch (error) {
  console.log('❌ Token verification test: FAILED');
  console.log('Error:', error.message);
}