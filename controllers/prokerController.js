const { Proker, Bidang, RincianBiaya } = require('../models');

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
    }
};

module.exports = prokerController;
