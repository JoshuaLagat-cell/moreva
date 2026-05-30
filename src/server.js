const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || 'moreva_super_secret_key_2026_enterprise';

// ==================== CORS CONFIGURATION FOR PRODUCTION ====================
// Allow all origins in production, or specify your Render URL
const allowedOrigins = [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    process.env.RENDER_URL || 'https://moreva-energy.onrender.com'
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1 && process.env.NODE_ENV === 'production') {
            console.warn(`Origin ${origin} not allowed by CORS`);
            // In production, still allow but log warning
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve static files from the 'public' directory
const publicPath = path.join(__dirname, '../public');
console.log(`📁 Serving static files from: ${publicPath}`);
app.use(express.static(publicPath));

// PostgreSQL Connection Pool (using Neon.tech)
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
});

// Test database connection
pool.connect(async (err, client, release) => {
    if (err) {
        console.error('❌ PostgreSQL Connection Error:', err.message);
        console.error('⚠️ Make sure your Neon.tech database is accessible');
        // Don't exit on connection error in production - retry later
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
    } else {
        console.log('✅ PostgreSQL Connected Successfully!');
        console.log(`📡 Host: ${process.env.DB_HOST}`);
        console.log(`📁 Database: ${process.env.DB_NAME}`);
        release();
        await initializeDatabase();
    }
});

