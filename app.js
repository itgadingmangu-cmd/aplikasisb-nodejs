'use strict';
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Op } = require('sequelize');
const {
    User, Lembaga, Pengaturan, SiklusTahun, Bidang,
    Proker, RincianBiaya, RealisasiBiaya, sequelize
} = require('./models');

// IMPORT ROUTER PROKER, ADMIN LEMBAGA, & SUPERADMIN
const prokerRoutes = require('./routes/proker');
const lembagaAdminRoutes = require('./routes/lembagaAdmin');
const superadminRoutes = require('./routes/superadmin');

const app = express();

// --- KONSTANTA & HELPER VALIDASI KETAT ---
const DEFAULT_SETTING = Object.freeze({
    nama_aplikasi: 'Aplikasi Program Kerja',
    logo_aplikasi: null,
    tahun_aktif: 2026
});

const USER_SAFE_ATTRIBUTES = {
    exclude: ['password']
};

const LEMBAGA_LIGHT_ATTRIBUTES = {
    exclude: ['kop_surat', 'stempel', 'ttd_ketua', 'ttd_pengaju', 'ttd_pembina_senkom']
};

function parsePositiveInt(val) {
    const num = parseInt(val, 10);
    return Number.isInteger(num) && num > 0 ? num : null;
}

function getTahunAktifInt(pengaturan) {
    const parsed = parseInt(pengaturan && pengaturan.tahun_aktif, 10);
    return Number.isInteger(parsed) && parsed >= 2000 ? parsed : 2026;
}

// --- IN-MEMORY CACHE DENGAN STALE FALLBACK ---
let cachedGlobalSetting = null;
let cachedGlobalSettingAt = 0;
const GLOBAL_SETTING_TTL_MS = 30 * 1000;

async function getCachedGlobalSetting(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedGlobalSetting && (now - cachedGlobalSettingAt) < GLOBAL_SETTING_TTL_MS) {
        return cachedGlobalSetting;
    }

    try {
        let setting = await Pengaturan.findOne({
            attributes: [
                'id', 'nama_aplikasi', 'logo_icon', 'logo_aplikasi',
                'step1_judul', 'step1_deskripsi', 'step2_judul', 'step2_deskripsi',
                'step3_judul', 'step3_deskripsi', 'step4_judul', 'step4_deskripsi',
                'tahun_aktif'
            ]
        });

        if (!setting) {
            setting = await Pengaturan.create({
                nama_aplikasi: DEFAULT_SETTING.nama_aplikasi,
                tahun_aktif: DEFAULT_SETTING.tahun_aktif
            });
        }

        cachedGlobalSetting = setting;
        cachedGlobalSettingAt = now;
        return setting;
    } catch (err) {
        console.error('[CACHE-WARN] Gagal memuat Pengaturan (kemungkinan EAI_AGAIN/koneksi):', err.message);
        if (cachedGlobalSetting) {
            return cachedGlobalSetting;
        }
        return { ...DEFAULT_SETTING };
    }
}

function invalidateGlobalSettingCache() {
    cachedGlobalSetting = null;
    cachedGlobalSettingAt = 0;
}

const loginLembagaCache = new Map();
const LOGIN_LEMBAGA_TTL_MS = 60 * 1000;

async function getCachedLoginLembaga(subdomain) {
    const now = Date.now();
    const entry = loginLembagaCache.get(subdomain);
    if (entry && (now - entry.at) < LOGIN_LEMBAGA_TTL_MS) {
        return entry.data;
    }

    try {
        const lembaga = await Lembaga.findOne({
            attributes: ['id', 'nama_organisasi', 'logo'],
            where: {
                nama_organisasi: {
                    [Op.iLike]: `%${subdomain}%`
                }
            }
        });
        loginLembagaCache.set(subdomain, { data: lembaga, at: now });
        return lembaga;
    } catch (err) {
        console.error(`[CACHE-WARN] Gagal lookup subdomain "${subdomain}":`, err.message);
        if (entry) {
            return entry.data;
        }
        return null;
    }
}

function invalidateLoginLembagaCache() {
    loginLembagaCache.clear();
}

// --- KONFIGURASI EXPRESS ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true);

