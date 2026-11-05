'use strict';

const { Proker, Bidang, RincianBiaya, RealisasiBiaya, Proposal, Lembaga, User, Pengaturan } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const lembagaAdminController = {
    index: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;

            if (!lembagaId) {
                req.session.error_msg = "Sesi akun lembaga tidak valid.";
                return res.redirect('/login');
            }

            const lembaga = await Lembaga.findByPk(lembagaId);

            const bidangs = await Bidang.findAll({
                where: { lembagaId: lembagaId },
                include: [
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers' }
                ],
                order: [['createdAt', 'DESC']]
            });

            const users = await User.findAll({
                where: { lembagaId: lembagaId, role: 'user_bidang' },
                include: [{ model: Bidang, as: 'Bidang' }],
                order: [['createdAt', 'DESC']]
            });

            const bidangIds = bidangs.map(b => b.id);
            let prokers = [];
            if (bidangIds.length > 0) {
                prokers = await Proker.findAll({
                    where: { bidangId: bidangIds },
                    include: [
                        { model: Bidang, as: 'Bidang' },
                        { model: RincianBiaya, as: 'RincianBiayas' }
                    ],
                    order: [['createdAt', 'DESC']]
                });
            }

            let totalPendingPencairan = 0;
            if (req.session.user && (req.session.user.hierarki === 'Bendahara' || req.session.user.nama_bidang === 'Bendahara')) {
                totalPendingPencairan = await Proposal.count({
                    where: {
                        lembagaId: req.session.user.lembagaId,
                        status: 'Disetujui'
                    }
                });
            }

            let proposalDitolakCount = 0;
            if (req.session.user) {
                proposalDitolakCount = await Proposal.count({
                    where: {
                        lembagaId: req.session.user.lembagaId,
                        status: 'Dana Ditolak'
                    }
                });
            }

            res.render('lembaga_admin/index', {
                title: 'Panel Kontrol Admin Lembaga',
                userSession: req.session.user,
                lembagaData: lembaga,
                bidangs: bidangs || [],
                users: users || [],
                prokers: prokers || [],
                totalPendingPencairan: totalPendingPencairan,
                proposalDitolakCount: proposalDitolakCount
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
            await Bidang.create({ nama_bidang, lembagaId });
            req.session.success_msg = 'Bidang baru berhasil ditambahkan!';
            res.redirect('/lembaga-admin');
        } catch (error) {
            req.session.error_msg = 'Gagal menambahkan bidang.';
            res.redirect('/lembaga-admin');
        }
    },

    storeUserBidang: async (req, res) => {
        try {
            const { nama_lengkap, username, password, id_bidang } = req.body;
            const lembagaId = req.session.user.lembagaId;
            const hashedPassword = bcrypt.hashSync(password, 10);

            await User.create({
                nama_lengkap,
                username,
                password: hashedPassword,
                role: 'user_bidang',
                lembagaId: lembagaId,
                id_bidang: id_bidang || null
            });

            req.session.success_msg = 'Pengurus Bidang berhasil didaftarkan!';
            res.redirect('/lembaga-admin');
        } catch (error) {
            req.session.error_msg = 'Gagal mendaftarkan pengurus bidang.';
            res.redirect('/lembaga-admin');
        }
    },

    storeProker: async (req, res) => {
        try {
            const { nama_program, deskripsi, bidangId, jenis, status } = req.body;
            
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
                jenis: jenisKegiatan
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
                satuan: satuan || '',
                volume,
                harga_satuan,
                total
            });

            req.session.success_msg = 'Rincian biaya (RAB) berhasil ditambahkan!';
            return res.redirect('/lembaga-admin');
        } catch (error) {
            console.error("ERROR STORE RAB:", error);
            req.session.error_msg = 'Gagal menambahkan rincian biaya: ' + error.message;
            return res.redirect('/lembaga-admin');
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

            // Ambil data realisasi sesuai rentang tanggal transaksi
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
