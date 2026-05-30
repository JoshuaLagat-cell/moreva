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

async function setupDatabase() {
  try {
    console.log('🔧 Setting up database...');

    // Drop existing users table if you want to recreate (comment out if you want to keep data)
    // await pool.query(`DROP TABLE IF EXISTS users CASCADE`);
    
    // Create users table with complete schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name VARCHAR(200) NOT NULL,
        role VARCHAR(50) DEFAULT 'staff',
        phone VARCHAR(20),
        address TEXT,
        is_active BOOLEAN DEFAULT true,
        email_verified BOOLEAN DEFAULT false,
        last_login TIMESTAMP,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table created/verified');

    // Create indexes for better performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    console.log('✅ Indexes created');

    // Create sessions table for token management (optional)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(50),
        user_agent TEXT
      )
    `);
    console.log('✅ Sessions table created');

    // Create password reset tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Password reset table created');

    // Check if super admin exists
    const adminCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      ['superadmin@moreva.com', 'superadmin']
    );

    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('Super@2024', 10);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, email_verified) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['superadmin', 'superadmin@moreva.com', hashedPassword, 'Super Administrator', 'super_admin', true]
      );
      console.log('✅ Super Admin created');
    } else {
      console.log('✅ Super Admin already exists');
    }

    // Create some sample staff accounts for testing
    const staffCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['manager@moreva.com']);
    if (staffCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('Manager@123', 10);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, email_verified) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['manager', 'manager@moreva.com', hashedPassword, 'Station Manager', 'manager', true]
      );
      console.log('✅ Manager account created');
    }

    const staffCheck2 = await pool.query('SELECT * FROM users WHERE email = $1', ['staff@moreva.com']);
    if (staffCheck2.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('Staff@123', 10);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, email_verified) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['staff', 'staff@moreva.com', hashedPassword, 'Fuel Attendant', 'staff', true]
      );
      console.log('✅ Staff account created');
    }

    console.log('\n📋 User Roles:');
    console.log('  - super_admin: Full system access');
    console.log('  - manager: Can manage operations');
    console.log('  - staff: Basic operations only');
    
    console.log('\n🔐 Test Accounts:');
    console.log('  Super Admin: superadmin@moreva.com / Super@2024');
    console.log('  Manager: manager@moreva.com / Manager@123');
    console.log('  Staff: staff@moreva.com / Staff@123');
    
    console.log('\n🎉 Database setup completed successfully!');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Setup error:', error);
    await pool.end();
  }
}

setupDatabase();