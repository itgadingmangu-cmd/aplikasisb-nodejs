const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch (_) {
  bcrypt = require('bcryptjs');
}
const ExcelJS = require('exceljs');
const { Op } = require('sequelize');

const {
    Lembaga,
    Bidang,
    User,
    Proker,
    RincianBiaya,
    RealisasiBiaya,
    Proposal,
    Pengaturan
} = require('../models');

const lembagaAdminController = require('../controllers/lembagaAdminController');
const prokerController = require('../controllers/prokerController');
const realisasiLpjController = require('../controllers/realisasiLpjController');
const uploadLpjFiles = (() => {
    const candidates = ['./uploadLpj', './lpjUpload', './upload'];
    for (const rel of candidates) {
        try {
            const mod = require(path.join(__dirname, '../middleware', rel));
            if (typeof mod === 'function') return mod;
            if (mod && typeof mod.uploadLpjFiles === 'function') return mod.uploadLpjFiles;
        } catch (_) {}
    }
    const lpjDir = path.join(__dirname, '../public/uploads/lpj');
    if (!fs.existsSync(lpjDir)) {
        fs.mkdirSync(lpjDir, { recursive: true });
    }
    const lpjStorage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, lpjDir),
        filename: (_req, file, cb) => cb(null, 'lpj-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase())
    });
    return multer({
        storage: lpjStorage,
        limits: { fileSize: 512 * 1024 }
    }).any();
})();

const DEFAULT_PENGATURAN = Object.freeze({
    tahun_aktif: 2026,
    nama_aplikasi: 'Aplikasi Program Kerja'
});

const USER_SAFE_ATTRIBUTES = [
    'id', 'nama_lengkap', 'username', 'role', 'jabatan',
    'id_bidang', 'lembagaId', 'must_change_password'
];

const LEMBAGA_LIGHT_ATTRIBUTES = [
    'id', 'nama_organisasi', 'nama_ketua', 'pembina_lembaga', 'pembina_senkom',
    'nomor_hp', 'alamat', 'logo', 'batas_anggaran_proposal',
    'pembina_1', 'pembina_2', 'pembina_3', 'pembina_4', 'pembina_5', 'pembina_6',
    'print_stempel', 'print_ketua', 'print_pengaju', 'print_pembina_lembaga', 'print_pembina',
    'print_ttd_ketua_img', 'print_ttd_pengaju_img', 'print_ttd_pembina_img'
];

// --- IN-MEMORY CACHE DENGAN STALE FALLBACK ---
let cachedPengaturan = null;
let cachedPengaturanAt = 0;
const PENGATURAN_TTL_MS = 30 * 1000;

async function getCachedPengaturan() {
    const now = Date.now();
    if (cachedPengaturan && (now - cachedPengaturanAt) < PENGATURAN_TTL_MS) {
        return cachedPengaturan;
    }
    try {
        const setting = await Pengaturan.findOne({
            attributes: [
                'id', 'nama_aplikasi', 'logo_icon', 'logo_aplikasi',
                'step1_judul', 'step1_deskripsi', 'step2_judul', 'step2_deskripsi',
                'step3_judul', 'step3_deskripsi', 'step4_judul', 'step4_deskripsi',
                'tahun_aktif'
            ]
        });
        if (setting) {
            cachedPengaturan = setting;
            cachedPengaturanAt = now;
            return setting;
        }
    } catch (err) {
        console.error('[CACHE-WARN] Gagal menyegarkan Pengaturan, menggunakan stale/default:', err.message);
        if (cachedPengaturan) {
            return cachedPengaturan;
        }
    }
    return cachedPengaturan || { ...DEFAULT_PENGATURAN };
}

let cachedLembagaList = null;
let cachedLembagaListAt = 0;
const LEMBAGA_LIST_TTL_MS = 60 * 1000;

async function getCachedLembagaList(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedLembagaList && (now - cachedLembagaListAt) < LEMBAGA_LIST_TTL_MS) {
        return cachedLembagaList;
    }
    try {
        const list = await Lembaga.findAll({
            attributes: ['id', 'nama_organisasi', 'logo'],
            order: [['id', 'ASC']]
        });
        cachedLembagaList = list;
        cachedLembagaListAt = now;
        return list;
    } catch (err) {
        console.error('[CACHE-WARN] Gagal menyegarkan daftar Lembaga:', err.message);
        if (cachedLembagaList) {
            return cachedLembagaList;
        }
        throw err;
    }
}

function invalidateLembagaListCache() {
    cachedLembagaList = null;
    cachedLembagaListAt = 0;
}

// --- HELPER VALIDASI & OTORISASI KETAT (BERBASIS ROLE, JABATAN & BIDANG — TANPA HARDCODE USERNAME) ---
function getActiveLembagaId(user) {
    if (!user) return null;
    const rawId = user.activeLembagaId || user.lembagaId;
    const parsed = parseInt(rawId, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getTahunAktifInt(pengaturan) {
    const parsed = parseInt(pengaturan && pengaturan.tahun_aktif, 10);
    return Number.isInteger(parsed) && parsed >= 2000 ? parsed : 2026;
}

function isWakilBendaharaUser(user) {
    if (!user) return false;
    const jabatan = String(user.jabatan || '').trim().toLowerCase();
    const bidang = String(user.nama_bidang || '').trim().toLowerCase();
    return jabatan.includes('wakil') || bidang.includes('wakil');
}

function isBendaharaUtamaUser(user) {
    if (!user || isWakilBendaharaUser(user)) return false;
    const role = String(user.role || '').trim().toLowerCase();
    const jabatan = String(user.jabatan || '').trim().toLowerCase();
    const bidang = String(user.nama_bidang || '').trim().toLowerCase();
    return role === 'bendahara_utama'
        || jabatan === 'bendahara'
        || jabatan.includes('bendahara utama')
        || bidang === 'bendahara';
}

function isKetuaApprovalUser(user) {
    if (!user) return false;
    const role = String(user.role || '').trim().toLowerCase();
    const jabatan = String(user.jabatan || '').trim().toLowerCase();
    const bidang = String(user.nama_bidang || '').trim().toLowerCase();
    return role === 'ketua' || jabatan === 'ketua' || bidang === 'ketua';
}

function isAdminStrukturalUser(user) {
    if (!user) return false;
    if (isBendaharaUtamaUser(user) || isKetuaApprovalUser(user)) return false;
    const role = String(user.role || '').trim().toLowerCase();
    return role === 'admin_lembaga' || role === 'superadmin';
}

function isPimpinanAtauBendahara(user) {
    if (!user) return false;
    return isBendaharaUtamaUser(user)
        || isKetuaApprovalUser(user)
        || isAdminStrukturalUser(user);
}

async function hydrateUserSession(req) {
    let user = req.session && req.session.user ? req.session.user : null;
    if (!user) return null;

    if (user.id && (!user.jabatan || (user.id_bidang && !user.nama_bidang))) {
        try {
            const dbUser = await User.findByPk(user.id, {
                attributes: ['id', 'nama_lengkap', 'username', 'role', 'jabatan', 'id_bidang', 'lembagaId'],
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'], required: false }]
            });
            if (dbUser) {
                user = {
                    ...user,
                    nama_lengkap: dbUser.nama_lengkap || user.nama_lengkap,
                    role: dbUser.role || user.role,
                    jabatan: dbUser.jabatan || user.jabatan || '',
                    id_bidang: dbUser.id_bidang || user.id_bidang || null,
                    nama_bidang: (dbUser.Bidang && dbUser.Bidang.nama_bidang) || user.nama_bidang || ''
                };
                req.session.user = user;
            }
        } catch (err) {
            console.error('[SESSION-HYDRATE-WARN] Gagal menyegarkan profil sesi user:', err.message);
        }
    }
    return user;
}

function canManageProker(user, proker) {
    if (!user || !proker) return false;
    const activeLembagaId = getActiveLembagaId(user);
    if (!activeLembagaId || Number(proker.lembagaId) !== activeLembagaId) {
        return false;
    }
    if (isAdminStrukturalUser(user)) {
        return true;
    }
    return Boolean(user.id_bidang) && Number(proker.bidangId) === Number(user.id_bidang);
}

function parsePositiveInt(value) {
    const num = parseInt(value, 10);
    return Number.isInteger(num) && num > 0 ? num : null;
}

function parseNonNegativeNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) && num >= 0 ? num : null;
}

function parseBooleanFlag(val) {
    return val === 'true' || val === 'on' || val === true || val === '1';
}

function popFlashMessages(req) {
    const success_msg = req.session.success_msg || null;
    const error_msg = req.session.error_msg || null;
    delete req.session.success_msg;
    delete req.session.error_msg;
    return { success_msg, error_msg };
}

async function recalculateProkerAnggaran(prokerId) {
    const total = await RincianBiaya.sum('total', { where: { prokerId } });
    const totalAnggaran = Number.isFinite(Number(total)) ? Number(total) : 0;
    await Proker.update({ anggaran: totalAnggaran }, { where: { id: prokerId } });
    return totalAnggaran;
}

// --- KONFIGURASI MULTER UNTUK UPLOAD LOGO & TTD ---
const uploadLogoDir = path.join(__dirname, '../public/uploads/logo');
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
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Format gambar tidak valid! Hanya diizinkan JPG, PNG, atau WEBP maksimal 512 KB.'));
    }
});

// --- KONFIGURASI MULTER KHUSUS UNTUK UPLOAD BUKTI NOTA REALISASI (Maks. 512 KB) ---
const uploadRealizDir = path.join(__dirname, '../public/uploads/realisasi');
if (!fs.existsSync(uploadRealizDir)) {
    fs.mkdirSync(uploadRealizDir, { recursive: true });
}

const storageRealisasi = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadRealizDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'realisasi-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

const uploadRealisasi = multer({
    storage: storageRealisasi,
    limits: { fileSize: 512 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|pdf/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Hanya mengizinkan file gambar (JPG/PNG) atau PDF dengan ukuran maksimal 512 KB!'));
    }
}).single('bukti_nota');

// --- MIDDLEWARE AUTENTIKASI & OTORISASI KETAT ---
async function isLoggedIn(req, res, next) {
    if (req.session && req.session.user) {
        await hydrateUserSession(req);
        return next();
    }
    return res.redirect('/login');
}

