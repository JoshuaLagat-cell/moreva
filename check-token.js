const jwt = require('jsonwebtoken');

// Your token
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJzdXBlcmFkbWluQG1vcmV2YS5jb20iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJpYXQiOjE3Nzk5NjM1OTEsImV4cCI6MTc4MDU2ODM5MX0.2tpNh5rZ3fPra6HGdt7vAYJBosgiglq1x9Ui9Dh0AW4";

try {
  // Decode without verifying
  const decoded = jwt.decode(token);
  console.log('Token decoded (unverified):');
  console.log('  Issued at (iat):', decoded.iat);
  console.log('  Issued at date:', new Date(decoded.iat * 1000).toLocaleString());
  console.log('  Expires at (exp):', decoded.exp);
  console.log('  Expires at date:', new Date(decoded.exp * 1000).toLocaleString());
  console.log('  User ID:', decoded.id);
  console.log('  Email:', decoded.email);
  console.log('  Role:', decoded.role);
  
  const now = Math.floor(Date.now() / 1000);
  console.log('\nCurrent timestamp:', now);
  console.log('Current time:', new Date().toLocaleString());
  console.log('Token expires in:', Math.floor((decoded.exp - now) / 60), 'minutes');
  
  if (decoded.exp < now) {
    console.log('\n❌ Token IS expired!');
  } else {
    console.log('\n✅ Token is still valid');
  }
} catch (error) {
  console.error('Error:', error.message);
}