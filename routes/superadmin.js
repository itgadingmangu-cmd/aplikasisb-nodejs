const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker, RincianBiaya } = require('../models');

// Pastikan fungsi middleware ini didefinisikan dengan benar atau diimpor dengan jalur yang tepat
function isLoggedIn(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
}

function isSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'superadmin') return next();
    res.status(403).send("Akses ditolak: Halaman ini khusus untuk Superadmin!");
}

// Rute Superadmin masuk ke panel kontrol lembaga tertentu (Impersonation)
router.get('/lembaga/kelola/:id', isLoggedIn, isSuperAdmin, async (req, res) => {
    try {
        const targetLembagaId = req.params.id;

        const lembagaData = await Lembaga.findByPk(targetLembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs' },
                { model: User, as: 'Users' },
                { model: Proker, as: 'Prokers', include: [{ model: Bidang, as: 'Bidang' }] }
            ]
        });

        if (!lembagaData) {
            req.session.error_msg = "Lembaga tidak ditemukan!";
            return res.redirect('/');
        }

        let totalAnggaranLembaga = 0;
        if (lembagaData.Prokers && lembagaData.Prokers.length > 0) {
            totalAnggaranLembaga = lembagaData.Prokers.reduce((sum, proker) => {
                return sum + (parseFloat(proker.anggaran) || 0);
            }, 0);
        }

        const userSession = {
            id: req.session.user.id,
            nama_lengkap: req.session.user.nama_lengkap,
            username: req.session.user.username,
            role: 'admin_lembaga', 
            lembagaId: targetLembagaId
        };

        res.render('lembaga_admin', {
            userSession,
            lembagaData,
            totalAnggaranLembaga
        });

    } catch (err) {
        console.error("Error superadmin kelola lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

module.exports = router;
