const express = require('express');
const pool = require('../database/postgres');
const { authenticateToken, isSuperAdmin } = require('../middleware/auth.middleware');
const router = express.Router();

// Get all audit logs (Super Admin only)
router.get('/logs', authenticateToken, isSuperAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    const count = await pool.query('SELECT COUNT(*) FROM audit_logs');
    
    res.json({
      logs: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get logs by user
router.get('/logs/user/:userId', authenticateToken, isSuperAdmin, async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user audit logs:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get logs by action type
router.get('/logs/action/:action', authenticateToken, isSuperAdmin, async (req, res) => {
  const { action } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       WHERE action = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [action, limit]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching action audit logs:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get logs by date range
router.get('/logs/date-range', authenticateToken, isSuperAdmin, async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Start date and end date required' });
  }
  
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       WHERE DATE(created_at) BETWEEN $1 AND $2 
       ORDER BY created_at DESC`,
      [startDate, endDate]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audit logs by date range:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get audit statistics
router.get('/stats', authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_logs,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT action) as unique_actions,
        COUNT(CASE WHEN action LIKE '%LOGIN%' THEN 1 END) as login_events,
        COUNT(CASE WHEN action LIKE '%FAILED%' THEN 1 END) as failed_events,
        MAX(created_at) as last_activity
      FROM audit_logs
    `);
    
    const actionCounts = await pool.query(`
      SELECT action, COUNT(*) as count 
      FROM audit_logs 
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    res.json({
      stats: result.rows[0],
      top_actions: actionCounts.rows
    });
  } catch (error) {
    console.error('Error fetching audit stats:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Clear old logs (Super Admin only)
router.delete('/logs/clear', authenticateToken, isSuperAdmin, async (req, res) => {
  const { daysToKeep } = req.body;
  const keepDays = daysToKeep || 90; // Keep last 90 days by default
  
  try {
    const result = await pool.query(
      'DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL \'' + keepDays + ' days\''
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_email, action, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.user.email, 'AUDIT_CLEANED', `Cleared logs older than ${keepDays} days`]
    );
    
    res.json({ 
      message: `Cleared ${result.rowCount} old audit logs`,
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('Error clearing audit logs:', error);
    res.status(500).json({ error: 'Error clearing audit logs' });
  }
});

// Export logs to CSV
router.get('/export/csv', authenticateToken, isSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT created_at, user_email, action, details, ip_address FROM audit_logs ORDER BY created_at DESC LIMIT 1000'
    );
    
    // Create CSV
    const headers = ['Timestamp', 'User Email', 'Action', 'Details', 'IP Address'];
    const csvRows = [headers.join(',')];
    
    for (const log of result.rows) {
      const row = [
        log.created_at,
        `"${log.user_email || ''}"`,
        `"${log.action}"`,
        `"${(log.details || '').replace(/"/g, '""')}"`,
        `"${log.ip_address || ''}"`
      ];
      csvRows.push(row.join(','));
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvRows.join('\n'));
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Error exporting logs' });
  }
});

module.exports = router;