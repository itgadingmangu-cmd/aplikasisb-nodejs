const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const { Op } = require('sequelize');
const { User, Lembaga, Pengaturan, SiklusTahun, Bidang, Proker, RincianBiaya, RealisasiBiaya, sequelize } = require('./models');

// IMPORT ROUTER PROKER, ADMIN LEMBAGA, & SUPERADMIN
const prokerRoutes = require('./routes/proker');
const lembagaAdminRoutes = require('./routes/lembagaAdmin');
const superadminRoutes = require('./routes/superadmin');

const app = express();

// --- KONFIGURASI EXPRESS ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'rahasia-proker-senkom-2026',
    resave: false,
    saveUninitialized: false
}));

// --- KONFIGURASI MULTER UNTUK UPLOAD ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/logo/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- MIDDLEWARE FLASH MESSAGE & GLOBAL SETTING ---
app.use(async (req, res, next) => {
    res.locals.success_msg = req.session.success_msg || null;
    res.locals.error_msg = req.session.error_msg || null;
    delete req.session.success_msg;
    delete req.session.error_msg;

    try {
        let globalSetting = await Pengaturan.findOne();
        if (!globalSetting) {
            globalSetting = await Pengaturan.create({ 
                nama_aplikasi: 'Aplikasi Program Kerja', 
                tahun_aktif: 2026 
            });
        }
        res.locals.globalSetting = globalSetting;
    } catch (e) {
        res.locals.globalSetting = { nama_aplikasi: 'Aplikasi Program Kerja', logo_aplikasi: null };
    }

    next();
});

// --- MIDDLEWARE AUTENTIKASI & HAK AKSES ---
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
}

function isSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'superadmin') return next();
    res.status(403).send("Akses ditolak: Halaman ini khusus untuk Superadmin!");
}

