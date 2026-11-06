'use strict';

const { Proker, Bidang, RincianBiaya, RealisasiBiaya, Proposal, Lembaga, User, Pengaturan } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const lembagaAdminController = {
    index: async (req, res) => {
        try {
            const user = req.session.user;
            const lembagaId = user ? (user.activeLembagaId || user.lembagaId) : null;

            if (!lembagaId) {
                req.session.error_msg = "Sesi akun lembaga tidak valid.";
                return res.redirect('/login');
            }

            const lembaga = await Lembaga.findByPk(lembagaId);
            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026, nama_aplikasi: 'Aplikasi Program Kerja' };
            const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

            const bidangs = await Bidang.findAll({
                where: { lembagaId: lembagaId, tahun: tahunAktifInt },
                include: [
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers' }
                ],
                order: [['createdAt', 'DESC']]
            });

            const users = await User.findAll({
                where: { lembagaId: lembagaId },
                include: [{ model: Bidang, as: 'Bidang' }],
                order: [['createdAt', 'DESC']]
            });

            const bidangIds = bidangs.map(b => b.id);
            let prokers = [];
            if (bidangIds.length > 0) {
                prokers = await Proker.findAll({
                    where: { bidangId: bidangIds, tahun: tahunAktifInt },
                    include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: Proposal, as: 'Proposal' },
                        { model: RincianBiaya, as: 'RincianBiayas' },
                        { model: RealisasiBiaya, as: 'Realisasis' }
                    ],
                    order: [['createdAt', 'DESC']]
                });
            }

            let totalPendingPencairan = 0;
            if (user && (user.hierarki === 'Bendahara' || user.jabatan === 'Bendahara' || user.role === 'bendahara_utama' || user.role === 'admin_lembaga')) {
                totalPendingPencairan = await Proposal.count({
                    where: {
                        lembagaId: lembagaId,
                        status: 'Disetujui'
                    }
                });
            }

            let proposalDitolakCount = 0;
            if (user) {
                proposalDitolakCount = await Proposal.count({
                    where: {
                        lembagaId: lembagaId,
                        status: 'Dana Ditolak'
                    }
                });
            }

            // Aturan Ketat Penentuan Judul Panel Berdasarkan Role & Jabatan Aktual
            let titlePanel = 'Panel Pimpinan Lembaga / Admin';
            if (user.role === 'admin_lembaga' || user.role === 'superadmin') {
                if (user.jabatan === 'Bendahara' || user.role === 'bendahara_utama') {
                    titlePanel = 'Panel Bendahara Utama (Pusat Keuangan)';
                } else {
                    titlePanel = 'Panel Pimpinan Lembaga / Admin';
                }
            } else {
                titlePanel = 'Panel Bidang: ' + (user.jabatan || 'Pengurus');
            }

            res.render('lembaga_admin', {
                title: 'Panel Kontrol Admin Lembaga',
                pengaturan,
                userSession: user,
                lembagaData: lembaga,
                bidangs: bidangs || [],
                users: users || [],
                prokers: prokers || [],
                totalPendingPencairan: totalPendingPencairan,
                proposalDitolakCount: proposalDitolakCount,
                titlePanel: titlePanel
            });
            
        } catch (error) {
            console.error("ERROR LEMBAGA ADMIN:", error);
            res.status(500).send('Terjadi kesalahan pada server: ' + error.message);
        }
    },

    storeBidang: async (req, res) => {
        try {
            const { nama_bidang } = req.body;
            const lembagaId = req.session.user.lembagaId;
            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

            await Bidang.create({ nama_bidang, lembagaId, tahun: tahunAktifInt });
            req.session.success_msg = 'Bidang baru berhasil ditambahkan!';
            res.redirect('/lembaga-admin');
        } catch (error) {
            req.session.error_msg = 'Gagal menambahkan bidang.';
            res.redirect('/lembaga-admin');
        }
    },

    storeUserBidang: async (req, res) => {
        try {
            const { nama_lengkap, username, password, id_bidang, role, jabatan } = req.body;
            const lembagaId = req.session.user.lembagaId;
            const hashedPassword = bcrypt.hashSync(password, 10);

            await User.create({
                nama_lengkap,
                username,
                password: hashedPassword,
                role: role || 'user_bidang',
                jabatan: jabatan || 'Anggota',
                lembagaId: lembagaId,
                id_bidang: id_bidang || null
            });

            req.session.success_msg = 'Pengurus Bidang berhasil didaftarkan!';
            res.redirect('/lembaga-admin/pengurus');
        } catch (error) {
            req.session.error_msg = 'Gagal mendaftarkan pengurus bidang.';
            res.redirect('/lembaga-admin/pengurus');
        }
    },

    storeProker: async (req, res) => {
        try {
            const { nama_program, deskripsi, bidangId, jenis, status } = req.body;
            const lembagaId = req.session.user.lembagaId;
            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
            
            let bulanPelaksanaan = req.body.bulan;
            if (Array.isArray(bulanPelaksanaan)) {
                bulanPelaksanaan = bulanPelaksanaan.join(','); 
            } else if (!bulanPelaksanaan) {
                bulanPelaksanaan = ''; 
            }

            const jenisKegiatan = (jenis === 'Insidentil') ? 'Insidentil' : 'Reguler';

            await Proker.create({
                nama_program,
                deskripsi,
                waktu_pelaksanaan: bulanPelaksanaan,
                status: status || 'Direncanakan',
                bidangId,
                lembagaId,
                jenis: jenisKegiatan,
                tahun: tahunAktifInt,
                anggaran: 0
            });

            req.session.success_msg = 'Program Kerja berhasil ditambahkan!';
            return res.redirect('/lembaga-admin/proker');
        } catch (error) {
            console.error("Gagal tambah proker:", error);
            req.session.error_msg = 'Gagal menambahkan program kerja: ' + error.message;
            return res.redirect('/lembaga-admin/proker');
        }
    },

    updateTtdProfile: async (req, res) => {
        try {
            const userId = req.session.user.id;

            if (!req.file) {
                req.session.error_msg = 'Silakan pilih file gambar tanda tangan terlebih dahulu.';
                return res.redirect('/lembaga-admin/profile');
            }

            const currentUser = await User.findByPk(userId);
            if (currentUser && currentUser.ttd) {
                const oldFilePath = path.join(__dirname, '../public/uploads/logo/', currentUser.ttd);
                if (fs.existsSync(oldFilePath)) {
                    try {
                        fs.unlinkSync(oldFilePath);
                    } catch (errUnlink) {
                        console.error("Gagal menghapus file TTD lama:", errUnlink);
                    }
                }
            }

            await User.update({
                ttd: req.file.filename
            }, {
                where: { id: userId }
            });

            req.session.user.ttd = req.file.filename;

            req.session.success_msg = 'Tanda tangan profil berhasil diperbarui!';
            return res.redirect('/lembaga-admin/profile');
        } catch (error) {
            console.error("ERROR UPLOAD TTD PROFILE:", error);
            req.session.error_msg = 'Gagal mengunggah tanda tangan: ' + error.message;
            return res.redirect('/lembaga-admin/profile');
        }
    },
    
    storeRAB: async (req, res) => {
        try {
            const { prokerId, nama_item, satuan } = req.body;
            
            const volume = parseInt(req.body.volume || req.body.jumlah) || 0;
            const harga_satuan = parseInt(req.body.harga_satuan) || 0;
            const total = volume * harga_satuan;

            await RincianBiaya.create({
                prokerId,
                nama_item,
                satuan: satuan || 'Pcs',
                jumlah: volume,
                harga_satuan,
                total
            });

            req.session.success_msg = 'Rincian biaya (RAB) berhasil ditambahkan!';
            return res.redirect('back');
        } catch (error) {
            console.error("ERROR STORE RAB:", error);
            req.session.error_msg = 'Gagal menambahkan rincian biaya: ' + error.message;
            return res.redirect('back');
        }
    },

    // Filter Laporan Realisasi Anggaran Berdasarkan Rentang Tanggal
    getLaporanRealisasi: async (req, res) => {
        try {
            const { tanggal_mulai, tanggal_selesai } = req.query;
            let whereClause = {};

            if (tanggal_mulai && tanggal_selesai) {
                whereClause.tanggal_transaksi = {
                    [Op.between]: [tanggal_mulai, tanggal_selesai]
                };
            }

            const realisasiList = await RealisasiBiaya.findAll({
                where: whereClause,
                include: [
                    {
                        model: Proker,
                        include: [Bidang]
                    }
                ],
                order: [['tanggal_transaksi', 'ASC']]
            });

            res.render('laporan_realisasi', {
                title: 'Laporan Realisasi Anggaran',
                userSession: req.session.user,
                realisasiList,
                tanggal_mulai: tanggal_mulai || '',
                tanggal_selesai: tanggal_selesai || ''
            });
        } catch (error) {
            console.error("ERROR LAPORAN REALISASI:", error);
            res.status(500).send('Terjadi kesalahan memuat laporan: ' + error.message);
        }
    },

    // Konsolidasi Rekapitulasi Proposal & RAB Bulanan untuk Bendahara Utama
    getRekapProposalBulanan: async (req, res) => {
        try {
            const user = req.session.user;
            const lembagaId = user.activeLembagaId || user.lembagaId;
            const { bulan, tahun } = req.query;

            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktif = tahun || pengaturan.tahun_aktif;

            const lembaga = await Lembaga.findByPk(lembagaId);
            if (!lembaga) {
                req.session.error_msg = "Data lembaga tidak ditemukan!";
                return res.redirect('/lembaga-admin');
            }

            let prokers = await Proker.findAll({
                where: { lembagaId: lembagaId, tahun: tahunAktif },
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: Proposal, as: 'Proposal' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ],
                order: [['createdAt', 'ASC']]
            });

            if (bulan) {
                prokers = prokers.filter(p => {
                    if (!p.waktu_pelaksanaan) return false;
                    const bulanArr = p.waktu_pelaksanaan.split(',').map(b => b.trim());
                    return bulanArr.includes(String(bulan));
                });
            }

            return res.render('bendahara_proposal_bulanan', {
                title: 'Konsolidasi Proposal & RAB Bulanan',
                userSession: user,
                lembaga,
                prokers,
                pengaturan,
                selectedBulan: bulan || '',
                selectedTahun: tahunAktif,
                query: req.query
            });
        } catch (error) {
            console.error("ERROR REKAP PROPOSAL BULANAN:", error);
            res.status(500).send('Terjadi kesalahan pada server: ' + error.message);
        }
    },

    // Diagnostik Test Clean & Strict Migrasi 2027
    testMigrasi2027: async (req, res) => {
        try {
            const user = req.session.user;
            const lembagaId = user.activeLembagaId || user.lembagaId;
            
            const lembaga = await Lembaga.findByPk(lembagaId);
            const pengaturan = await Pengaturan.findOne();

            // 1. Validasi Tahun Aktif 2027
            const isTahunAktifValid = pengaturan && parseInt(pengaturan.tahun_aktif, 10) === 2027;

            // 2. Validasi Bidang 2027
            const jumlahBidang2027 = await Bidang.count({ where: { lembagaId, tahun: 2027 } });

            // 3. Validasi Proker & RAB 2027 (Pastikan nominal RAB 0 / kosong)
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

            // 4. Validasi Proposal (Pastikan belum ada proposal yang disetujui/berstatus aktif, clean state)
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
    },

    // Cetak Rekapitulasi Proposal & RAB Bulanan
    printRekapProposalBulanan: async (req, res) => {
        try {
            const user = req.session.user;
            const lembagaId = user.activeLembagaId || user.lembagaId;
            const { bulan, tahun } = req.query;

            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktif = tahun || pengaturan.tahun_aktif;

            const lembaga = await Lembaga.findByPk(lembagaId);
            if (!lembaga) {
                req.session.error_msg = "Data lembaga tidak ditemukan!";
                return res.redirect('/lembaga-admin');
            }

            let prokers = await Proker.findAll({
                where: { lembagaId: lembagaId, tahun: tahunAktif },
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: Proposal, as: 'Proposal' },
                    { model: RincianBiaya, as: 'RincianBiayas' }
                ],
                order: [['createdAt', 'ASC']]
            });

            if (bulan) {
                prokers = prokers.filter(p => {
                    if (!p.waktu_pelaksanaan) return false;
                    const bulanArr = p.waktu_pelaksanaan.split(',').map(b => b.trim());
                    return bulanArr.includes(String(bulan));
                });
            }

            return res.render('print_bendahara_bulanan', {
                userSession: user,
                lembaga,
                prokers,
                pengaturan,
                selectedBulan: bulan || '',
                selectedTahun: tahunAktif
            });
        } catch (error) {
            console.error("ERROR CETAK REKAP BULANAN:", error);
            res.status(500).send('Terjadi kesalahan pada server: ' + error.message);
        }
    }
};

module.exports = lembagaAdminController;
