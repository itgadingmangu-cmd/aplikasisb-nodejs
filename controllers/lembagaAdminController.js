'use strict';

const { Proker, Bidang, RincianBiaya, Proposal, Lembaga, User } = require('../models');
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

    // Menyimpan data proker baru (Menangkap parameter 'jenis' untuk Reguler / Insidentil)
    storeProker: async (req, res) => {
        try {
            // Tangkap semua kemungkinan nama parameter dari form (jenis / jenis_kegiatan)
            const jenisInput = req.body.jenis || req.body.jenis_kegiatan || 'Reguler';
            const { nama_program, deskripsi, bidangId, status } = req.body;
            
            const lembagaId = req.session.user.lembagaId;
            const pengaturan = await Proker.sequelize.models.Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);
            
            let bulanPelaksanaan = req.body.bulan;
            if (Array.isArray(bulanPelaksanaan)) {
                bulanPelaksanaan = bulanPelaksanaan.join(','); 
            } else if (!bulanPelaksanaan) {
                bulanPelaksanaan = ''; 
            }

            // Pastikan deteksi kata Insidentil bersifat case-insensitive dan akurat
            const jenisKegiatan = (String(jenisInput).toLowerCase().includes('insidentil')) ? 'Insidentil' : 'Reguler';

            await Proker.create({
                nama_program,
                deskripsi,
                waktu_pelaksanaan: bulanPelaksanaan,
                status: status || 'Direncanakan',
                bidangId,
                lembagaId: lembagaId,
                tahun: tahunAktifInt,
                jenis: jenisKegiatan // Disimpan akurat ke database
            });

            req.session.success_msg = 'Program Kerja berhasil ditambahkan!';
            return res.redirect('/lembaga-admin/proker');
        } catch (error) {
            console.error("Gagal tambah proker:", error);
            req.session.error_msg = 'Gagal menambahkan program kerja: ' + error.message;
            return res.redirect('/lembaga-admin/proker');
        }
    },

    // Aksi menyimpan upload tanda tangan user dengan pembersihan file lama
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
            res.redirect('/lembaga-admin');
        } catch (error) {
            console.error("ERROR STORE RAB:", error);
            req.session.error_msg = 'Gagal menambahkan rincian biaya: ' + error.message;
            res.redirect('/lembaga-admin');
        }
    }
};

module.exports = lembagaAdminController;