// --- RUTE HALAMAN UTAMA (DASHBOARD SUPERADMIN) ---
app.get('/', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        let pengaturan = await Pengaturan.findOne();
        if (!pengaturan) {
            pengaturan = await Pengaturan.create({ nama_aplikasi: 'Aplikasi Program Kerja', tahun_aktif: 2026 });
        }

        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
        const tahunAktifStr = String(tahunAktifInt);

        let currentSiklus = await SiklusTahun.findOne({ where: { tahun: tahunAktifStr } });
        if (!currentSiklus) {
            await SiklusTahun.create({ tahun: tahunAktifStr, status: 'Aktif' });
        }
        
        const countLembaga = await Lembaga.count();
        const countUser = await User.count({
            where: {
                role: { [Op.in]: ['superadmin', 'admin_lembaga'] }
            }
        });
        const countSiklus = await SiklusTahun.count();
        
        let dbStatus = 'Terhubung & Normal';
        try {
            await sequelize.authenticate();
        } catch (e) {
            dbStatus = 'Error Koneksi';
        }

        const systemHealth = {
            database: dbStatus,
            totalLembaga: countLembaga,
            totalUser: countUser,
            totalSiklus: countSiklus,
            statusServer: 'Online'
        };

        // KUNCI UTAMA: Ambil Lembaga beserta Bidang yang terfilter murni berdasarkan tahun aktif
        const rawListLembaga = await Lembaga.findAll({
            include: [{ 
                model: Bidang, 
                as: 'Bidangs',
                where: { tahun: tahunAktifInt },
                required: false 
            }]
        });

        const listLembaga = rawListLembaga.map(lembaga => {
            const plainLembaga = lembaga.toJSON();
            const jumlahBidang = plainLembaga.Bidangs ? plainLembaga.Bidangs.length : 0;
            
            if (jumlahBidang > 0) {
                plainLembaga.statusKelengkapan = 'Lengkap';
                plainLembaga.badgeClass = 'bg-success';
                plainLembaga.keteranganStatus = `${jumlahBidang} Bidang Terdaftar (${tahunAktifInt})`;
            } else {
                plainLembaga.statusKelengkapan = 'Belum Lengkap';
                plainLembaga.badgeClass = 'bg-warning text-dark';
                plainLembaga.keteranganStatus = `Belum ada bidang untuk ${tahunAktifInt}`;
            }
            return plainLembaga;
        });

        const dataUser = await User.findAll({ 
            where: {
                role: { [Op.in]: ['superadmin', 'admin_lembaga'] }
            },
            include: [{ model: Lembaga, as: 'Lembaga' }],
            order: [['createdAt', 'DESC']]
        });
        
        const siklusList = await SiklusTahun.findAll({ order: [['tahun', 'DESC']] });
        const listTahun = siklusList.map(s => String(s.tahun));

        let totalBidangGlobal = 0;
        rawListLembaga.forEach(l => {
            if (l.Bidangs) totalBidangGlobal += l.Bidangs.length;
        });

        res.render('index', { 
            pengaturan, 
            listLembaga,
            dataUser,
            listTahun,
            systemHealth, 
            totalBidangGlobal,
            userSession: req.session.user 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE DETAIL / MONITORING LEMBAGA (SUPERADMIN) ---
app.get('/lembaga/detail/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        let pengaturan = await Pengaturan.findOne();
        if (!pengaturan) {
            pengaturan = await Pengaturan.create({ nama_aplikasi: 'Aplikasi Program Kerja', tahun_aktif: 2026 });
        }
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembaga = await Lembaga.findByPk(id, {
            include: [{ 
                model: Bidang, 
                as: 'Bidangs',
                where: { tahun: tahunAktifInt },
                required: false 
            }]
        });

        if (!lembaga) {
            req.session.error_msg = "Lembaga tidak ditemukan!";
            return res.redirect('/');
        }

        res.render('lembaga_detail', {
            pengaturan,
            lembaga,
            userSession: req.session.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE TES DIAGNOSTIK MODUL SISTEM ---
app.get('/diagnostik/cek', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        await sequelize.authenticate();
        const jmlLembaga = await Lembaga.count();
        const jmlUser = await User.count({ where: { role: { [Op.in]: ['superadmin', 'admin_lembaga'] } } });
        const jmlPengaturan = await Pengaturan.count();
        const jmlSiklus = await SiklusTahun.count();

        req.session.success_msg = `DIAGNOSTIK SYSTEM OK: Database Terhubung, Modul Lembaga (${jmlLembaga}), Admin RBAC (${jmlUser}), Pengaturan Global (${jmlPengaturan}), dan Siklus TA (${jmlSiklus} Arsip) Berjalan Normal!`;
        res.redirect('/');
    } catch (err) {
        req.session.error_msg = "DIAGNOSTIK GAGAL: Terkendala pada koneksi database atau tabel modul. Detail: " + err.message;
        res.redirect('/');
    }
});

// --- RUTE AUTH ---
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.role === 'superadmin' ? '/' : '/lembaga-admin');
    }
    res.render('login');
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });

        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = {
                id: user.id,
                nama_lengkap: user.nama_lengkap,
                username: user.username,
                role: user.role,          
                lembagaId: user.lembagaId,
                id_bidang: user.id_bidang || null
            };
            return res.redirect(user.role === 'superadmin' ? '/' : '/lembaga-admin');
        } else {
            req.session.error_msg = "Username atau password salah!";
            res.redirect('/login');
        }
    } catch (err) {
        res.status(500).send("Terjadi kesalahan: " + err.message);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// --- MANAJEMEN LEMBAGA (SUPERADMIN) ---
app.post('/lembaga/tambah', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
        const logo = req.file ? req.file.filename : null;
        await Lembaga.create({ nama_organisasi, nama_ketua, nomor_hp, alamat, logo });
        req.session.success_msg = "Lembaga berhasil ditambahkan!";
        res.redirect('/');
    } catch (err) {
        req.session.error_msg = "Gagal menambah lembaga: " + err.message;
        res.redirect('/');
    }
});

