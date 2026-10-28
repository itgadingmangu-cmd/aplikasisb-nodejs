const { Bidang, User, Proker, RincianBiaya, Lembaga } = require('../models');
const bcrypt = require('bcrypt');

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

            res.render('lembaga_admin/index', {
                title: 'Panel Kontrol Admin Lembaga',
                userSession: req.session.user,
                lembagaData: lembaga,
                bidangs: bidangs || [],
                users: users || [],
                prokers: prokers || []
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
            const { nama_program, deskripsi, waktu_pelaksanaan, bidangId } = req.body;
            await Proker.create({
                nama_program,
                deskripsi,
                waktu_pelaksanaan,
                status: 'Perencanaan',
                bidangId
            });
            req.session.success_msg = 'Program Kerja berhasil ditambahkan!';
            res.redirect('/lembaga-admin');
        } catch (error) {
            req.session.error_msg = 'Gagal menambahkan program kerja.';
            res.redirect('/lembaga-admin');
        }
    }
};

module.exports = lembagaAdminController;
