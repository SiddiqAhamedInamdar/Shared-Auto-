function roleGuard(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. You do not have permission to access this resource.',
        requiredRole: allowedRoles,
        yourRole: req.user.role
      });
    }
    
    next();
  };
}

module.exports = { roleGuard };
