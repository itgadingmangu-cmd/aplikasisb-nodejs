const express = require('express');
const router = express.Router();
const prokerController = require('../controllers/prokerController');
const biayaController = require('../controllers/biayaController');

// Rute Manajemen Program Kerja
router.get('/', prokerController.index);
router.get('/tambah', prokerController.create); // Menampilkan form tambah proker
router.post('/tambah', prokerController.store); // Memproses form tambah proker

// Rute Rincian Biaya / Anggaran Program Kerja
router.get('/:prokerId/biaya', biayaController.index);
router.post('/:prokerId/biaya/tambah', biayaController.store);
router.get('/:prokerId/biaya/hapus/:id', biayaController.destroy);

module.exports = router;
