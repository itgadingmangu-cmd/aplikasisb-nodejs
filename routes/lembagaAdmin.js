'use strict';

const express = require('express');
const router = express.Router();
const { User, Lembaga, Bidang, Proker, Proposal, RincianBiaya, RealisasiBiaya, Pengaturan } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const prokerController = require('../controllers/prokerController'); 
const realisasiLpjController = require('../controllers/realisasiLpjController');
const lembagaAdminController = require('../controllers/lembagaAdminController');
const uploadLpjFiles = require('../config/multerLpj');

// --- PANGGIL MIDDLEWARE DI ATAS SEBELUM DIGUNAKAN PADA RUTE ---
const { isLoggedIn, isAdminLembaga } = require('../middleware/auth');

// --- KONFIGURASI MULTER UNTUK UPLOAD LOGO & TTD ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/logo/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- MODUL PROFIL & UPLOAD TTD PRIBADI ---
router.get('/profile', isLoggedIn, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const currentUser = await User.findByPk(userId, {
            include: [{ model: Bidang, as: 'Bidang' }]
        });

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        return res.render('profile', {
            title: 'Profil & Tanda Tangan Saya',
            userSession: req.session.user,
            currentUser,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error("Gagal memuat halaman profil:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/profile/update-ttd', isLoggedIn, upload.single('ttd'), lembagaAdminController.updateTtdProfile);

// --- KONFIGURASI MULTER KHUSUS UNTUK UPLOAD BUKTI NOTA REALISASI (Maks. 1 MB) ---
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
        cb(null, 'realisasi-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadRealisasi = multer({
    storage: storageRealisasi,
    limits: { fileSize: 1 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|pdf/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Hanya mengizinkan file gambar (JPG/PNG) atau PDF dengan ukuran maksimal 1 MB!'));
    }
}).single('bukti_nota');

// --- MIDDLEWARE KHUSUS BENDAHARA UTAMA ---
function ensureBendaharaUtama(req, res, next) {
    const user = req.session.user;
    if (user && (user.role === 'admin_lembaga' || user.role === 'superadmin' || user.jabatan === 'Bendahara' || user.role === 'bendahara_utama')) {
        return next();
    }
    req.session.error_msg = "Akses ditolak. Halaman ini khusus untuk Bendahara Utama (Akses Utama).";
    return res.redirect('/lembaga-admin');
}

// ==========================================
// MODUL EKSPOR LAPORAN
// ==========================================
router.get('/ekspor/excel', isLoggedIn, async (req, res) => {
    try {
        const lembagaId = req.session.user.activeLembagaId || req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembaga = await Lembaga.findByPk(lembagaId);
        const prokers = await Proker.findAll({
            where: { lembagaId: lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: RincianBiaya, as: 'RincianBiayas' },
                { model: RealisasiBiaya, as: 'Realisasis' }
            ]
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Rekapitulasi Keuangan');

        worksheet.addRow([ lembaga ? lembaga.nama_organisasi.toUpperCase() : 'LAPORAN KEUANGAN' ]);
        worksheet.addRow([ `REKAPITULASI PROGRAM KERJA & REALISASI TAHUN ${tahunAktifInt}` ]);
        worksheet.addRow([]);

        worksheet.getCell('A1').font = { bold: true, size: 13 };
        worksheet.getCell('A2').font = { bold: true, size: 11 };

        const headerRow = worksheet.addRow(['No', 'Nama Program Kerja', 'Bidang', 'Jenis', 'Pagu RAB (Rp)', 'Realisasi Riil (Rp)', 'Selisih / Sisa (Rp)', 'Status']);
        
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
            const totalRAB = p.RincianBiayas ? p.RincianBiayas.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) : 0;
            const totalRealisasi = p.Realisasis ? p.Realisasis.reduce((s, r) => s + (parseFloat(r.nominal_realisasi) || 0), 0) : 0;
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
        console.error("ERROR EKSPOR EXCEL:", error);
        req.session.error_msg = 'Gagal mengekspor data ke Excel: ' + error.message;
        return res.redirect('back');
    }
});

router.get('/ekspor/pdf', isLoggedIn, async (req, res) => {
    return res.redirect('/lembaga-admin/rekap-global/print');
});

// ==========================================
// MODUL KHUSUS BENDAHARA UTAMA
// ==========================================
router.get('/bendahara/rekapitulasi', isLoggedIn, ensureBendaharaUtama, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [
                { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
                { 
                    model: Proker, 
                    as: 'Prokers', 
                    where: { tahun: tahunAktifInt }, 
                    include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: Proposal, as: 'Proposal' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ], 
                    required: false 
                }
            ]
        });

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        const prokers = lembagaData.Prokers || [];

        let totalPaguLembaga = 0;
        let totalRealisasiLembaga = 0;

        prokers.forEach(p => {
            const paguP = p.RincianBiayas ? p.RincianBiayas.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) : 0;
            const realP = p.Realisasis ? p.Realisasis.reduce((s, r) => s + (parseFloat(r.nominal_realisasi) || 0), 0) : 0;
            totalPaguLembaga += paguP;
            totalRealisasiLembaga += realP;
        });

        const sisaAnggaranLembaga = totalPaguLembaga - totalRealisasiLembaga;
        const persentaseSerapan = totalPaguLembaga > 0 ? ((totalRealisasiLembaga / totalPaguLembaga) * 100).toFixed(1) : 0;

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

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
        console.error("Gagal memuat rekapitulasi bendahara utama:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE KONSOLIDASI PROPOSAL & RAB BULANAN BENDAHARA UTAMA ---
router.get('/bendahara/proposal-bulanan', isLoggedIn, ensureBendaharaUtama, lembagaAdminController.getRekapProposalBulanan);

// --- RUTE CETAK KONSOLIDASI PROPOSAL & RAB BULANAN ---
router.get('/bendahara/proposal-bulanan/print', isLoggedIn, ensureBendaharaUtama, lembagaAdminController.printRekapProposalBulanan);

// --- RUTE HALAMAN UTAMA / DASHBOARD DINAMIS (/lembaga-admin) ---
router.get('/', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        let lembagaData;

        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026, nama_aplikasi: 'Aplikasi Program Kerja' };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (user.role === 'admin_lembaga' || user.role === 'superadmin' || user.jabatan === 'Bendahara') {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false, include: [{ model: Proker, as: 'Prokers' }] },
                    { model: User, as: 'Users', include: [{ model: Bidang, as: 'Bidang' }] },
                    { 
                        model: Proker, 
                        as: 'Prokers', 
                        where: { tahun: tahunAktifInt }, 
                        include: [
                            { model: Bidang, as: 'Bidang' },
                            { model: Proposal, as: 'Proposal' },
                            { model: RincianBiaya, as: 'RincianBiayas' },
                            { model: RealisasiBiaya, as: 'Realisasis' }
                        ], 
                        required: false 
                    }
                ]
            });
        } else {
            lembagaData = await Lembaga.findByPk(lembagaId, {
                include: [
                    { model: Bidang, as: 'Bidangs', where: { id: user.id_bidang, tahun: tahunAktifInt }, required: false },
                    { model: User, as: 'Users', where: { id_bidang: user.id_bidang }, required: false, include: [{ model: Bidang, as: 'Bidang' }] },
                    { 
                        model: Proker, 
                        as: 'Prokers', 
                        where: { bidangId: user.id_bidang, tahun: tahunAktifInt }, 
                        include: [
                            { model: Bidang, as: 'Bidang' },
                            { model: Proposal, as: 'Proposal' },
                            { model: RincianBiaya, as: 'RincianBiayas' },
                            { model: RealisasiBiaya, as: 'Realisasis' }
                        ], 
                        required: false 
                    }
                ]
            });
        }

        if (!lembagaData) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/');
        }

        const listLembaga = await Lembaga.findAll();

        const bidangs = lembagaData.Bidangs || [];
        const users = lembagaData.Users || [];
        const prokers = lembagaData.Prokers || [];

        let totalAnggaranLembaga = 0;
        let totalRealisasiLembaga = 0;

        if (prokers.length > 0) {
            prokers.forEach(proker => {
                const paguProker = proker.RincianBiayas ? proker.RincianBiayas.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0) : (parseFloat(proker.anggaran) || 0);
                totalAnggaranLembaga += paguProker;

                if (proker.Realisasis && proker.Realisasis.length > 0) {
                    const realisasiProker = proker.Realisasis.reduce((sum, r) => sum + (parseFloat(r.nominal_realisasi) || 0), 0);
                    totalRealisasiLembaga += realisasiProker;
                }
            });
        }

        const persentaseSerapan = totalAnggaranLembaga > 0 ? ((totalRealisasiLembaga / totalAnggaranLembaga) * 100).toFixed(1) : 0;

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        let totalPendingPencairan = 0;
        if (user.hierarki === 'Bendahara' || user.jabatan === 'Bendahara' || user.role === 'admin_lembaga') {
            try {
                totalPendingPencairan = await Proposal.count({
                    where: {
                        lembagaId: lembagaId,
                        status: 'Disetujui'
                    }
                });
            } catch (errCount) {
                console.error("DEBUG: Gagal menghitung notifikasi pencairan Bendahara:", errCount);
            }
        }

        let titlePanel = 'Panel Bidang: ' + (user.jabatan || 'Pengurus');
        if (user.role === 'admin_lembaga' || user.role === 'superadmin') {
            if (user.jabatan === 'Bendahara' || user.role === 'bendahara_utama') {
                titlePanel = 'Panel Bendahara Utama (Pusat Keuangan)';
            } else {
                titlePanel = 'Panel Pimpinan Lembaga / Admin';
            }
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
        console.error("Error pada dashboard lembaga:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('manajemen_bidang', {
            pengaturan,
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman manajemen bidang:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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
            tahun: tahunAktifInt
        });

        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal menambah bidang:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('edit_bidang', { pengaturan, userSession: req.session.user, bidang });
    } catch (err) {
        console.error("Error ambil data edit bidang:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/bidang/edit/:id', isLoggedIn, isAdminLembaga, upload.single('ttd_bidang'), async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const { nama_bidang, deskripsi_tugas } = req.body;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        if (!nama_bidang || nama_bidang.trim() === '') {
            return res.status(400).send("Nama bidang wajib diisi!");
        }

        const bidang = await Bidang.findOne({ where: { id: bidangId, lembagaId: lembagaId, tahun: tahunAktifInt } });
        if (!bidang) {
            return res.status(404).send("Data bidang tidak ditemukan!");
        }

        bidang.nama_bidang = nama_bidang.trim();
        bidang.deskripsi_tugas = deskripsi_tugas ? deskripsi_tugas.trim() : null;

        if (req.file) {
            const maxSize = 1 * 1024 * 1024;
            if (req.file.size > maxSize) {
                req.session.error_msg = "Ukuran file TTD Bidang melebihi batas maksimal 1 MB!";
                return res.redirect(`/lembaga-admin/bidang/edit/${bidangId}`);
            }
            bidang.ttd_bidang = req.file.filename;
        }

        await bidang.save();

        req.session.success_msg = "Data bidang dan tanda tangan berhasil diperbarui!";
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal mengupdate bidang:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/bidang/hapus/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const bidangId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        await Bidang.destroy({ where: { id: bidangId, lembagaId: lembagaId, tahun: tahunAktifInt } });
        return res.redirect('/lembaga-admin/bidang');
    } catch (err) {
        console.error("Gagal menghapus bidang:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('kelola_pengurus', {
            pengaturan,
            userSession: req.session.user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman pengurus:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.redirect('/lembaga-admin/pengurus');
    } catch (err) {
        console.error("Gagal menambah pengurus:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/pengurus/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        const targetUser = await User.findOne({ where: { id: userId, lembagaId: lembagaId } });
        if (!targetUser) {
            req.session.error_msg = "Data pengurus tidak ditemukan!";
            return res.redirect('/lembaga-admin/pengurus');
        }

        const lembagaData = await Lembaga.findByPk(lembagaId, {
            include: [{ model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false }]
        });

        return res.render('edit_pengurus', {
            pengaturan,
            userSession: req.session.user,
            targetUser,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman edit pengurus:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/pengurus/edit/:id', isLoggedIn, isAdminLembaga, async (req, res) => {
    try {
        const userId = req.params.id;
        const lembagaId = req.session.user.lembagaId;
        const { nama_lengkap, username, password, role, jabatan, id_bidang } = req.body;

        const targetUser = await User.findOne({ where: { id: userId, lembagaId: lembagaId } });
        if (!targetUser) {
            req.session.error_msg = "Data pengurus tidak ditemukan!";
            return res.redirect('/lembaga-admin/pengurus');
        }

        targetUser.nama_lengkap = nama_lengkap ? nama_lengkap.trim() : targetUser.nama_lengkap;
        targetUser.username = username ? username.trim() : targetUser.username;
        targetUser.role = role || targetUser.role;
        targetUser.jabatan = jabatan || targetUser.jabatan;
        targetUser.id_bidang = id_bidang ? id_bidang : null;

        if (password && password.trim() !== '') {
            targetUser.password = bcrypt.hashSync(password.trim(), 10);
        }

        await targetUser.save();

        req.session.success_msg = `Data pengurus [${targetUser.username}] dan Role berhasil diperbarui!`;
        return res.redirect('/lembaga-admin/pengurus');
    } catch (err) {
        console.error("Gagal mengupdate pengurus:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL PROGRAM KERJA & RAB
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

        return res.render('manajemen_proker', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman proker:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/tambah', isLoggedIn, lembagaAdminController.storeProker, async (req, res) => {
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
            tahun: tahunAktifInt
        });

        return res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal menambah proker:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

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

        return res.render('edit_proker', {
            pengaturan,
            userSession: user,
            proker,
            bidangs
        });
    } catch (err) {
        console.error("Error ambil form edit proker:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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
        return res.redirect('/lembaga-admin/proker');
    } catch (err) {
        console.error("Gagal update proker:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('manajemen_rab', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error("Error halaman RAB:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error("Gagal menambah item RAB:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

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

        return res.render('edit_rab', {
            pengaturan,
            userSession: user,
            itemRAB
        });
    } catch (err) {
        console.error("Error ambil form edit RAB:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.redirect(`/lembaga-admin/proker/rab/${itemRAB.prokerId}`);
    } catch (err) {
        console.error("Gagal update item RAB:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.redirect(`/lembaga-admin/proker/rab/${prokerId}`);
    } catch (err) {
        console.error("Gagal menghapus item RAB:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        let includeCondition = [
            { model: Bidang, as: 'Bidangs', where: { tahun: tahunAktifInt }, required: false },
            { 
                model: Proker, 
                as: 'Prokers', 
                where: { tahun: tahunAktifInt }, 
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ], 
                required: false 
            }
        ];

        if (user.role !== 'admin_lembaga' && user.role !== 'superadmin' && user.jabatan !== 'Bendahara' && user.id_bidang) {
            includeCondition[1].where = { bidangId: user.id_bidang, tahun: tahunAktifInt };
            includeCondition[0].where = { id: user.id_bidang, tahun: tahunAktifInt };
        }

        const lembagaData = await Lembaga.findByPk(lembagaId, { include: includeCondition });

        return res.render('rekap_anggaran', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman rekap anggaran:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('laporan_realisasi', {
            pengaturan,
            userSession: user,
            lembagaData
        });
    } catch (err) {
        console.error("Error halaman laporan realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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

        return res.render('manajemen_realisasi', {
            pengaturan,
            userSession: user,
            proker
        });
    } catch (err) {
        console.error("Error halaman kelola realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// RUTE TAMBAH REALISASI DENGAN DUKUNGAN UPLOAD BUKTI NOTA (Maks. 1 MB)
router.post('/proker/realisasi/tambah/:id', isLoggedIn, (req, res, next) => {
    uploadRealisasi(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                req.session.error_msg = "Gagal menambah realisasi: Ukuran file bukti nota melebihi batas maksimal 1 MB!";
            } else {
                req.session.error_msg = "Gagal mengunggah file: " + err.message;
            }
            return res.redirect('back');
        } else if (err) {
            req.session.error_msg = err.message;
            return res.redirect('back');
        }
        next();
    });
}, async (req, res) => {
    try {
        const prokerId = req.params.id;
        const userId = req.session.user.id;
        const { uraian_pengeluaran, nominal_realisasi, tanggal_transaksi, keterangan } = req.body;

        if (!uraian_pengeluaran || !nominal_realisasi || !tanggal_transaksi) {
            req.session.error_msg = "Uraian pengeluaran, nominal, dan tanggal transaksi wajib diisi!";
            return res.redirect('back');
        }

        const buktiNotaFilename = req.file ? req.file.filename : null;

        await RealisasiBiaya.create({
            prokerId,
            userId,
            uraian_pengeluaran: uraian_pengeluaran.trim(),
            nominal_realisasi: parseFloat(nominal_realisasi) || 0,
            tanggal_transaksi,
            keterangan: keterangan ? keterangan.trim() : null,
            bukti_nota: buktiNotaFilename
        });

        req.session.success_msg = "Realisasi biaya dan bukti nota berhasil disimpan!";
        return res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error("Gagal menambah realisasi biaya:", err);
        req.session.error_msg = "Terjadi kesalahan pada server: " + err.message;
        return res.redirect('back');
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

        return res.redirect(`/lembaga-admin/proker/realisasi/${prokerId}`);
    } catch (err) {
        console.error("Gagal menghapus realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE HALAMAN PRATINJAU / PILIHAN CETAK REKAP GLOBAL ---
router.get('/rekap-global', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        const success_msg = req.session.success_msg || null;
        delete req.session.success_msg;

        return res.render('rekap_global_form', {
            pengaturan,
            userSession: user,
            lembaga,
            success_msg
        });
    } catch (err) {
        console.error("Gagal membuka halaman rekap global:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE SIMPAN PENGATURAN CETAK REKAP GLOBAL ---
router.post('/rekap-global/simpan', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const { 
            nama_ketua, pembina_senkom, 
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ketua, show_pengaju, show_pembina,
            show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img, show_pembina_lembaga 
        } = req.body;
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        lembaga.nama_organisasi = lembaga.nama_organisasi;
        lembaga.nama_ketua = nama_ketua ? nama_ketua.trim() : lembaga.nama_ketua;
        lembaga.pembina_senkom = pembina_senkom ? pembina_senkom.trim() : null;
        lembaga.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        lembaga.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        lembaga.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        lembaga.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        lembaga.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        lembaga.pembina_6 = pembina_6 ? pembina_6.trim() : null;

        lembaga.print_stempel = (show_stempel === 'true' || show_stempel === 'on');
        lembaga.print_ttd_ketua_img = (show_ttd_ketua_img === 'true' || show_ttd_ketua_img === 'on');
        lembaga.print_ttd_pengaju_img = (show_ttd_pengaju_img === 'true' || show_ttd_pengaju_img === 'on');
        lembaga.print_ttd_pembina_img = (show_ttd_pembina_img === 'true' || show_ttd_pembina_img === 'on');
        lembaga.print_ketua = (show_ketua === 'true' || show_ketua === 'on');
        lembaga.print_pengaju = (show_pengaju === 'true' || show_pengaju === 'on');
        lembaga.print_pembina_lembaga = (show_pembina_lembaga === 'true' || show_pembina_lembaga === 'on');
        lembaga.print_pembina = (show_pembina === 'true' || show_pembina === 'on');
        
        await lembaga.save();

        req.session.success_msg = "Pengaturan cetak berhasil disimpan! Silakan klik Buka Pratinjau & Cetak.";
        return res.redirect('/lembaga-admin/rekap-global');
    } catch (err) {
        console.error("Gagal menyimpan pengaturan rekap global:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE EKSEKUSI CETAK REKAPITULASI GLOBAL TAHUNAN ---
router.get('/rekap-global/print', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId; 
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        const listProker = await Proker.findAll({
            where: { lembagaId: lembagaId, tahun: tahunAktifInt },
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: RincianBiaya, as: 'RincianBiayas' }
            ]
        });

        return res.render('print_rekap_global', {
            lembaga,
            listProker,
            prokers: listProker,
            pengaturan,
            tahunAktif: tahunAktifInt,
            userSession: user
        });
    } catch (err) {
        console.error("Gagal mencetak rekap global:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE HALAMAN PRATINJAU / KONFIGURASI CETAK LAPORAN REALISASI ---
router.get('/realisasi/print-config', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin/realisasi');
        }

        const success_msg = req.session.success_msg || null;
        delete req.session.success_msg;

        return res.render('realisasi_print_form', {
            pengaturan,
            userSession: user,
            lembaga,
            success_msg
        });
    } catch (err) {
        console.error("Gagal membuka konfigurasi cetak realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE SIMPAN KONFIGURASI CETAK LAPORAN REALISASI ---
router.post('/realisasi/print-config/simpan', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const { 
            nama_ketua, pembina_senkom, 
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ketua, show_pengaju, show_pembina,
            show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img, show_pembina_lembaga 
        } = req.body;
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
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

        lembaga.print_stempel = (show_stempel === 'true' || show_stempel === 'on');
        lembaga.print_ttd_ketua_img = (show_ttd_ketua_img === 'true' || show_ttd_ketua_img === 'on');
        lembaga.print_ttd_pengaju_img = (show_ttd_pengaju_img === 'true' || show_ttd_pengaju_img === 'on');
        lembaga.print_ttd_pembina_img = (show_ttd_pembina_img === 'true' || show_ttd_pembina_img === 'on');
        lembaga.print_ketua = (show_ketua === 'true' || show_ketua === 'on');
        lembaga.print_pengaju = (show_pengaju === 'true' || show_pengaju === 'on');
        lembaga.print_pembina_lembaga = (show_pembina_lembaga === 'true' || show_pembina_lembaga === 'on');
        lembaga.print_pembina = (show_pembina === 'true' || show_pembina === 'on');
        
        await lembaga.save();

        req.session.success_msg = "Pengaturan cetak realisasi berhasil disimpan!";
        return res.redirect('/lembaga-admin/realisasi/print');
    } catch (err) {
        console.error("Gagal menyimpan pengaturan cetak realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE EKSEKUSI CETAK LAPORAN REALISASI (DENGAN DUKUNGAN FILTER TANGGAL) ---
router.get('/realisasi/print', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId; 
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        // Tangkap parameter tanggal dari query (mendukung start_date / tanggal_mulai)
        const startDate = req.query.start_date || req.query.tanggal_mulai;
        const endDate = req.query.end_date || req.query.tanggal_selesai;

        let realisasiWhere = {};
        if (startDate && endDate) {
            realisasiWhere.tanggal_transaksi = {
                [Op.between]: [startDate, endDate]
            };
        }

        let includeCondition = [
            { model: Bidang, as: 'Bidang' },
            { model: RincianBiaya, as: 'RincianBiayas' },
            { 
                model: RealisasiBiaya, 
                as: 'Realisasis',
                where: Object.keys(realisasiWhere).length > 0 ? realisasiWhere : undefined,
                required: false 
            }
        ];

        let prokerWhere = { lembagaId: lembagaId, tahun: tahunAktifInt };
        if (user.role !== 'admin_lembaga' && user.role !== 'superadmin' && user.jabatan !== 'Bendahara' && user.id_bidang) {
            prokerWhere.bidangId = user.id_bidang;
        }

        let listProker = await Proker.findAll({
            where: prokerWhere,
            include: includeCondition
        });

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
        console.error("Gagal mencetak laporan realisasi:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL PROPOSAL & APPROVAL
// ==========================================
router.get('/proker/proposal/:prokerId', isLoggedIn, async (req, res) => {
    try {
        const { prokerId } = req.params;
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;

        const proker = await Proker.findOne({
            where: { id: prokerId, lembagaId: lembagaId },
            include: [{ model: Bidang, as: 'Bidang' }]
        });

        if (!proker) {
            req.session.error_msg = "Program Kerja tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        let proposal = await Proposal.findOne({ where: { prokerId: proker.id } });

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

        const lembaga = await Lembaga.findByPk(lembagaId);

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        return res.render('detail_proposal', {
            userSession: user,
            proker,
            proposal,
            lembaga,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error("Gagal membuat/membuka proposal:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/proposal/update/:id', isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            tema, latar_belakang, tujuan, action, 
            pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6,
            show_stempel, show_ttd_ketua_img, show_ttd_pengaju_img, show_ttd_pembina_img, 
            show_ketua, show_pengaju, show_pembina_lembaga, show_pembina 
        } = req.body;

        const proposal = await Proposal.findByPk(id);
        if (!proposal) {
            req.session.error_msg = "Proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin/proposal');
        }

        proposal.tema = tema;
        proposal.latar_belakang = latar_belakang;
        proposal.tujuan = tujuan;
        proposal.pembina_1 = pembina_1 ? pembina_1.trim() : null;
        proposal.pembina_2 = pembina_2 ? pembina_2.trim() : null;
        proposal.pembina_3 = pembina_3 ? pembina_3.trim() : null;
        proposal.pembina_4 = pembina_4 ? pembina_4.trim() : null;
        proposal.pembina_5 = pembina_5 ? pembina_5.trim() : null;
        proposal.pembina_6 = pembina_6 ? pembina_6.trim() : null;

        if (action === 'submit') {
            proposal.status = 'Diajukan';
            req.session.success_msg = "Proposal berhasil diajukan untuk persetujuan!";
        } else {
            req.session.success_msg = "Draf proposal dan konfigurasi tanda tangan berhasil disimpan!";
        }
        await proposal.save();

        const lembaga = await Lembaga.findByPk(proposal.lembagaId);
        if (lembaga) {
            lembaga.print_stempel = (show_stempel === 'true' || show_stempel === 'on');
            lembaga.print_ttd_ketua_img = (show_ttd_ketua_img === 'true' || show_ttd_ketua_img === 'on');
            lembaga.print_ttd_pengaju_img = (show_ttd_pengaju_img === 'true' || show_ttd_pengaju_img === 'on');
            lembaga.print_ttd_pembina_img = (show_ttd_pembina_img === 'true' || show_ttd_pembina_img === 'on');
            lembaga.print_ketua = (show_ketua === 'true' || show_ketua === 'on');
            lembaga.print_pengaju = (show_pengaju === 'true' || show_pengaju === 'on');
            lembaga.print_pembina_lembaga = (show_pembina_lembaga === 'true' || show_pembina_lembaga === 'on');
            lembaga.print_pembina = (show_pembina === 'true' || show_pembina === 'on');
            await lembaga.save();
        }

        return res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
        
    } catch (err) {
        console.error("Gagal mengupdate proposal:", err);
        req.session.error_msg = "Terjadi kesalahan pada server.";
        return res.redirect('/lembaga-admin/proposal');
    }
});

// --- RUTE MODUL LPJ ---
router.get('/proker/proposal/lpj/:id', isLoggedIn, realisasiLpjController.formLpj);
router.post('/proker/proposal/lpj/update/:id', isLoggedIn, uploadLpjFiles, realisasiLpjController.storeOrUpdateLpj);

// --- RUTE APPROVAL & PENCAIRAN ---
router.post('/proker/proposal/ajukan/:id', isLoggedIn, prokerController.ajukanProposal);
router.post('/proker/proposal/review/:id', isLoggedIn, prokerController.reviewApprovalKetua);
router.post('/proker/proposal/pencairan/:id', isLoggedIn, prokerController.prosesPencairanBendahara);
router.get('/proker/bidang/:bidangId/print', isLoggedIn, prokerController.cetakPerBidang);

router.get('/proposal', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

        let whereCondition = { 
            lembagaId: lembagaId, 
            tahun: tahunAktifInt 
        };

        if (user.role !== 'admin_lembaga' && user.role !== 'superadmin' && user.id_bidang) {
            whereCondition.bidangId = user.id_bidang;
        }

        const prokers = await Proker.findAll({
            where: whereCondition,
            include: [
                { model: Bidang, as: 'Bidang' },
                { model: Proposal, as: 'Proposal' } 
            ]
        });

        const success_msg = req.session.success_msg || null;
        const error_msg = req.session.error_msg || null;
        delete req.session.success_msg;
        delete req.session.error_msg;

        return res.render('list_proposal', {
            userSession: user,
            pengaturan,
            prokers,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error("Gagal memuat daftar proposal:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proker/proposal/print/:id', isLoggedIn, async (req, res) => {
    try {
        const proposalId = req.params.id;
        
        const proposal = await Proposal.findByPk(proposalId, {
            include: [
                {
                    model: Proker,
                    as: 'Proker',
                    include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ]
                },
                { model: User, as: 'User' }
            ]
        });

        if (!proposal) {
            req.session.error_msg = "Proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin/proposal');
        }

        const lembaga = await Lembaga.findByPk(proposal.Proker.lembagaId);

        return res.render('print_proposal', {
            proposal,
            proker: proposal.Proker,
            rincianRab: (proposal.Proker && proposal.Proker.RincianBiayas) ? proposal.Proker.RincianBiayas : [],
            lembaga,
            userSession: req.session.user,
            req: req 
        });
    } catch (err) {
        console.error("Gagal membuka pratinjau cetak proposal:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.get('/proposal/approval', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
        const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

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

        return res.render('proposal_approval', {
            userSession: user,
            pengaturan,
            prokers,
            success_msg,
            error_msg
        });
    } catch (err) {
        console.error("Gagal memuat halaman approval proposal:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/proker/proposal/approval/:id', isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, catatan_revisi } = req.body;  

        const proposal = await Proposal.findByPk(id);
        if (!proposal) {
            req.session.error_msg = "Proposal tidak ditemukan!";
            return res.redirect('/lembaga-admin/proposal/approval');
        }

        proposal.status = status; 
        
        if (status === 'Perlu Revisi' || status === 'Direvisi') {
            proposal.catatan_revisi = catatan_revisi ? catatan_revisi.trim() : 'Mohon perbaiki proposal sesuai arahan.';
        } else if (status === 'Disetujui') {
            proposal.catatan_revisi = null; 
        }
        
        await proposal.save();

        req.session.success_msg = `Proposal berhasil diperbarui!`;
        return res.redirect('/lembaga-admin/proposal/approval');
    } catch (err) {
        console.error("Gagal approval:", err);
        req.session.error_msg = "Terjadi kesalahan server.";
        return res.redirect('/lembaga-admin/proposal/approval');
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
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin');
        }

        const listLembaga = await Lembaga.findAll();

        return res.render('setting_lembaga', {
            pengaturan,
            userSession: user,
            lembaga,
            listLembaga
        });
    } catch (err) {
        console.error("Error halaman setting lembaga:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

router.post('/setting/update', isLoggedIn, upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'kop_surat', maxCount: 1 },
    { name: 'stempel', maxCount: 1 },
    { name: 'ttd_ketua', maxCount: 1 },
    { name: 'ttd_pembina_senkom', maxCount: 1 }
]), async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        const { nama_organisasi, nama_ketua, pembina_lembaga, pembina_senkom, nomor_hp, alamat, pembina_1, pembina_2, pembina_3, pembina_4, pembina_5, pembina_6 } = req.body;

        const lembaga = await Lembaga.findByPk(lembagaId);
        if (!lembaga) {
            req.session.error_msg = "Data lembaga tidak ditemukan!";
            return res.redirect('/lembaga-admin/setting');
        }

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
        lembaga.pembina_lembaga = pembina_lembaga ? pembina_lembaga.trim() : null;
        lembaga.pembina_senkom = pembina_senkom ? pembina_senkom.trim() : null;
        lembaga.nomor_hp = nomor_hp ? nomor_hp.trim() : lembaga.nomor_hp;
        lembaga.alamat = alamat ? alamat.trim() : lembaga.alamat;
        
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
        req.session.success_msg = "Profil, pengaturan lembaga, dan master pembina berhasil diperbarui!";
        return res.redirect('/lembaga-admin/setting');
    } catch (err) {
        console.error("Gagal memperbarui setting lembaga:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// ==========================================
// MODUL UTILITAS
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

        const listLembaga = await Lembaga.findAll();

        return res.render('utilitas_users', {
            pengaturan,
            userSession: user,
            lembaga: lembagaData,
            lembagaData,
            listLembaga
        });
    } catch (err) {
        console.error("Error halaman utilitas users:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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
        return res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error("Gagal reset password:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
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
        return res.redirect('/lembaga-admin/utilitas/users');
    } catch (err) {
        console.error("Gagal menghapus user:", err);
        return res.status(500).send("Terjadi kesalahan pada server: " + err.message);
    }
});

// --- RUTE DIAGNOSTIK TEST MIGRASI 2027 (CLEAN & STRICT) ---
router.get('/diagnostik/test-migrasi-2027', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        const pengaturan = await Pengaturan.findOne();

        // 1. Validasi Tahun Aktif 2027
        const isTahunAktifValid = pengaturan && parseInt(pengaturan.tahun_aktif, 10) === 2027;

        // 2. Validasi Bidang 2027
        const jumlahBidang2027 = await Bidang.count({ where: { lembagaId, tahun: 2027 } });

        // 3. Validasi Proker & RAB 2027 (Pastikan nominal RAB bernilai 0 / kosong secara ketat)
        const prokers2027 = await Proker.findAll({
            where: { lembagaId, tahun: 2027 },
            include: [{ model: RincianBiaya, as: 'RincianBiayas' }]
        });

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

        // 4. Validasi Proposal (Pastikan berada dalam clean state / belum ada proposal aktif/disetujui)
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
            status: isCleanAndStrict ? "OK" : "WARNING",
            pesan: isCleanAndStrict 
                ? "Sistem migrasi ke tahun 2027 terverifikasi CLEAN dan STRICT dengan sempurna." 
                : "Ditemukan ketidaksesuaian pada aturan migrasi tahun 2027.",
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
                lembagaId: lembagaId
            },
            data_lembaga: {
                id: lembaga ? lembaga.id : null,
                nama_organisasi: lembaga ? lembaga.nama_organisasi : "Tidak ditemukan",
                tahun_aktif: pengaturan ? pengaturan.tahun_aktif : null,
                konfigurasi_print: {
                    stempel: lembaga ? lembaga.print_stempel : null,
                    ketua: lembaga ? lembaga.print_ketua : null,
                    pengaju: lembaga ? lembaga.print_pengaju : null,
                    pembina: lembaga ? lembaga.print_pembina : null,
                }
            }
        });
    } catch (err) {
        console.error("Error pada diagnostik migrasi:", err);
        return res.status(500).json({
            status: "ERROR",
            pesan: "Terjadi kesalahan pada server saat pengujian migrasi.",
            error: err.message
        });
    }
});

router.get('/diagnostik/cek', isLoggedIn, async (req, res) => {
    try {
        const user = req.session.user;
        const lembagaId = user.activeLembagaId || user.lembagaId;
        
        const lembaga = await Lembaga.findByPk(lembagaId);
        const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };

        return res.status(200).json({
            status: "OK",
            pesan: "Sistem diagnostik berjalan normal.",
            waktu_cek: new Date(),
            user_session: {
                id: user.id,
                username: user.username,
                role: user.role,
                lembagaId: lembagaId
            },
            data_lembaga: {
                id: lembaga ? lembaga.id : null,
                nama_organisasi: lembaga ? lembaga.nama_organisasi : "Tidak ditemukan",
                tahun_aktif: pengaturan.tahun_aktif,
                konfigurasi_print: {
                    stempel: lembaga ? lembaga.print_stempel : null,
                    ketua: lembaga ? lembaga.print_ketua : null,
                    pengaju: lembaga ? lembaga.print_pengaju : null,
                    pembina: lembaga ? lembaga.print_pembina : null,
                }
            }
        });
    } catch (err) {
        console.error("Error pada diagnostik sistem:", err);
        return res.status(500).json({
            status: "ERROR",
            pesan: "Terjadi kesalahan pada server saat pengecekan diagnostik.",
            error: err.message
        });
    }
});

module.exports = router;