app.use(session({
    secret: process.env.SESSION_SECRET || 'rahasia-proker-senkom-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12
    }
}));

// --- KONFIGURASI MULTER UNTUK UPLOAD ---
const uploadLogoDir = path.join(__dirname, 'public/uploads/logo');
if (!fs.existsSync(uploadLogoDir)) {
    fs.mkdirSync(uploadLogoDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadLogoDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
        cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 512 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp|svg/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Format file gambar tidak valid (hanya JPG, PNG, WEBP, SVG).'));
    }
});

// --- HELPER CAPTCHA & VALIDASI PASSWORD KUAT ---
function generateLoginCaptcha() {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    const isMinus = a > b && Math.random() < 0.4;
    const question = isMinus ? `${a} - ${b} = ?` : `${a} + ${b} = ?`;
    const answer = String(isMinus ? a - b : a + b);
    return { question, answer };
}

function validateStrongPassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        return 'Password minimal 8 karakter.';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password harus mengandung minimal 1 huruf besar (A-Z).';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password harus mengandung minimal 1 huruf kecil (a-z).';
    }
    if (!/[0-9]/.test(password)) {
        return 'Password harus mengandung minimal 1 angka (0-9).';
    }
    return null;
}

// --- MIDDLEWARE FLASH MESSAGE & GLOBAL SETTING ---
app.use(async (req, res, next) => {
    res.locals.success_msg = req.session.success_msg || null;
    res.locals.error_msg = req.session.error_msg || null;
    delete req.session.success_msg;
    delete req.session.error_msg;

    res.locals.globalSetting = await getCachedGlobalSetting();
    next();
});

// --- MIDDLEWARE AUTENTIKASI & HAK AKSES ---
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) return next();
    return res.redirect('/login');
}

function isSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'superadmin') return next();
    return res.status(403).send('Akses ditolak: Halaman ini khusus untuk Superadmin!');
}

// --- RUTE SWITCH / PILIH LEMBAGA AKTIF UNTUK SUPERADMIN ---
app.get('/superadmin/pilih-lembaga/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const targetLembagaId = parsePositiveInt(req.params.id);
        if (!targetLembagaId) {
            req.session.error_msg = 'ID lembaga tidak valid!';
            return res.redirect('/');
        }

        const lembagaTarget = await Lembaga.findByPk(targetLembagaId, {
            attributes: ['id', 'nama_organisasi']
        });

        if (!lembagaTarget) {
            req.session.error_msg = 'Lembaga tidak ditemukan!';
            return res.redirect('/');
        }

        req.session.user.activeLembagaId = targetLembagaId;
        req.session.user.lembagaId = targetLembagaId;

        req.session.success_msg = `Berhasil beralih ke panel operasional: ${lembagaTarget.nama_organisasi}`;
        return res.redirect('/lembaga-admin');
    } catch (err) {
        console.error(err);
        req.session.error_msg = 'Gagal beralih lembaga: ' + err.message;
        return res.redirect('/');
    }
});

