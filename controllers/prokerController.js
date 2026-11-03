// GABUNGKAN 'Proposal' ke dalam import yang sudah ada agar tidak terjadi crash
const { Proker, Bidang, RincianBiaya, Proposal, Lembaga, User } = require('../models');

const prokerController = {
    index: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const tahunAktif = req.tahunAktif || 2026; // Mengambil tahun aktif dari router

            // Ambil bidang berdasarkan lembaga dan tahun aktif
            const bidangLembaga = await Bidang.findAll({ 
                where: { 
                    lembagaId: lembagaId, 
                    tahun: tahunAktif 
                } 
            });
            const bidangIds = bidangLembaga.map(b => b.id);

            // Ambil proker difilter berdasarkan bidang tahun aktif tersebut
            const prokers = await Proker.findAll({
                where: { 
                    bidangId: bidangIds,
                    tahun: tahunAktif // Isolasi data proker per tahun
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

    // Menampilkan form tambah proker (difilter berdasarkan tahun aktif)
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

    // Menyimpan data proker baru ke database dengan menyertakan tahun aktif
    store: async (req, res) => {
        try {
            const { nama_program, bidangId, status, deskripsi } = req.body;
            const tahunAktif = req.tahunAktif || 2026;
            
            let bulanPelaksanaan = req.body.bulan;
            if (Array.isArray(bulanPelaksanaan)) {
                bulanPelaksanaan = bulanPelaksanaan.join(',');
            } else if (!bulanPelaksanaan) {
                bulanPelaksanaan = ''; 
            }

            await Proker.create({
                nama_program,
                bidangId,
                waktu_pelaksanaan: bulanPelaksanaan,
                status,
                deskripsi,
                anggaran: 0, // Standar awal anggaran bersih 0
                tahun: tahunAktif // Disematkan tahun aktif agar terisolasi dengan sempurna
            });

            req.session.success_msg = 'Program Kerja berhasil ditambahkan!';
            res.redirect('/proker');
        } catch (error) {
            console.error(error);
            req.session.error_msg = 'Gagal menambahkan Program Kerja.';
            res.redirect('/proker/tambah');
        }
    },

    // Menyimpan rincian RAB dengan validasi aman dari error tipe data integer/strip ("-")
    storeRAB: async (req, res) => {
        try {
            const { prokerId, nama_item, satuan } = req.body;
            
            // Validasi & konversi aman ke angka (mencegah string/strip "-" masuk ke kolom integer)
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

   // 1. Aksi Pengaju mengirim/mengajukan proposal dari Draft ke Status "Diajukan"
   ajukanProposal: async (req, res) => {
        try {
            const { id } = req.params; // ID Proposal
            const proposal = await Proposal.findByPk(id); 

            if (!proposal) {
                req.session.error_msg = 'Program kerja atau proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proker');
            }

            // Ubah status menjadi Diajukan
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

   // 2. Aksi Ketua/Admin mereview: Menyetujui atau Meminta Revisi DAN MENGATUR TTD
   reviewApprovalKetua: async (req, res) => {
        try {
            const { id } = req.params;
            // Dapatkan SEMUA data dari body, termasuk konfigurasi TTD dan Stempel
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

            // Cari proposal untuk mengambil prokerId dan lembagaId
            const proposal = await Proposal.findByPk(id); 
            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            // Tentukan keputusan final dengan pembersihan string (trim) & pengecilan huruf (toLowerCase)
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

            // A. Eksekusi pembaruan database untuk tabel PROPOSAL secara langsung
            await Proposal.update({
                status: statusBaru,
                catatan_revisi: catatanBaru
            }, {
                where: { id: id }
            });

            // B. Eksekusi pembaruan database untuk tabel LEMBAGA (Konfigurasi TTD/Stempel)
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

    // 3. Aksi Bendahara: Menyetujui Pencairan atau Menolak dengan Alasan (Menggunakan ENUM asli database)
    prosesPencairanBendahara: async (req, res) => {
        try {
            // 1. Validasi Keamanan Hak Akses Bendahara
            const user = req.session.user;
            if (!user || (user.hierarki !== 'Bendahara' && user.nama_bidang !== 'Bendahara')) {
                req.session.error_msg = 'Akses ditolak! Hanya Bendahara yang berhak memproses eksekusi keuangan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            const { id } = req.params;
            const { keputusan_bendahara, alasan_penolakan } = req.body; 

            // 2. Cari proposal untuk memastikan keberadaan data
            const proposal = await Proposal.findByPk(id); 
            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan di dalam database.';
                return res.redirect('/lembaga-admin/proposal');
            }

            // 3. Pembersihan input keputusan
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

            // 4. Eksekusi UPDATE eksplisit ke database dengan status ENUM baru
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

    // Cetak Rekap / Dokumen Berdasarkan Bidang
    cetakPerBidang: async (req, res) => {
        try {
            const { bidangId } = req.params;
            const lembagaId = req.session.user.lembagaId;

            // Ambil data bidang beserta daftar proker dan rincian biayanya
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

            // Ambil data lembaga untuk konfigurasi ttd/stempel
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
    }
};

module.exports = prokerController;