// Initialize database tables and ensure columns exist
async function initializeDatabase() {
    console.log('\n📋 Creating/Verifying database tables...');
    
    try {
        // Ensure users table has all required columns
        await ensureUsersTableColumns();
        
        // Create other tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_records (
                id SERIAL PRIMARY KEY,
                record_date DATE DEFAULT CURRENT_DATE,
                morning_diesel DECIMAL(10,2) DEFAULT 0,
                morning_petrol DECIMAL(10,2) DEFAULT 0,
                diesel_sold DECIMAL(10,2) DEFAULT 0,
                petrol_sold DECIMAL(10,2) DEFAULT 0,
                locked BOOLEAN DEFAULT FALSE,
                recorded_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Daily records table ready');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deliveries (
                id SERIAL PRIMARY KEY,
                fuel_type VARCHAR(50),
                driver_name VARCHAR(200),
                declared_litres DECIMAL(10,2),
                pre_dip DECIMAL(10,2),
                post_dip DECIMAL(10,2),
                actual_gain DECIMAL(10,2),
                variance DECIMAL(10,2),
                status VARCHAR(50),
                delivery_date DATE DEFAULT CURRENT_DATE,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                recorded_by INTEGER
            )
        `);
        console.log('✓ Deliveries table ready');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS variances (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50),
                amount DECIMAL(10,2),
                cause TEXT,
                status VARCHAR(50) DEFAULT 'Pending',
                date DATE DEFAULT CURRENT_DATE,
                fuel_type VARCHAR(50),
                expected_stock DECIMAL(10,2),
                actual_stock DECIMAL(10,2),
                resolution_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                recorded_by INTEGER
            )
        `);
        console.log('✓ Variances table ready');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reconciliations (
                id SERIAL PRIMARY KEY,
                total_sales DECIMAL(10,2),
                mpesa DECIMAL(10,2),
                credits DECIMAL(10,2),
                expenses DECIMAL(10,2),
                advances DECIMAL(10,2),
                returns_val DECIMAL(10,2),
                lubricants DECIMAL(10,2),
                expected_cash DECIMAL(10,2),
                actual_cash DECIMAL(10,2),
                variance DECIMAL(10,2),
                status VARCHAR(50),
                record_date DATE DEFAULT CURRENT_DATE,
                recorded_by INTEGER,
                recorded_by_name VARCHAR(200),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Reconciliations table ready');
        
        // Create default admin user if not exists
        const adminCheck = await pool.query(`SELECT * FROM users WHERE username = 'admin'`);
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (username, email, password_hash, full_name, role, is_active, email_verified) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['admin', 'admin@moreva.com', hashedPassword, 'System Administrator', 'super_admin', true, true]
            );
            console.log('✓ Default admin user created: admin / admin123');
        } else {
            console.log('✓ Admin user already exists');
        }
        
        // Get database statistics
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as active_users,
                (SELECT COUNT(*) FROM users WHERE is_active = false) as pending_users,
                (SELECT COUNT(*) FROM deliveries) as deliveries,
                (SELECT COUNT(*) FROM variances) as variances,
                (SELECT COUNT(*) FROM daily_records) as daily_records
        `);
        
        console.log('\n📊 Database Status Report:');
        console.log(`   👥 Total Users: ${stats.rows[0].users}`);
        console.log(`   ✅ Active Users: ${stats.rows[0].active_users}`);
        console.log(`   ⏳ Pending Approval: ${stats.rows[0].pending_users}`);
        console.log(`   🚚 Deliveries: ${stats.rows[0].deliveries}`);
        console.log(`   ⚠️ Variances: ${stats.rows[0].variances}`);
        console.log(`   📅 Daily Records: ${stats.rows[0].daily_records}`);
        console.log('');
        
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
    }
}

// Function to ensure users table has all required columns
async function ensureUsersTableColumns() {
    const columnsToAdd = [
        { name: 'address', type: 'TEXT' },
        { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
        { name: 'email_verified', type: 'BOOLEAN DEFAULT FALSE' }
    ];
    
    for (const col of columnsToAdd) {
        try {
            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
            console.log(`✓ Ensured column: ${col.name}`);
        } catch (err) {
            // Column might already exist
        }
    }
    
    // Ensure is_active has default false for new users
    try {
        await pool.query(`ALTER TABLE users ALTER COLUMN is_active SET DEFAULT FALSE`);
        console.log('✓ is_active default set to FALSE');
    } catch (err) {
        // Already set
    }
}

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token. Please login again.' });
        }
        req.user = user;
        next();
    });
};

// Check if user is admin
const isAdmin = (req, res, next) => {
    const adminRoles = ['super_admin', 'admin', 'Administrator'];
    if (!req.user.role || !adminRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== AUTH ROUTES ====================

// Login endpoint (checks if user is approved)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`🔐 Login attempt: ${username}`);
    
    try {
        const result = await pool.query(
            `SELECT id, username, email, password_hash, full_name, role, phone, is_active, email_verified, login_attempts, locked_until 
             FROM users 
             WHERE username = $1 OR email = $1`,
            [username]
        );
        
        if (result.rows.length === 0) {
            console.log(`❌ Login failed: User ${username} not found`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        // Check if account is locked
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(401).json({ error: 'Account is locked. Please try again later.' });
        }
        
        // Check if account is approved (active)
        if (!user.is_active) {
            console.log(`❌ Login failed: Account ${username} pending approval`);
            return res.status(403).json({ error: 'Account pending admin approval. Please wait for verification.' });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            const newAttempts = (user.login_attempts || 0) + 1;
            let lockUntil = null;
            
            if (newAttempts >= 5) {
                lockUntil = new Date(Date.now() + 15 * 60 * 1000);
                await pool.query(
                    `UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3`,
                    [newAttempts, lockUntil, user.id]
                );
                return res.status(401).json({ error: 'Account locked due to multiple failed attempts. Try again in 15 minutes.' });
            } else {
                await pool.query(`UPDATE users SET login_attempts = $1 WHERE id = $2`, [newAttempts, user.id]);
            }
            
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Reset login attempts and update last login
        await pool.query(
            `UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = $1`,
            [user.id]
        );
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            SECRET_KEY, 
            { expiresIn: process.env.JWT_EXPIRE || '30d' }
        );
        
        console.log(`✅ Login successful: ${username} (${user.role})`);
        res.json({ 
            token, 
            user: { 
                id: user.id, 
                username: user.username, 
                full_name: user.full_name || user.username, 
                role: user.role,
                email: user.email,
                phone: user.phone,
                is_active: user.is_active
            } 
        });
    } catch (error) {
        console.error('❌ Login error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Register endpoint (sets is_active = false for admin approval)
app.post('/api/auth/signup', async (req, res) => {
    const { username, full_name, email, phone, password, role } = req.body;
    console.log(`📝 Signup attempt: ${username}`);
    
    try {
        // Check if user exists
        const existing = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $2`,
            [username, email]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert new user with is_active = FALSE (pending admin approval)
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, role, phone, is_active, email_verified, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
             RETURNING id, username, full_name, role, email, is_active`,
            [username, email, hashedPassword, full_name, role || 'staff', phone || null, false, false]
        );
        
        const user = result.rows[0];
        
        console.log(`✅ User registered: ${username} (pending approval)`);
        res.status(201).json({ 
            message: 'Registration successful! Your account is pending admin approval. You will be notified once approved.',
            user: { 
                id: user.id, 
                username: user.username, 
                full_name: user.full_name, 
                role: user.role,
                email: user.email,
                is_active: user.is_active
            } 
        });
    } catch (error) {
        console.error('❌ Signup error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Verify token endpoint
app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, full_name, role, email, is_active FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        // Check if account is still active
        if (!result.rows[0].is_active) {
            return res.status(403).json({ error: 'Account deactivated. Contact administrator.' });
        }
        
        res.json({ valid: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN USER MANAGEMENT ROUTES ====================

// Get all users (admin only)
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, email, full_name, role, phone, address, 
                   is_active, email_verified, last_login, login_attempts, 
                   created_at, updated_at
            FROM users 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Approve a user (activate pending account)
app.put('/api/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Update user to active
        await pool.query(
            `UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [userId]
        );
        
        console.log(`✅ User ${userId} approved by admin ${req.user.username}`);
        res.json({ 
            message: 'User approved successfully', 
            user_id: userId 
        });
    } catch (error) {
        console.error('Error approving user:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        // Don't allow admin to delete themselves
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Delete the user
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        
        console.log(`🗑️ User ${userId} deleted by admin ${req.user.username}`);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Create new user (admin only)
app.post('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { username, email, password, full_name, phone, address, role, is_active } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email and password are required' });
        }
        
        // Check if user exists
        const existing = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $2`,
            [username, email]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, phone, address, role, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id, username, email, full_name, role, is_active`,
            [username, email, hashedPassword, full_name || null, phone || null, address || null, role || 'staff', is_active !== undefined ? is_active : true]
        );
        
        console.log(`➕ New user created by admin ${req.user.username}: ${username}`);
        res.status(201).json({ 
            message: 'User created successfully', 
            user: result.rows[0] 
        });
    } catch (error) {
        console.error('Error creating user:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update user (admin only)
app.put('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { role, is_active } = req.body;
        
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (role !== undefined) {
            updates.push(`role = $${paramCount++}`);
            values.push(role);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${paramCount++}`);
            values.push(is_active);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(userId);
        
        await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`,
            values
        );
        
        console.log(`✏️ User ${userId} updated by admin ${req.user.username}`);
        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get dashboard statistics (admin only)
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE is_active = true) as active_users,
                (SELECT COUNT(*) FROM users WHERE is_active = false) as pending_users,
                (SELECT COUNT(*) FROM deliveries) as total_deliveries,
                (SELECT COUNT(*) FROM variances) as total_variances,
                (SELECT COUNT(*) FROM variances WHERE status = 'Pending') as pending_variances,
                (SELECT COUNT(*) FROM daily_records) as total_daily_records,
                (SELECT COUNT(*) FROM reconciliations) as total_reconciliations,
                (SELECT COALESCE(SUM(actual_gain), 0) FROM deliveries) as total_fuel_received,
                (SELECT COALESCE(SUM(diesel_sold + petrol_sold), 0) FROM daily_records) as total_fuel_sold
        `);
        
        res.json(stats.rows[0]);
    } catch (error) {
        console.error('Error fetching stats:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== OTHER EXISTING ROUTES ====================

app.get('/api/deliveries', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM deliveries ORDER BY recorded_at DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/deliveries', authenticateToken, async (req, res) => {
    const { fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO deliveries (fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, recorded_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, req.user.id]
        );
        res.json({ id: result.rows[0].id, message: 'Delivery saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/deliveries/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query(`DELETE FROM deliveries WHERE id = $1`, [req.params.id]);
        res.json({ message: 'Delivery deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/variances', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM variances ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/variances', authenticateToken, async (req, res) => {
    const { type, amount, cause, status, date, fuel_type, expected_stock, actual_stock } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO variances (type, amount, cause, status, date, fuel_type, expected_stock, actual_stock, recorded_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [type, amount, cause, status || 'Pending', date || new Date().toISOString().split('T')[0], fuel_type, expected_stock, actual_stock, req.user.id]
        );
        res.json({ id: result.rows[0].id, message: 'Variance recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/variances/:id/resolve', authenticateToken, async (req, res) => {
    const { resolution_notes } = req.body;
    try {
        await pool.query(
            `UPDATE variances SET status = 'Resolved', resolution_notes = $1 WHERE id = $2`,
            [resolution_notes, req.params.id]
        );
        res.json({ message: 'Variance resolved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reconciliation', authenticateToken, async (req, res) => {
    const { total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status } = req.body;
    try {
        await pool.query(
            `INSERT INTO reconciliations (total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, recorded_by, recorded_by_name) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, req.user.id, req.user.username]
        );
        res.json({ message: 'Reconciliation saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reconciliation/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM reconciliations ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fuel/morning-dip', authenticateToken, async (req, res) => {
    const { diesel, petrol } = req.body;
    const today = new Date().toISOString().split('T')[0];
    try {
        const existing = await pool.query(`SELECT * FROM daily_records WHERE record_date = $1`, [today]);
        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE daily_records SET morning_diesel = $1, morning_petrol = $2, recorded_by = $3 WHERE record_date = $4`,
                [diesel, petrol, req.user.id, today]
            );
        } else {
            await pool.query(
                `INSERT INTO daily_records (record_date, morning_diesel, morning_petrol, recorded_by) VALUES ($1, $2, $3, $4)`,
                [today, diesel, petrol, req.user.id]
            );
        }
        res.json({ message: 'Morning dip saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fuel/daily-sales', authenticateToken, async (req, res) => {
    const { dieselSold, petrolSold } = req.body;
    const today = new Date().toISOString().split('T')[0];
    try {
        await pool.query(
            `UPDATE daily_records SET diesel_sold = diesel_sold + $1, petrol_sold = petrol_sold + $2, recorded_by = $3 WHERE record_date = $4`,
            [dieselSold, petrolSold, req.user.id, today]
        );
        res.json({ message: 'Sales recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/fuel/daily-records', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM daily_records ORDER BY record_date DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SERVE HTML FILES ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(publicPath, 'dashboard.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicPath, 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'running',
            database: 'connected',
            port: PORT,
            environment: process.env.NODE_ENV || 'development',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'running',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ERROR HANDLING MIDDLEWARE ====================
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong! Please try again later.' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 MOREVA ENERGY Backend Server');
    console.log('='.repeat(60));
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`📁 Static files served from: ${publicPath}`);
    console.log(`🌐 Access the app at: http://localhost:${PORT}`);
    console.log(`🔐 Admin login: admin / admin123`);
    console.log(`🖥️ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('\n📋 API Endpoints:');
    console.log(`   POST   /api/login - User login`);
    console.log(`   POST   /api/auth/signup - User registration`);
    console.log(`   GET    /api/users - Get all users (admin only)`);
    console.log(`   PUT    /api/users/:id/approve - Approve user (admin only)`);
    console.log(`   DELETE /api/users/:id - Delete user (admin only)`);
    console.log(`   POST   /api/users - Create user (admin only)`);
    console.log(`   GET    /api/deliveries - Get all deliveries`);
    console.log(`   GET    /api/variances - Get all variances`);
    console.log(`   GET    /api/reconciliation/history - Get reconciliation history`);
    console.log('='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    await pool.end();
    console.log('✅ Database connection closed');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down server...');
    await pool.end();
    console.log('✅ Database connection closed');
    process.exit(0);
});