function isAdminLembaga(req, res, next) {
    const user = req.session && req.session.user;
    if (isAdminStrukturalUser(user)) {
        return next();
    }
    req.session.error_msg = 'Akses ditolak. Fitur ini khusus untuk Admin Lembaga / Superadmin.';
    return res.redirect('/lembaga-admin');
}

function ensureBendaharaUtama(req, res, next) {
    const user = req.session && req.session.user;
    if (isBendaharaUtamaUser(user) || isAdminStrukturalUser(user)) {
        return next();
    }
    req.session.error_msg = 'Akses ditolak. Halaman ini khusus untuk Bendahara Utama / Admin Lembaga.';
    return res.redirect('/lembaga-admin');
}

function ensureApprovalAccess(req, res, next) {
    const user = req.session && req.session.user;
    if (isKetuaApprovalUser(user) || isAdminStrukturalUser(user)) {
        return next();
    }
    req.session.error_msg = 'Akses ditolak. Halaman persetujuan proposal khusus untuk Ketua / Admin Lembaga.';
    return res.redirect('/lembaga-admin');
}

function ensureRekapBulananAccess(req, res, next) {
    const user = req.session && req.session.user;
    if (isPimpinanAtauBendahara(user) || (user && user.id_bidang)) {
        return next();
    }
    req.session.error_msg = 'Akses ditolak. Anda tidak memiliki hak akses untuk rekap bulanan.';
    return res.redirect('/lembaga-admin');
}

// ==========================================
// MODUL PROFIL & UPLOAD TTD PRIBADI
// ==========================================
router.get('/profile', isLoggedIn, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.session.user.id);
        const currentUser = await User.findByPk(userId, {
            attributes: USER_SAFE_ATTRIBUTES,
            include: [{ model: Bidang, as: 'Bidang' }]
        });

        if (!currentUser) {
            req.session.error_msg = 'Data profil pengguna tidak ditemukan.';
            return res.redirect('/lembaga-admin');
        }

        const { success_msg, error_msg } = popFlashMessages(req);

        return res.render('profile', {
            title: 'Profil & Tanda Tangan Saya',
            userSession: req.session.user,
            currentUser,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error('Gagal memuat halaman profil:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/profile/update-ttd', isLoggedIn, (req, res, next) => {
    upload.single()(req, res, (err) => {
        if (err) {
            req.session.error_msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran file tanda tangan melebihi batas maksimal 512 KB!'
                : err.message;
            return res.redirect('/lembaga-admin/profile');
        }
        next();
    });
}, lembagaAdminController.updateTtdProfile);

// ==========================================
// MODUL EKSPOR LAPORAN
// ==========================================
router.get('/ekspor/excel', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!lembagaId) {
            return res.status(403).send('Sesi lembaga tidak valid.');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const prokerWhere = { lembagaId, tahun: tahunAktifInt };
        if (!isPimpinanAtauBendahara(user) && user.id_bidang) {
            prokerWhere.bidangId = user.id_bidang;
        }

        const [lembaga, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: ['id', 'nama_organisasi'] }),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: RincianBiaya, as: 'RincianBiayas', attributes: ['id', 'total'] },
                    { model: RealisasiBiaya, as: 'Realisasis', attributes: ['id', 'nominal_realisasi'] }
                ],
                order: [['bidangId', 'ASC'], ['id', 'ASC']]
            })
        ]);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Rekapitulasi Keuangan');

        worksheet.addRow([lembaga ? lembaga.nama_organisasi.toUpperCase() : 'LAPORAN KEUANGAN']);
        worksheet.addRow([`REKAPITULASI PROGRAM KERJA & REALISASI TAHUN ${tahunAktifInt}`]);
        worksheet.addRow([]);

        worksheet.getCell('A1').font = { bold: true, size: 13 };
        worksheet.getCell('A2').font = { bold: true, size: 11 };

        const headerRow = worksheet.addRow([
            'No', 'Nama Program Kerja', 'Bidang', 'Jenis',
            'Pagu RAB (Rp)', 'Realisasi Riil (Rp)', 'Selisih / Sisa (Rp)', 'Status'
        ]);

        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '1F4E78' }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        let sumRAB = 0;
        let sumRealisasi = 0;
        let sumSelisih = 0;

        prokers.forEach((p, index) => {
            const totalRAB = p.RincianBiayas
                ? p.RincianBiayas.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
                : 0;
            const totalRealisasi = p.Realisasis
                ? p.Realisasis.reduce((s, r) => s + (parseFloat(r.nominal_realisasi) || 0), 0)
                : 0;
            const selisih = totalRAB - totalRealisasi;

            sumRAB += totalRAB;
            sumRealisasi += totalRealisasi;
            sumSelisih += selisih;

            const row = worksheet.addRow([
                index + 1,
                p.nama_program || p.nama_proker,
                p.Bidang ? p.Bidang.nama_bidang : '-',
                p.jenis || 'Reguler',
                totalRAB,
                totalRealisasi,
                selisih,
                p.status || 'Aktif'
            ]);

            row.alignment = { vertical: 'middle' };
            row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };

            row.getCell(5).numFmt = '"Rp" #,##0';
            row.getCell(6).numFmt = '"Rp" #,##0';
            row.getCell(7).numFmt = '"Rp" #,##0';

            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'D3D3D3' } },
                    left: { style: 'thin', color: { argb: 'D3D3D3' } },
                    bottom: { style: 'thin', color: { argb: 'D3D3D3' } },
                    right: { style: 'thin', color: { argb: 'D3D3D3' } }
                };
            });
        });

        const totalRow = worksheet.addRow([
            '', 'TOTAL KESELURUHAN', '', '', sumRAB, sumRealisasi, sumSelisih, ''
        ]);

        totalRow.font = { bold: true };
        totalRow.alignment = { vertical: 'middle' };
        totalRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
        totalRow.getCell(5).numFmt = '"Rp" #,##0';
        totalRow.getCell(6).numFmt = '"Rp" #,##0';
        totalRow.getCell(7).numFmt = '"Rp" #,##0';

        totalRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: '000000' } },
                bottom: { style: 'double', color: { argb: '000000' } },
                left: { style: 'thin', color: { argb: 'D3D3D3' } },
                right: { style: 'thin', color: { argb: 'D3D3D3' } }
            };
        });

        worksheet.getColumn(1).width = 6;
        worksheet.getColumn(2).width = 35;
        worksheet.getColumn(3).width = 20;
        worksheet.getColumn(4).width = 12;
        worksheet.getColumn(5).width = 20;
        worksheet.getColumn(6).width = 20;
        worksheet.getColumn(7).width = 20;
        worksheet.getColumn(8).width = 15;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Rekap-Keuangan-${tahunAktifInt}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('ERROR EKSPOR EXCEL:', error);
        req.session.error_msg = 'Gagal mengekspor data ke Excel: ' + error.message;
        return res.redirect('/lembaga-admin');
    }
});

router.get('/ekspor/pdf', isLoggedIn, (req, res) => {
    return res.redirect('/lembaga-admin/rekap-global/print');
});

