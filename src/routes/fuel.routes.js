const express = require('express');
const pool = require('../database/postgres');
const { authenticateToken, isManager } = require('../middleware/auth.middleware');
const router = express.Router();

// Get current stock levels
router.get('/stock', authenticateToken, isManager, async (req, res) => {
  try {
    const result = await pool.query('SELECT fuel_type, quantity, updated_at FROM stock');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stock:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update stock levels
router.post('/stock', authenticateToken, isManager, async (req, res) => {
  const { fuel_type, quantity } = req.body;
  
  if (!fuel_type || quantity === undefined) {
    return res.status(400).json({ error: 'Fuel type and quantity required' });
  }
  
  try {
    await pool.query(
      'UPDATE stock SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2',
      [quantity, fuel_type]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'STOCK_UPDATED', `${fuel_type}: ${quantity}L`]
    );
    
    res.json({ message: 'Stock updated successfully' });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ error: 'Error updating stock' });
  }
});

// Get daily records
router.get('/daily-records', authenticateToken, isManager, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM daily_records ORDER BY record_date DESC LIMIT 30'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily records:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Save morning dip
router.post('/morning-dip', authenticateToken, isManager, async (req, res) => {
  const { diesel, petrol } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  if (diesel === undefined || petrol === undefined) {
    return res.status(400).json({ error: 'Diesel and petrol values required' });
  }
  
  try {
    // Check if record exists for today
    const existing = await pool.query(
      'SELECT id FROM daily_records WHERE record_date = $1',
      [today]
    );
    
    if (existing.rows.length > 0) {
      // Update existing record
      await pool.query(
        `UPDATE daily_records 
         SET morning_diesel = $1, morning_petrol = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE record_date = $3`,
        [diesel, petrol, today]
      );
    } else {
      // Insert new record
      await pool.query(
        'INSERT INTO daily_records (record_date, morning_diesel, morning_petrol, recorded_by) VALUES ($1, $2, $3, $4)',
        [today, diesel, petrol, req.user.id]
      );
    }
    
    res.json({ message: 'Morning dip saved successfully' });
  } catch (error) {
    console.error('Error saving morning dip:', error);
    res.status(500).json({ error: 'Error saving morning dip' });
  }
});

// Save daily sales
router.post('/daily-sales', authenticateToken, isManager, async (req, res) => {
  const { dieselSold, petrolSold } = req.body;
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Get morning dip values
    const record = await pool.query(
      'SELECT morning_diesel, morning_petrol, locked FROM daily_records WHERE record_date = $1',
      [today]
    );
    
    if (record.rows.length === 0) {
      return res.status(400).json({ error: 'Please save morning dip first' });
    }
    
    if (record.rows[0].locked === 1) {
      return res.status(400).json({ error: 'Today\'s record is already locked' });
    }
    
    const morningDiesel = record.rows[0].morning_diesel;
    const morningPetrol = record.rows[0].morning_petrol;
    const expectedDiesel = morningDiesel - (dieselSold || 0);
    const expectedPetrol = morningPetrol - (petrolSold || 0);
    
    if (expectedDiesel < 0 || expectedPetrol < 0) {
      return res.status(400).json({ error: 'Sales exceed morning stock' });
    }
    
    // Update with sales and lock the record
    await pool.query(
      `UPDATE daily_records 
       SET diesel_sold = $1, petrol_sold = $2, 
           expected_evening_diesel = $3, expected_evening_petrol = $4,
           locked = 1, recorded_by = $5
       WHERE record_date = $6`,
      [dieselSold || 0, petrolSold || 0, expectedDiesel, expectedPetrol, req.user.id, today]
    );
    
    // Update stock levels
    await pool.query(
      'UPDATE stock SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2',
      [dieselSold || 0, 'Diesel']
    );
    await pool.query(
      'UPDATE stock SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE fuel_type = $2',
      [petrolSold || 0, 'Petrol']
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'DAILY_SALES', `Sold D:${dieselSold || 0}L P:${petrolSold || 0}L`]
    );
    
    res.json({ message: 'Daily sales recorded and locked' });
  } catch (error) {
    console.error('Error saving daily sales:', error);
    res.status(500).json({ error: 'Error saving sales' });
  }
});

// Get current day's record
router.get('/today', authenticateToken, isManager, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const result = await pool.query(
      'SELECT * FROM daily_records WHERE record_date = $1',
      [today]
    );
    
    if (result.rows.length === 0) {
      return res.json({ exists: false, message: 'No record for today' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching today\'s record:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;