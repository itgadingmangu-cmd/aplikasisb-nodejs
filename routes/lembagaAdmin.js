const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker } = require('../models'); // Pastikan Proker sudah di-import di sini

// --- RUTE HALAMAN UTAMA / DASHBOARD ADMIN LEMBAGA (/lembaga-admin) ---
router.get('/', async (req, res) => {
    try {
        // Pastikan yang mengakses adalah admin_lembaga
        if (!req.session.user || req.session.user.role !== 'admin_lembaga') {
            return res.redirect('/login');
        }

        const lembagaId = req.session.user.lembagaId;

        // Ambil data lembaga aktif beserta Bidang, User/Pengurus, dan Program Kerja yang terkait
        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs' },
                { model: User, as: 'Users' },
                { model: Proker, as: 'Prokers' } // Disertakan agar data program kerja lembaga ikut terpanggil
            ]
        });

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/login');
        }

        // Render ke file views/lembaga_admin.ejs
        res.render('lembaga_admin', {
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error("Error pada dashboard lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

module.exports = router;