// --- RUTE HALAMAN UTAMA (DASHBOARD SUPERADMIN) ---
app.get('/', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const pengaturan = await getCachedGlobalSetting();
        const tahunAktifInt = getTahunAktifInt(pengaturan);
        const tahunAktifStr = String(tahunAktifInt);

        let dbStatus = 'Terhubung & Normal';
        try {
            await sequelize.authenticate();
        } catch (e) {
            dbStatus = 'Gangguan Koneksi / DNS';
        }

        await SiklusTahun.findOrCreate({
            where: { tahun: tahunAktifStr },
            defaults: { status: 'Aktif' }
        }).catch(() => {});

        const [
            countLembaga,
            countUser,
            countSiklus,
            rawListLembaga,
            dataUser,
            siklusList
        ] = await Promise.all([
            Lembaga.count(),
            User.count({ where: { role: { [Op.in]: ['superadmin', 'admin_lembaga'] } } }),
            SiklusTahun.count(),
            Lembaga.findAll({
                attributes: LEMBAGA_LIGHT_ATTRIBUTES,
                include: [{
                    model: Bidang,
                    as: 'Bidangs',
                    attributes: ['id', 'nama_bidang', 'lembagaId', 'tahun'],
                    where: { tahun: tahunAktifInt },
                    required: false
                }],
                order: [['id', 'ASC']]
            }),
            User.findAll({
                where: { role: { [Op.in]: ['superadmin', 'admin_lembaga'] } },
                attributes: USER_SAFE_ATTRIBUTES,
                include: [{ model: Lembaga, as: 'Lembaga', attributes: ['id', 'nama_organisasi'] }],
                order: [['createdAt', 'DESC']]
            }),
            SiklusTahun.findAll({ order: [['tahun', 'DESC']] })
        ]);

        const systemHealth = {
            database: dbStatus,
            totalLembaga: countLembaga,
            totalUser: countUser,
            totalSiklus: countSiklus,
            statusServer: 'Online'
        };

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

        const activeLembagaId = parsePositiveInt(req.session.user.activeLembagaId)
            || (listLembaga.length > 0 ? listLembaga[0].id : null);

        let selectedLembaga = null;
        if (activeLembagaId) {
            selectedLembaga = await Lembaga.findByPk(activeLembagaId, {
                attributes: LEMBAGA_LIGHT_ATTRIBUTES,
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                    {
                        model: Proker,
                        as: 'Prokers',
                        where: { tahun: tahunAktifInt },
                        include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }],
                        required: false
                    }
                ]
            });
        }

        const listTahun = siklusList.map(s => String(s.tahun));

        let totalBidangGlobal = 0;
        for (const l of rawListLembaga) {
            if (l.Bidangs) totalBidangGlobal += l.Bidangs.length;
        }

        return res.render('index', {
            pengaturan,
            listLembaga,
            selectedLembaga,
            activeLembagaId,
            dataUser,
            listTahun,
            systemHealth,
            totalBidangGlobal,
            userSession: req.session.user
        });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE DETAIL / MONITORING LEMBAGA (SUPERADMIN) ---
app.get('/lembaga/detail/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) {
            return res.redirect('/');
        }

        const pengaturan = await getCachedGlobalSetting();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const lembaga = await Lembaga.findByPk(id, {
            attributes: LEMBAGA_LIGHT_ATTRIBUTES,
            include: [{
                model: Bidang,
                as: 'Bidangs',
                where: { tahun: tahunAktifInt },
                required: false
            }]
        });

        if (!lembaga) {
            req.session.error_msg = 'Lembaga tidak ditemukan!';
            return res.redirect('/');
        }

        return res.render('lembaga_detail', {
            pengaturan,
            lembaga,
            userSession: req.session.user
        });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE TES DIAGNOSTIK MODUL SISTEM ---
app.get('/diagnostik/cek', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        await sequelize.authenticate();
        const [jmlLembaga, jmlUser, jmlPengaturan, jmlSiklus] = await Promise.all([
            Lembaga.count(),
            User.count({ where: { role: { [Op.in]: ['superadmin', 'admin_lembaga'] } } }),
            Pengaturan.count(),
            SiklusTahun.count()
        ]);

        req.session.success_msg = `DIAGNOSTIK SYSTEM OK: Database Terhubung, Modul Lembaga (${jmlLembaga}), Admin RBAC (${jmlUser}), Pengaturan Global (${jmlPengaturan}), dan Siklus TA (${jmlSiklus} Arsip) Berjalan Normal!`;
        return res.redirect('/');
    } catch (err) {
        req.session.error_msg = 'DIAGNOSTIK GAGAL: Terkendala pada koneksi database atau tabel modul. Detail: ' + err.message;
        return res.redirect('/');
    }
});

