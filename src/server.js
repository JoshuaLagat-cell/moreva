const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

// Email service (optional - won't crash if not configured)
let sendPasswordResetEmail, sendWelcomeEmail, sendAccountApprovalEmail;
try {
    const emailService = require('../services/emailService');
    sendPasswordResetEmail = emailService.sendPasswordResetEmail;
    sendWelcomeEmail = emailService.sendWelcomeEmail;
    sendAccountApprovalEmail = emailService.sendAccountApprovalEmail;
    console.log('✅ Email service loaded');
} catch (error) {
    console.log('⚠️ Email service not configured - using fallback mode');
    sendPasswordResetEmail = async (to, resetCode, username) => {
        console.log(`📧 [FALLBACK] Reset code for ${to}: ${resetCode}`);
        return { success: false, error: 'Email not configured' };
    };
    sendWelcomeEmail = async () => ({ success: false });
    sendAccountApprovalEmail = async () => ({ success: false });
}

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || 'moreva_super_secret_key_2026_enterprise';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '833977857957-h3rgifh791e5klbd8t1n3hjfg8p9kq5g.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ==================== STATIC FILES ====================
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
    publicPath = path.join(__dirname, '..', 'public');
    fs.mkdirSync(publicPath, { recursive: true });
    console.log(`📁 Created public folder at: ${publicPath}`);
}

app.use(express.static(publicPath));

// ==================== DATABASE CONNECTION WITH RETRY LOGIC ====================
const poolConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
};

console.log('\n📡 Database Configuration:');
console.log(`   Host: ${poolConfig.host}`);
console.log(`   Database: ${poolConfig.database}`);
console.log(`   User: ${poolConfig.user}`);
console.log(`   SSL: ${poolConfig.ssl ? 'Enabled' : 'Disabled'}`);

const pool = new Pool(poolConfig);

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
});

