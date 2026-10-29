const express = require('express');
const router = express.Router();
// Disempurnakan: Menambahkan RincianBiaya ke dalam daftar impor model
const { User, Lembaga, Bidang, Proker, RincianBiaya, RealisasiBiaya } = require('../models');
// Memanggil middleware autentikasi yang sudah dibuat
const { isLoggedIn, isAdminLembaga } = require('../middleware/auth');

// --- RUTE HALAMAN UTAMA / DASHBOARD DINAMIS (/lembaga-admin) ---
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.lembagaId;
        let lembagaData;

        // Logika akses dinamis berdasarkan role user
        if (user.role === 'admin_lembaga') {
            // Jika Admin Lembaga, tampilkan seluruh data dalam lembaga tersebut
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs' },
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers', include: [{ model: Bidang, as: 'Bidang' }] }
                ]
            });
        } else {
            // Jika Pengurus Bidang, saring data agar hanya fokus pada bidang miliknya sendiri
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

        // Hitung total anggaran secara otomatis dari proker yang tampil
        let totalAnggaranLembaga = 0;
        if (lembagaData.Prokers && lembagaData.Prokers.length > 0) {
            totalAnggaranLembaga = lembagaData.Prokers.reduce((sum, proker) => {
                return sum + (parseFloat(proker.anggaran) || 0);
            }, 0);
        }

        // Render view dengan mengirimkan status user session dan data lembaga
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
// MODUL MANAJEMEN BIDANG & TUGAS (LAYOUT 2 KOLOM)
// ==========================================

// --- RUTE HALAMAN KELOLA & DAFTAR BIDANG ---
router.get('/bidang', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        
        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs' }
            ]
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

// --- RUTE PROSES SIMPAN BIDANG BARU ---
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

// --- RUTE HALAMAN FORM EDIT BIDANG ---
router.get('/bidang/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;

        const bidang = await Bidang.findOne({
            where: { id: bidangId, lembagaId: lembagaId }
        });

        if (!bidang) {
            return res.status(404).send("Data bidang tidak ditemukan atau Anda tidak memiliki akses.");
        }

        res.render('edit_bidang', { 
            userSession: req.session.user,
            bidang 
        });
    } catch (err) {
        console.error("Error ambil data edit bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE PROSES UPDATE BIDANG ---
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

// --- RUTE HAPUS BIDANG ---
router.get('/bidang/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;

        await Bidang.destroy({
            where: { id: bidangId, lembagaId: lembagaId }
        });

        res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal menghapus bidang:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL MANAJEMEN PENGURUS & HIERARKI JABATAN
// ==========================================

// --- RUTE HALAMAN KELOLA & DAFTAR PENGURUS ---
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

// --- RUTE PROSES SIMPAN PENGURUS BARU ---
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

// --- RUTE HALAMAN KELOLA PROGRAM KERJA ---
router.get('/proker', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const user = req.session.user;

        // Ambil data lembaga, list bidang, dan list proker beserta rincian biayanya
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
            // Jika pengurus bidang, batasi hanya bidang miliknya
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

// --- RUTE PROSES SIMPAN PROGRAM KERJA BARU ---
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
            anggaran: 0 // Akan dihitung dari rincian RAB
        });

        res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal menambah proker:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE HALAMAN KELOLA RAB / RINCIAN BIAYA PROKER ---
router.get('/proker/rab/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const user = req.session.user;

        // Ambil data proker beserta bidang, lembaga, dan rincian biayanya
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

// --- RUTE PROSES TAMBAH ITEM RAB ---
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

        // Simpan item rincian biaya baru
        await RincianBiaya.create({
            prokerId,
            nama_item: nama_item.trim(),
            satuan: satuan ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: bulan ? bulan.trim() : '-',
            total: totalBiaya
        });

        // Hitung ulang total anggaran di tabel Proker secara otomatis
        const allRAB = await RincianBiaya.findAll({ where: { prokerId } });
        const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: prokerId } });

        res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error("Gagal menambah item RAB:", err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE HAPUS ITEM RAB ---
router.get('/proker/rab/hapus/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = req.params.idItem;
        const itemRAB = await RincianBiaya.findByPk(idItem);

        if (!itemRAB) {
            return res.status(404).send("Item rincian biaya tidak ditemukan!");
        }

        const prokerId = itemRAB.prokerId;
        await itemRAB.destroy();

        // Hitung ulang total anggaran proker setelah item dihapus
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
// MODUL KEUANGAN & LAPORAN (REKAPITULASI)
// ==========================================

// --- RUTE HALAMAN REKAPITULASI RINCIAN ANGGARAN (KEUANGAN) ---
router.get('/anggaran', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.lembagaId;
        const user = req.session.user;

        // Ambil data lembaga beserta seluruh bidang, proker, dan rincian biayanya
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

// ==========================================
// MODUL LAPORAN REALISASI ANGGARAN (BERJENJANG)
// ==========================================

router.get('/realisasi', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.lembagaId;
        let lembagaData;

        // Logika Berjenjang Berdasarkan Role:
        if (user.role === 'admin_lembaga') {
            // Admin Lembaga melihat seluruh realisasi dari semua bidang
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
            // Pengurus Bidang HANYA melihat proker dan realisasi di bidang miliknya
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

// ==========================================
// MODUL KELOLA REALISASI BIAYA PER PROKER
// ==========================================

// --- RUTE HALAMAN KELOLA REALISASI BIAYA ---
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

// --- RUTE PROSES TAMBAH REALISASI BIAYA ---
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

// --- RUTE HAPUS REALISASI BIAYA ---
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

module.exports = router;
