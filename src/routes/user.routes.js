const express = require('express');
const pool = require('../database/postgres');
const bcrypt = require('bcryptjs');
const { authenticateToken, isManager, isSuperAdmin } = require('../middleware/auth.middleware');
const router = express.Router();

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  try {
    await pool.query(
      'UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [name, req.user.id]
    );
    
    // Log profile update
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'PROFILE_UPDATED', 'User updated their profile']
    );
    
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Error updating profile' });
  }
});

// Get all users (Manager and above)
router.get('/', authenticateToken, isManager, async (req, res) => {
  try {
    let query = 'SELECT id, name, email, role, active, created_at FROM users';
    const params = [];
    
    // If not super admin, don't show other managers? (optional filtering)
    if (req.user.role !== 'Super Administrator') {
      query += ' WHERE id = $1';
      params.push(req.user.id);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get user by ID (Admin only)
router.get('/:id', authenticateToken, isSuperAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Reset user password (Admin only)
router.post('/:id/reset-password', authenticateToken, isSuperAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Prevent resetting Super Admin password through this endpoint
    if (user.email === 'superadmin@moreva.com') {
      return res.status(403).json({ error: 'Use Super Admin account to change password' });
    }
    
    const newPassword = 'Welcome@123';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, id]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'PASSWORD_RESET', `Reset password for user: ${user.email}`]
    );
    
    res.json({ 
      message: 'Password reset successfully',
      temporaryPassword: newPassword
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Error resetting password' });
  }
});

// Get user activity summary
router.get('/:id/activity', authenticateToken, isSuperAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_actions,
        COUNT(CASE WHEN action LIKE '%LOGIN%' THEN 1 END) as logins,
        MAX(created_at) as last_active
       FROM audit_logs 
       WHERE user_id = $1`,
      [id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;