const express = require('express');
const router = express.Router();
const lembagaAdminController = require('../controllers/lembagaAdminController');

router.get('/', lembagaAdminController.index);
router.post('/bidang/tambah', lembagaAdminController.storeBidang);
router.post('/user-bidang/tambah', lembagaAdminController.storeUserBidang);
router.post('/proker/tambah', lembagaAdminController.storeProker);

module.exports = router;