app.post('/lembaga/edit/:id', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
        let lembaga = await Lembaga.findByPk(id);
        if (!lembaga) return res.status(404).send("Lembaga tidak ditemukan");

        lembaga.nama_organisasi = nama_organisasi;
        lembaga.nama_ketua = nama_ketua;
        lembaga.nomor_hp = nomor_hp;
        lembaga.alamat = alamat;
        if (req.file) lembaga.logo = req.file.filename;

        await lembaga.save();
        req.session.success_msg = "Data lembaga berhasil diperbarui!";
        res.redirect('/');
    } catch (err) {
        req.session.error_msg = "Gagal memperbarui lembaga: " + err.message;
        res.redirect('/');
    }
});

// --- MANAJEMEN BIDANG OLEH SUPERADMIN ---
app.post('/bidang/tambah', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { nama_bidang, lembagaId } = req.body;
        let pengaturan = await Pengaturan.findOne();
        const tahunAktif = pengaturan ? pengaturan.tahun_aktif : 2026;

        await Bidang.create({ 
            nama_bidang, 
            lembagaId,
            tahun: tahunAktif 
        });
        req.session.success_msg = "Bidang baru berhasil ditambahkan!";
        const referer = req.get('Referer') || '/';
        res.redirect(referer);
    } catch (err) {
        req.session.error_msg = "Gagal menambah bidang: " + err.message;
        res.redirect('/');
    }
});

// --- MANAJEMEN USER ---
app.post('/user/tambah', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { nama_lengkap, username, password, role, lembagaId } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);
        const validRole = (role === 'superadmin') ? 'superadmin' : 'admin_lembaga';

        await User.create({ 
            nama_lengkap, 
            username, 
            password: hashedPassword, 
            role: validRole,
            lembagaId: validRole === 'admin_lembaga' ? (lembagaId || null) : null,
            id_bidang: null 
        });
        req.session.success_msg = "Akun Admin berhasil ditambahkan!";
        res.redirect('/');
    } catch (err) {
        req.session.error_msg = "Gagal menambah user: " + err.message;
        res.redirect('/');
    }
});

app.post('/user/edit/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nama_lengkap, username, password, role, lembagaId } = req.body;
        let user = await User.findByPk(id);
        if (!user) return res.status(404).send("User tidak ditemukan");

        const validRole = (role === 'superadmin') ? 'superadmin' : 'admin_lembaga';

        user.nama_lengkap = nama_lengkap;
        user.username = username;
        user.role = validRole;
        user.lembagaId = validRole === 'admin_lembaga' ? (lembagaId || null) : null;
        user.id_bidang = null;
        
        if (password && password.trim() !== "") {
            user.password = bcrypt.hashSync(password, 10);
        }
        await user.save();
        req.session.success_msg = "Data Admin berhasil diperbarui!";
        res.redirect('/');
    } catch (err) {
        req.session.error_msg = "Gagal mengupdate user: " + err.message;
        res.redirect('/');
    }
});