// Helper function to execute queries with retry on connection error
async function executeQuery(query, params, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await pool.query(query, params);
        } catch (error) {
            if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') && i < retries) {
                console.log(`⚠️ Connection reset, retrying query... (attempt ${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
}

// Test database connection with retry logic
let connectionRetries = 5;
let dbConnected = false;

async function connectWithRetry() {
    while (connectionRetries > 0 && !dbConnected) {
        try {
            const client = await pool.connect();
            console.log('✅ PostgreSQL (Neon) connected successfully!');
            client.release();
            dbConnected = true;
            await initializeDatabase();
            // Set up periodic keepalive
            setInterval(async () => {
                try {
                    await executeQuery('SELECT 1');
                    console.log('💓 Database keepalive ping');
                } catch (err) {
                    console.error('Keepalive failed:', err.message);
                }
            }, 25000);
            return true;
        } catch (err) {
            connectionRetries--;
            console.error(`❌ Database connection error (${connectionRetries} retries left):`, err.message);
            if (connectionRetries === 0) {
                console.error('⚠️ Starting without database connection. Some features will not work.');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    return false;
}

// ==================== INITIALIZE DATABASE TABLES ====================
async function initializeDatabase() {
    console.log('\n📋 Initializing database tables...');
    
    try {
        // Create users table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(200) UNIQUE NOT NULL,
                password_hash VARCHAR(255),
                full_name VARCHAR(200),
                role VARCHAR(50) DEFAULT 'staff',
                phone VARCHAR(50),
                address TEXT,
                is_active BOOLEAN DEFAULT FALSE,
                email_verified BOOLEAN DEFAULT FALSE,
                google_id VARCHAR(255),
                reset_token VARCHAR(255),
                reset_token_expires TIMESTAMP,
                last_login TIMESTAMP,
                login_attempts INT DEFAULT 0,
                locked_until TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Users table ready');
        
        // Create password_resets table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                email VARCHAR(200) NOT NULL,
                reset_code VARCHAR(10) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Password resets table ready');
        
        // Create daily_records table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS daily_records (
                id SERIAL PRIMARY KEY,
                record_date DATE DEFAULT CURRENT_DATE,
                morning_diesel DECIMAL(10,2) DEFAULT 0,
                morning_petrol DECIMAL(10,2) DEFAULT 0,
                diesel_sold DECIMAL(10,2) DEFAULT 0,
                petrol_sold DECIMAL(10,2) DEFAULT 0,
                expected_evening_diesel DECIMAL(10,2) DEFAULT 0,
                expected_evening_petrol DECIMAL(10,2) DEFAULT 0,
                locked BOOLEAN DEFAULT FALSE,
                recorded_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Daily records table ready');
        
        // Create deliveries table
        await executeQuery(`
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
        
        // Create variances table
        await executeQuery(`
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
        
        // Create reconciliations table
        await executeQuery(`
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
                shift_report JSONB,
                record_date DATE DEFAULT CURRENT_DATE,
                recorded_by INTEGER,
                recorded_by_name VARCHAR(200),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Reconciliations table ready');
        
        // Create audit_logs table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                user_email VARCHAR(200),
                action VARCHAR(100),
                details TEXT,
                ip_address VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Audit logs table ready');
        
        // Create locked_records table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS locked_records (
                id SERIAL PRIMARY KEY,
                record_type VARCHAR(50),
                record_id INTEGER,
                record_date DATE,
                locked_by INTEGER,
                locked_by_name VARCHAR(200),
                locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Locked records table ready');
        
        // Check if admin exists
        const adminCheck = await executeQuery(`SELECT * FROM users WHERE username = $1 OR email = $2`, ['superadmin', 'admin@moreva.com']);
        
        if (adminCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('Admin@123', 10);
            await executeQuery(
                `INSERT INTO users (username, email, password_hash, full_name, role, is_active, email_verified) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['superadmin', 'admin@moreva.com', hashedPassword, 'System Administrator', 'super_admin', true, true]
            );
            console.log('✓ Default superadmin user created: superadmin / Admin@123');
        } else {
            console.log('✓ Admin user already exists');
        }
        
        console.log('✅ Database initialization complete!\n');
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
    }
}

// Helper: Add audit log
async function addAuditLog(userId, userEmail, action, details, ipAddress = null) {
    try {
        await executeQuery(
            `INSERT INTO audit_logs (user_id, user_email, action, details, ip_address) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, userEmail, action, details, ipAddress]
        );
    } catch (error) {
        console.error('Audit log error:', error.message);
    }
}

function generateResetCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==================== AUTHENTICATION MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token.' });
        }
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
    console.log(`🔐 Login attempt: ${username}`);
    
    try {
        const result = await executeQuery(
            `SELECT id, username, email, password_hash, full_name, role, is_active FROM users WHERE username = $1 OR email = $1`,
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        if (!user.is_active) {
            return res.status(403).json({ error: 'Account pending admin approval. Please wait for activation.' });
        }
        
        if (!user.password_hash) {
            return res.status(401).json({ error: 'Please use Google Sign-In for this account' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        await executeQuery(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: process.env.JWT_EXPIRE || '30d' }
        );
        
        await addAuditLog(user.id, user.email, 'LOGIN', 'User logged in successfully');
        
        console.log(`✅ Login successful: ${username}`);
        res.json({
            token,
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
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, full_name, email, phone, address, password, role } = req.body;
    console.log(`📝 Signup attempt: ${username}`);
    
    try {
        const existing = await executeQuery(
            `SELECT * FROM users WHERE username = $1 OR email = $2`,
            [username, email]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await executeQuery(
            `INSERT INTO users (username, email, password_hash, full_name, role, phone, address, is_active, email_verified) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             RETURNING id, username, full_name, role, email, is_active`,
            [username, email, hashedPassword, full_name, role || 'staff', phone || null, address || null, false, false]
        );
        
        await addAuditLog(result.rows[0].id, email, 'SIGNUP', `New user registered (pending approval)`);
        
        sendWelcomeEmail(email, username, true).catch(err => console.error('Welcome email failed:', err.message));
        
        console.log(`✅ User registered: ${username} (pending approval)`);
        res.status(201).json({
            message: 'Registration successful! Your account is pending admin approval.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Google Auth
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        const { email, name, sub: googleId, email_verified } = payload;
        
        let result = await executeQuery(
            `SELECT id, username, email, full_name, role, is_active, google_id FROM users WHERE email = $1`,
            [email]
        );
        
        let user;
        
        if (result.rows.length === 0) {
            const username = email.split('@')[0] + '_' + Math.floor(Math.random() * 1000);
            const insertResult = await executeQuery(
                `INSERT INTO users (username, email, full_name, google_id, is_active, email_verified, role) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) 
                 RETURNING id, username, email, full_name, role, is_active`,
                [username, email, name, googleId, true, email_verified, 'staff']
            );
            user = insertResult.rows[0];
            await addAuditLog(user.id, email, 'GOOGLE_SIGNUP', `User signed up via Google`);
            sendWelcomeEmail(email, username, false).catch(err => console.error('Welcome email failed:', err.message));
        } else {
            user = result.rows[0];
            if (!user.google_id) {
                await executeQuery(`UPDATE users SET google_id = $1 WHERE id = $2`, [googleId, user.id]);
            }
            await addAuditLog(user.id, email, 'GOOGLE_LOGIN', `User logged in via Google`);
        }
        
        if (!user.is_active) {
            return res.status(403).json({ error: 'Account pending admin approval' });
        }
        
        await executeQuery(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);
        
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            SECRET_KEY,
            { expiresIn: process.env.JWT_EXPIRE || '30d' }
        );
        
        res.json({
            token,
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
        console.error('Google auth error:', error);
        res.status(401).json({ error: 'Google authentication failed' });
    }
});

// ==================== FORGOT PASSWORD ROUTES (FIXED) ====================

// Forgot Password - Request reset code
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    console.log(`🔑 Password reset requested for: ${email}`);
    
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
    }
    
    try {
        const userCheck = await executeQuery(`SELECT id, email, username, full_name FROM users WHERE email = $1`, [email]);
        
        if (userCheck.rows.length === 0) {
            // For security, still return success message
            return res.json({ message: 'If your email is registered, you will receive a reset code.' });
        }
        
        const user = userCheck.rows[0];
        const resetCode = generateResetCode();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);
        
        // First, clean up any old unused codes for this email
        await executeQuery(`UPDATE password_resets SET used = TRUE WHERE email = $1 AND used = FALSE`, [email]);
        
        // Store new reset code
        await executeQuery(
            `INSERT INTO password_resets (email, reset_code, expires_at) VALUES ($1, $2, $3)`,
            [email, resetCode, expiresAt]
        );
        
        // Verify the code was stored correctly
        const verifyStore = await executeQuery(
            `SELECT reset_code FROM password_resets WHERE email = $1 AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
            [email]
        );
        
        console.log(`📝 Generated reset code: ${resetCode}`);
        console.log(`📝 Verified stored code: ${verifyStore.rows[0]?.reset_code}`);
        
        // Log the reset code visibly for testing
        console.log('\n' + '='.repeat(60));
        console.log(`🔐 PASSWORD RESET CODE FOR ${email}: ${resetCode}`);
        console.log('='.repeat(60) + '\n');
        
        // Try to send email
        let emailSent = false;
        try {
            const emailResult = await sendPasswordResetEmail(email, resetCode, user.username || user.full_name);
            emailSent = emailResult.success;
            if (emailSent) {
                console.log(`📧 Password reset email sent to: ${email}`);
            }
        } catch (emailError) {
            console.error('Email sending error:', emailError.message);
        }
        
        // Return response
        res.json({ 
            message: emailSent 
                ? 'Reset code has been sent to your email address.'
                : `Reset code generated. Check server console for code: ${resetCode}`,
            ...(process.env.NODE_ENV === 'development' && { resetCode })
        });
        
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
});

// Reset Password - Verify code and update password
app.post('/api/reset-password', async (req, res) => {
    const { email, new_password, reset_code } = req.body;
    console.log(`🔄 Password reset attempt for: ${email}`);
    console.log(`📝 Received reset_code: "${reset_code}"`);
    
    if (!email || !reset_code || !new_password) {
        return res.status(400).json({ error: 'Email, reset code, and new password are required' });
    }
    
    if (new_password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    try {
        // First, find valid reset code
        const resetResult = await executeQuery(
            `SELECT * FROM password_resets 
             WHERE email = $1 
             AND reset_code = $2 
             AND used = FALSE 
             AND expires_at > NOW() 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [email, reset_code]
        );
        
        console.log(`📝 Database query found ${resetResult.rows.length} matching records`);
        
        if (resetResult.rows.length === 0) {
            // Check if code exists but is expired or used
            const codeCheck = await executeQuery(
                `SELECT used, expires_at FROM password_resets WHERE email = $1 AND reset_code = $2`,
                [email, reset_code]
            );
            
            if (codeCheck.rows.length > 0) {
                const record = codeCheck.rows[0];
                if (record.used) {
                    return res.status(400).json({ error: 'This reset code has already been used. Please request a new one.' });
                }
                if (new Date(record.expires_at) < new Date()) {
                    return res.status(400).json({ error: 'This reset code has expired. Please request a new one.' });
                }
            }
            
            return res.status(400).json({ error: 'Invalid reset code. Please check and try again.' });
        }
        
        const resetRecord = resetResult.rows[0];
        console.log(`✅ Valid reset code found! ID: ${resetRecord.id}`);
        
        // Hash the new password
        const hashedPassword = await bcrypt.hash(new_password, 10);
        
        // Update user's password
        await executeQuery(`UPDATE users SET password_hash = $1 WHERE email = $2`, [hashedPassword, email]);
        
        // Mark reset code as used
        await executeQuery(`UPDATE password_resets SET used = TRUE WHERE id = $1`, [resetRecord.id]);
        
        // Add audit log
        await addAuditLog(null, email, 'PASSWORD_RESET', 'Password reset successfully');
        
        console.log(`✅ Password reset successful for: ${email}`);
        res.json({ message: 'Password reset successful! You can now login with your new password.' });
        
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// DEBUG: Check reset codes for an email (remove in production)
app.get('/api/debug/reset-codes/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const codes = await executeQuery(
            `SELECT id, reset_code, expires_at, used, created_at 
             FROM password_resets 
             WHERE email = $1 
             ORDER BY created_at DESC`,
            [email]
        );
        res.json({
            email,
            codes: codes.rows.map(r => ({
                code: r.reset_code,
                expires: r.expires_at,
                used: r.used,
                created: r.created_at
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== VERIFY TOKEN ====================
app.get('/api/verify', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(
            `SELECT id, username, full_name, role, email, is_active FROM users WHERE id = $1`,
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        if (!result.rows[0].is_active) {
            return res.status(403).json({ error: 'Account deactivated or pending approval' });
        }
        
        res.json({ valid: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN ROUTES ====================
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await executeQuery(`
            SELECT id, username, email, full_name, role, is_active, last_login, created_at 
            FROM users 
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/pending-users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await executeQuery(`
            SELECT id, username, email, full_name, role, phone, address, created_at 
            FROM users 
            WHERE is_active = FALSE AND role != 'super_admin'
            ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/users/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userResult = await executeQuery(`SELECT email, username, full_name FROM users WHERE id = $1`, [req.params.id]);
        
        await executeQuery(`UPDATE users SET is_active = true WHERE id = $1`, [req.params.id]);
        await addAuditLog(req.user.id, req.user.username, 'APPROVE_USER', `Approved user ID: ${req.params.id}`);
        
        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            sendAccountApprovalEmail(user.email, user.username || user.full_name).catch(err => 
                console.error('Approval email failed:', err.message)
            );
        }
        
        res.json({ message: 'User approved successfully.' });
    } catch (error) {
        console.error('Approval error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        await executeQuery(`DELETE FROM users WHERE id = $1`, [userId]);
        await addAuditLog(req.user.id, req.user.username, 'DELETE_USER', `Deleted user ID: ${userId}`);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== DELIVERIES ROUTES ====================
app.get('/api/deliveries', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(`SELECT * FROM deliveries ORDER BY recorded_at DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/deliveries', authenticateToken, async (req, res) => {
    const { fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status } = req.body;
    try {
        const result = await executeQuery(
            `INSERT INTO deliveries (fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, recorded_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, req.user.id]
        );
        await addAuditLog(req.user.id, req.user.username, 'DELIVERY_CREATED', `${fuel_type}: ${declared_litres}L`);
        res.json({ id: result.rows[0].id, message: 'Delivery saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/deliveries/:id', authenticateToken, async (req, res) => {
    try {
        await executeQuery(`DELETE FROM deliveries WHERE id = $1`, [req.params.id]);
        await addAuditLog(req.user.id, req.user.username, 'DELIVERY_DELETED', `Deleted delivery ID: ${req.params.id}`);
        res.json({ message: 'Delivery deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== VARIANCES ROUTES ====================
app.get('/api/variances', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(`SELECT * FROM variances ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/variances', authenticateToken, async (req, res) => {
    const { type, amount, cause, fuel_type, expected_stock, actual_stock } = req.body;
    try {
        const result = await executeQuery(
            `INSERT INTO variances (type, amount, cause, fuel_type, expected_stock, actual_stock, recorded_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [type, amount, cause, fuel_type, expected_stock, actual_stock, req.user.id]
        );
        await addAuditLog(req.user.id, req.user.username, 'VARIANCE_CREATED', `${type}: ${amount}`);
        res.json({ id: result.rows[0].id, message: 'Variance recorded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/variances/:id', authenticateToken, async (req, res) => {
    try {
        await executeQuery(`DELETE FROM variances WHERE id = $1`, [req.params.id]);
        res.json({ message: 'Variance deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/variances/:id/resolve', authenticateToken, async (req, res) => {
    const { resolution_notes } = req.body;
    try {
        await executeQuery(
            `UPDATE variances SET status = 'Resolved', resolution_notes = $1 WHERE id = $2`,
            [resolution_notes, req.params.id]
        );
        await addAuditLog(req.user.id, req.user.username, 'VARIANCE_RESOLVED', `ID: ${req.params.id}`);
        res.json({ message: 'Variance resolved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== RECONCILIATION ROUTES ====================
app.post('/api/reconciliation', authenticateToken, async (req, res) => {
    const { total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, shift_report } = req.body;
    try {
        const result = await executeQuery(
            `INSERT INTO reconciliations (total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, shift_report, recorded_by, recorded_by_name) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [total_sales, mpesa, credits, expenses, advances, returns_val, lubricants, expected_cash, actual_cash, variance, status, shift_report, req.user.id, req.user.username]
        );
        
        await addAuditLog(req.user.id, req.user.username, 'RECONCILIATION_SAVED', `Expected: ${expected_cash}, Actual: ${actual_cash}`);
        res.json({ id: result.rows[0].id, message: 'Reconciliation saved' });
    } catch (error) {
        console.error('Reconciliation error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reconciliation/history', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(`SELECT * FROM reconciliations ORDER BY created_at DESC LIMIT 50`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== FUEL ROUTES ====================
app.post('/api/fuel/morning-dip', authenticateToken, async (req, res) => {
    const { diesel, petrol } = req.body;
    const today = new Date().toISOString().split('T')[0];
    console.log(`📝 Morning dip: Diesel=${diesel}L, Petrol=${petrol}L`);
    
    try {
        const existing = await executeQuery(`SELECT * FROM daily_records WHERE record_date = $1`, [today]);
        
        if (existing.rows.length > 0) {
            await executeQuery(
                `UPDATE daily_records SET morning_diesel = $1, morning_petrol = $2, recorded_by = $3 WHERE record_date = $4`,
                [diesel, petrol, req.user.id, today]
            );
        } else {
            await executeQuery(
                `INSERT INTO daily_records (record_date, morning_diesel, morning_petrol, recorded_by) VALUES ($1, $2, $3, $4)`,
                [today, diesel, petrol, req.user.id]
            );
        }
        
        await addAuditLog(req.user.id, req.user.username, 'MORNING_DIP', `Diesel: ${diesel}L, Petrol: ${petrol}L`);
        res.json({ message: 'Morning dip saved successfully' });
    } catch (error) {
        console.error('Error saving morning dip:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fuel/daily-sales', authenticateToken, async (req, res) => {
    const { dieselSold, petrolSold } = req.body;
    const today = new Date().toISOString().split('T')[0];
    console.log(`💰 Daily sales: Diesel=${dieselSold}L, Petrol=${petrolSold}L`);
    
    try {
        const record = await executeQuery(`SELECT morning_diesel, morning_petrol, diesel_sold, petrol_sold FROM daily_records WHERE record_date = $1`, [today]);
        
        if (record.rows.length === 0) {
            return res.status(400).json({ error: 'Please save morning dip first' });
        }
        
        const currentMorningDiesel = parseFloat(record.rows[0].morning_diesel) || 0;
        const currentMorningPetrol = parseFloat(record.rows[0].morning_petrol) || 0;
        const currentDieselSold = parseFloat(record.rows[0].diesel_sold) || 0;
        const currentPetrolSold = parseFloat(record.rows[0].petrol_sold) || 0;
        
        const newDieselSold = currentDieselSold + dieselSold;
        const newPetrolSold = currentPetrolSold + petrolSold;
        
        if (newDieselSold > currentMorningDiesel || newPetrolSold > currentMorningPetrol) {
            return res.status(400).json({ error: 'Sales cannot exceed morning stock' });
        }
        
        const expectedEveningDiesel = currentMorningDiesel - newDieselSold;
        const expectedEveningPetrol = currentMorningPetrol - newPetrolSold;
        
        await executeQuery(
            `UPDATE daily_records 
             SET diesel_sold = $1, petrol_sold = $2, expected_evening_diesel = $3, expected_evening_petrol = $4, recorded_by = $5 
             WHERE record_date = $6`,
            [newDieselSold, newPetrolSold, expectedEveningDiesel, expectedEveningPetrol, req.user.id, today]
        );
        
        await addAuditLog(req.user.id, req.user.username, 'DAILY_SALES', `Diesel: ${dieselSold}L, Petrol: ${petrolSold}L`);
        res.json({ message: 'Sales recorded successfully' });
    } catch (error) {
        console.error('Error recording sales:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/fuel/daily-records', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(`SELECT * FROM daily_records ORDER BY record_date DESC`);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/fuel/daily-record/:id', authenticateToken, async (req, res) => {
    try {
        const record = await executeQuery(`SELECT locked FROM daily_records WHERE id = $1`, [req.params.id]);
        
        if (record.rows.length > 0 && record.rows[0].locked) {
            if (req.user.role !== 'super_admin') {
                return res.status(403).json({ error: 'Locked records can only be deleted by super admin' });
            }
        }
        
        await executeQuery(`DELETE FROM daily_records WHERE id = $1`, [req.params.id]);
        await addAuditLog(req.user.id, req.user.username, 'DELETE_DAILY_RECORD', `Deleted record ID: ${req.params.id}`);
        res.json({ message: 'Daily record deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fuel/lock-record', authenticateToken, async (req, res) => {
    const { recordId, recordDate } = req.body;
    try {
        await executeQuery(`UPDATE daily_records SET locked = true WHERE id = $1`, [recordId]);
        
        await executeQuery(
            `INSERT INTO locked_records (record_type, record_id, record_date, locked_by, locked_by_name) 
             VALUES ($1, $2, $3, $4, $5)`,
            ['daily_record', recordId, recordDate, req.user.id, req.user.username]
        );
        
        await addAuditLog(req.user.id, req.user.username, 'LOCK_RECORD', `Locked record ID: ${recordId}`);
        res.json({ message: 'Record locked successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/fuel/unlock-record/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        await executeQuery(`UPDATE daily_records SET locked = false WHERE id = $1`, [req.params.id]);
        await executeQuery(`DELETE FROM locked_records WHERE record_id = $1 AND record_type = 'daily_record'`, [req.params.id]);
        await addAuditLog(req.user.id, req.user.username, 'UNLOCK_RECORD', `Unlocked record ID: ${req.params.id}`);
        res.json({ message: 'Record unlocked successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/locked-records', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(`
            SELECT lr.*, u.username as locked_by_username 
            FROM locked_records lr
            JOIN users u ON lr.locked_by = u.id
            ORDER BY lr.locked_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== AUDIT LOGS ====================
app.get('/api/audit-logs', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await executeQuery(`
            SELECT * FROM audit_logs 
            ORDER BY created_at DESC 
            LIMIT 200
        `);
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
        await executeQuery('SELECT 1');
        res.json({
            status: 'running',
            database: 'connected',
            port: PORT,
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'running',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================
connectWithRetry().then((connected) => {
    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 MOREVA ENERGY Backend Server');
        console.log('='.repeat(60));
        console.log(`📡 Server running on: http://localhost:${PORT}`);
        console.log(`📁 Static files from: ${publicPath}`);
        console.log(`🌐 Access at: http://localhost:${PORT}`);
        console.log(`🔐 Admin: superadmin / Admin@123`);
        console.log(`🗄️ Database: ${connected ? 'Connected ✓' : 'Disconnected ⚠️'}`);
        console.log(`📧 Email Service: ${process.env.SMTP_USER ? 'Configured ✓' : 'Fallback mode'}`);
        console.log('='.repeat(60));
        console.log('\n💡 TIPS:');
        console.log('   - Reset codes appear in console with ===== around them');
        console.log('   - Use /api/debug/reset-codes/:email to check codes');
        console.log('='.repeat(60) + '\n');
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    app.listen(PORT, () => {
        console.log(`⚠️ Server running without database on port ${PORT}`);
    });
});