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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Find public folder
let publicPath = null;
const possiblePaths = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '..', 'public'),
    path.join(process.cwd(), 'public'),
    '/opt/render/project/src/public'
];

for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
        publicPath = testPath;
        console.log(`✅ Found public folder at: ${publicPath}`);
        break;
    }
}

if (!publicPath) {
    publicPath = path.join(process.cwd(), 'public');
    fs.mkdirSync(publicPath, { recursive: true });
    console.log(`📁 Created public folder at: ${publicPath}`);
}

app.use(express.static(publicPath));

// PostgreSQL Connection
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.connect(async (err) => {
    if (err) {
        console.error('❌ Database Error:', err.message);
    } else {
        console.log('✅ PostgreSQL Connected!');
        await initTables();
    }
});

async function initTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE,
                email VARCHAR(200) UNIQUE,
                password_hash VARCHAR(255),
                full_name VARCHAR(200),
                role VARCHAR(50) DEFAULT 'staff',
                phone VARCHAR(50),
                is_active BOOLEAN DEFAULT FALSE,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
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
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                recorded_by INTEGER
            )
        `);
        
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                recorded_by INTEGER
            )
        `);
        
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
        
        // Create admin user
        const adminCheck = await pool.query(`SELECT * FROM users WHERE username = 'admin'`);
        if (adminCheck.rows.length === 0) {
            const hashed = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (username, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
                ['admin', 'admin@moreva.com', hashed, 'System Administrator', 'super_admin', true]
            );
            console.log('✅ Admin created: admin / admin123');
        }
        
        console.log('✅ All tables ready');
    } catch (err) {
        console.error('Table error:', err.message);
    }
}

// ==================== AUTH MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    const adminRoles = ['super_admin', 'admin'];
    if (!adminRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ==================== AUTH ROUTES ====================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`🔐 Login: ${username}`);
    
    try {
        const result = await pool.query(`SELECT * FROM users WHERE username = $1 OR email = $1`, [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = result.rows[0];
        if (!user.is_active) return res.status(403).json({ error: 'Account pending approval' });
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '30d' });
        res.json({ 
            token, 
            user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, email: user.email, is_active: user.is_active } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, full_name, email, password, role } = req.body;
    try {
        const existing = await pool.query(`SELECT * FROM users WHERE username = $1 OR email = $2`, [username, email]);
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Username or email exists' });
        
        const hashed = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, full_name, role, email, is_active`,
            [username, email, hashed, full_name, role || 'staff', false]
        );
        res.status(201).json({ message: 'Registration pending admin approval', user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/verify', authenticateToken, async (req, res) => {
    const result = await pool.query(`SELECT id, username, full_name, role, email, is_active FROM users WHERE id = $1`, [req.user.id]);
    res.json({ valid: true, user: result.rows[0] });
});

// ==================== ADMIN ROUTES ====================
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    const result = await pool.query(`SELECT id, username, email, full_name, role, is_active, last_login, created_at FROM users ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.put('/api/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [req.params.id]);
    res.json({ message: 'User approved' });
});

app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    res.json({ message: 'User deleted' });
});

// ==================== DELIVERIES ROUTES ====================
app.get('/api/deliveries', authenticateToken, async (req, res) => {
    const result = await pool.query(`SELECT * FROM deliveries ORDER BY recorded_at DESC`);
    res.json(result.rows);
});

app.post('/api/deliveries', authenticateToken, async (req, res) => {
    const { fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status } = req.body;
    const result = await pool.query(
        `INSERT INTO deliveries (fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, req.user.id]
    );
    res.json({ id: result.rows[0].id, message: 'Delivery saved' });
});

// ==================== VARIANCES ROUTES ====================
app.get('/api/variances', authenticateToken, async (req, res) => {
    const result = await pool.query(`SELECT * FROM variances ORDER BY created_at DESC`);
    res.json(result.rows);
});

app.post('/api/variances', authenticateToken, async (req, res) => {
    const { type, amount, cause, fuel_type, expected_stock, actual_stock } = req.body;
    const result = await pool.query(
        `INSERT INTO variances (type, amount, cause, fuel_type, expected_stock, actual_stock, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [type, amount, cause, fuel_type, expected_stock, actual_stock, req.user.id]
    );
    res.json({ id: result.rows[0].id, message: 'Variance recorded' });
});

app.put('/api/variances/:id/resolve', authenticateToken, async (req, res) => {
    const { resolution_notes } = req.body;
    await pool.query(`UPDATE variances SET status = 'Resolved', resolution_notes = $1 WHERE id = $2`, [resolution_notes, req.params.id]);
    res.json({ message: 'Variance resolved' });
});

// ==================== RECONCILIATION ROUTES ====================
app.post('/api/reconciliation', authenticateToken, async (req, res) => {
    const { total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status } = req.body;
    await pool.query(
        `INSERT INTO reconciliations (total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, recorded_by, recorded_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, req.user.id, req.user.username]
    );
    res.json({ message: 'Reconciliation saved' });
});

app.get('/api/reconciliation/history', authenticateToken, async (req, res) => {
    const result = await pool.query(`SELECT * FROM reconciliations ORDER BY created_at DESC`);
    res.json(result.rows);
});

// ==================== FUEL ROUTES (FIXED) ====================
app.post('/api/fuel/morning-dip', authenticateToken, async (req, res) => {
    const { diesel, petrol } = req.body;
    const today = new Date().toISOString().split('T')[0];
    console.log(`📝 Morning dip: Diesel=${diesel}L, Petrol=${petrol}L`);
    
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
    console.log(`💰 Sales: Diesel=${dieselSold}L, Petrol=${petrolSold}L`);
    
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
    const result = await pool.query(`SELECT * FROM daily_records ORDER BY record_date DESC`);
    res.json(result.rows);
});

// ==================== SERVE HTML ====================
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(publicPath, 'dashboard.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicPath, 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'running', port: PORT, publicPath: publicPath });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📁 Serving from: ${publicPath}`);
    console.log(`🌐 Access: http://localhost:${PORT}\n`);
});