const express = require('express');
const pool = require('../database/postgres');
const { authenticateToken, isManager } = require('../middleware/auth.middleware');
const router = express.Router();

// Get all deliveries
router.get('/', authenticateToken, isManager, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.name as recorded_by_name 
       FROM deliveries d
       LEFT JOIN users u ON d.recorded_by = u.id
       ORDER BY d.recorded_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching deliveries:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get single delivery by ID
router.get('/:id', authenticateToken, isManager, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM deliveries WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching delivery:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Create new delivery
router.post('/', authenticateToken, isManager, async (req, res) => {
  const { 
    fuel_type, 
    driver_name, 
    declared_litres, 
    pre_dip, 
    post_dip, 
    actual_gain, 
    variance, 
    status 
  } = req.body;
  
  // Validate required fields
  if (!fuel_type || !driver_name || !declared_litres || pre_dip === undefined || post_dip === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    // Start a transaction
    await pool.query('BEGIN');
    
    // Insert delivery record
    const result = await pool.query(
      `INSERT INTO deliveries 
       (fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status, recorded_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [fuel_type, driver_name, declared_litres, pre_dip, post_dip, actual_gain, variance, status || 'Completed', req.user.id]
    );
    
    // Update stock
    await pool.query(
      'UPDATE stock SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2',
      [actual_gain, fuel_type]
    );
    
    // Commit transaction
    await pool.query('COMMIT');
    
    // Log the action
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'DELIVERY_COMPLETED', `${fuel_type}: ${declared_litres}L, variance: ${variance}L`]
    );
    
    res.status(201).json({ 
      id: result.rows[0].id, 
      message: 'Delivery recorded successfully' 
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating delivery:', error);
    res.status(500).json({ error: 'Error saving delivery' });
  }
});

// Update delivery
router.put('/:id', authenticateToken, isManager, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  try {
    // Get old delivery data
    const oldDelivery = await pool.query('SELECT * FROM deliveries WHERE id = $1', [id]);
    
    if (oldDelivery.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    // Build dynamic update query
    const allowedFields = ['fuel_type', 'driver_name', 'declared_litres', 'pre_dip', 'post_dip', 'actual_gain', 'variance', 'status'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }
    
    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    
    await pool.query(
      `UPDATE deliveries SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    // Log update
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'DELIVERY_UPDATED', `Updated delivery ID: ${id}`]
    );
    
    res.json({ message: 'Delivery updated successfully' });
  } catch (error) {
    console.error('Error updating delivery:', error);
    res.status(500).json({ error: 'Error updating delivery' });
  }
});

// Delete delivery
router.delete('/:id', authenticateToken, isManager, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Get delivery before deletion
    const delivery = await pool.query('SELECT * FROM deliveries WHERE id = $1', [id]);
    
    if (delivery.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery not found' });
    }
    
    // Reverse stock adjustment
    await pool.query(
      'UPDATE stock SET quantity = quantity - $1 WHERE fuel_type = $2',
      [delivery.rows[0].actual_gain, delivery.rows[0].fuel_type]
    );
    
    // Delete delivery
    await pool.query('DELETE FROM deliveries WHERE id = $1', [id]);
    
    // Log deletion
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'DELIVERY_DELETED', `Deleted delivery ID: ${id}`]
    );
    
    res.json({ message: 'Delivery deleted successfully' });
  } catch (error) {
    console.error('Error deleting delivery:', error);
    res.status(500).json({ error: 'Error deleting delivery' });
  }
});

// Get delivery statistics
router.get('/stats/summary', authenticateToken, isManager, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_deliveries,
        SUM(declared_litres) as total_declared,
        SUM(actual_gain) as total_received,
        AVG(variance) as avg_variance
      FROM deliveries
      WHERE recorded_at >= NOW() - INTERVAL '30 days'
    `);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching delivery stats:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;