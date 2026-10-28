const { RincianBiaya, Proker } = require('../models');

const biayaController = {
    // Menampilkan halaman detail proker dan rincian biayanya
    index: async (req, res) => {
        try {
            const { prokerId } = req.params;
            const proker = await Proker.findByPk(prokerId, {
                include: [{ model: RincianBiaya, as: 'RincianBiayas' }, { model: Bidang, as: 'Bidang' }]
            });

            if (!proker) {
                req.session.error_msg = "Program Kerja tidak ditemukan!";
                return res.redirect('/proker');
            }

            // Hitung total keseluruhan anggaran proker
            let grandTotal = 0;
            if (proker.RincianBiayas && proker.RincianBiayas.length > 0) {
                grandTotal = proker.RincianBiayas.reduce((sum, item) => sum + item.total, 0);
            }

            res.render('proker/biaya', {
                title: 'Rincian Anggaran Biaya Proker',
                user: req.session.user,
                proker,
                grandTotal
            });
        } catch (error) {
            console.error(error);
            res.status(500).send("Terjadi kesalahan pada server");
        }
    },

    // Tambah item rincian biaya
    store: async (req, res) => {
        try {
            const { prokerId } = req.params;
            const { nama_item, satuan, jumlah, harga_satuan, bulan } = req.body;

            // Hitung otomatis: jumlah (volume) * harga_satuan * bulan
            const total = parseInt(jumlah) * parseInt(harga_satuan) * parseInt(bulan);

            await RincianBiaya.create({
                prokerId,
                nama_item,
                satuan,
                jumlah: parseInt(jumlah),
                harga_satuan: parseInt(harga_satuan),
                bulan: parseInt(bulan),
                total
            });

            req.session.success_msg = "Item biaya berhasil ditambahkan!";
            res.redirect(`/proker/${prokerId}/biaya`);
        } catch (error) {
            console.error(error);
            req.session.error_msg = "Gagal menambahkan item biaya.";
            res.redirect(`/proker/${prokerId}/biaya`);
        }
    },

    // Hapus item rincian biaya
    destroy: async (req, res) => {
        try {
            const { id, prokerId } = req.params;
            await RincianBiaya.destroy({ where: { id } });

            req.session.success_msg = "Item biaya berhasil dihapus!";
            res.redirect(`/proker/${prokerId}/biaya`);
        } catch (error) {
            console.error(error);
            req.session.error_msg = "Gagal menghapus item biaya.";
            res.redirect(`/proker/${prokerId}/biaya`);
        }
    }
};

module.exports = biayaController;