// --- RUTE AUTH (MODIFIKASI SUBDOMAIN LOGO + CAPTCHA + GANTI PASSWORD PERTAMA) ---
app.get('/login', async (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect(req.session.user.role === 'superadmin' ? '/' : '/lembaga-admin');
    }

    try {
        const hostHeader = String(
            req.headers['x-forwarded-host'] || req.headers.host || req.hostname || 'localhost'
        ).split(',')[0].trim();
        const hostWithoutPort = hostHeader.split(':')[0];
        const subdomain = hostWithoutPort.split('.')[0].toLowerCase();

        let namaLembaga = 'SISTEM INFORMASI PORTAL ADMIN';
        let logoLembaga = '/images/default-shield.png';

        if (subdomain && subdomain !== 'portal' && subdomain !== 'localhost' && subdomain !== 'www') {
            const lembaga = await getCachedLoginLembaga(subdomain);
            if (lembaga) {
                namaLembaga = lembaga.nama_organisasi;
                logoLembaga = lembaga.logo ? `/uploads/logo/${lembaga.logo}` : logoLembaga;
            }
        }

        const captcha = generateLoginCaptcha();
        req.session.loginCaptcha = captcha.answer;

        return res.render('login', {
            namaLembaga,
            logoLembaga,
            captchaQuestion: captcha.question
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Terjadi kesalahan server');
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password, captcha_answer } = req.body;
        const expectedCaptcha = req.session.loginCaptcha;
        delete req.session.loginCaptcha;

        if (!expectedCaptcha || !captcha_answer || String(captcha_answer).trim() !== String(expectedCaptcha).trim()) {
            req.session.error_msg = 'Kode keamanan (Captcha) salah atau sudah kedaluwarsa. Silakan coba lagi.';
            return res.redirect('/login');
        }

        if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
            req.session.error_msg = 'Username dan password wajib diisi!';
            return res.redirect('/login');
        }

        const user = await User.findOne({
            where: { username: username.trim() },
            include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }]
        });

        if (user && bcrypt.compareSync(password, user.password)) {
            const mustChange = Boolean(user.must_change_password);
            req.session.user = {
                id: user.id,
                nama_lengkap: user.nama_lengkap,
                username: user.username,
                role: user.role,
                lembagaId: user.lembagaId,
                id_bidang: user.id_bidang || null,
                nama_bidang: user.Bidang ? user.Bidang.nama_bidang : null,
                activeLembagaId: user.lembagaId || null,
                ttd: user.ttd || null,
                must_change_password: mustChange
            };

            if (mustChange) {
                req.session.success_msg = 'Login berhasil. Demi keamanan akun, Anda disarankan mengganti password dengan password yang lebih kuat.';
                return res.redirect('/ganti-password-wajib');
            }

            return res.redirect(user.role === 'superadmin' ? '/' : '/lembaga-admin');
        }

        req.session.error_msg = 'Username atau password salah!';
        return res.redirect('/login');
    } catch (err) {
        return res.status(500).send('Terjadi kesalahan: ' + err.message);
    }
});

app.get('/ganti-password-wajib', isAuthenticated, async (req, res) => {
    try {
        const lembagaId = parsePositiveInt(req.session.user.activeLembagaId || req.session.user.lembagaId);

        const [currentUser, pengaturan, lembaga] = await Promise.all([
            User.findByPk(req.session.user.id, {
                attributes: USER_SAFE_ATTRIBUTES,
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }]
            }),
            getCachedGlobalSetting(),
            lembagaId ? Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }) : Promise.resolve(null)
        ]);

        if (!currentUser) {
            return res.redirect('/login');
        }

        return res.render('ganti_password_pertama', {
            title: 'Ganti Password Akun',
            userSession: req.session.user,
            currentUser,
            pengaturan,
            lembaga
        });
    } catch (err) {
        return res.status(500).send('Terjadi kesalahan: ' + err.message);
    }
});

