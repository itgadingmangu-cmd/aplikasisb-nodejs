const { Proker, Bidang } = require('../models');

const prokerController = {
    index: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const bidangLembaga = await Bidang.findAll({ where: { lembagaId: lembagaId } });
            const bidangIds = bidangLembaga.map(b => b.id);

            const prokers = await Proker.findAll({
                where: { bidangId: bidangIds },
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

    // Menampilkan form tambah proker
    create: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;
            const bidangs = await Bidang.findAll({ where: { lembagaId: lembagaId } });
            
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

    // Menyimpan data proker baru ke database
    store: async (req, res) => {
        try {
            const { nama_program, bidangId, waktu_pelaksanaan, status, deskripsi } = req.body;
            
            await Proker.create({
                nama_program,
                bidangId,
                waktu_pelaksanaan,
                status,
                deskripsi
            });

            req.session.success_msg = 'Program Kerja berhasil ditambahkan!';
            res.redirect('/proker');
        } catch (error) {
            console.error(error);
            req.session.error_msg = 'Gagal menambahkan Program Kerja.';
            res.redirect('/proker/tambah');
        }
    }
};

module.exports = prokerController;
