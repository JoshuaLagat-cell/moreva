const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || 'moreva_super_secret_key_2026_enterprise';

// ==================== CORS CONFIGURATION ====================
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ==================== FIND PUBLIC FOLDER - ROBUST SEARCH ====================
console.log('\n🔍 Searching for public folder...');

// Try multiple possible locations
const possiblePaths = [
    path.join(process.cwd(), 'public'),           // /opt/render/project/src/public
    path.join(__dirname, 'public'),               // /opt/render/project/src/src/public
    path.join(__dirname, '..', 'public'),         // /opt/render/project/src/public
    path.join(process.cwd(), '..', 'public'),     // /opt/render/project/public
    '/opt/render/project/src/public',
    '/opt/render/project/public'
];

let publicPath = null;

for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
        publicPath = testPath;
        console.log(`✅ Found public folder at: ${publicPath}`);
        const files = fs.readdirSync(publicPath);
        console.log(`📄 Files: ${files.join(', ')}`);
        break;
    }
}

// If no public folder found, create it with fallback HTML
if (!publicPath) {
    console.log('⚠️ No public folder found, creating one...');
    publicPath = path.join(process.cwd(), 'public');
    fs.mkdirSync(publicPath, { recursive: true });
    
    // Create fallback HTML files
    const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MOREVA ENERGY</title>
    <script src="https://cdn.tailwindcss.com/3.4.1"></script>
    <style>
        body { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; }
        .card { background: white; border-radius: 2rem; padding: 2rem; max-width: 400px; width: 100%; }
        .brand { background: linear-gradient(135deg, #1e3a8a, #dc2626); width: 60px; height: 60px; border-radius: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; color: white; margin: 0 auto; }
    </style>
</head>
<body>
    <div class="card">
        <div class="brand mb-4">M</div>
        <h1 class="text-2xl font-bold text-center">MOREVA ENERGY</h1>
        <p class="text-center text-gray-500 mt-2">Server is running!</p>
        <div class="mt-4 p-3 bg-green-50 rounded-lg">
            <p class="text-sm text-green-800">✅ Backend is operational</p>
            <p id="status" class="text-xs text-gray-500 mt-2">Checking database connection...</p>
        </div>
    </div>
    <script>
        fetch('/api/health')
            .then(r => r.json())
            .then(data => {
                document.getElementById('status').innerHTML = 'Database: ' + (data.database === 'connected' ? '✅ Connected' : '❌ ' + data.error);
            })
            .catch(e => {
                document.getElementById('status').innerHTML = 'Error connecting to API';
            });
    </script>
</body>
</html>`;
    
    fs.writeFileSync(path.join(publicPath, 'index.html'), fallbackHtml);
    fs.writeFileSync(path.join(publicPath, 'dashboard.html'), fallbackHtml);
    fs.writeFileSync(path.join(publicPath, 'admin.html'), fallbackHtml);
    console.log(`✅ Created fallback HTML files in ${publicPath}`);
}

// Serve static files
app.use(express.static(publicPath));

console.log(`📁 Serving static files from: ${publicPath}\n`);

// PostgreSQL Connection Pool
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
    } else {
        console.log('✅ PostgreSQL Connected Successfully!');
        console.log(`📡 Host: ${process.env.DB_HOST}`);
        console.log(`📁 Database: ${process.env.DB_NAME}`);
        release();
        await initializeDatabase();
    }
});

// Initialize database tables
async function initializeDatabase() {
    console.log('\n📋 Creating/Verifying database tables...');
    
    try {
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

const isAdmin = (req, res, next) => {
    const adminRoles = ['super_admin', 'admin', 'Administrator'];
    if (!req.user.role || !adminRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== AUTH ROUTES ====================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`🔐 Login attempt: ${username}`);
    
    try {
        const result = await pool.query(
            `SELECT id, username, email, password_hash, full_name, role, is_active 
             FROM users 
             WHERE username = $1 OR email = $1`,
            [username]
        );
        
        if (result.rows.length === 0) {
            console.log(`❌ Login failed: User ${username} not found`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        if (!user.is_active) {
            console.log(`❌ Login failed: Account ${username} pending approval`);
            return res.status(403).json({ error: 'Account pending admin approval' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            console.log(`❌ Login failed: Invalid password for ${username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            SECRET_KEY, 
            { expiresIn: '30d' }
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
                is_active: user.is_active
            } 
        });
    } catch (error) {
        console.error('❌ Login error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, full_name, email, phone, password, role } = req.body;
    console.log(`📝 Signup attempt: ${username}`);
    
    try {
        const existing = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $2`,
            [username, email]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, role, phone, is_active, email_verified) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING id, username, full_name, role, email, is_active`,
            [username, email, hashedPassword, full_name, role || 'staff', phone || null, false, false]
        );
        
        console.log(`✅ User registered: ${username} (pending approval)`);
        res.status(201).json({ 
            message: 'Registration successful! Your account is pending admin approval.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Signup error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, full_name, role, email, is_active FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        if (!result.rows[0].is_active) {
            return res.status(403).json({ error: 'Account deactivated. Contact administrator.' });
        }
        
        res.json({ valid: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN ROUTES ====================
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, email, full_name, role, is_active, last_login, created_at 
            FROM users 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
        await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [req.params.id]);
        res.json({ message: 'User approved successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== OTHER ROUTES ====================
app.get('/api/deliveries', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM deliveries ORDER BY recorded_at DESC`);
        res.json(result.rows);
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

app.get('/api/reconciliation/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM reconciliations ORDER BY created_at DESC`);
        res.json(result.rows);
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

app.get('/index.html', (req, res) => {
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
            publicPath: publicPath
        });
    } catch (error) {
        res.json({
            status: 'running',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 MOREVA ENERGY Backend Server');
    console.log('='.repeat(60));
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`📁 Static files served from: ${publicPath}`);
    console.log(`🌐 Access the app at: http://localhost:${PORT}`);
    console.log('='.repeat(60) + '\n');
});