const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker, RincianBiaya, RealisasiBiaya } = require('../models');
const multer = require('multer');
const path = require('path');

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

        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs' },
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers', include: [{ model: Bidang, as: 'Bidang' }] }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang }, required: false },
                    { model: User, as: 'Users', where: { id_bidang: user.id_bidang }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang }, required: false }
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
        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [{ model: Bidang, as: 'Bidangs' }]
        });

        res.render('manajemen_bidang', {
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

        if (!nama_bidang || nama_bidang.trim() === '') {
            return res.status(400).send("Nama bidang wajib diisi!");
        }

        await Bidang.create({
            nama_bidang: nama_bidang.trim(),
            deskripsi_tugas: deskripsi_tugas ? deskripsi_tugas.trim() : null,
            lembagaId
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

        const bidang = await Bidang.findOne({ where: { id: bidangId, lembagaId: lembagaId } });
        if (!bidang) {
            return res.status(404).send("Data bidang tidak ditemukan atau Anda tidak memiliki akses.");
        }

        res.render('edit_bidang', { userSession: req.session.user, bidang });
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

        if (!nama_bidang || nama_bidang.trim() === '') {
            return res.status(400).send("Nama bidang wajib diisi!");
        }

        await Bidang.update({
            nama_bidang: nama_bidang.trim(),
            deskripsi_tugas: deskripsi_tugas ? deskripsi_tugas.trim() : null
        }, {
            where: { id: bidangId, lembagaId: lembagaId }
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

        await Bidang.destroy({ where: { id: bidangId, lembagaId: lembagaId } });
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
        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                { model: Bidang, as: 'Bidangs' }
            ]
        });

        res.render('kelola_pengurus', {
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

        await User.create({
            nama_lengkap: nama_lengkap.trim(),
            username: username.trim(),
            password,
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

        let lembagaData;
        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs' },
                    { model: Proker, as: 'Prokers', include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ]}
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ], required: false }
                ]
            });
        }

        res.render('manajemen_proker', {
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
        const { nama_program, bidangId, deskripsi, waktu_pelaksanaan, status } = req.body;
        const lembagaId = req.session.user.lembagaId;

        if (!nama_program || !bidangId) {
            return res.status(400).send("Nama program dan bidang penanggung jawab wajib diisi!");
        }

        await Proker.create({
            nama_program: nama_program.trim(),
            bidangId,
            lembagaId,
            deskripsi: deskripsi ? deskripsi.trim() : null,
            waktu_pelaksanaan,
            status: status || 'Direncanakan',
            anggaran: 0
        });

        res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal menambah proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/rab/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;

        const proker = await Proker.findByPk(prokerId, {
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
        const { nama_item, satuan, jumlah, harga_satuan, bulan } = req.body;

        if (!nama_item || !jumlah || !harga_satuan) {
            return res.status(400).send("Nama item, volume (jumlah), dan harga satuan wajib diisi!");
        }

        const jml = parseFloat(jumlah) || 0;
        const harga = parseFloat(harga_satuan) || 0;
        const totalBiaya = jml * harga;

        await RincianBiaya.create({
            prokerId,
            nama_item: nama_item.trim(),
            satuan: satuan ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: bulan ? bulan.trim() : '-',
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

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs' },
                { model: Proker, as: 'Prokers', include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ]}
            ]
        });

        res.render('rekap_anggaran', {
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
        let lembagaData;

        if (user.role === 'admin_lembaga') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs' },
                    { model: Proker, as: 'Prokers', include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ]}
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang }, required: false },
                    { model: Proker, as: 'Prokers', where: { bidangId: user.id_bidang }, include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ], required: false }
                ]
            });
        }

        res.render('laporan_realisasi', {
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

        const proker = await Proker.findByPk(prokerId, {
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
        const lembaga = await Lembaga.findByPk(lembagaId);

        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        res.render('setting_lembaga', {
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
        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                { model: Bidang, as: 'Bidangs' }
            ]
        });

        res.render('utilitas_users', {
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

        const bcrypt = require('bcrypt');
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
