module.exports = {
    // Middleware untuk memastikan user sudah login
    isLoggedIn: (req, res, next) => {
        if (req.session && req.session.user) {
            return next();
        }
        req.session.error_msg = "Silakan login terlebih dahulu.";
        res.redirect('/login');
    },
    
    // Middleware khusus Admin Lembaga
    isAdminLembaga: (req, res, next) => {
        if (req.session && req.session.user && req.session.user.role === 'admin_lembaga') {
            return next();
        }
        req.session.error_msg = "Akses ditolak! Halaman ini khusus Admin Lembaga.";
        res.redirect('/lembaga-admin');
    }
};
