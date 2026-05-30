const jwt = require('jsonwebtoken');
require('dotenv').config();

// User data from your database
const user = {
  id: 1,
  email: 'superadmin@moreva.com',
  role: 'super_admin'
};

// Get secret from .env
const secret = process.env.JWT_SECRET;
console.log('\n🔐 Generating new token...\n');
console.log('Using secret:', secret);
console.log('For user:', user.email);
console.log('Role:', user.role);
console.log('ID:', user.id);
console.log('\n');

// Generate token
const token = jwt.sign(user, secret, { expiresIn: '7d' });
console.log('✅ NEW TOKEN:\n');
console.log(token);
console.log('\n');

// Verify it works
try {
  const verified = jwt.verify(token, secret);
  console.log('✅ Token verification: SUCCESS');
  console.log('Decoded:', verified);
} catch (error) {
  console.log('❌ Token verification: FAILED');
  console.log('Error:', error.message);
}

console.log('\n📋 Copy the token above to use in your API calls\n');