app.post('/ganti-password-wajib', isAuthenticated, async (req, res) => {
    try {
        const { password_lama, password_baru, konfirmasi_password } = req.body;
        const user = await User.findByPk(req.session.user.id);

        if (!user) {
            req.session.error_msg = 'Akun pengguna tidak ditemukan.';
            return res.redirect('/login');
        }

        if (!password_lama || !bcrypt.compareSync(password_lama, user.password)) {
            req.session.error_msg = 'Password saat ini tidak sesuai.';
            return res.redirect('/ganti-password-wajib');
        }

        if (password_baru !== konfirmasi_password) {
            req.session.error_msg = 'Konfirmasi password baru tidak cocok.';
            return res.redirect('/ganti-password-wajib');
        }

        if (bcrypt.compareSync(password_baru, user.password)) {
            req.session.error_msg = 'Password baru tidak boleh sama dengan password lama.';
            return res.redirect('/ganti-password-wajib');
        }

        const passwordError = validateStrongPassword(password_baru);
        if (passwordError) {
            req.session.error_msg = passwordError;
            return res.redirect('/ganti-password-wajib');
        }

        const hashedPassword = bcrypt.hashSync(password_baru, 10);
        await user.update({
            password: hashedPassword,
            must_change_password: false
        });

        req.session.user.must_change_password = false;
        req.session.success_msg = 'Password berhasil diperbarui dengan password kuat!';
        return res.redirect(user.role === 'superadmin' ? '/' : '/lembaga-admin');
    } catch (err) {
        req.session.error_msg = 'Gagal memperbarui password: ' + err.message;
        return res.redirect('/ganti-password-wajib');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// --- MANAJEMEN LEMBAGA (SUPERADMIN) ---
app.post('/lembaga/tambah', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
    try {
        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
        if (!nama_organisasi || !nama_organisasi.trim()) {
            req.session.error_msg = 'Nama organisasi wajib diisi!';
            return res.redirect('/');
        }

        const logo = req.file ? req.file.filename : null;
        await Lembaga.create({
            nama_organisasi: nama_organisasi.trim(),
            nama_ketua: nama_ketua ? nama_ketua.trim() : null,
            nomor_hp: nomor_hp ? nomor_hp.trim() : null,
            alamat: alamat ? alamat.trim() : null,
            logo
        });

        invalidateLoginLembagaCache();
        req.session.success_msg = 'Lembaga berhasil ditambahkan!';
        return res.redirect('/');
    } catch (err) {
        req.session.error_msg = 'Gagal menambah lembaga: ' + err.message;
        return res.redirect('/');
    }
});

app.post('/lembaga/edit/:id', isAuthenticated, isSuperAdmin, upload.single('logo'), async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) {
            return res.redirect('/');
        }

        const { nama_organisasi, nama_ketua, nomor_hp, alamat } = req.body;
        const lembaga = await Lembaga.findByPk(id);
        if (!lembaga) return res.status(404).send('Lembaga tidak ditemukan');

        lembaga.nama_organisasi = nama_organisasi ? nama_organisasi.trim() : lembaga.nama_organisasi;
        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.nomor_hp = nomor_hp ? nomor_hp.trim() : lembaga.nomor_hp;
        lembaga.alamat = alamat ? alamat.trim() : lembaga.alamat;
        if (req.file) lembaga.logo = req.file.filename;

        await lembaga.save();
        invalidateLoginLembagaCache();
        req.session.success_msg = 'Data lembaga berhasil diperbarui!';
        return res.redirect('/');
    } catch (err) {
        req.session.error_msg = 'Gagal memperbarui lembaga: ' + err.message;
        return res.redirect('/');
    }
});

// --- MANAJEMEN BIDANG OLEH SUPERADMIN ---
app.post('/bidang/tambah', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { nama_bidang, lembagaId } = req.body;
        const validLembagaId = parsePositiveInt(lembagaId);
        if (!nama_bidang || !nama_bidang.trim() || !validLembagaId) {
            req.session.error_msg = 'Nama bidang dan lembaga wajib dipilih!';
            return res.redirect('/');
        }

        const pengaturan = await getCachedGlobalSetting();
        const tahunAktif = getTahunAktifInt(pengaturan);

        await Bidang.create({
            nama_bidang: nama_bidang.trim(),
            lembagaId: validLembagaId,
            tahun: tahunAktif
        });

        req.session.success_msg = 'Bidang baru berhasil ditambahkan!';
        const referer = req.get('Referer') || '/';
        return res.redirect(referer);
    } catch (err) {
        req.session.error_msg = 'Gagal menambah bidang: ' + err.message;
        return res.redirect('/');
    }
});

