const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../database/postgres');
const { authenticateToken, isSuperAdmin } = require('../middleware/auth.middleware');
const router = express.Router();

// Get all users (Super Admin only)
router.get('/users', authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create new user (Super Admin only)
router.post('/users', authenticateToken, isSuperAdmin, async (req, res) => {
  const { name, email, role } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email required' });
  }
  
  try {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const tempPassword = 'Welcome@123';
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, email, hashedPassword, role || 'Manager', 1]
    );
    
    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'USER_CREATED', `Created user: ${name} (${email})`]
    );
    
    res.json({
      message: 'User created successfully',
      user: { id: result.rows[0].id, name, email, role: role || 'Manager' },
      temporaryPassword: tempPassword
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Error creating user' });
  }
});

// Toggle user active status (Super Admin only)
router.put('/users/:id/toggle', authenticateToken, isSuperAdmin, async (req, res) => {
  const userId = req.params.id;
  
  try {
    const userResult = await pool.query('SELECT active, email FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Prevent disabling Super Admin
    if (user.email === 'superadmin@moreva.com') {
      return res.status(403).json({ error: 'Cannot modify Super Admin' });
    }
    
    const newStatus = user.active ? 0 : 1;
    await pool.query('UPDATE users SET active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
      [newStatus, userId]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'USER_STATUS_CHANGED', `User ${user.email} ${newStatus ? 'activated' : 'deactivated'}`]
    );
    
    res.json({ message: `User ${newStatus ? 'activated' : 'deactivated'}` });
  } catch (error) {
    console.error('Error toggling user:', error);
    res.status(500).json({ error: 'Error updating user' });
  }
});

// Delete user (Super Admin only)
router.delete('/users/:id', authenticateToken, isSuperAdmin, async (req, res) => {
  const userId = req.params.id;
  
  try {
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Prevent deleting Super Admin
    if (user.email === 'superadmin@moreva.com') {
      return res.status(403).json({ error: 'Cannot delete Super Admin' });
    }
    
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'USER_DELETED', `Deleted user: ${user.email}`]
    );
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Error deleting user' });
  }
});

// Get all locked records
router.get('/locked-records', authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM daily_records WHERE locked = 1 ORDER BY record_date DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching locked records:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Unlock a record
router.put('/unlock-record/:id', authenticateToken, isSuperAdmin, async (req, res) => {
  const recordId = req.params.id;
  
  try {
    await pool.query('UPDATE daily_records SET locked = 0 WHERE id = $1', [recordId]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'RECORD_UNLOCKED', `Unlocked record ID: ${recordId}`]
    );
    
    res.json({ message: 'Record unlocked successfully' });
  } catch (error) {
    console.error('Error unlocking record:', error);
    res.status(500).json({ error: 'Error unlocking record' });
  }
});

// Get system statistics (Super Admin only)
router.get('/stats', authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalDeliveries = await pool.query('SELECT COUNT(*) FROM deliveries');
    const totalSales = await pool.query('SELECT SUM(diesel_sold + petrol_sold) as total FROM daily_records');
    const lockedRecords = await pool.query('SELECT COUNT(*) FROM daily_records WHERE locked = 1');
    
    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalDeliveries: parseInt(totalDeliveries.rows[0].count),
      totalSales: parseFloat(totalSales.rows[0].total) || 0,
      lockedRecords: parseInt(lockedRecords.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;