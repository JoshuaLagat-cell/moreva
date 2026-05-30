// save as update-passwords.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function updatePasswords() {
  try {
    console.log('🔐 Updating password hashes...');
    
    const users = [
      { email: 'superadmin@moreva.com', password: 'Super@2024' },
      { email: 'manager@moreva.com', password: 'Manager@123' },
      { email: 'staff@moreva.com', password: 'Staff@123' }
    ];
    
    for (const user of users) {
      const hash = await bcrypt.hash(user.password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, user.email]);
      console.log(`✓ Updated password for ${user.email}`);
    }
    
    console.log('\n✅ All passwords updated successfully!');
    console.log('\n🔑 Login Credentials:');
    console.log('  Super Admin: superadmin@moreva.com / Super@2024');
    console.log('  Manager: manager@moreva.com / Manager@123');
    console.log('  Staff: staff@moreva.com / Staff@123');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

updatePasswords();