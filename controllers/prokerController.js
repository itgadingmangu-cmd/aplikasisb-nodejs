'use strict';
const { Proker, Bidang, RincianBiaya, Proposal, Lembaga, User, Realisasi } = require('../models');
const { Op } = require('sequelize');

const prokerController = {
    index: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const tahunAktif = req.tahunAktif || 2026;

            const bidangLembaga = await Bidang.findAll({ 
                where: { 
                    lembagaId: lembagaId, 
                    tahun: tahunAktif 
                } 
            });
            const bidangIds = bidangLembaga.map(b => b.id);

            const prokers = await Proker.findAll({
                where: { 
                    bidangId: bidangIds,
                    tahun: tahunAktif 
                },
                include: [{ model: Bidang, as: 'Bidang', attributes: ['nama_bidang'] }],
                order: [['createdAt', 'DESC']]
            });

            res.render('proker/index', {
                title: 'Manajemen Program Kerja',
                user: req.session.user,
                prokers,
                bidangs: bidangLembaga
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Terjadi kesalahan pada server');
        }
    },

    create: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const tahunAktif = req.tahunAktif || 2026;

            const bidangs = await Bidang.findAll({ 
                where: { 
                    lembagaId: lembagaId,
                    tahun: tahunAktif 
                } 
            });
            
            res.render('proker/tambah', {
                title: 'Tambah Program Kerja Baru',
                user: req.session.user,
                bidangs
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Terjadi kesalahan saat memuat form');
        }
    },

    store: async (req, res) => {
        try {
            const { nama_program, bidangId, status, deskripsi, jenis } = req.body;
            const tahunAktif = req.tahunAktif || 2026;
            
            let bulanPelaksanaan = req.body.waktu_pelaksanaan || req.body.bulan;
            if (Array.isArray(bulanPelaksanaan)) {
                bulanPelaksanaan = bulanPelaksanaan.join(',');
            } else if (!bulanPelaksanaan) {
                bulanPelaksanaan = ''; 
            }

            await Proker.create({
                nama_program,
                bidangId,
                waktu_pelaksanaan: bulanPelaksanaan,
                status: status || 'Direncanakan',
                deskripsi,
                anggaran: 0,
                jenis: jenis || 'Reguler',
                tahun: tahunAktif
            });

            req.session.success_msg = 'Program Kerja / Kegiatan berhasil ditambahkan!';
            res.redirect('/proker');
        } catch (error) {
            console.error("ERROR STORE PROKER:", error);
            req.session.error_msg = 'Gagal menambahkan Program Kerja: ' + error.message;
            res.redirect('/proker');
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
            res.redirect('back');
        } catch (error) {
            console.error("ERROR STORE RAB:", error);
            req.session.error_msg = 'Gagal menambahkan rincian biaya: ' + error.message;
            res.redirect('back');
        }
    },

   ajukanProposal: async (req, res) => {
        try {
            const { id } = req.params; 
            const proposal = await Proposal.findByPk(id); 

            if (!proposal) {
                req.session.error_msg = 'Program kerja atau proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proker');
            }

            proposal.status = 'Diajukan';
            await proposal.save();

            req.session.success_msg = 'Proposal berhasil diajukan kepada Ketua/Pimpinan!';
            res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
        } catch (error) {
            console.error("ERROR AJUKAN PROPOSAL:", error);
            req.session.error_msg = 'Gagal mengajukan proposal: ' + error.message;
            res.redirect('/lembaga-admin/proker');
        }
    },

    reviewApprovalKetua: async (req, res) => {
        try {
            const { id } = req.params;
            const { 
                aksi, 
                catatan_revisi, 
                status,
                show_stempel,
                show_ttd_ketua_img,
                show_ttd_pengaju_img,
                show_ttd_pembina_img,
                show_ketua,
                show_pengaju,
                show_pembina_lembaga,
                show_pembina 
            } = req.body; 

            const proposal = await Proposal.findByPk(id); 
            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const rawKeputusan = aksi || status || '';
            const keputusan = rawKeputusan.trim().toLowerCase();
            
            let statusBaru = 'Diajukan';
            let catatanBaru = null;

            if (keputusan === 'disetujui') {
                statusBaru = 'Disetujui'; 
                catatanBaru = null;
            } else if (keputusan === 'revisi' || keputusan === 'perlu revisi') {
                statusBaru = 'Perlu Revisi';
                catatanBaru = catatan_revisi && catatan_revisi.trim() !== '' 
                    ? catatan_revisi.trim() 
                    : 'Mohon perbaiki proposal kegiatan ini sesuai arahan pimpinan.';
            } else {
                statusBaru = 'Perlu Revisi';
                catatanBaru = catatan_revisi || 'Mohon perbaiki proposal.';
            }

            await Proposal.update({
                status: statusBaru,
                catatan_revisi: catatanBaru
            }, {
                where: { id: id }
            });

            if (proposal.lembagaId) {
                await Lembaga.update({
                    print_stempel: show_stempel ? true : false,
                    print_ttd_ketua_img: show_ttd_ketua_img ? true : false,
                    print_ttd_pengaju_img: show_ttd_pengaju_img ? true : false,
                    print_ttd_pembina_img: show_ttd_pembina_img ? true : false,
                    print_ketua: show_ketua ? true : false,
                    print_pengaju: show_pengaju ? true : false,
                    print_pembina_lembaga: show_pembina_lembaga ? true : false,
                    print_pembina: show_pembina ? true : false
                }, { 
                    where: { id: proposal.lembagaId } 
                });
            }

            req.session.success_msg = `Proposal disetujui & Konfigurasi TTD disimpan!`;
            return res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
        } catch (error) {
            console.error("ERROR REVIEW KETUA:", error);
            req.session.error_msg = 'Gagal memproses approval ketua: ' + error.message;
            return res.redirect('/lembaga-admin/proposal');
        }
    },

    prosesPencairanBendahara: async (req, res) => {
        try {
            const user = req.session.user;
            if (!user || (user.hierarki !== 'Bendahara' && user.nama_bidang !== 'Bendahara')) {
                req.session.error_msg = 'Akses ditolak! Hanya Bendahara yang berhak memproses eksekusi keuangan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const { id } = req.params;
            const { keputusan_bendahara, alasan_penolakan } = req.body; 

            const proposal = await Proposal.findByPk(id); 
            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan di dalam database.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const keputusan = (keputusan_bendahara || '').trim().toLowerCase();
            let statusBaru = 'Disetujui';
            let catatanBaru = null;

            if (keputusan === 'cairkan') {
                statusBaru = 'Dana Dicairkan'; 
                catatanBaru = null; 
            } else if (keputusan === 'tolak') {
                statusBaru = 'Dana Ditolak'; 
                catatanBaru = alasan_penolakan && alasan_penolakan.trim() !== '' 
                    ? alasan_penolakan.trim() 
                    : 'Pencairan dana ditolak oleh bagian keuangan.';
            } else {
                req.session.error_msg = 'Pilihan eksekusi bendahara tidak valid.';
                return res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
            }

            await Proposal.update({
                status: statusBaru,
                catatan_revisi: catatanBaru
            }, {
                where: { id: id }
            });

            req.session.success_msg = `Keputusan keuangan berhasil dieksekusi dengan status: ${statusBaru}`;
            return res.redirect(`/lembaga-admin/proker/proposal/${proposal.prokerId}`);
        } catch (error) {
            console.error("ERROR CRITICAL PENCAIRAN BENDAHARA:", error);
            req.session.error_msg = 'Terjadi kesalahan sistem saat memproses dana: ' + error.message;
            return res.redirect('/lembaga-admin/proposal');
        }
    },

    // Cetak Dokumen Proposal (Disempurnakan agar mengambil TTD Pengaju/User secara akurat)
    printProposal: async (req, res) => {
        try {
            const { id } = req.params; 
            const proposal = await Proposal.findByPk(id, {
                include: [
                    { 
                        model: Proker, 
                        as: 'Proker', 
                        include: [{ model: Bidang, as: 'Bidang' }] 
                    },
                    { model: User, as: 'User' }, 
                    { model: Lembaga, as: 'Lembaga' }
                ]
            });

            if (!proposal) {
                req.session.error_msg = 'Dokumen proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proker');
            }

            // Fallback pengaman jika relasi proposal.User belum tersimpan di database, ambil dari session login aktif
            if (!proposal.User && req.session.user) {
                proposal.User = {
                    nama_lengkap: req.session.user.nama_lengkap,
                    jabatan: req.session.user.jabatan,
                    ttd: req.session.user.ttd
                };
            }

            const lembaga = await Lembaga.findByPk(proposal.lembagaId || req.session.user.lembagaId);

            return res.render('proker/print_proposal', {
                title: 'Cetak Proposal Kegiatan',
                proposal,
                lembaga: lembaga || {},
                userSession: req.session.user
            });
        } catch (error) {
            console.error("ERROR PRINT PROPOSAL:", error);
            return res.status(500).send('Terjadi kesalahan saat memuat cetak proposal: ' + error.message);
        }
    },

    cetakPerBidang: async (req, res) => {
        try {
            const { bidangId } = req.params;
            const lembagaId = req.session.user.lembagaId;

            const bidang = await Bidang.findOne({
                where: { id: bidangId, lembagaId: lembagaId },
                include: [{
                    model: Proker,
                    as: 'Prokers', 
                    include: [{ model: RincianBiaya, as: 'RincianBiayas' }]
                }]
            });

            if (!bidang) {
                req.session.error_msg = 'Data bidang tidak ditemukan.';
                return res.redirect('/proker');
            }

            const lembaga = await Lembaga.findByPk(lembagaId);

            res.render('proker/print_bidang', {
                title: `Cetak Laporan Bidang - ${bidang.nama_bidang}`,
                bidang,
                lembaga: lembaga || {},
                userSession: req.session.user
            });
        } catch (error) {
            console.error("ERROR CETAK PER BIDANG:", error);
            res.status(500).send('Terjadi kesalahan saat memuat cetak bidang: ' + error.message);
        }
    },

    printRealisasi: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const tahunAktif = req.tahunAktif || 2026;
            const { start_date, end_date } = req.query;

            let realisasiWhere = {};
            if (start_date && end_date) {
                realisasiWhere.tanggal = {
                    [Op.between]: [start_date, end_date]
                };
            }

            const bidangLembaga = await Bidang.findAll({ 
                where: { lembagaId: lembagaId, tahun: tahunAktif } 
            });
            const bidangIds = bidangLembaga.map(b => b.id);

            const listProker = await Proker.findAll({
                where: { 
                    bidangId: bidangIds,
                    tahun: tahunAktif 
                },
                include: [
                    { model: RincianBiaya, as: 'RincianBiayas' },
                    { 
                        model: Realisasi, 
                        as: 'Realisasis',
                        where: realisasiWhere,
                        required: false 
                    },
                    { model: Bidang, as: 'Bidang', attributes: ['nama_bidang'] }
                ],
                order: [['createdAt', 'DESC']]
            });

            const lembaga = await Lembaga.findByPk(lembagaId);

            return res.render('print_realisasi', {
                title: 'Cetak Laporan Realisasi Anggaran',
                tahunAktif,
                listProker,
                lembaga: lembaga || {},
                userSession: req.session.user,
                query: req.query
            });
        } catch (error) {
            console.error("ERROR PRINT REALISASI:", error);
            return res.status(500).send('Terjadi kesalahan saat memuat pratinjau cetak: ' + error.message);
        }
    }
};

module.exports = prokerController;
