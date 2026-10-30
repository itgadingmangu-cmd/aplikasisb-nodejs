const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker, Proposal, RincianBiaya, RealisasiBiaya, Pengaturan } = require('../models');
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
        const lembagaId = user.activeLembagaId || user.lembagaId;
        let lembagaData;

        // Ambil pengaturan global agar tahun aktif selalu sinkron
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026, nama_aplikasi: 'Aplikasi Program Kerja' };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (user.role === 'admin_lembaga' || user.role === 'superadmin') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false, include: [{ model: Proker, as: 'Prokers' }] },
                    { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: User, as: 'Users', where: { id_bidang: user.id_bidang }, required: false, include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        }

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/');
        }

        // Ambil seluruh daftar lembaga untuk dropdown Switch Organization Superadmin di kanan atas
        const listLembaga = await Lembaga.findAll();

        // Ekstraksi variabel agar sesuai dengan yang dipanggil di lembaga_admin.ejs (bidangs, users, prokers)
        const bidangs = lembagaData.Bidangs || [];
        const users = lembagaData.Users || [];
        const prokers = lembagaData.Prokers || [];

        let totalAnggaranLembaga = 0;
        if (prokers.length > 0) {
            totalAnggaranLembaga = prokers.reduce((sum, proker) => {
                return sum + (parseFloat(proker.anggaran) || 0);
            }, 0);
        }

        // --- AMBIL & BERSIHKAN FLASH MESSAGE DARI SESSION ---
        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        res.render('lembaga_admin', {
            title: 'Dashboard Admin Lembaga',
            pengaturan,
            userSession: user,
            lembagaData,
            bidangs,
            users,
            prokers,
            listLembaga, // <-- Sangat penting untuk dropdown Switch Organization di kanan atas
            totalAnggaranLembaga,
            success_msg,
            error_msg
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
router.get('/setting', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        
        // Ambil data lembaga yang sedang aktif
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        // Ambil daftar lembaga untuk switch organization di kanan atas
        const listLembaga = await Lembaga.findAll();

        res.render('setting_lembaga', {
            pengaturan,
            userSession: user,
            lembaga,
            listLembaga
        });
    } catch (err) {
        console.error("Error halaman setting lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// POST Update Setting Lembaga (Termasuk Logo, Kop Surat, Stempel, & TTD)
router.post('/setting/update', isLoggedIn, upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'kop_surat', maxCount: 1 },
    { name: 'stempel', maxCount: 1 },
    { name: 'ttd_ketua', maxCount: 1 },
    { name: 'ttd_pengaju', maxCount: 1 }
]), async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin/setting');
        }

        // Validasi ukuran file (Maksimal 1 MB / 1048576 bytes)
        const maxSize = 1 * 1024 * 1024;
        if (req.files) {
            for (const key in req.files) {
                if (req.files[key][0].size > maxSize) {
                    req.session.error_msg = `Ukuran file ${key} melebihi batas maksimal 1 MB!`;
                    return res.redirect('/lembaga-admin/setting');
                }
            }
        }

        lembaga.nama_organisasi = nama_organisasi ? nama_organisasi.trim() : lembaga.nama_organisasi;
        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.nomor_hp = nomor_hp ? nomor_hp.trim() : lembaga.nomor_hp;
        lembaga.alamat = alamat ? alamat.trim() : lembaga.alamat;

        // Tangkap dan simpan file yang diunggah
        if (req.files && req.files.logo) {
            lembaga.logo = req.files.logo[0].filename;
        }
        if (req.files && req.files.kop_surat) {
            lembaga.kop_surat = req.files.kop_surat[0].filename;
        }
        if (req.files && req.files.stempel) {
            lembaga.stempel = req.files.stempel[0].filename;
        }
        if (req.files && req.files.ttd_ketua) {
            lembaga.ttd_ketua = req.files.ttd_ketua[0].filename;
        }
        if (req.files && req.files.ttd_pengaju) {
            lembaga.ttd_pengaju = req.files.ttd_pengaju[0].filename;
        }

        await lembaga.save();
        req.session.success_msg = "Profil dan pengaturan lembaga berhasil diperbarui!";
        res.redirect('/lembaga-admin/setting');
    } catch (err) {
        console.error("Gagal memperbarui setting lembaga:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// Rute Diagnostik Lembaga & Bidang (Render Langsung Instan Tanpa Redirect)
router.get('/diagnostik/cek', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026, nama_aplikasi: 'Aplikasi Program Kerja' };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (user.role === 'admin_lembaga' || user.role === 'superadmin') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false, include: [{ model: Proker, as: 'Prokers' }] },
                    { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Proker, as: 'Prokers', where: { tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: User, as: 'Users', where: { id_bidang: user.id_bidang }, required: false, include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, include: [{ model: Bidang, as: 'Bidang' }], required: false }
                ]
            });
        }

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        const listLembaga = await Lembaga.findAll();
        const bidangs = lembagaData.Bidangs || [];
        const users = lembagaData.Users || [];
        const prokers = lembagaData.Prokers || [];

        let totalAnggaranLembaga = 0;
        if (prokers.length > 0) {
            totalAnggaranLembaga = prokers.reduce((sum, proker) => {
                return sum + (parseFloat(proker.anggaran) || 0);
            }, 0);
        }

        // Tentukan kalimat pesan hijau secara tegas berdasarkan role/bidang user
        let success_msg = "";
        if (user.id_bidang && bidangs.length > 0) {
            success_msg = `DIAGNOSTIK BIDANG OK: Terhubung ke Bidang ${bidangs[0].nama_bidang}, Tahun Anggaran (${tahunAktifInt}) Berjalan Normal!`;
        } else {
            const totalBidang = bidangs.length;
            const totalAkun = users.length;
            success_msg = `DIAGNOSTIK LEMBAGA OK: Terhubung ke ${lembagaData.nama_organisasi}, Tahun Anggaran (${tahunAktifInt}), Memuat ${totalBidang} Bidang dan ${totalAkun} Akun Pengurus Berjalan Normal!`;
        }

        // Render langsung ke view lembaga_admin dengan membawa pesan sukses hijau secara instan
        return res.render('lembaga_admin', {
            title: 'Dashboard Admin Lembaga',
            pengaturan,
            userSession: user,
            lembagaData,
            bidangs,
            users,
            prokers,
            listLembaga,
            totalAnggaranLembaga,
            success_msg,
            error_msg: null
        });

    } catch (err) {
        console.error("Gagal menjalankan diagnostik:", err);
        req.session.error_msg = "Terjadi kesalahan pada server: " + err.message;
        res.redirect('/lembaga-admin');
    }
});

