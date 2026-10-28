const { Bidang, User, Proker, RincianBiaya } = require('../models');
const bcrypt = require('bcrypt');

const lembagaAdminController = {
    // Menampilkan Dashboard Utama Admin Lembaga (Bidang, User, & Proker)
    index: async (req, res) => {
        try {
            const lembagaId = req.session.user.lembagaId;

            if (!lembagaId) {
                req.session.error_msg = "Sesi akun lembaga tidak valid.";
                return res.redirect('/login');
            }

            // 1. Ambil daftar bidang milik lembaga ini
            const bidangs = await Bidang.findAll({
                where: { lembagaId: lembagaId },
                include: [
                    { model: User, as: 'Users' },
                    { model: Proker, as: 'Prokers' }
                ],
                order: [['createdAt', 'DESC']]
            });

            // 2. Ambil daftar user/pengurus bidang
            const users = await User.findAll({
                where: { lembagaId: lembagaId, role: 'user_bidang' },
                include: [{ model: Bidang, as: 'Bidang' }],
                order: [['createdAt', 'DESC']]
            });

            // 3. Ambil daftar Program Kerja yang terhubung ke bidang-bidang di lembaga ini
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
                bidangs: bidangs || [],
                users: users || [],
                prokers: prokers || []
            });
        } catch (error) {
            console.error("ERROR LEMBAGA ADMIN:", error);
            res.status(500).send('Terjadi kesalahan pada server: ' + error.message);
        }
    },

    // Simpan Bidang Baru
    storeBidang: async (req, res) => {
        try {
            const { nama_bidang } = req.body;
            const lembagaId = req.session.user.lembagaId;

            await Bidang.create({ nama_bidang, lembagaId });

            req.session.success_msg = 'Bidang baru berhasil ditambahkan!';
            res.redirect('/lembaga-admin');
        } catch (error) {
            console.error("ERROR TAMBAH BIDANG:", error);
            req.session.error_msg = 'Gagal menambahkan bidang.';
            res.redirect('/lembaga-admin');
        }
    },

    // Simpan User/Pengurus Bidang Baru
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
            console.error("ERROR TAMBAH USER BIDANG:", error);
            req.session.error_msg = 'Gagal mendaftarkan pengurus bidang.';
            res.redirect('/lembaga-admin');
        }
    },

    // Tambah Program Kerja Langsung dari Panel Lembaga
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
            console.error("ERROR TAMBAH PROKER LEMBAGA:", error);
            req.session.error_msg = 'Gagal menambahkan program kerja.';
            res.redirect('/lembaga-admin');
        }
    }
};

module.exports = lembagaAdminController;
