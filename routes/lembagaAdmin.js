const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker, RincianBiaya, RealisasiBiaya, Pengaturan } = require('../models');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');

// --- KONFIGURASI MULTER UNTUK UPLOAD LOGO LEMBAGA ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/logo/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const { isLoggedIn, isAdminLembaga } = require('../middleware/auth');

// --- RUTE HALAMAN UTAMA / DASHBOARD DINAMIS (/lembaga-admin) ---
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.lembagaId;
        let lembagaData;

        // Ambil pengaturan global agar tahun aktif selalu sinkron
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026, nama_aplikasi: 'Aplikasi Program Kerja' };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: User, as: 'Users', where: { id_bidang: user.id_bidang }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        }

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/login');
        }

        let totalAnggaranLembaga = 0;
        if (lembagaData.Prokers && lembagaData.Prokers.length > 0) {
            totalAnggaranLembaga = lembagaData.Prokers.reduce((sum, proker) => {
                return sum + (parseFloat(proker.anggaran) || 0);
            }, 0);
        }

        res.render('lembaga_admin', {
            pengaturan,
            userSession: user,
            lembagaData,
            totalAnggaranLembaga
        });

    } catch (err) {
        console.error("Error pada dashboard lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL MANAJEMEN BIDANG
// ==========================================
router.get('/bidang', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [{ model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false }]
        });

        res.render('manajemen_bidang', {
            pengaturan,
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman manajemen bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/bidang/tambah', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const { nama_bidang, deskripsi_tugas } = req.body;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (!nama_bidang || nama_bidang.trim() === '') {
            return res.status(400).send("Nama bidang wajib diisi!");
        }

        await Bidang.create({
            nama_bidang: nama_bidang.trim(),
            deskripsi_tugas: deskripsi_tugas ? deskripsi_tugas.trim() : null,
            lembagaId,
            tahun: tahunAktifInt // <-- Disematkan tahun aktif
        });

        res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal menambah bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/bidang/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const bidang = await Bidang.findOne({ where: { id: bidangId, lembagaId: lembagaId, tahun: tahunAktifInt } });
        if (!bidang) {
            return res.status(404).send("Data bidang tidak ditemukan pada tahun aktif atau Anda tidak memiliki akses.");
        }

        res.render('edit_bidang', { pengaturan, userSession: req.session.user, bidang });
    } catch (err) {
        console.error("Error ambil data edit bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/bidang/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const { nama_bidang, deskripsi_tugas } = req.body;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (!nama_bidang || nama_bidang.trim() === '') {
            return res.status(400).send("Nama bidang wajib diisi!");
        }

        await Bidang.update({
            nama_bidang: nama_bidang.trim(),
            deskripsi_tugas: deskripsi_tugas ? deskripsi_tugas.trim() : null
        }, {
            where: { id: bidangId, lembagaId: lembagaId, tahun: tahunAktifInt }
        });

        res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal mengupdate bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/bidang/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        await Bidang.destroy({ where: { id: bidangId, lembagaId: lembagaId, tahun: tahunAktifInt } });
        res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal menghapus bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL MANAJEMEN PENGURUS
// ==========================================
router.get('/pengurus', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false }
            ]
        });

        res.render('kelola_pengurus', {
            pengaturan,
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman pengurus:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/pengurus/tambah', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const { nama_lengkap, username, password, role, jabatan, id_bidang } = req.body;
        const lembagaId = req.session.user.lembagaId;

        if (!nama_lengkap || !username || !password) {
            return res.status(400).send("Nama lengkap, username, dan password wajib diisi!");
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        await User.create({
            nama_lengkap: nama_lengkap.trim(),
            username: username.trim(),
            password: hashedPassword,
            role,
            jabatan,
            id_bidang: id_bidang ? id_bidang : null,
            lembagaId
        });

        res.redirect('/lembaga-admin/pengurus');
    } catch (err) {
        console.error("Gagal menambah pengurus:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL PROGRAM KERJA (PROKER) & RAB
// ==========================================
router.get('/proker', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        let lembagaData;
        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                    { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ], required: false }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ], required: false }
                ]
            });
        }

        res.render('manajemen_proker', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/tambah', isLoggedIn, async (req, res) => {
    try {
        const { nama_program, bidangId, deskripsi, status } = req.body;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (!nama_program || !bidangId) {
            return res.status(400).send("Nama program dan bidang penanggung jawab wajib diisi!");
        }

        let bulanPelaksanaan = req.body.bulan;
        if (Array.isArray(bulanPelaksanaan)) {
            bulanPelaksanaan = bulanPelaksanaan.join(',');
        } else if (!bulanPelaksanaan) {
            bulanPelaksanaan = '';
        }

        await Proker.create({
            nama_program: nama_program.trim(),
            bidangId,
            lembagaId,
            deskripsi: deskripsi ? deskripsi.trim() : null,
            waktu_pelaksanaan: bulanPelaksanaan,
            status: status || 'Direncanakan',
            anggaran: 0,
            tahun: tahunAktifInt // <-- Disematkan tahun aktif
        });

        res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal menambah proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE EDIT PROGRAM KERJA ---
router.get('/proker/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const proker = await Proker.findOne({ where: { id: prokerId, tahun: tahunAktifInt } });
        if (!proker) {
            req.session.error_msg = "Program kerja tidak ditemukan pada tahun aktif!";
            return res.redirect('/lembaga-admin/proker');
        }

        if (user.role !== 'admin_lembaga' && proker.bidangId !== user.id_bidang) {
            req.session.error_msg = "Anda tidak memiliki akses untuk mengedit program kerja ini!";
            return res.redirect('/lembaga-admin/proker');
        }

        const bidangs = await Bidang.findAll({ where: { lembagaId: user.lembagaId, tahun: tahunAktifInt } });

        res.render('edit_proker', {
            pengaturan,
            userSession: user,
            proker,
            bidangs
        });
    } catch (err) {
        console.error("Error ambil form edit proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;
        const { nama_program, bidangId, deskripsi, status } = req.body;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const proker = await Proker.findOne({ where: { id: prokerId, tahun: tahunAktifInt } });
        if (!proker) {
            return res.status(404).send("Program kerja tidak ditemukan!");
        }

        if (user.role !== 'admin_lembaga' && proker.bidangId !== user.id_bidang) {
            return res.status(403).send("Akses ditolak!");
        }

        let bulanPelaksanaan = req.body.bulan;
        if (Array.isArray(bulanPelaksanaan)) {
            bulanPelaksanaan = bulanPelaksanaan.join(',');
        } else if (!bulanPelaksanaan) {
            bulanPelaksanaan = proker.waktu_pelaksanaan;
        }

        await proker.update({
            nama_program: nama_program ? nama_program.trim() : proker.nama_program,
            bidangId: user.role === 'admin_lembaga' ? bidangId : proker.bidangId,
            deskripsi: deskripsi ? deskripsi.trim() : null,
            waktu_pelaksanaan: bulanPelaksanaan,
            status: status || proker.status
        });

        req.session.success_msg = "Program kerja berhasil diperbarui!";
        res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal update proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/rab/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const proker = await Proker.findOne({
            where: { id: prokerId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: Lembaga, as: 'Lembaga' },
                { model: RincianBiaya, as: 'RincianBiayas' }
            ]
        });

        if (!proker) {
            req.session.error_msg = "Program kerja tidak ditemukan!";
            return res.redirect('/lembaga-admin/proker');
        }

        res.render('manajemen_rab', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error("Error halaman RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/rab/tambah/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const { nama_item, satuan, jumlah, harga_satuan } = req.body;

        if (!nama_item || !jumlah || !harga_satuan) {
            return res.status(400).send("Nama item, volume (jumlah), dan harga satuan wajib diisi!");
        }

        const jml = parseFloat(jumlah) || 0;
        const harga = parseFloat(harga_satuan) || 0;

        const proker = await Proker.findByPk(prokerId);
        let jumlahBulan = 1;
        if (proker && proker.waktu_pelaksanaan) {
            const bulanArr = proker.waktu_pelaksanaan.split(',').filter(Boolean);
            if (bulanArr.length > 0) {
                jumlahBulan = bulanArr.length;
            }
        }

        const totalBiaya = jml * harga * jumlahBulan;

        await RincianBiaya.create({
            prokerId,
            nama_item: nama_item.trim(),
            satuan: satuan ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: jumlahBulan,
            total: totalBiaya
        });

        const allRAB = await RincianBiaya.findAll({ where: { prokerId } });
        const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: prokerId } });

        res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error("Gagal menambah item RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE EDIT ITEM RAB ---
router.get('/proker/rab/edit/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = req.params.idItem;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };

        const itemRAB = await RincianBiaya.findByPk(idItem, {
            include: [{ model: Proker, as: 'Proker' }]
        });

        if (!itemRAB) {
            req.session.error_msg = "Item RAB tidak ditemukan!";
            return res.redirect('/lembaga-admin/proker');
        }

        if (user.role !== 'admin_lembaga' && itemRAB.Proker.bidangId !== user.id_bidang) {
            req.session.error_msg = "Akses ditolak!";
            return res.redirect('/lembaga-admin/proker');
        }

        res.render('edit_rab', {
            pengaturan,
            userSession: user,
            itemRAB
        });
    } catch (err) {
        console.error("Error ambil form edit RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/rab/edit/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = req.params.idItem;
        const { nama_item, satuan, jumlah, harga_satuan } = req.body;

        const itemRAB = await RincianBiaya.findByPk(idItem);
        if (!itemRAB) {
            return res.status(404).send("Item RAB tidak ditemukan!");
        }

        const jml = parseFloat(jumlah) || 0;
        const harga = parseFloat(harga_satuan) || 0;

        const proker = await Proker.findByPk(itemRAB.prokerId);
        let jumlahBulan = 1;
        if (proker && proker.waktu_pelaksanaan) {
            const bulanArr = proker.waktu_pelaksanaan.split(',').filter(Boolean);
            if (bulanArr.length > 0) jumlahBulan = bulanArr.length;
        }

        const totalBiaya = jml * harga * jumlahBulan;

        await itemRAB.update({
            nama_item: nama_item.trim(),
            satuan: satuan ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: jumlahBulan,
            total: totalBiaya
        });

        const allRAB = await RincianBiaya.findAll({ where: { prokerId: itemRAB.prokerId } });
        const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
        await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: itemRAB.prokerId } });

        res.redirect(`/lembaga-admin/proker/rab/${itemRAB.prokerId}`);
    } catch (err) {
        console.error("Gagal update item RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/rab/hapus/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = req.params.idItem;
        const itemRAB = await RincianBiaya.findByPk(idItem);

        if (!itemRAB) {
            return res.status(404).send("Item rincian biaya tidak ditemukan!");
        }

        const prokerId = itemRAB.prokerId;
        await itemRAB.destroy();

        const allRAB = await RincianBiaya.findAll({ where: { prokerId } });
        const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: prokerId } });

        res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error("Gagal menghapus item RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL KEUANGAN & LAPORAN
// ==========================================
router.get('/anggaran', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ], required: false }
            ]
        });

        res.render('rekap_anggaran', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman rekap anggaran:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/realisasi', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
        let lembagaData;

        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                    { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ], required: false }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ], required: false }
                ]
            });
        }

        res.render('laporan_realisasi', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman laporan realisasi:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/realisasi/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const proker = await Proker.findOne({
            where: { id: prokerId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: Lembaga, as: 'Lembaga' },
                { model: RincianBiaya, as: 'RincianBiayas' },
                { model: RealisasiBiaya, as: 'Realisasis' }
            ]
        });

        if (!proker) {
            req.session.error_msg = "Program kerja tidak ditemukan!";
            return res.redirect('/lembaga-admin/realisasi');
        }

        res.render('manajemen_realisasi', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error("Error halaman kelola realisasi:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/realisasi/tambah/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const userId = req.session.user.id;
        const { uraian_pengeluaran, nominal_realisasi, tanggal_transaksi, keterangan } = req.body;

        if (!uraian_pengeluaran || !nominal_realisasi || !tanggal_transaksi) {
            return res.status(400).send("Uraian pengeluaran, nominal, dan tanggal transaksi wajib diisi!");
        }

        await RealisasiBiaya.create({
            prokerId,
            userId,
            uraian_pengeluaran: uraian_pengeluaran.trim(),
            nominal_realisasi: parseFloat(nominal_realisasi) || 0,
            tanggal_transaksi,
            keterangan: keterangan ? keterangan.trim() : null
        });

        res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error("Gagal menambah realisasi biaya:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/realisasi/hapus/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = req.params.idItem;
        const realisasi = await RealisasiBiaya.findByPk(idItem);

        if (!realisasi) {
            return res.status(404).send("Data realisasi tidak ditemukan!");
        }

        const prokerId = realisasi.prokerId;
        await realisasi.destroy();

        res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error("Gagal menghapus realisasi:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL SETTING LEMBAGA
// ==========================================
router.get('/setting', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const lembaga = await Lembaga.findByPk(lembagaId);

        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        res.render('setting_lembaga', {
            pengaturan,
            userSession: req.session.user,
            lembaga
        });
    } catch (err) {
        console.error("Error halaman setting lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/setting/update', isLoggedIn, isAdminLembaga, upload.single('logo'), async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin/setting');
        }

        lembaga.nama_organisasi = nama_organisasi ? nama_organisasi.trim() : lembaga.nama_organisasi;
        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.nomor_hp = nomor_hp ? nomor_hp.trim() : lembaga.nomor_hp;
        lembaga.alamat = alamat ? alamat.trim() : lembaga.alamat;

        if (req.file) {
            lembaga.logo = req.file.filename;
        }

        await lembaga.save();
        req.session.success_msg = "Profil dan pengaturan lembaga berhasil diperbarui!";
        res.redirect('/lembaga-admin/setting');
    } catch (err) {
        console.error("Gagal memperbarui setting lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL UTILITAS: MANAJEMEN AKUN & KEAMANAN
// ==========================================
router.get('/utilitas/users', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false }
            ]
        });

        res.render('utilitas_users', {
            pengaturan,
            userSession: req.session.user,
            lembaga: lembagaData,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman utilitas users:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/utilitas/users/reset-password/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const { password_baru } = req.body;

        if (!password_baru || password_baru.trim() === '') {
            req.session.error_msg = "Password baru tidak boleh kosong!";
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        const targetUser = await User.findOne({ where: { id: userId, lembagaId: lembagaId } });
        if (!targetUser) {
            req.session.error_msg = "User tidak ditemukan atau di luar wewenang Anda!";
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        targetUser.password = bcrypt.hashSync(password_baru.trim(), 10);
        await targetUser.save();

        req.session.success_msg = `Password untuk akun [${targetUser.username}] berhasil direset!`;
        res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error("Gagal reset password:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/utilitas/users/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = req.params.id;
        const lembagaId = req.session.user.lembagaId;

        if (userId == req.session.user.id) {
            req.session.error_msg = "Anda tidak dapat menghapus akun yang sedang Anda gunakan!";
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        await User.destroy({ where: { id: userId, lembagaId: lembagaId } });
        req.session.success_msg = "Akun pengurus berhasil dihapus dari sistem.";
        res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error("Gagal menghapus user:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

module.exports = router;