// Rute Auto-Create atau Ambil Draf Proposal Berdasarkan Proker
router.get('/proker/proposal/:prokerId', isLoggedIn, async (req, res) => {
    try {
        const { prokerId } = req.params;
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;

        // Ambil data Program Kerja beserta relasi Bidang dan RAB/Proker detail
        const proker = await Proker.findOne({
            where: { id: prokerId, lembagaId: lembagaId },
            include: [{ model: Bidang, as: 'Bidang' }]
        });

        if (!proker) {
            req.session.error_msg = "Program Kerja tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        // Cek apakah proposal untuk proker ini sudah pernah dibuat
        let proposal = await Proposal.findOne({ where: { prokerId: proker.id } });

        // Jika belum ada, buat secara otomatis (Auto-Create)
        if (!proposal) {
            proposal = await Proposal.create({
                prokerId: proker.id,
                lembagaId: lembagaId,
                latar_belakang: `Dalam rangka menunjang efektivitas dan pencapaian target kerja operasional pada ${proker.Bidang ? proker.Bidang.nama_bidang : 'lembaga'}, maka diselenggarakan program kerja "${proker.nama_program}". Kegiatan ini dirancang sebagai langkah strategis untuk merealisasikan sasaran program tahunan secara terstruktur.`,
                tujuan: `- Meningkatkan kualitas pelaksanaan program kerja bidang.\n- Memastikan pencapaian target operasional secara optimal.\n- Mempererat koordinasi dan sinergi antar pengurus.`,
                tema: `Optimalisasi Kinerja dan Sinergi Melalui ${proker.nama_program}`,
                status: 'Draft'
            });
        }

        // Ambil data Lembaga untuk informasi Kop Surat, Stempel, & Ketua
        const lembaga = await Lembaga.findByPk(lembagaId);

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        res.render('detail_proposal', {
            userSession: user,
            proker,
            proposal,
            lembaga,
            success_msg,
            error_msg
        });

    } catch (err) {
        console.error("Gagal membuat/membuka proposal:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// Rute Update / Simpan Perubahan Narasi & Pengaturan TTD Proposal
router.post('/proker/proposal/update/:id', isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const { latar_belakang, tujuan, tema, pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6, action } = req.body;

        const proposal = await Proposal.findByPk(id);
        if (!proposal) {
            req.session.error_msg = "Data proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        proposal.latar_belakang = latar_belakang;
        proposal.tujuan = tujuan;
        proposal.tema = tema;
        proposal.pembina_1 = pembina_1 || null;
        proposal.pembina_2 = pembina_2 || null;
        proposal.pembina_3 = pembina_3 || null;
        proposal.pembina_4 = pembina_4 || null;
        proposal.pembina_5 = pembina_5 || null;
        proposal.pembina_6 = pembina_6 || null;

        // Jika tombol ajukan diklik
        if (action === 'submit') {
            proposal.status = 'Diajukan';
            req.session.success_msg = "Proposal berhasil diajukan ke pimpinan lembaga!";
        } else {
            req.session.success_msg = "Perubahan draf proposal berhasil disimpan!";
        }

        await proposal.save();
        res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
    } catch (err) {
        console.error("Gagal menyimpan proposal:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// Rute Daftar Proposal Lembaga (Menu Khusus Proposal)
router.get('/proposal', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        // Ambil semua program kerja pada tahun aktif beserta proposalnya
        const prokers = await Proker.findAll({
            where: { lembagaId: lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: Proposal, as: 'Proposal' }
            ]
        });

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        res.render('list_proposal', {
            userSession: user,
            pengaturan,
            prokers,
            success_msg,
            error_msg
        });

    } catch (err) {
        console.error("Gagal memuat daftar proposal:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});
// Rute Pratinjau Cetak / Print Proposal & RAB Lengkap
router.get('/proker/proposal/print/:id', isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;

        const proposal = await Proposal.findOne({
            where: { id: id, lembagaId: lembagaId },
            include: [
                {
                    model: Proker,
                    as: 'Proker',
                    include: [{ model: Bidang, as: 'Bidang' }]
                },
                { model: Lembaga, as: 'Lembaga' }
            ]
        });

        if (!proposal) {
            req.session.error_msg = "Dokumen proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin/proposal');
        }

        res.render('print_proposal', {
            proposal,
            proker: proposal.Proker,
            lembaga: proposal.Lembaga,
            userSession: user
        });

    } catch (err) {
        console.error("Gagal memuat halaman cetak proposal:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// Rute Pimpinan untuk Approval (Setujui / Revisi Proposal)
router.post('/proker/proposal/approval/:id', isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'Disetujui' atau 'Direvisi'

        const proposal = await Proposal.findByPk(id);
        if (!proposal) {
            req.session.error_msg = "Proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin/proposal');
        }

        proposal.status = status;
        await proposal.save();

        req.session.success_msg = `Status proposal berhasil diperbarui menjadi: ${status}`;
        res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
    } catch (err) {
        console.error("Gagal memperbarui status approval:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL UTILITAS: MANAJEMEN AKUN & KEAMANAN
// ==========================================
router.get('/utilitas/users', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false }
            ]
        });

        // Ambil daftar seluruh lembaga untuk switch organization di kanan atas
        const listLembaga = await Lembaga.findAll();

        res.render('utilitas_users', {
            pengaturan,
            userSession: user,
            lembaga: lembagaData,
            lembagaData,
            listLembaga
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
