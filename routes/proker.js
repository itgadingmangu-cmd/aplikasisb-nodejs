const express = require('express');
const router = express.Router();
const prokerController = require('../controllers/prokerController');
const biayaController = require('../controllers/biayaController');
const { Pengaturan, Proker, Bidang } = require('../models');

// --- MIDDLEWARE PENDUKUNG ISOLASI TAHUN PADA ROUTER PROKER ---
// Memastikan setiap request membawa informasi tahun aktif global
router.use(async (req, res, next) => {
    try {
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        req.tahunAktif = parseInt(pengaturan.tahun_aktif, 10);
        next();
    } catch (err) {
        req.tahunAktif = 2026;
        next();
    }
});

// Rute Manajemen Program Kerja
router.get('/', prokerController.index);
router.get('/tambah', prokerController.create); // Menampilkan form tambah proker
router.post('/tambah', prokerController.store); // Memproses form tambah proker

// Rute Rincian Biaya / Anggaran Program Kerja
router.get('/:prokerId/biaya', biayaController.index);
router.post('/:prokerId/biaya/tambah', biayaController.store);
router.get('/:prokerId/biaya/hapus/:id', biayaController.destroy);

// Tambahkan rute aksi alur proposal & pencairan berikut:

// 1. Pengaju mengajukan proposal dari Draft ke Status "Diajukan"
router.post('/proker/ajukan/:id', prokerController.ajukanProposal);

// 2. Ketua/Admin mereview proposal (Disetujui / Revisi + Opsi TTD)
router.post('/proker/review/:id', prokerController.reviewApprovalKetua);

// 3. Bendahara memproses pencairan atau menolak pencairan (Disertai Alasan)
router.post('/proker/pencairan/:id', prokerController.prosesPencairanBendahara);

// Rute Cetak Laporan / Dokumen Berdasarkan Bidang
router.get('/proker/bidang/:bidangId/print', prokerController.cetakPerBidang);

module.exports = router;
