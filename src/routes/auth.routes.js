const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database/postgres');
const router = express.Router();

// ==================== SIGNUP ====================
router.post('/signup', async (req, res) => {
  console.log('Signup request received:', req.body);
  
  const { username, email, password, full_name, phone, role } = req.body;
  
  // Validation
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!full_name) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  
  try {
    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User with this email or username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert new user - FIXED: Using 'is_active' instead of 'active'
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, phone, role, is_active, email_verified) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, username, email, full_name, role`,
      [username, email, hashedPassword, full_name, phone || null, role || 'staff', true, true]
    );
    
    const newUser = result.rows[0];
    
    // Generate token
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }  // FIXED: Using 30d from .env
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Error creating user: ' + error.message });
  }
});

// ==================== LOGIN ====================
router.post('/login', async (req, res) => {
  console.log('Login request received:', req.body.email);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // Find user by email or username - FIXED: Use 'is_active' column
    const result = await pool.query(
      'SELECT * FROM users WHERE (email = $1 OR username = $1) AND is_active = true',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      // Increment login attempts
      const attempts = (user.login_attempts || 0) + 1;
      await pool.query('UPDATE users SET login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(401).json({ error: 'Invalid credentials', attempts_left: Math.max(0, 5 - attempts) });
    }
    
    // Reset login attempts and update last login
    await pool.query(
      'UPDATE users SET login_attempts = 0, last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // Generate token - FIXED: Use role as stored in DB (could be 'super_admin' or 'Super Administrator')
    const tokenPayload = { 
      id: user.id, 
      email: user.email, 
      role: user.role 
    };
    
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );
    
    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET + '_refresh',
      { expiresIn: '30d' }
    );
    
    res.json({
      message: 'Login successful',
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

// ==================== VERIFY TOKEN ====================
router.get('/verify', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  console.log('Verify token request received');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided', valid: false });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token decoded:', decoded);
    
    // FIXED: Use 'is_active' column
    const result = await pool.query(
      'SELECT id, username, email, full_name, role FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found', valid: false });
    }
    
    res.json({ 
      valid: true, 
      user: result.rows[0],
      message: 'Token is valid'
    });
  } catch (error) {
    console.error('Token verification error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', valid: false });
    }
    res.status(401).json({ error: 'Invalid token', valid: false });
  }
});

// ==================== REFRESH TOKEN ====================
router.post('/refresh-token', async (req, res) => {
  const { refresh_token } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token required' });
  }
  
  try {
    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET + '_refresh');
    
    const result = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );
    
    res.json({ token: newToken });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ==================== LOGOUT ====================
router.post('/logout', async (req, res) => {
  console.log('Logout request received');
  res.json({ message: 'Logged out successfully' });
});

// ==================== FORGOT PASSWORD ====================
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  res.json({ message: 'If email exists, password reset link has been sent' });
});

// ==================== CHANGE PASSWORD ====================
router.post('/change-password', async (req, res) => {
  const { user_id, current_password, new_password } = req.body;
  
  if (!user_id || !current_password || !new_password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  try {
    const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user_id]);
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const isValid = await bcrypt.compare(current_password, user.rows[0].password_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, user_id]);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error changing password' });
  }
});

module.exports = router;