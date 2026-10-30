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
    },

    // TAMBAHAN UTAMA: Middleware untuk membatasi akses khusus role atau bidang tertentu
    checkRole: (allowedRoles) => {
        return (req, res, next) => {
            const user = req.session.user;
            if (!user) {
                return res.redirect('/login');
            }
            // Jika role user termasuk dalam daftar yang diizinkan atau merupakan admin_lembaga/superadmin
            if (allowedRoles.includes(user.role) || user.role === 'admin_lembaga' || user.role === 'superadmin') {
                return next();
            }
            req.session.error_msg = "Anda tidak memiliki hak akses ke halaman tersebut!";
            res.redirect('/lembaga-admin');
        };
    }
};