// ==========================================
// MODUL KHUSUS BENDAHARA UTAMA
// ==========================================
router.get('/bendahara/rekapitulasi', isLoggedIn, ensureBendaharaUtama, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [lembagaData, bidangs, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                order: [['id', 'ASC']]
            }),
            Proker.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: Proposal, as: 'Proposal' },
                    { model: RincianBiaya, as: 'RincianBiayas' },
                    { model: RealisasiBiaya, as: 'Realisasis' }
                ],
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        lembagaData.Bidangs = bidangs;
        lembagaData.Prokers = prokers;

        let totalPaguLembaga = 0;
        let totalRealisasiLembaga = 0;

        prokers.forEach(p => {
            const paguP = p.RincianBiayas
                ? p.RincianBiayas.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)
                : 0;
            const realP = p.Realisasis
                ? p.Realisasis.reduce((s, r) => s + (parseFloat(r.nominal_realisasi) || 0), 0)
                : 0;
            totalPaguLembaga += paguP;
            totalRealisasiLembaga += realP;
        });

        const sisaAnggaranLembaga = totalPaguLembaga - totalRealisasiLembaga;
        const persentaseSerapan = totalPaguLembaga > 0
            ? ((totalRealisasiLembaga / totalPaguLembaga) * 100).toFixed(1)
            : 0;

        const { success_msg, error_msg } = popFlashMessages(req);

        return res.render('bendahara_rekapitulasi', {
            title: 'Rekapitulasi Keuangan Bendahara Utama',
            pengaturan,
            userSession: user,
            lembagaData,
            prokers,
            totalPaguLembaga,
            totalRealisasiLembaga,
            sisaAnggaranLembaga,
            persentaseSerapan,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error('Gagal memuat rekapitulasi bendahara utama:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE KONSOLIDASI PROPOSAL & RAB BULANAN BENDAHARA UTAMA ---
router.get('/bendahara/proposal-bulanan', isLoggedIn, ensureRekapBulananAccess, lembagaAdminController.getRekapProposalBulanan);

// --- RUTE CETAK KONSOLIDASI PROPOSAL & RAB BULANAN ---
router.get('/bendahara/proposal-bulanan/print', isLoggedIn, ensureRekapBulananAccess, lembagaAdminController.printRekapProposalBulanan);

// ==========================================
// RUTE HALAMAN UTAMA / DASHBOARD DINAMIS (/lembaga-admin)
// ==========================================
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!lembagaId) {
            req.session.error_msg = 'Sesi lembaga tidak valid.';
            return res.redirect('/login');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);
        const hasFullAccess = isPimpinanAtauBendahara(user);

        const bidangWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, id: user.id_bidang || -1, tahun: tahunAktifInt };

        const userWhere = hasFullAccess
            ? { lembagaId }
            : { lembagaId, id_bidang: user.id_bidang || -1 };

        const prokerWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, bidangId: user.id_bidang || -1, tahun: tahunAktifInt };

        const needPendingCount = isBendaharaUtamaUser(user) || isAdminStrukturalUser(user);

        const [lembagaData, bidangs, users, prokers, listLembaga, totalPendingPencairan] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({
                where: bidangWhere,
                order: [['id', 'ASC']]
            }),
            User.findAll({
                where: userWhere,
                attributes: USER_SAFE_ATTRIBUTES,
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }],
                order: [['id', 'ASC']]
            }),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: Proposal, as: 'Proposal' },
                    { model: RincianBiaya, as: 'RincianBiayas', attributes: ['id', 'prokerId', 'total', 'bulan'] },
                    { model: RealisasiBiaya, as: 'Realisasis', attributes: ['id', 'prokerId', 'nominal_realisasi'] }
                ],
                order: [['id', 'ASC']]
            }),
            getCachedLembagaList(),
            needPendingCount
                ? Proposal.count({ where: { lembagaId, status: 'Disetujui' } }).catch(() => 0)
                : Promise.resolve(0)
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/');
        }

        const prokersByBidang = new Map();
        for (const p of prokers) {
            const key = Number(p.bidangId);
            if (!prokersByBidang.has(key)) prokersByBidang.set(key, []);
            prokersByBidang.get(key).push(p);
        }
        bidangs.forEach(b => {
            b.Prokers = prokersByBidang.get(Number(b.id)) || [];
        });

        lembagaData.Bidangs = bidangs;
        lembagaData.Users = users;
        lembagaData.Prokers = prokers;

        let totalAnggaranLembaga = 0;
        let totalRealisasiLembaga = 0;

        for (const proker of prokers) {
            const paguProker = (proker.RincianBiayas && proker.RincianBiayas.length > 0)
                ? proker.RincianBiayas.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0)
                : (parseFloat(proker.anggaran) || 0);
            totalAnggaranLembaga += paguProker;

            if (proker.Realisasis && proker.Realisasis.length > 0) {
                const realisasiProker = proker.Realisasis.reduce((sum, r) => sum + (parseFloat(r.nominal_realisasi) || 0), 0);
                totalRealisasiLembaga += realisasiProker;
            }
        }

        const persentaseSerapan = totalAnggaranLembaga > 0
            ? ((totalRealisasiLembaga / totalAnggaranLembaga) * 100).toFixed(1)
            : 0;

        const { success_msg, error_msg } = popFlashMessages(req);

        let titlePanel = 'Panel Bidang: ' + (user.nama_bidang || user.jabatan || 'Pengurus');
        if (isBendaharaUtamaUser(user)) {
            titlePanel = 'Panel Bendahara Utama (Eksekusi Pencairan)';
        } else if (isKetuaApprovalUser(user)) {
            titlePanel = 'Panel Ketua (Persetujuan Proposal)';
        } else if (isAdminStrukturalUser(user)) {
            titlePanel = 'Panel Pimpinan Lembaga / Admin';
        }

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
            totalRealisasiLembaga,
            persentaseSerapan,
            success_msg,
            error_msg,
            totalPendingPencairan,
            titlePanel
        });
    } catch (err) {
        console.error('Error pada dashboard lembaga:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL MANAJEMEN BIDANG (KHUSUS ADMIN STRUKTURAL)
// ==========================================
const slugifyUsernamePart = (str) => String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

const generateRandomPassword = (length = 10) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%';
    const bytes = crypto.randomBytes(length);
    let pass = '';
    for (let i = 0; i < length; i++) {
        pass += chars[bytes[i] % chars.length];
    }
    return pass;
};

const ensureUniqueUsername = async (baseName) => {
    const cleanBase = slugifyUsernamePart(baseName) || 'pengurus_bidang';
    let candidate = cleanBase;
    let counter = 1;
    while (await User.findOne({ where: { username: candidate }, attributes: ['id'] })) {
        counter += 1;
        candidate = `${cleanBase.slice(0, 20)}_${counter}`;
    }
    return candidate;
};

router.get('/bidang', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = getActiveLembagaId(req.session.user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [lembagaData, bidangs] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                include: [{
                    model: User,
                    as: 'Users',
                    attributes: ['id', 'nama_lengkap', 'username', 'role', 'jabatan', 'must_change_password'],
                    required: false
                }],
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Bidangs = bidangs;

        const generatedBidangUsers = req.session.generated_bidang_users || null;
        delete req.session.generated_bidang_users;

        return res.render('manajemen_bidang', {
            pengaturan,
            userSession: req.session.user,
            lembagaData,
            generatedBidangUsers
        });
    } catch (err) {
        console.error('Error halaman manajemen bidang:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/bidang/buat-user/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = getActiveLembagaId(req.session.user);
        const bidangId = Number(req.params.id);
        const bidang = await Bidang.findOne({ where: { id: bidangId, lembagaId } });

        if (!bidang) {
            req.session.error_msg = 'Data bidang tidak ditemukan.';
            return res.redirect('/lembaga-admin/bidang');
        }

        const existingUser = await User.findOne({
            where: { id_bidang: bidang.id, role: 'pengurus_bidang' },
            attributes: ['id', 'username']
        });
        if (existingUser) {
            req.session.error_msg = `Bidang "${bidang.nama_bidang}" sudah memiliki akun (${existingUser.username}). Gunakan fitur reset password bila perlu.`;
            return res.redirect('/lembaga-admin/bidang');
        }

        const rawNama = (req.body.nama_lengkap || '').trim() || `Pengurus ${bidang.nama_bidang}`;
        const rawJabatan = (req.body.jabatan || '').trim() || `Pengurus ${bidang.nama_bidang}`;
        const requestedUsername = (req.body.username || '').trim();

        let finalUsername;
        if (requestedUsername) {
            const cleanReq = slugifyUsernamePart(requestedUsername);
            if (!cleanReq || cleanReq.length < 3) {
                req.session.error_msg = 'Username minimal 3 karakter huruf/angka.';
                return res.redirect('/lembaga-admin/bidang');
            }
            const taken = await User.findOne({ where: { username: cleanReq }, attributes: ['id'] });
            if (taken) {
                req.session.error_msg = `Username "${cleanReq}" sudah digunakan.`;
                return res.redirect('/lembaga-admin/bidang');
            }
            finalUsername = cleanReq;
        } else {
            finalUsername = await ensureUniqueUsername(`${bidang.nama_bidang}_${lembagaId}`);
        }

        const rawPassword = (req.body.password || '').trim() || generateRandomPassword(10);
        if (rawPassword.length < 6) {
            req.session.error_msg = 'Password minimal 6 karakter.';
            return res.redirect('/lembaga-admin/bidang');
        }

        await User.create({
            nama_lengkap: rawNama,
            username: finalUsername,
            password: bcrypt.hashSync(rawPassword, 10),
            role: 'pengurus_bidang',
            jabatan: rawJabatan,
            id_bidang: bidang.id,
            lembagaId: lembagaId,
            must_change_password: true
        });

        req.session.generated_bidang_users = [{
            bidang: bidang.nama_bidang,
            nama_lengkap: rawNama,
            username: finalUsername,
            password: rawPassword,
            status: 'Dibuat baru (multi-tahun)'
        }];
        req.session.success_msg = `Akun pengurus untuk bidang "${bidang.nama_bidang}" berhasil dibuat.`;
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error('Error buat user bidang:', err);
        req.session.error_msg = 'Gagal membuat akun bidang: ' + err.message;
        return res.redirect('/lembaga-admin/bidang');
    }
});

router.post('/bidang/generate-users', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = getActiveLembagaId(req.session.user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        let selectedIds = req.body.bidang_ids;
        if (selectedIds && !Array.isArray(selectedIds)) {
            selectedIds = [selectedIds];
        }
        const filterIds = Array.isArray(selectedIds) && selectedIds.length > 0
            ? selectedIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
            : null;

        const whereBidang = { lembagaId, tahun: tahunAktifInt };
        if (filterIds) {
            whereBidang.id = filterIds;
        }

        const bidangs = await Bidang.findAll({
            where: whereBidang,
            include: [{
                model: User,
                as: 'Users',
                attributes: ['id', 'username', 'role'],
                required: false
            }],
            order: [['id', 'ASC']]
        });

        if (!bidangs.length) {
            req.session.error_msg = 'Tidak ada data bidang untuk digenerate.';
            return res.redirect('/lembaga-admin/bidang');
        }

        const createdList = [];
        let skippedCount = 0;

        for (const b of bidangs) {
            const hasAccount = Array.isArray(b.Users) && b.Users.some((u) => u.role === 'pengurus_bidang');
            if (hasAccount) {
                skippedCount += 1;
                continue;
            }

            const username = await ensureUniqueUsername(`${b.nama_bidang}_${lembagaId}`);
            const password = generateRandomPassword(10);
            const namaLengkap = `Pengurus ${b.nama_bidang}`;

            await User.create({
                nama_lengkap: namaLengkap,
                username,
                password: bcrypt.hashSync(password, 10),
                role: 'pengurus_bidang',
                jabatan: `Pengurus ${b.nama_bidang}`,
                id_bidang: b.id,
                lembagaId: lembagaId,
                must_change_password: true
            });

            createdList.push({
                bidang: b.nama_bidang,
                nama_lengkap: namaLengkap,
                username,
                password,
                status: 'Baru digenerate'
            });
        }

        if (createdList.length > 0) {
            req.session.generated_bidang_users = createdList;
            req.session.success_msg = `Berhasil men-generate ${createdList.length} akun bidang${skippedCount > 0 ? ` (${skippedCount} bidang dilewati karena sudah punya akun)` : ''}.`;
        } else {
            req.session.error_msg = `Tidak ada akun baru dibuat (${skippedCount} bidang sudah memiliki akun pengurus).`;
        }

        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error('Error generate users bidang:', err);
        req.session.error_msg = 'Gagal generate akun bidang: ' + err.message;
        return res.redirect('/lembaga-admin/bidang');
    }
});

