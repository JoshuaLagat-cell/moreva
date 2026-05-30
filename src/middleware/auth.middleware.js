const jwt = require('jsonwebtoken');
const pool = require('../database/postgres');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // FIXED: Changed 'active' to 'is_active' to match your database schema
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'User not found or inactive.' });
    }
    
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// FIXED: Role checks to match both formats
const isSuperAdmin = (req, res, next) => {
  const userRole = req.user.role;
  if (userRole !== 'super_admin' && userRole !== 'Super Administrator') {
    return res.status(403).json({ error: 'Super Admin access required.' });
  }
  next();
};

const isManager = (req, res, next) => {
  const userRole = req.user.role;
  const allowedRoles = ['manager', 'super_admin', 'Super Administrator', 'Manager'];
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Manager access required.' });
  }
  next();
};

module.exports = { authenticateToken, isSuperAdmin, isManager };