// --- MANAJEMEN USER ---
app.post('/user/tambah', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { nama_lengkap, username, password, role, lembagaId } = req.body;
        if (!nama_lengkap || !username || !password) {
            req.session.error_msg = 'Nama lengkap, username, dan password wajib diisi!';
            return res.redirect('/');
        }

        const hashedPassword = bcrypt.hashSync(String(password).trim(), 10);
        const validRole = role === 'superadmin' ? 'superadmin' : 'admin_lembaga';
        const validLembagaId = validRole === 'admin_lembaga' ? parsePositiveInt(lembagaId) : null;

        await User.create({
            nama_lengkap: nama_lengkap.trim(),
            username: username.trim(),
            password: hashedPassword,
            role: validRole,
            lembagaId: validLembagaId,
            id_bidang: null
        });

        req.session.success_msg = 'Akun Admin berhasil ditambahkan!';
        return res.redirect('/');
    } catch (err) {
        req.session.error_msg = 'Gagal menambah user: ' + err.message;
        return res.redirect('/');
    }
});

app.post('/user/edit/:id', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const id = parsePositiveInt(req.params.id);
        if (!id) {
            return res.redirect('/');
        }

        const { nama_lengkap, username, password, role, lembagaId } = req.body;
        const user = await User.findByPk(id);
        if (!user) return res.status(404).send('User tidak ditemukan');

        const validRole = role === 'superadmin' ? 'superadmin' : 'admin_lembaga';
        const validLembagaId = validRole === 'admin_lembaga' ? parsePositiveInt(lembagaId) : null;

        user.nama_lengkap = nama_lengkap ? nama_lengkap.trim() : user.nama_lengkap;
        user.username = username ? username.trim() : user.username;
        user.role = validRole;
        user.lembagaId = validLembagaId;
        user.id_bidang = null;

        if (password && password.trim() !== '') {
            user.password = bcrypt.hashSync(password.trim(), 10);
        }
        await user.save();

        req.session.success_msg = 'Data Admin berhasil diperbarui!';
        return res.redirect('/');
    } catch (err) {
        req.session.error_msg = 'Gagal mengupdate user: ' + err.message;
        return res.redirect('/');
    }
});

// --- PENGATURAN GLOBAL & SIKLUS TAHUN ---
app.post('/pengaturan', isAuthenticated, isSuperAdmin, upload.single('logo_aplikasi'), async (req, res) => {
    try {
        const { nama_aplikasi, tahun_aktif } = req.body;
        const tahunInt = parsePositiveInt(tahun_aktif);
        if (!tahunInt) {
            req.session.error_msg = 'Tahun anggaran tidak valid!';
            return res.redirect('/');
        }

        const tahunBaruStr = String(tahunInt);

        let pengaturan = await Pengaturan.findOne();
        if (pengaturan) {
            pengaturan.nama_aplikasi = nama_aplikasi ? nama_aplikasi.trim() : pengaturan.nama_aplikasi;
            pengaturan.tahun_aktif = tahunInt;
            if (req.file) {
                pengaturan.logo_aplikasi = req.file.filename;
            }
            await pengaturan.save();
        } else {
            const logoFilename = req.file ? req.file.filename : null;
            await Pengaturan.create({
                nama_aplikasi: nama_aplikasi ? nama_aplikasi.trim() : DEFAULT_SETTING.nama_aplikasi,
                tahun_aktif: tahunInt,
                logo_aplikasi: logoFilename
            });
        }
        invalidateGlobalSettingCache();

        const [siklus] = await SiklusTahun.findOrCreate({
            where: { tahun: tahunBaruStr },
            defaults: { status: 'Aktif' }
        });

        const totalBidangTahunIni = await Bidang.count({ where: { tahun: tahunInt } });

        if (totalBidangTahunIni === 0) {
            const tahunAcuan = tahunInt - 1;
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

            for (const bidangLama of listBidangAcuan) {
                const bidangBaru = await Bidang.create({
                    nama_bidang: bidangLama.nama_bidang,
                    deskripsi_tugas: bidangLama.deskripsi_tugas,
                    lembagaId: bidangLama.lembagaId,
                    tahun: tahunInt
                });

                if (bidangLama.Prokers && bidangLama.Prokers.length > 0) {
                    const prokerPayloads = bidangLama.Prokers.map(prokerLama => ({
                        nama_program: prokerLama.nama_program,
                        deskripsi: prokerLama.deskripsi,
                        waktu_pelaksanaan: prokerLama.waktu_pelaksanaan,
                        status: 'Direncanakan',
                        anggaran: 0,
                        lembagaId: prokerLama.lembagaId,
                        bidangId: bidangBaru.id,
                        tahun: tahunInt
                    }));
                    await Proker.bulkCreate(prokerPayloads);
                }
            }
        }

        await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
        siklus.status = 'Aktif';
        await siklus.save();

        req.session.success_msg = `Tahun Anggaran ${tahunInt} berhasil diaktifkan dengan isolasi data mandiri!`;
        return res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = 'Gagal menyimpan pengaturan: ' + err.message;
        return res.redirect('/');
    }
});

