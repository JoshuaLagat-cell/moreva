const express = require('express');
const pool = require('../database/postgres');
const { authenticateToken, isManager } = require('../middleware/auth.middleware');
const router = express.Router();

// Calculate expected cash
router.post('/calculate', authenticateToken, isManager, async (req, res) => {
  const { total_sales, mpesa, credits, expenses, advances, returns_val, lubricants } = req.body;
  
  // Expected cash formula: total_sales - mpesa - credits - expenses - advances + returns_val + lubricants
  const expected_cash = (total_sales || 0) - (mpesa || 0) - (credits || 0) - (expenses || 0) - (advances || 0) + (returns_val || 0) + (lubricants || 0);
  
  res.json({ 
    expected_cash,
    breakdown: {
      total_sales: total_sales || 0,
      mpesa: mpesa || 0,
      credits: credits || 0,
      expenses: expenses || 0,
      advances: advances || 0,
      returns_val: returns_val || 0,
      lubricants: lubricants || 0
    }
  });
});

// Save reconciliation
router.post('/', authenticateToken, isManager, async (req, res) => {
  const { 
    total_sales, 
    mpesa, 
    credits, 
    expenses, 
    advances,
    returns_val,
    lubricants,
    expected_cash, 
    actual_cash, 
    variance, 
    status 
  } = req.body;
  
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // Check if reconciliation already exists for today
    const existing = await pool.query(
      'SELECT id FROM reconciliations WHERE record_date = $1',
      [today]
    );
    
    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE reconciliations 
         SET total_sales = $1, mpesa = $2, credits = $3, expenses = $4, 
             advances = $5, returns_val = $6, lubricants = $7,
             expected_cash = $8, actual_cash = $9, variance = $10, 
             status = $11, locked = 1, recorded_by = $12
         WHERE record_date = $13`,
        [total_sales || 0, mpesa || 0, credits || 0, expenses || 0, 
         advances || 0, returns_val || 0, lubricants || 0,
         expected_cash, actual_cash, variance, status || 'Completed', 
         req.user.id, today]
      );
    } else {
      // Insert new reconciliation
      await pool.query(
        `INSERT INTO reconciliations 
         (record_date, total_sales, mpesa, credits, expenses, advances, returns_val, lubricants,
          expected_cash, actual_cash, variance, status, locked, recorded_by) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [today, total_sales || 0, mpesa || 0, credits || 0, expenses || 0,
         advances || 0, returns_val || 0, lubricants || 0,
         expected_cash, actual_cash, variance, status || 'Completed', 1, req.user.id]
      );
    }
    
    // Also lock the daily record for today
    await pool.query(
      'UPDATE daily_records SET locked = 1 WHERE record_date = $1',
      [today]
    );
    
    // Log reconciliation
    const varianceText = variance > 0 ? `EXCESS of ${Math.abs(variance)}` : (variance < 0 ? `SHORTAGE of ${Math.abs(variance)}` : 'BALANCED');
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'RECONCILIATION_COMPLETED', 
       `Expected: ${expected_cash}, Actual: ${actual_cash}, Variance: ${variance} (${varianceText})`]
    );
    
    res.json({ 
      message: 'Reconciliation completed and locked',
      variance: variance,
      status: variance > 0 ? 'EXCESS' : (variance < 0 ? 'SHORTAGE' : 'BALANCED')
    });
  } catch (error) {
    console.error('Error saving reconciliation:', error);
    res.status(500).json({ error: 'Error saving reconciliation' });
  }
});

// Get reconciliation history
router.get('/history', authenticateToken, isManager, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as recorded_by_name 
       FROM reconciliations r
       LEFT JOIN users u ON r.recorded_by = u.id
       ORDER BY r.record_date DESC 
       LIMIT 30`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reconciliation history:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get reconciliation by date
router.get('/date/:date', authenticateToken, isManager, async (req, res) => {
  const { date } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM reconciliations WHERE record_date = $1',
      [date]
    );
    
    if (result.rows.length === 0) {
      return res.json({ exists: false, message: 'No reconciliation for this date' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching reconciliation:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get daily reconciliation summary
router.get('/summary', authenticateToken, isManager, async (req, res) => {
  const days = req.query.days || 7;
  
  try {
    const result = await pool.query(`
      SELECT 
        record_date,
        total_sales,
        expected_cash,
        actual_cash,
        variance,
        CASE 
          WHEN variance > 0 THEN 'EXCESS'
          WHEN variance < 0 THEN 'SHORTAGE'
          ELSE 'BALANCED'
        END as status
      FROM reconciliations
      WHERE record_date >= NOW() - INTERVAL '${days} days'
      ORDER BY record_date DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reconciliation summary:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;