router.post('/bidang/tambah', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const { nama_bidang, deskripsi_tugas } = req.body;
        const lembagaId = getActiveLembagaId(req.session.user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        if (!nama_bidang || nama_bidang.trim() === '') {
            req.session.error_msg = 'Nama bidang wajib diisi!';
            return res.redirect('/lembaga-admin/bidang');
        }

        await Bidang.create({
            nama_bidang: nama_bidang.trim(),
            deskripsi_tugas: deskripsi_tugas ? deskripsi_tugas.trim() : null,
            lembagaId,
            tahun: tahunAktifInt
        });

        req.session.success_msg = 'Bidang baru berhasil ditambahkan!';
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error('Gagal menambah bidang:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/bidang/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        if (!bidangId || !lembagaId) {
            return res.status(400).send('Parameter bidang tidak valid.');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const bidang = await Bidang.findOne({
            where: { id: bidangId, lembagaId, tahun: tahunAktifInt }
        });
        if (!bidang) {
            return res.status(404).send('Data bidang tidak ditemukan pada tahun aktif atau Anda tidak memiliki akses.');
        }

        return res.render('edit_bidang', {
            pengaturan,
            userSession: req.session.user,
            bidang
        });
    } catch (err) {
        console.error('Error ambil data edit bidang:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/bidang/edit/:id', isLoggedIn, isAdminLembaga, (req, res, next) => {
    upload.single('ttd_bidang')(req, res, (err) => {
        if (err) {
            req.session.error_msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran file TTD Bidang melebihi batas maksimal 512 KB!'
                : err.message;
            return res.redirect(`/lembaga-admin/bidang/edit/${req.params.id}`);
        }
        next();
    });
}, async (req, res) => {
    try {
        const bidangId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        const { nama_bidang, deskripsi_tugas } = req.body;
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        if (!bidangId || !nama_bidang || nama_bidang.trim() === '') {
            req.session.error_msg = 'Nama bidang wajib diisi!';
            return res.redirect(`/lembaga-admin/bidang/edit/${req.params.id}`);
        }

        const bidang = await Bidang.findOne({
            where: { id: bidangId, lembagaId, tahun: tahunAktifInt }
        });
        if (!bidang) {
            return res.status(404).send('Data bidang tidak ditemukan!');
        }

        bidang.nama_bidang = nama_bidang.trim();
        bidang.deskripsi_tugas = deskripsi_tugas ? deskripsi_tugas.trim() : null;

        if (req.file) {
            bidang.ttd_bidang = req.file.filename;
        }

        await bidang.save();

        req.session.success_msg = 'Data bidang dan tanda tangan berhasil diperbarui!';
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error('Gagal mengupdate bidang:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/bidang/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        if (!bidangId || !lembagaId) {
            return res.redirect('/lembaga-admin/bidang');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [jumlahProker, jumlahUser] = await Promise.all([
            Proker.count({ where: { bidangId, lembagaId, tahun: tahunAktifInt } }),
            User.count({ where: { id_bidang: bidangId, lembagaId } })
        ]);

        if (jumlahProker > 0 || jumlahUser > 0) {
            req.session.error_msg = `Bidang tidak dapat dihapus karena masih memiliki ${jumlahProker} program kerja dan ${jumlahUser} pengurus terkait.`;
            return res.redirect('/lembaga-admin/bidang');
        }

        await Bidang.destroy({ where: { id: bidangId, lembagaId, tahun: tahunAktifInt } });
        req.session.success_msg = 'Bidang berhasil dihapus.';
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error('Gagal menghapus bidang:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL MANAJEMEN PENGURUS (KHUSUS ADMIN STRUKTURAL)
// ==========================================
router.get('/pengurus', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const lembagaId = getActiveLembagaId(req.session.user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [lembagaData, users, bidangs] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            User.findAll({
                where: { lembagaId },
                attributes: USER_SAFE_ATTRIBUTES,
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }],
                order: [['id', 'ASC']]
            }),
            Bidang.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Users = users;
        lembagaData.Bidangs = bidangs;

        return res.render('kelola_pengurus', {
            pengaturan,
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error('Error halaman pengurus:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/pengurus/tambah', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const { nama_lengkap, username, password, role, jabatan, id_bidang } = req.body;
        const lembagaId = getActiveLembagaId(req.session.user);

        if (!nama_lengkap || !username || !password || nama_lengkap.trim() === '' || username.trim() === '' || password.trim() === '') {
            req.session.error_msg = 'Nama lengkap, username, dan password wajib diisi!';
            return res.redirect('/lembaga-admin/pengurus');
        }

        const cleanUsername = username.trim();
        const existingUser = await User.findOne({ where: { username: cleanUsername } });
        if (existingUser) {
            req.session.error_msg = `Username "${cleanUsername}" sudah digunakan. Silakan pilih username lain.`;
            return res.redirect('/lembaga-admin/pengurus');
        }

        let validBidangId = null;
        if (id_bidang) {
            const parsedBidangId = parsePositiveInt(id_bidang);
            if (parsedBidangId) {
                const bidangValid = await Bidang.findOne({ where: { id: parsedBidangId, lembagaId } });
                if (!bidangValid) {
                    req.session.error_msg = 'Bidang yang dipilih tidak valid untuk lembaga ini.';
                    return res.redirect('/lembaga-admin/pengurus');
                }
                validBidangId = parsedBidangId;
            }
        }

        const hashedPassword = bcrypt.hashSync(password.trim(), 10);

        await User.create({
            nama_lengkap: nama_lengkap.trim(),
            username: cleanUsername,
            password: hashedPassword,
            role: role || 'pengurus_bidang',
            jabatan: jabatan ? jabatan.trim() : null,
            id_bidang: validBidangId,
            lembagaId
        });

        req.session.success_msg = `Pengurus [${cleanUsername}] berhasil ditambahkan!`;
        return res.redirect('/lembaga-admin/pengurus');
    } catch (err) {
        console.error('Gagal menambah pengurus:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/pengurus/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        if (!userId || !lembagaId) {
            return res.redirect('/lembaga-admin/pengurus');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [targetUser, lembagaData, bidangs] = await Promise.all([
            User.findOne({
                where: { id: userId, lembagaId },
                attributes: USER_SAFE_ATTRIBUTES
            }),
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                order: [['id', 'ASC']]
            })
        ]);

        if (!targetUser) {
            req.session.error_msg = 'Data pengurus tidak ditemukan!';
            return res.redirect('/lembaga-admin/pengurus');
        }

        if (lembagaData) {
            lembagaData.Bidangs = bidangs;
        }

        return res.render('edit_pengurus', {
            pengaturan,
            userSession: req.session.user,
            targetUser,
            lembagaData
        });
    } catch (err) {
        console.error('Error halaman edit pengurus:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/pengurus/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        const { nama_lengkap, username, password, role, jabatan, id_bidang } = req.body;

        if (!userId || !lembagaId) {
            return res.redirect('/lembaga-admin/pengurus');
        }

        const targetUser = await User.findOne({ where: { id: userId, lembagaId } });
        if (!targetUser) {
            req.session.error_msg = 'Data pengurus tidak ditemukan!';
            return res.redirect('/lembaga-admin/pengurus');
        }

        if (username && username.trim() !== '' && username.trim() !== targetUser.username) {
            const duplicate = await User.findOne({
                where: {
                    username: username.trim(),
                    id: { [Op.ne]: userId }
                }
            });
            if (duplicate) {
                req.session.error_msg = `Username "${username.trim()}" sudah dipakai pengguna lain.`;
                return res.redirect(`/lembaga-admin/pengurus/edit/${userId}`);
            }
            targetUser.username = username.trim();
        }

        let validBidangId = null;
        if (id_bidang) {
            const parsedBidangId = parsePositiveInt(id_bidang);
            if (parsedBidangId) {
                const bidangValid = await Bidang.findOne({ where: { id: parsedBidangId, lembagaId } });
                if (!bidangValid) {
                    req.session.error_msg = 'Bidang yang dipilih tidak valid untuk lembaga ini.';
                    return res.redirect(`/lembaga-admin/pengurus/edit/${userId}`);
                }
                validBidangId = parsedBidangId;
            }
        }

        targetUser.nama_lengkap = nama_lengkap && nama_lengkap.trim() !== '' ? nama_lengkap.trim() : targetUser.nama_lengkap;
        targetUser.role = role || targetUser.role;
        targetUser.jabatan = jabatan ? jabatan.trim() : targetUser.jabatan;
        targetUser.id_bidang = validBidangId;

        if (password && password.trim() !== '') {
            targetUser.password = bcrypt.hashSync(password.trim(), 10);
        }

        await targetUser.save();

        req.session.success_msg = `Data pengurus [${targetUser.username}] dan Role berhasil diperbarui!`;
        return res.redirect('/lembaga-admin/pengurus');
    } catch (err) {
        console.error('Gagal mengupdate pengurus:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL PROGRAM KERJA & RAB
// ==========================================
router.get('/proker', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);
        const hasFullAccess = isPimpinanAtauBendahara(user);

        const bidangWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, id: user.id_bidang || -1, tahun: tahunAktifInt };

        const prokerWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, bidangId: user.id_bidang || -1, tahun: tahunAktifInt };

        const [lembagaData, bidangs, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({ where: bidangWhere, order: [['id', 'ASC']] }),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ],
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Bidangs = bidangs;
        lembagaData.Prokers = prokers;

        return res.render('manajemen_proker', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error('Error halaman proker:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/tambah', isLoggedIn, lembagaAdminController.storeProker, async (req, res) => {
    try {
        const user = req.session.user;
        const { nama_program, bidangId, deskripsi, status } = req.body;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const targetBidangId = isAdminStrukturalUser(user)
            ? parsePositiveInt(bidangId)
            : parsePositiveInt(user.id_bidang);

        if (!nama_program || nama_program.trim() === '' || !targetBidangId) {
            req.session.error_msg = 'Nama program dan bidang penanggung jawab wajib diisi!';
            return res.redirect('/lembaga-admin/proker');
        }

        const bidangValid = await Bidang.findOne({
            where: { id: targetBidangId, lembagaId, tahun: tahunAktifInt }
        });
        if (!bidangValid) {
            req.session.error_msg = 'Bidang penanggung jawab tidak valid pada tahun aktif!';
            return res.redirect('/lembaga-admin/proker');
        }

        let bulanPelaksanaan = req.body.bulan;
        if (Array.isArray(bulanPelaksanaan)) {
            bulanPelaksanaan = bulanPelaksanaan.map(b => String(b).trim()).filter(Boolean).join(',');
        } else if (!bulanPelaksanaan) {
            bulanPelaksanaan = '';
        }

        await Proker.create({
            nama_program: nama_program.trim(),
            bidangId: targetBidangId,
            lembagaId,
            deskripsi: deskripsi ? deskripsi.trim() : null,
            waktu_pelaksanaan: bulanPelaksanaan,
            status: status || 'Direncanakan',
            anggaran: 0,
            tahun: tahunAktifInt
        });

        req.session.success_msg = 'Program kerja berhasil ditambahkan!';
        return res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error('Gagal menambah proker:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!prokerId || !lembagaId) {
            return res.redirect('/lembaga-admin/proker');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [proker, bidangs] = await Promise.all([
            Proker.findOne({ where: { id: prokerId, lembagaId, tahun: tahunAktifInt } }),
            Bidang.findAll({ where: { lembagaId, tahun: tahunAktifInt }, order: [['id', 'ASC']] })
        ]);

        if (!proker) {
            req.session.error_msg = 'Program kerja tidak ditemukan pada tahun aktif!';
            return res.redirect('/lembaga-admin/proker');
        }

        if (!canManageProker(user, proker)) {
            req.session.error_msg = 'Anda tidak memiliki akses untuk mengedit program kerja ini!';
            return res.redirect('/lembaga-admin/proker');
        }

        return res.render('edit_proker', {
            pengaturan,
            userSession: user,
            proker,
            bidangs
        });
    } catch (err) {
        console.error('Error ambil form edit proker:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const { nama_program, bidangId, deskripsi, status } = req.body;
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const proker = await Proker.findOne({ where: { id: prokerId, lembagaId, tahun: tahunAktifInt } });
        if (!proker) {
            return res.status(404).send('Program kerja tidak ditemukan!');
        }

        if (!canManageProker(user, proker)) {
            return res.status(403).send('Akses ditolak!');
        }

        let targetBidangId = proker.bidangId;
        if (isAdminStrukturalUser(user) && bidangId) {
            const parsedBidangId = parsePositiveInt(bidangId);
            if (parsedBidangId) {
                const bidangValid = await Bidang.findOne({
                    where: { id: parsedBidangId, lembagaId, tahun: tahunAktifInt }
                });
                if (!bidangValid) {
                    req.session.error_msg = 'Bidang tujuan tidak valid!';
                    return res.redirect(`/lembaga-admin/proker/edit/${prokerId}`);
                }
                targetBidangId = parsedBidangId;
            }
        }

        let bulanPelaksanaan = req.body.bulan;
        if (Array.isArray(bulanPelaksanaan)) {
            bulanPelaksanaan = bulanPelaksanaan.map(b => String(b).trim()).filter(Boolean).join(',');
        } else if (!bulanPelaksanaan) {
            bulanPelaksanaan = proker.waktu_pelaksanaan;
        }

        await proker.update({
            nama_program: nama_program && nama_program.trim() !== '' ? nama_program.trim() : proker.nama_program,
            bidangId: targetBidangId,
            deskripsi: deskripsi ? deskripsi.trim() : null,
            waktu_pelaksanaan: bulanPelaksanaan,
            status: status || proker.status
        });

        req.session.success_msg = 'Program kerja berhasil diperbarui!';
        return res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error('Gagal update proker:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/rab/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!prokerId || !lembagaId) {
            return res.redirect('/lembaga-admin/proker');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const proker = await Proker.findOne({
            where: { id: prokerId, lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                { model: Lembaga, as: 'Lembaga', attributes: LEMBAGA_LIGHT_ATTRIBUTES },
                { model: RincianBiaya, as: 'RincianBiayas' }
            ]
        });

        if (!proker) {
            req.session.error_msg = 'Program kerja tidak ditemukan!';
            return res.redirect('/lembaga-admin/proker');
        }

        return res.render('manajemen_rab', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error('Error halaman RAB:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/rab/tambah/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const { nama_item, satuan, jumlah, harga_satuan } = req.body;

        const jml = parseNonNegativeNumber(jumlah);
        const harga = parseNonNegativeNumber(harga_satuan);

        if (!prokerId || !nama_item || nama_item.trim() === '' || jml === null || jml <= 0 || harga === null) {
            req.session.error_msg = 'Nama item, volume (> 0), dan harga satuan wajib diisi dengan valid!';
            return res.redirect(`/lembaga-admin/proker/rab/${req.params.id}`);
        }

        const proker = await Proker.findOne({ where: { id: prokerId, lembagaId } });
        if (!proker) {
            req.session.error_msg = 'Program kerja tidak ditemukan!';
            return res.redirect('/lembaga-admin/proker');
        }

        if (!canManageProker(user, proker)) {
            req.session.error_msg = 'Anda tidak memiliki akses untuk menambah RAB pada program kerja ini!';
            return res.redirect('/lembaga-admin/proker');
        }

        let jumlahBulan = 1;
        if (proker.waktu_pelaksanaan) {
            const bulanArr = proker.waktu_pelaksanaan.split(',').filter(Boolean);
            if (bulanArr.length > 0) {
                jumlahBulan = bulanArr.length;
            }
        }

        const totalBiaya = jml * harga * jumlahBulan;

        await RincianBiaya.create({
            prokerId,
            nama_item: nama_item.trim(),
            satuan: satuan && satuan.trim() !== '' ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: jumlahBulan,
            total: totalBiaya
        });

        await recalculateProkerAnggaran(prokerId);

        req.session.success_msg = 'Item rincian biaya berhasil ditambahkan!';
        return res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error('Gagal menambah item RAB:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/rab/edit/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = parsePositiveInt(req.params.idItem);
        const user = req.session.user;
        if (!idItem) {
            return res.redirect('/lembaga-admin/proker');
        }

        const pengaturan = await getCachedPengaturan();

        const itemRAB = await RincianBiaya.findByPk(idItem, {
            include: [{ model: Proker, as: 'Proker' }]
        });

        if (!itemRAB || !itemRAB.Proker) {
            req.session.error_msg = 'Item RAB tidak ditemukan!';
            return res.redirect('/lembaga-admin/proker');
        }

        if (!canManageProker(user, itemRAB.Proker)) {
            req.session.error_msg = 'Akses ditolak! Item RAB berada di luar wewenang Anda.';
            return res.redirect('/lembaga-admin/proker');
        }

        return res.render('edit_rab', {
            pengaturan,
            userSession: user,
            itemRAB
        });
    } catch (err) {
        console.error('Error ambil form edit RAB:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/rab/edit/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = parsePositiveInt(req.params.idItem);
        const user = req.session.user;
        const { nama_item, satuan, jumlah, harga_satuan } = req.body;

        const jml = parseNonNegativeNumber(jumlah);
        const harga = parseNonNegativeNumber(harga_satuan);

        if (!idItem || !nama_item || nama_item.trim() === '' || jml === null || jml <= 0 || harga === null) {
            req.session.error_msg = 'Input rincian biaya tidak valid!';
            return res.redirect('/lembaga-admin/proker');
        }

        const itemRAB = await RincianBiaya.findByPk(idItem, {
            include: [{ model: Proker, as: 'Proker' }]
        });
        if (!itemRAB || !itemRAB.Proker) {
            return res.status(404).send('Item RAB tidak ditemukan!');
        }

        if (!canManageProker(user, itemRAB.Proker)) {
            return res.status(403).send('Akses ditolak!');
        }

        let jumlahBulan = 1;
        if (itemRAB.Proker.waktu_pelaksanaan) {
            const bulanArr = itemRAB.Proker.waktu_pelaksanaan.split(',').filter(Boolean);
            if (bulanArr.length > 0) jumlahBulan = bulanArr.length;
        }

        const totalBiaya = jml * harga * jumlahBulan;

        await itemRAB.update({
            nama_item: nama_item.trim(),
            satuan: satuan && satuan.trim() !== '' ? satuan.trim() : 'Pcs',
            jumlah: jml,
            harga_satuan: harga,
            bulan: jumlahBulan,
            total: totalBiaya
        });

        await recalculateProkerAnggaran(itemRAB.prokerId);

        req.session.success_msg = 'Item RAB berhasil diperbarui!';
        return res.redirect(`/lembaga-admin/proker/rab/${itemRAB.prokerId}`);
    } catch (err) {
        console.error('Gagal update item RAB:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/rab/hapus/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = parsePositiveInt(req.params.idItem);
        const user = req.session.user;
        if (!idItem) {
            return res.redirect('/lembaga-admin/proker');
        }

        const itemRAB = await RincianBiaya.findByPk(idItem, {
            include: [{ model: Proker, as: 'Proker' }]
        });

        if (!itemRAB || !itemRAB.Proker) {
            return res.status(404).send('Item rincian biaya tidak ditemukan!');
        }

        if (!canManageProker(user, itemRAB.Proker)) {
            return res.status(403).send('Akses ditolak!');
        }

        const prokerId = itemRAB.prokerId;
        await itemRAB.destroy();

        await recalculateProkerAnggaran(prokerId);

        req.session.success_msg = 'Item RAB berhasil dihapus.';
        return res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error('Gagal menghapus item RAB:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL KEUANGAN & LAPORAN
// ==========================================
router.get('/anggaran', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);
        const hasFullAccess = isPimpinanAtauBendahara(user);

        const bidangWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, id: user.id_bidang || -1, tahun: tahunAktifInt };

        const prokerWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, bidangId: user.id_bidang || -1, tahun: tahunAktifInt };

        const [lembagaData, bidangs, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({ where: bidangWhere, order: [['id', 'ASC']] }),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ],
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Bidangs = bidangs;
        lembagaData.Prokers = prokers;

        return res.render('rekap_anggaran', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error('Error halaman rekap anggaran:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/realisasi', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);
        const hasFullAccess = isPimpinanAtauBendahara(user);

        const bidangWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, id: user.id_bidang || -1, tahun: tahunAktifInt };

        const prokerWhere = hasFullAccess
            ? { lembagaId, tahun: tahunAktifInt }
            : { lembagaId, bidangId: user.id_bidang || -1, tahun: tahunAktifInt };

        const [lembagaData, bidangs, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Bidang.findAll({ where: bidangWhere, order: [['id', 'ASC']] }),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: RincianBiaya, as: 'RincianBiayas', attributes: ['id', 'prokerId', 'total'] },
                    { model: RealisasiBiaya, as: 'Realisasis', attributes: ['id', 'prokerId', 'nominal_realisasi'] }
                ],
                order: [['id', 'ASC']]
            })
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Bidangs = bidangs;
        lembagaData.Prokers = prokers;

        return res.render('laporan_realisasi', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error('Error halaman laporan realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/realisasi/:id', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!prokerId || !lembagaId) {
            return res.redirect('/lembaga-admin/realisasi');
        }

        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const proker = await Proker.findOne({
            where: { id: prokerId, lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                { model: Lembaga, as: 'Lembaga', attributes: LEMBAGA_LIGHT_ATTRIBUTES },
                { model: RincianBiaya, as: 'RincianBiayas' },
                { model: RealisasiBiaya, as: 'Realisasis' }
            ]
        });

        if (!proker) {
            req.session.error_msg = 'Program kerja tidak ditemukan!';
            return res.redirect('/lembaga-admin/realisasi');
        }

        return res.render('manajemen_realisasi', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error('Error halaman kelola realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// RUTE TAMBAH REALISASI DENGAN DUKUNGAN UPLOAD BUKTI NOTA (Maks. 512 KB)
router.post('/proker/realisasi/tambah/:id', isLoggedIn, (req, res, next) => {
    uploadRealisasi(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                req.session.error_msg = 'Gagal menambah realisasi: Ukuran file bukti nota melebihi batas maksimal 512 KB!';
            } else {
                req.session.error_msg = 'Gagal mengunggah file: ' + err.message;
            }
            return res.redirect(`/lembaga-admin/proker/realisasi/${req.params.id}`);
        } else if (err) {
            req.session.error_msg = err.message;
            return res.redirect(`/lembaga-admin/proker/realisasi/${req.params.id}`);
        }
        next();
    });
}, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const { uraian_pengeluaran, nominal_realisasi, tanggal_transaksi, keterangan } = req.body;

        const nominal = parseNonNegativeNumber(nominal_realisasi);

        if (!prokerId || !uraian_pengeluaran || uraian_pengeluaran.trim() === '' || nominal === null || nominal <= 0 || !tanggal_transaksi) {
            if (req.file) {
                fs.unlink(path.join(uploadRealizDir, req.file.filename), () => {});
            }
            req.session.error_msg = 'Uraian pengeluaran, nominal (> 0), dan tanggal transaksi wajib diisi dengan valid!';
            return res.redirect(`/lembaga-admin/proker/realisasi/${req.params.id}`);
        }

        const proker = await Proker.findOne({ where: { id: prokerId, lembagaId } });
        if (!proker || !canManageProker(user, proker)) {
            if (req.file) {
                fs.unlink(path.join(uploadRealizDir, req.file.filename), () => {});
            }
            req.session.error_msg = 'Program kerja tidak ditemukan atau di luar wewenang Anda!';
            return res.redirect('/lembaga-admin/realisasi');
        }

        const buktiNotaFilename = req.file ? req.file.filename : null;

        await RealisasiBiaya.create({
            prokerId,
            userId: user.id,
            uraian_pengeluaran: uraian_pengeluaran.trim(),
            nominal_realisasi: nominal,
            tanggal_transaksi,
            keterangan: keterangan ? keterangan.trim() : null,
            bukti_nota: buktiNotaFilename
        });

        req.session.success_msg = 'Realisasi biaya dan bukti nota berhasil disimpan!';
        return res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error('Gagal menambah realisasi biaya:', err);
        req.session.error_msg = 'Terjadi kesalahan pada server: ' + err.message;
        return res.redirect(`/lembaga-admin/proker/realisasi/${req.params.id}`);
    }
});

router.get('/proker/realisasi/hapus/:idItem', isLoggedIn, async (req, res) => {
    try {
        const idItem = parsePositiveInt(req.params.idItem);
        const user = req.session.user;
        if (!idItem) {
            return res.redirect('/lembaga-admin/realisasi');
        }

        const realisasi = await RealisasiBiaya.findByPk(idItem, {
            include: [{ model: Proker, as: 'Proker' }]
        });

        if (!realisasi || !realisasi.Proker) {
            return res.status(404).send('Data realisasi tidak ditemukan!');
        }

        if (!canManageProker(user, realisasi.Proker)) {
            return res.status(403).send('Akses ditolak! Realisasi berada di luar wewenang Anda.');
        }

        const prokerId = realisasi.prokerId;
        const oldNotaFile = realisasi.bukti_nota;

        await realisasi.destroy();

        if (oldNotaFile) {
            const safeFilename = path.basename(oldNotaFile);
            fs.unlink(path.join(uploadRealizDir, safeFilename), () => {});
        }

        req.session.success_msg = 'Data realisasi berhasil dihapus.';
        return res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error('Gagal menghapus realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE HALAMAN PRATINJAU / PILIHAN CETAK REKAP GLOBAL ---
router.get('/rekap-global', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();

        const lembaga = await Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES });
        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        const { success_msg } = popFlashMessages(req);

        return res.render('rekap_global_form', {
            pengaturan,
            userSession: user,
            lembaga,
            success_msg
        });
    } catch (err) {
        console.error('Gagal membuka halaman rekap global:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE SIMPAN PENGATURAN CETAK REKAP GLOBAL ---
router.post('/rekap-global/simpan', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const {
            nama_ketua, pembina_senkom,
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ketua, show_pengaju, show_pembina,
            show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img, show_pembina_lembaga
        } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.pembina_senkom = pembina_senkom ? pembina_senkom.trim() : null;
        lembaga.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        lembaga.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        lembaga.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        lembaga.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        lembaga.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        lembaga.pembina_6 = pembina_6 ? pembina_6.trim() : null;

        lembaga.print_stempel = parseBooleanFlag(show_stempel);
        lembaga.print_ttd_ketua_img = parseBooleanFlag(show_ttd_ketua_img);
        lembaga.print_ttd_pengaju_img = parseBooleanFlag(show_ttd_pengaju_img);
        lembaga.print_ttd_pembina_img = parseBooleanFlag(show_ttd_pembina_img);
        lembaga.print_ketua = parseBooleanFlag(show_ketua);
        lembaga.print_pengaju = parseBooleanFlag(show_pengaju);
        lembaga.print_pembina_lembaga = parseBooleanFlag(show_pembina_lembaga);
        lembaga.print_pembina = parseBooleanFlag(show_pembina);

        await lembaga.save();

        req.session.success_msg = 'Pengaturan cetak berhasil disimpan! Silakan klik Buka Pratinjau & Cetak.';
        return res.redirect('/lembaga-admin/rekap-global');
    } catch (err) {
        console.error('Gagal menyimpan pengaturan rekap global:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE EKSEKUSI CETAK REKAPITULASI GLOBAL TAHUNAN ---
router.get('/rekap-global/print', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [lembaga, listProker] = await Promise.all([
            Lembaga.findByPk(lembagaId),
            Proker.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ],
                order: [['bidangId', 'ASC'], ['id', 'ASC']]
            })
        ]);

        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        return res.render('print_rekap_global', {
            lembaga,
            listProker,
            prokers: listProker,
            pengaturan,
            tahunAktif: tahunAktifInt,
            userSession: user
        });
    } catch (err) {
        console.error('Gagal mencetak rekap global:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE HALAMAN PRATINJAU / KONFIGURASI CETAK LAPORAN REALISASI ---
router.get('/realisasi/print-config', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();

        const lembaga = await Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES });
        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin/realisasi');
        }

        const { success_msg } = popFlashMessages(req);

        return res.render('realisasi_print_form', {
            pengaturan,
            userSession: user,
            lembaga,
            success_msg
        });
    } catch (err) {
        console.error('Gagal membuka konfigurasi cetak realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE SIMPAN KONFIGURASI CETAK LAPORAN REALISASI ---
router.post('/realisasi/print-config/simpan', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const {
            nama_ketua, pembina_senkom,
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ketua, show_pengaju, show_pembina,
            show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img, show_pembina_lembaga
        } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin/realisasi');
        }

        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.pembina_senkom = pembina_senkom ? pembina_senkom.trim() : null;
        lembaga.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        lembaga.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        lembaga.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        lembaga.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        lembaga.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        lembaga.pembina_6 = pembina_6 ? pembina_6.trim() : null;

        lembaga.print_stempel = parseBooleanFlag(show_stempel);
        lembaga.print_ttd_ketua_img = parseBooleanFlag(show_ttd_ketua_img);
        lembaga.print_ttd_pengaju_img = parseBooleanFlag(show_ttd_pengaju_img);
        lembaga.print_ttd_pembina_img = parseBooleanFlag(show_ttd_pembina_img);
        lembaga.print_ketua = parseBooleanFlag(show_ketua);
        lembaga.print_pengaju = parseBooleanFlag(show_pengaju);
        lembaga.print_pembina_lembaga = parseBooleanFlag(show_pembina_lembaga);
        lembaga.print_pembina = parseBooleanFlag(show_pembina);

        await lembaga.save();

        req.session.success_msg = 'Pengaturan cetak realisasi berhasil disimpan!';
        return res.redirect('/lembaga-admin/realisasi/print');
    } catch (err) {
        console.error('Gagal menyimpan pengaturan cetak realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE EKSEKUSI CETAK LAPORAN REALISASI (DENGAN DUKUNGAN FILTER TANGGAL) ---
router.get('/realisasi/print', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const startDate = req.query.start_date || req.query.tanggal_mulai;
        const endDate = req.query.end_date || req.query.tanggal_selesai;

        const realisasiWhere = {};
        if (startDate && endDate) {
            realisasiWhere.tanggal_transaksi = {
                [Op.between]: [startDate, endDate]
            };
        }

        const prokerWhere = { lembagaId, tahun: tahunAktifInt };
        if (!isPimpinanAtauBendahara(user) && user.id_bidang) {
            prokerWhere.bidangId = user.id_bidang;
        }

        const [lembaga, listProkerRaw] = await Promise.all([
            Lembaga.findByPk(lembagaId),
            Proker.findAll({
                where: prokerWhere,
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' },
                    {
                        model: RealisasiBiaya,
                        as: 'Realisasis',
                        where: Object.keys(realisasiWhere).length > 0 ? realisasiWhere : undefined,
                        required: false
                    }
                ],
                order: [['bidangId', 'ASC'], ['id', 'ASC']]
            })
        ]);

        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        let listProker = listProkerRaw;
        if (startDate && endDate) {
            listProker = listProker.map(proker => {
                if (proker.Realisasis) {
                    proker.Realisasis = proker.Realisasis.filter(r => {
                        return r.tanggal_transaksi >= startDate && r.tanggal_transaksi <= endDate;
                    });
                }
                return proker;
            });
        }

        return res.render('print_realisasi', {
            lembaga,
            listProker,
            prokers: listProker,
            pengaturan,
            tahunAktif: tahunAktifInt,
            userSession: user,
            query: req.query
        });
    } catch (err) {
        console.error('Gagal mencetak laporan realisasi:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL PENGAJUAN (PROPOSAL / TANPA PROPOSAL) & APPROVAL
// ==========================================
router.get('/proker/proposal/:prokerId', isLoggedIn, async (req, res) => {
    try {
        const prokerId = parsePositiveInt(req.params.prokerId);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!prokerId || !lembagaId) {
            return res.redirect('/lembaga-admin');
        }

        const [proker, lembaga] = await Promise.all([
            Proker.findOne({
                where: { id: prokerId, lembagaId },
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }]
            }),
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES })
        ]);

        if (!proker) {
            req.session.error_msg = 'Program Kerja tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        const batasAnggaranProposal = Number(lembaga && lembaga.batas_anggaran_proposal ? lembaga.batas_anggaran_proposal : 2000000);
        const anggaranProker = Number(proker.anggaran || 0);

        let proposal = await Proposal.findOne({ where: { prokerId: proker.id, lembagaId } });

        if (!proposal) {
            proposal = await Proposal.create({
                prokerId: proker.id,
                lembagaId,
                userId: user.id,
                jenis_pengajuan: anggaranProker > batasAnggaranProposal ? 'dengan_proposal' : 'tanpa_proposal',
                latar_belakang: `Dalam rangka menunjang efektivitas dan pencapaian target kerja operasional pada ${proker.Bidang ? proker.Bidang.nama_bidang : 'lembaga'}, maka diselenggarakan program kerja "${proker.nama_program}". Kegiatan ini dirancang sebagai langkah strategis untuk merealisasikan sasaran program tahunan secara terstruktur.`,
                tujuan: `- Meningkatkan kualitas pelaksanaan program kerja bidang.\n- Memastikan pencapaian target operasional secara optimal.\n- Mempererat koordinasi dan sinergi antar pengurus.`,
                tema: `Optimalisasi Kinerja dan Sinergi Melalui ${proker.nama_program}`,
                status: 'Draft'
            });
        }

        const { success_msg, error_msg } = popFlashMessages(req);

        return res.render('detail_proposal', {
            userSession: user,
            proker,
            proposal,
            lembaga,
            batasAnggaranProposal,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error('Gagal membuat/membuka pengajuan:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/proposal/update/:id', isLoggedIn, async (req, res) => {
    try {
        const proposalId = parsePositiveInt(req.params.id);
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        if (!proposalId || !lembagaId) {
            return res.redirect('/lembaga-admin/proposal');
        }

        const {
            tema, latar_belakang, tujuan, tanggal_kegiatan, tempat_kegiatan, dresscode_kegiatan,
            action, jenis_pengajuan,
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img,
            show_ketua, show_pengaju, show_pembina_lembaga, show_pembina
        } = req.body;

        const proposal = await Proposal.findOne({
            where: { id: proposalId, lembagaId },
            include: [{ model: Proker, as: 'Proker' }]
        });
        if (!proposal) {
            req.session.error_msg = 'Data pengajuan tidak ditemukan!';
            return res.redirect('/lembaga-admin/proposal');
        }

        if (proposal.Proker && !canManageProker(user, proposal.Proker)) {
            req.session.error_msg = 'Anda tidak memiliki wewenang mengubah pengajuan ini.';
            return res.redirect('/lembaga-admin/proposal');
        }

        proposal.jenis_pengajuan = jenis_pengajuan === 'tanpa_proposal' ? 'tanpa_proposal' : 'dengan_proposal';
        proposal.tema = tema;
        proposal.latar_belakang = latar_belakang;
        proposal.tujuan = tujuan;
        proposal.tanggal_kegiatan = tanggal_kegiatan ? tanggal_kegiatan.trim() : null;
        proposal.tempat_kegiatan = tempat_kegiatan ? tempat_kegiatan.trim() : null;
        proposal.dresscode_kegiatan = dresscode_kegiatan ? dresscode_kegiatan.trim() : null;
        proposal.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        proposal.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        proposal.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        proposal.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        proposal.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        proposal.pembina_6 = pembina_6 ? pembina_6.trim() : null;

        if (action === 'submit') {
            proposal.status = 'Diajukan';
            req.session.success_msg = proposal.jenis_pengajuan === 'tanpa_proposal'
                ? 'Pengajuan (Tanpa Proposal) berhasil dikirim untuk persetujuan!'
                : 'Pengajuan (Dengan Proposal) berhasil dikirim untuk persetujuan!';
        } else {
            req.session.success_msg = 'Draf pengajuan dan konfigurasi tanda tangan berhasil disimpan!';
        }
        await proposal.save();

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (lembaga) {
            lembaga.print_stempel = parseBooleanFlag(show_stempel);
            lembaga.print_ttd_ketua_img = parseBooleanFlag(show_ttd_ketua_img);
            lembaga.print_ttd_pengaju_img = parseBooleanFlag(show_ttd_pengaju_img);
            lembaga.print_ttd_pembina_img = parseBooleanFlag(show_ttd_pembina_img);
            lembaga.print_ketua = parseBooleanFlag(show_ketua);
            lembaga.print_pengaju = parseBooleanFlag(show_pengaju);
            lembaga.print_pembina_lembaga = parseBooleanFlag(show_pembina_lembaga);
            lembaga.print_pembina = parseBooleanFlag(show_pembina);
            await lembaga.save();
        }

        return res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
    } catch (err) {
        console.error('Gagal mengupdate pengajuan:', err);
        req.session.error_msg = 'Terjadi kesalahan pada server.';
        return res.redirect('/lembaga-admin/proposal');
    }
});

// --- RUTE MODUL LPJ ---
router.get('/proker/proposal/lpj/:id', isLoggedIn, realisasiLpjController.formLpj);
const handleUploadLpjFiles = (req, res, next) => {
    uploadLpjFiles(req, res, (err) => {
        if (!err) {
            return next();
        }

        const fallbackUrl = req.params && req.params.id
            ? `/lembaga-admin/proker/proposal/lpj/${req.params.id}`
            : '/lembaga-admin/proposal';

        if (err.code === 'LIMIT_FILE_SIZE') {
            req.session.error_msg = 'Gagal mengunggah berkas LPJ: Ukuran setiap file maksimal 512 KB.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
            req.session.error_msg = 'Gagal mengunggah berkas LPJ: Jumlah atau field file tidak sesuai.';
        } else {
            req.session.error_msg = 'Gagal mengunggah berkas LPJ: ' + (err.message || 'Berkas tidak valid.');
        }

        return res.redirect(req.get('Referer') || fallbackUrl);
    });
};

router.post('/proker/proposal/lpj/update/:id', isLoggedIn, handleUploadLpjFiles, realisasiLpjController.storeOrUpdateLpj);

// --- RUTE APPROVAL & PENCAIRAN ---
router.post('/proker/proposal/ajukan/:id', isLoggedIn, prokerController.ajukanProposal);
router.post('/proker/proposal/review/:id', isLoggedIn, prokerController.reviewApprovalKetua);
router.post('/proker/proposal/pencairan/:id', isLoggedIn, prokerController.prosesPencairanBendahara);
router.get('/proker/bidang/:bidangId/print', isLoggedIn, prokerController.cetakPerBidang);

router.get('/proposal', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const whereCondition = {
            lembagaId,
            tahun: tahunAktifInt
        };

        if (!isPimpinanAtauBendahara(user) && user.id_bidang) {
            whereCondition.bidangId = user.id_bidang;
        }

        const [lembaga, prokers] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: ['id', 'batas_anggaran_proposal'] }),
            Proker.findAll({
                where: whereCondition,
                include: [
                    { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                    { model: Proposal, as: 'Proposal' }
                ],
                order: [['id', 'ASC']]
            })
        ]);

        const batasAnggaranProposal = Number(lembaga && lembaga.batas_anggaran_proposal ? lembaga.batas_anggaran_proposal : 2000000);
        const { success_msg, error_msg } = popFlashMessages(req);

        return res.render('list_proposal', {
            userSession: user,
            pengaturan,
            prokers,
            batasAnggaranProposal,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error('Gagal memuat daftar pengajuan:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proker/proposal/print/:id', isLoggedIn, async (req, res) => {
    try {
        const proposalId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        if (!proposalId || !lembagaId) {
            return res.redirect('/lembaga-admin/proposal');
        }

        const proposal = await Proposal.findOne({
            where: { id: proposalId, lembagaId },
            include: [
                {
                    model: Proker,
                    as: 'Proker',
                    include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ]
                },
                { model: User, as: 'User', attributes: USER_SAFE_ATTRIBUTES }
            ]
        });

        if (!proposal || !proposal.Proker) {
            req.session.error_msg = 'Proposal tidak ditemukan!';
            return res.redirect('/lembaga-admin/proposal');
        }

        const lembaga = await Lembaga.findByPk(proposal.Proker.lembagaId);

        return res.render('print_proposal', {
            proposal,
            proker: proposal.Proker,
            rincianRab: proposal.Proker.RincianBiayas || [],
            lembaga,
            userSession: req.session.user,
            req
        });
    } catch (err) {
        console.error('Gagal membuka pratinjau cetak proposal:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/proposal/approval', isLoggedIn, ensureApprovalAccess, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const prokers = await Proker.findAll({
            where: { lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] },
                { model: Proposal, as: 'Proposal' }
            ],
            order: [['id', 'ASC']]
        });

        const { success_msg, error_msg } = popFlashMessages(req);

        return res.render('proposal_approval', {
            userSession: user,
            pengaturan,
            prokers,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error('Gagal memuat halaman approval proposal:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/proker/proposal/approval/:id', isLoggedIn, ensureApprovalAccess, async (req, res) => {
    try {
        const proposalId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        const { status, catatan_revisi } = req.body;

        const ALLOWED_STATUS = ['Diajukan', 'Disetujui', 'Perlu Revisi', 'Direvisi', 'Ditolak'];
        if (!proposalId || !ALLOWED_STATUS.includes(status)) {
            req.session.error_msg = 'Status persetujuan tidak valid!';
            return res.redirect('/lembaga-admin/proposal/approval');
        }

        const proposal = await Proposal.findOne({ where: { id: proposalId, lembagaId } });
        if (!proposal) {
            req.session.error_msg = 'Proposal tidak ditemukan!';
            return res.redirect('/lembaga-admin/proposal/approval');
        }

        proposal.status = status;

        if (status === 'Perlu Revisi' || status === 'Direvisi') {
            proposal.catatan_revisi = catatan_revisi ? catatan_revisi.trim() : 'Mohon perbaiki proposal sesuai arahan.';
        } else if (status === 'Disetujui') {
            proposal.catatan_revisi = null;
        }

        await proposal.save();

        req.session.success_msg = 'Proposal berhasil diperbarui!';
        return res.redirect('/lembaga-admin/proposal/approval');
    } catch (err) {
        console.error('Gagal approval:', err);
        req.session.error_msg = 'Terjadi kesalahan server.';
        return res.redirect('/lembaga-admin/proposal/approval');
    }
});

// ==========================================
// MODUL SETTING LEMBAGA (KHUSUS ADMIN STRUKTURAL)
// ==========================================
router.get('/setting', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();

        const [lembaga, listLembaga] = await Promise.all([
            Lembaga.findByPk(lembagaId),
            getCachedLembagaList()
        ]);

        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }

        return res.render('setting_lembaga', {
            pengaturan,
            userSession: user,
            lembaga,
            listLembaga
        });
    } catch (err) {
        console.error('Error halaman setting lembaga:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/setting/update', isLoggedIn, isAdminLembaga, (req, res, next) => {
    upload.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'kop_surat', maxCount: 1 },
        { name: 'stempel', maxCount: 1 },
        { name: 'ttd_ketua', maxCount: 1 },
        { name: 'ttd_pembina_senkom', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) {
            req.session.error_msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran salah satu file melebihi batas maksimal 512 KB!'
                : err.message;
            return res.redirect('/lembaga-admin/setting');
        }
        next();
    });
}, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const {
            nama_organisasi, nama_ketua, pembina_lembaga, pembina_senkom,
            nomor_hp, alamat, batas_anggaran_proposal,
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6
        } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin/setting');
        }

        lembaga.nama_organisasi = nama_organisasi ? nama_organisasi.trim() : lembaga.nama_organisasi;
        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.pembina_lembaga = pembina_lembaga ? pembina_lembaga.trim() : null;
        lembaga.pembina_senkom = pembina_senkom ? pembina_senkom.trim() : null;
        lembaga.nomor_hp = nomor_hp ? nomor_hp.trim() : lembaga.nomor_hp;
        lembaga.alamat = alamat ? alamat.trim() : lembaga.alamat;

        const parsedBatas = Number(String(batas_anggaran_proposal || '').replace(/[^\d]/g, ''));
        lembaga.batas_anggaran_proposal = parsedBatas > 0 ? parsedBatas : 2000000;

        lembaga.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        lembaga.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        lembaga.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        lembaga.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        lembaga.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        lembaga.pembina_6 = pembina_6 ? pembina_6.trim() : null;

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
        if (req.files && req.files.ttd_pembina_senkom) {
            lembaga.ttd_pembina_senkom = req.files.ttd_pembina_senkom[0].filename;
        }

        await lembaga.save();
        invalidateLembagaListCache();

        req.session.success_msg = 'Profil, pengaturan lembaga, dan master pembina berhasil diperbarui!';
        return res.redirect('/lembaga-admin/setting');
    } catch (err) {
        console.error('Gagal memperbarui setting lembaga:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// ==========================================
// MODUL UTILITAS (KHUSUS ADMIN STRUKTURAL)
// ==========================================
router.get('/utilitas/users', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);
        const pengaturan = await getCachedPengaturan();
        const tahunAktifInt = getTahunAktifInt(pengaturan);

        const [lembagaData, users, bidangs, listLembaga] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            User.findAll({
                where: { lembagaId },
                attributes: USER_SAFE_ATTRIBUTES,
                include: [{ model: Bidang, as: 'Bidang', attributes: ['id', 'nama_bidang'] }],
                order: [['id', 'ASC']]
            }),
            Bidang.findAll({
                where: { lembagaId, tahun: tahunAktifInt },
                order: [['id', 'ASC']]
            }),
            getCachedLembagaList()
        ]);

        if (!lembagaData) {
            req.session.error_msg = 'Data lembaga tidak ditemukan!';
            return res.redirect('/lembaga-admin');
        }
        lembagaData.Users = users;
        lembagaData.Bidangs = bidangs;

        return res.render('utilitas_users', {
            pengaturan,
            userSession: user,
            lembaga: lembagaData,
            lembagaData,
            listLembaga
        });
    } catch (err) {
        console.error('Error halaman utilitas users:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.post('/utilitas/users/reset-password/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        const { password_baru } = req.body;

        if (!userId || !password_baru || password_baru.trim() === '') {
            req.session.error_msg = 'Password baru tidak boleh kosong!';
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        const targetUser = await User.findOne({ where: { id: userId, lembagaId } });
        if (!targetUser) {
            req.session.error_msg = 'User tidak ditemukan atau di luar wewenang Anda!';
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        targetUser.password = bcrypt.hashSync(password_baru.trim(), 10);
        await targetUser.save();

        req.session.success_msg = `Password untuk akun [${targetUser.username}] berhasil direset!`;
        return res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error('Gagal reset password:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

router.get('/utilitas/users/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = parsePositiveInt(req.params.id);
        const lembagaId = getActiveLembagaId(req.session.user);
        if (!userId || !lembagaId) {
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        if (userId === parsePositiveInt(req.session.user.id)) {
            req.session.error_msg = 'Anda tidak dapat menghapus akun yang sedang Anda gunakan!';
            return res.redirect('/lembaga-admin/utilitas/users');
        }

        await User.destroy({ where: { id: userId, lembagaId } });
        req.session.success_msg = 'Akun pengurus berhasil dihapus dari sistem.';
        return res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error('Gagal menghapus user:', err);
        return res.status(500).send('Terjadi kesalahan pada server: ' + err.message);
    }
});

// --- RUTE DIAGNOSTIK TEST MIGRASI 2027 (CLEAN & STRICT) ---
router.get('/diagnostik/test-migrasi-2027', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);

        const [lembaga, pengaturan, jumlahBidang2027, prokers2027] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            Pengaturan.findOne(),
            Bidang.count({ where: { lembagaId, tahun: 2027 } }),
            Proker.findAll({
                where: { lembagaId, tahun: 2027 },
                include: [{ model: RincianBiaya, as: 'RincianBiayas', attributes: ['id', 'total', 'harga_satuan'] }]
            })
        ]);

        const isTahunAktifValid = pengaturan && parseInt(pengaturan.tahun_aktif, 10) === 2027;

        let rabStrictValid = true;
        prokers2027.forEach(p => {
            if (p.RincianBiayas) {
                p.RincianBiayas.forEach(item => {
                    if (parseFloat(item.total) > 0 || parseFloat(item.harga_satuan) > 0) {
                        rabStrictValid = false;
                    }
                });
            }
        });

        const prokerIds2027 = prokers2027.map(p => p.id);
        let proposalCleanState = true;
        if (prokerIds2027.length > 0) {
            const countProposalAktif = await Proposal.count({
                where: {
                    prokerId: prokerIds2027,
                    status: { [Op.notIn]: ['Draft', 'Belum Ada Draf'] }
                }
            });
            if (countProposalAktif > 0) proposalCleanState = false;
        }

        const isCleanAndStrict = isTahunAktifValid && jumlahBidang2027 > 0 && rabStrictValid && proposalCleanState;

        return res.status(200).json({
            status: isCleanAndStrict ? 'OK' : 'WARNING',
            pesan: isCleanAndStrict
                ? 'Sistem migrasi ke tahun 2027 terverifikasi CLEAN dan STRICT dengan sempurna.'
                : 'Ditemukan ketidaksesuaian pada aturan migrasi tahun 2027.',
            waktu_cek: new Date(),
            validasi_aturan: {
                tahun_aktif_2027: isTahunAktifValid,
                bidang_termigrasi: jumlahBidang2027 > 0,
                rab_nominal_nol_strict: rabStrictValid,
                proposal_clean_state: proposalCleanState
            },
            user_session: {
                id: user.id,
                username: user.username,
                role: user.role,
                lembagaId
            },
            data_lembaga: {
                id: lembaga ? lembaga.id : null,
                nama_organisasi: lembaga ? lembaga.nama_organisasi : 'Tidak ditemukan',
                tahun_aktif: pengaturan ? pengaturan.tahun_aktif : null,
                konfigurasi_print: {
                    stempel: lembaga ? lembaga.print_stempel : null,
                    ketua: lembaga ? lembaga.print_ketua : null,
                    pengaju: lembaga ? lembaga.print_pengaju : null,
                    pembina: lembaga ? lembaga.print_pembina : null
                }
            }
        });
    } catch (err) {
        console.error('Error pada diagnostik migrasi:', err);
        return res.status(500).json({
            status: 'ERROR',
            pesan: 'Terjadi kesalahan pada server saat pengujian migrasi.',
            error: err.message
        });
    }
});

router.get('/diagnostik/cek', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = getActiveLembagaId(user);

        const [lembaga, pengaturan] = await Promise.all([
            Lembaga.findByPk(lembagaId, { attributes: LEMBAGA_LIGHT_ATTRIBUTES }),
            getCachedPengaturan()
        ]);

        return res.status(200).json({
            status: 'OK',
            pesan: 'Sistem diagnostik berjalan normal.',
            waktu_cek: new Date(),
            user_session: {
                id: user.id,
                username: user.username,
                role: user.role,
                lembagaId
            },
            data_lembaga: {
                id: lembaga ? lembaga.id : null,
                nama_organisasi: lembaga ? lembaga.nama_organisasi : 'Tidak ditemukan',
                tahun_aktif: pengaturan.tahun_aktif,
                konfigurasi_print: {
                    stempel: lembaga ? lembaga.print_stempel : null,
                    ketua: lembaga ? lembaga.print_ketua : null,
                    pengaju: lembaga ? lembaga.print_pengaju : null,
                    pembina: lembaga ? lembaga.print_pembina : null
                }
            }
        });
    } catch (err) {
        console.error('Error pada diagnostik sistem:', err);
        return res.status(500).json({
            status: 'ERROR',
            pesan: 'Terjadi kesalahan pada server saat pengecekan diagnostik.',
            error: err.message
        });
    }
});

module.exports = router;