app.get('/siklus-ta/pilih/:tahun', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const targetTahunInt = parsePositiveInt(req.params.tahun);
        if (!targetTahunInt) {
            req.session.error_msg = 'Tahun anggaran tidak valid!';
            return res.redirect('/');
        }

        const targetTahunStr = String(targetTahunInt);

        const pengaturan = await Pengaturan.findOne();
        if (pengaturan) {
            pengaturan.tahun_aktif = targetTahunInt;
            await pengaturan.save();
            invalidateGlobalSettingCache();
        }

        await SiklusTahun.update({ status: 'Arsip' }, { where: {} });
        await SiklusTahun.update({ status: 'Aktif' }, { where: { tahun: targetTahunStr } });

        req.session.success_msg = `Berhasil beralih ke Tahun Anggaran ${targetTahunInt}`;
        return res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = 'Gagal beralih tahun: ' + err.message;
        return res.redirect('/');
    }
});

app.get('/lembaga/dashboard', isAuthenticated, (req, res) => {
    return res.redirect('/lembaga-admin');
});

// --- DAFTARKAN RUTE MODUL APLIKASI ---
app.use('/proker', isAuthenticated, prokerRoutes);
app.use('/lembaga-admin', isAuthenticated, lembagaAdminRoutes);
app.use('/superadmin', isAuthenticated, isSuperAdmin, superadminRoutes);

// --- FUNGSI SEEDER OTOMATIS: SUPERUSER & LEMBAGA ESENSIAL ---
async function createSuperUser() {
    try {
        const superadminUsername = 'superadmin';
        const adminExists = await User.findOne({ where: { username: superadminUsername }, attributes: ['id'] });
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
        console.error('Gagal membuat superuser:', err.message || err);
    }
}

async function seedInitialLembaga() {
    try {
        const count = await Lembaga.count();
        if (count === 0) {
            console.log('Database lembaga kosong. Memasukkan daftar lengkap lembaga...');
            await Lembaga.bulkCreate([
                { id: 1, nama_organisasi: 'Lembaga Utama / Senkom Mitra Polri', nama_ketua: 'Pengurus Pusat', nomor_hp: '-', alamat: '-', logo: null },
                { id: 2, nama_organisasi: 'LDII JOMBANG', nama_ketua: 'Drs. WIDODO, M.Si', nomor_hp: '0812xxxxx', alamat: 'Jl. Mashur Ds. Gadingmangu', logo: 'nama_file_logo_ldii.png' },
                { id: 3, nama_organisasi: 'PERSINAS ASAD JOMBANG', nama_ketua: 'Suwandi, S.H', nomor_hp: '0812xxx', alamat: 'Jl. Jombang', logo: 'nama_file_logo_asad.png' },
                { id: 4, nama_organisasi: 'SENKOM JOMBANG', nama_ketua: 'AGUS EFENDY', nomor_hp: '0812220xxx', alamat: 'Jl. RE. Martadinata Jombang', logo: 'nama_file_logo_senkom.png' }
            ]);
            invalidateLoginLembagaCache();
            console.log('Daftar lengkap lembaga berhasil di-seed ke database.');
        }
    } catch (err) {
        console.error('Gagal melakukan seeding lembaga otomatis:', err.message || err);
    }
}