// --- PENGATURAN GLOBAL & SIKLUS TAHUN (ISOLASI TAHUN & ANTI-DUPLIKASI MUTLAK) ---
app.post('/pengaturan', isAuthenticated, isSuperAdmin, upload.single('logo_aplikasi'), async (req, res) => {
    try {
        const { nama_aplikasi, tahun_aktif } = req.body;
        const tahunInt = parseInt(tahun_aktif, 10);
        const tahunBaruStr = String(tahunInt);

        let pengaturan = await Pengaturan.findOne();
        if (pengaturan) {
            pengaturan.nama_aplikasi = nama_aplikasi;
            pengaturan.tahun_aktif = tahunInt;
            if (req.file) {
                pengaturan.logo_aplikasi = req.file.filename;
            }
            await pengaturan.save();
        } else {
            const logoFilename = req.file ? req.file.filename : null;
            await Pengaturan.create({ 
                nama_aplikasi, 
                tahun_aktif: tahunInt, 
                logo_aplikasi: logoFilename 
            });
        }

        let [siklus, created] = await SiklusTahun.findOrCreate({
            where: { tahun: tahunBaruStr },
            defaults: { status: 'Aktif' }
        });

        // 🔍 CEK ISOLASI TAHUN: Apakah tahun target ini sudah memiliki data bidang sebelumnya?
        const totalBidangTahunIni = await Bidang.count({ where: { tahun: tahunInt } });

        // KLONING HANYA JIKA BELUM ADA DATA SAMA SEKALI PADA TAHUN TERSEBUT
        if (totalBidangTahunIni === 0) {
            // Cari data acuan dari tahun sebelumnya atau fallback ke 2026
            let tahunAcuan = tahunInt - 1;
            let listBidangAcuan = await Bidang.findAll({
                where: { tahun: tahunAcuan },
                include: [{ model: Proker, as: 'Prokers' }]
            });

            if (listBidangAcuan.length === 0) {
                listBidangAcuan = await Bidang.findAll({
                    where: { tahun: 2026 },
                    include: [{ model: Proker, as: 'Prokers' }]
                });
            }

            for (let bidangLama of listBidangAcuan) {
                const bidangBaru = await Bidang.create({
                    nama_bidang: bidangLama.nama_bidang,
                    deskripsi_tugas: bidangLama.deskripsi_tugas,
                    lembagaId: bidangLama.lembagaId,
                    tahun: tahunInt // <-- Disematkan tahun aktif baru
                });

                if (bidangLama.Prokers && bidangLama.Prokers.length > 0) {
                    for (let prokerLama of bidangLama.Prokers) {
                        await Proker.create({
                            nama_program: prokerLama.nama_program,
                            deskripsi: prokerLama.deskripsi,
                            waktu_pelaksanaan: prokerLama.waktu_pelaksanaan,
                            status: 'Direncanakan',
                            anggaran: 0, // <-- Anggaran bersih dipaksa 0
                            lembagaId: prokerLama.lembagaId,
                            bidangId: bidangBaru.id,
                            tahun: tahunInt // <-- Disematkan tahun aktif baru
                        });
                    }
                }
            }
        }

        await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
        siklus.status = 'Aktif';
        await siklus.save();

        req.session.success_msg = `Tahun Anggaran ${tahunInt} berhasil diaktifkan dengan isolasi data mandiri!`;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Gagal menyimpan pengaturan: " + err.message;
        res.redirect('/');
    }
});

app.get('/siklus-ta/pilih/:tahun', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const targetTahunInt = parseInt(req.params.tahun, 10);
        const targetTahunStr = String(targetTahunInt);

        let pengaturan = await Pengaturan.findOne();
        if (pengaturan) {
            pengaturan.tahun_aktif = targetTahunInt;
            await pengaturan.save();
        }

        await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
        await SiklusTahun.update({ status: 'Aktif' }, { where: { tahun: targetTahunStr } });

        req.session.success_msg = `Berhasil beralih ke Tahun Anggaran ${targetTahunInt}`;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Gagal beralih tahun: " + err.message;
        res.redirect('/');
    }
});

app.get('/lembaga/dashboard', isAuthenticated, (req, res) => {
    res.redirect('/lembaga-admin');
});

// --- DAFTARKAN RUTE MODUL APLIKASI ---
app.use('/proker', isAuthenticated, prokerRoutes);
app.use('/lembaga-admin', isAuthenticated, lembagaAdminRoutes);
app.use('/superadmin', isAuthenticated, isSuperAdmin, superadminRoutes);

async function createSuperUser() {
    try {
        const superadminUsername = 'superadmin';
        const adminExists = await User.findOne({ where: { username: superadminUsername } });
        if (!adminExists) {
            const hashedPassword = bcrypt.hashSync('B31i72sA', 10);
            await User.create({
                nama_lengkap: 'Super Administrator',
                username: superadminUsername,
                password: hashedPassword,
                role: 'superadmin',
                lembagaId: null
            });
            console.log('Akun Superuser berhasil dibuat.');
        }
    } catch (err) {
        console.error(err);
    }
}