app.get('/siklus-ta/hapus/:tahun', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const tahunInt = parsePositiveInt(req.params.tahun);
        if (!tahunInt) {
            req.session.error_msg = 'Tahun anggaran tidak valid!';
            return res.redirect('/');
        }
        const tahunTarget = String(tahunInt);

        const pengaturan = await getCachedGlobalSetting();
        if (pengaturan && String(pengaturan.tahun_aktif) === tahunTarget) {
            req.session.error_msg = `Tidak dapat menghapus Tahun Anggaran ${tahunTarget} karena sedang aktif digunakan! Pindahkan dulu tahun aktif ke tahun lain.`;
            return res.redirect('/');
        }

        await SiklusTahun.destroy({ where: { tahun: tahunTarget } });
        await Bidang.destroy({ where: { tahun: tahunInt } });
        await Proker.destroy({ where: { tahun: tahunInt } });

        req.session.success_msg = `Arsip dan data terkait Tahun Anggaran ${tahunTarget} berhasil dibersihkan dari sistem.`;
        return res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = 'Gagal menghapus tahun anggaran: ' + err.message;
        return res.redirect('/');
    }
});

// --- SINKRONISASI / BUAT TAHUN ANGGARAN BARU MANUAL ---
app.post('/siklus-ta/sinkronisasi', isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
        const { tahun_target } = req.body;
        const tahunInt = parsePositiveInt(tahun_target);
        if (!tahunInt) {
            req.session.error_msg = 'Tahun anggaran tidak valid!';
            return res.redirect('/');
        }

        const tahunBaruStr = String(tahunInt);

        await SiklusTahun.findOrCreate({
            where: { tahun: tahunBaruStr },
            defaults: { status: 'Arsip' }
        });

        const totalBidangTahunIni = await Bidang.count({ where: { tahun: tahunInt } });

        if (totalBidangTahunIni === 0) {
            const tahunAcuan = tahunInt - 1;
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

            for (const bidangLama of listBidangAcuan) {
                const bidangBaru = await Bidang.create({
                    nama_bidang: bidangLama.nama_bidang,
                    deskripsi_tugas: bidangLama.deskripsi_tugas,
                    lembagaId: bidangLama.lembagaId,
                    tahun: tahunInt
                });

                if (bidangLama.Prokers && bidangLama.Prokers.length > 0) {
                    const prokerPayloads = bidangLama.Prokers.map(prokerLama => ({
                        nama_program: prokerLama.nama_program,
                        deskripsi: prokerLama.deskripsi,
                        waktu_pelaksanaan: prokerLama.waktu_pelaksanaan,
                        status: 'Direncanakan',
                        anggaran: 0,
                        lembagaId: prokerLama.lembagaId,
                        bidangId: bidangBaru.id,
                        tahun: tahunInt
                    }));
                    await Proker.bulkCreate(prokerPayloads);
                }
            }
            req.session.success_msg = `Tahun Anggaran ${tahunInt} berhasil disinkronkan dan dikloning dengan struktur bersih!`;
        } else {
            req.session.success_msg = `Tahun Anggaran ${tahunInt} sudah memiliki data sebelumnya.`;
        }

        return res.redirect('/');
    } catch (err) {
        console.error(err);
        req.session.error_msg = 'Gagal menyinkronkan tahun anggaran: ' + err.message;
        return res.redirect('/');
    }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error('[EXPRESS-ERR]', err.message || err);
    if (res.headersSent) return next(err);
    return res.status(500).send('Terjadi kesalahan pada server.');
});

// --- MENJALANKAN SERVER & KONEKSI DATABASE (NON-BLOCKING LISTEN) ---
const PORT = parsePositiveInt(process.env.PORT) || 3000;
const shouldSync = process.env.DB_SYNC === 'true';
const shouldAlter = process.env.DB_SYNC_ALTER === 'true';

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
});

if (shouldSync || shouldAlter) {
    sequelize.sync(shouldAlter ? { alter: true } : undefined)
        .then(async () => {
            console.log(`Database & tabel siap (alter: ${shouldAlter}).`);
            await createSuperUser();
            await seedInitialLembaga();
        })
        .catch(err => {
            console.error('Gagal sinkronisasi database:', err.message || err);
        });
} else {
    sequelize.authenticate()
        .then(async () => {
            console.log('Koneksi database Supabase terhubung.');
            await createSuperUser();
            await seedInitialLembaga();
        })
        .catch(err => {
            console.error('Koneksi awal database tertunda:', err.message || err);
        });
}

module.exports = app;