app.get('/siklus-ta/hapus/:tahun', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const tahunTarget = req.params.tahun;
        let pengaturan = await Pengaturan.findOne();
        if (pengaturan && String(pengaturan.tahun_aktif) === tahunTarget) {
            req.session.error_msg = `Tidak dapat menghapus Tahun Anggaran ${tahunTarget} karena sedang aktif digunakan! Pindahkan dulu tahun aktif ke tahun lain.`;
            return res.redirect('/');
        }

        await SiklusTahun.destroy({ where: { tahun: tahunTarget } });
        // Opsional: Hapus data bidang/proker yang terikat pada tahun tersebut agar bersih total
        await Bidang.destroy({ where: { tahun: parseInt(tahunTarget, 10) } });
        await Proker.destroy({ where: { tahun: parseInt(tahunTarget, 10) } });

        req.session.success_msg = `Arsip dan data terkait Tahun Anggaran ${tahunTarget} berhasil dibersihkan dari sistem.`;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Gagal menghapus tahun anggaran: " + err.message;
        res.redirect('/');
    }
});

// --- SINKRONISASI / BUAT TAHUN ANGGARAN BARU MANUAL ---
app.post('/siklus-ta/sinkronisasi', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { tahun_target } = req.body;
        const tahunInt = parseInt(tahun_target, 10);
        const tahunBaruStr = String(tahunInt);

        if (!tahunInt || isNaN(tahunInt)) {
            req.session.error_msg = "Tahun anggaran tidak valid!";
            return res.redirect('/');
        }

        // Pastikan siklus tahun tercatat
        let [siklus, created] = await SiklusTahun.findOrCreate({
            where: { tahun: tahunBaruStr },
            defaults: { status: 'Arsip' }
        });

        // Cek apakah data untuk tahun ini sudah ada
        const totalBidangTahunIni = await Bidang.count({ where: { tahun: tahunInt } });

        if (totalBidangTahunIni === 0) {
            // Ambil acuan dari tahun sebelumnya atau fallback ke 2026
            let tahunAcuan = tahunInt - 1;
            let listBidangAcuan = await Bidang.findAll({
                where: { tahun: tahunAcuan },
                include: [{ model: Proker, as: 'Prokers' }]
            });

            if (listBidangAcuan.length === 0) {
                listBidangAcuan = await Bidang.findAll({
                    where: { tahun: 2026 },
                    include: [{ model: Proker, as: 'Prokers' }]
                });
            }

            for (let bidangLama of listBidangAcuan) {
                const bidangBaru = await Bidang.create({
                    nama_bidang: bidangLama.nama_bidang,
                    deskripsi_tugas: bidangLama.deskripsi_tugas,
                    lembagaId: bidangLama.lembagaId,
                    tahun: tahunInt
                });

                if (bidangLama.Prokers && bidangLama.Prokers.length > 0) {
                    for (let prokerLama of bidangLama.Prokers) {
                        await Proker.create({
                            nama_program: prokerLama.nama_program,
                            deskripsi: prokerLama.deskripsi,
                            waktu_pelaksanaan: prokerLama.waktu_pelaksanaan,
                            status: 'Direncanakan',
                            anggaran: 0, // Anggaran bersih otomatis 0
                            lembagaId: prokerLama.lembagaId,
                            bidangId: bidangBaru.id,
                            tahun: tahunInt
                        });
                    }
                }
            }
            req.session.success_msg = `Tahun Anggaran ${tahunInt} berhasil disinkronkan dan dikloning dengan struktur bersih!`;
        } else {
            req.session.success_msg = `Tahun Anggaran ${tahunInt} sudah memiliki data sebelumnya (tidak ada duplikasi ganda).`;
        }

        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = "Gagal menyinkronkan tahun anggaran: " + err.message;
        res.redirect('/');
    }
});

// --- MENJALANKAN SERVER & SINKRONISASI DATABASE OTOMATIS ---
const PORT = 3000;
sequelize.sync({ alter: true }).then(async () => {
    console.log('Database & tabel berhasil disinkronkan.');
    await createSuperUser();
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Gagal sinkronisasi database:', err);
});
