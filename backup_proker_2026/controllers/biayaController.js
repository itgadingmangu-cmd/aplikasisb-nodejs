const { RincianBiaya, Proker, Bidang } = require('../models');

const biayaController = {
    // Menampilkan halaman detail proker dan rincian biayanya (dengan proteksi isolasi tahun aktif)
    index: async (req, res) => {
        try {
            const { prokerId } = req.params;
            const tahunAktif = req.tahunAktif || 2026; // Mengambil tahun aktif dari router proker

            // Cari proker berdasarkan ID DAN harus sesuai dengan tahun aktif yang sedang berjalan
            const proker = await Proker.findOne({
                where: { 
                    id: prokerId,
                    tahun: tahunAktif 
                },
                include: [
                    { model: RincianBiaya, as: 'RincianBiayas' }, 
                    { model: Bidang, as: 'Bidang' }
                ]
            });

            if (!proker) {
                req.session.error_msg = "Program Kerja tidak ditemukan pada tahun anggaran aktif!";
                return res.redirect('/proker');
            }

            // Hitung total keseluruhan anggaran proker
            let grandTotal = 0;
            if (proker.RincianBiayas && proker.RincianBiayas.length > 0) {
                grandTotal = proker.RincianBiayas.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
            }

            res.render('proker/biaya', {
                title: 'Rincian Anggaran Biaya Proker',
                user: req.session.user,
                proker,
                grandTotal
            });
        } catch (error) {
            console.error("Error index biaya:", error);
            res.status(500).send("Terjadi kesalahan pada server");
        }
    },

    // Tambah item rincian biaya
    store: async (req, res) => {
        try {
            const { prokerId } = req.params;
            const { nama_item, satuan, jumlah, harga_satuan, bulan } = req.body;

            const jml = parseInt(jumlah) || 0;
            const harga = parseInt(harga_satuan) || 0;
            const bln = parseInt(bulan) || 1;

            // Hitung otomatis: jumlah (volume) * harga_satuan * bulan
            const total = jml * harga * bln;

            await RincianBiaya.create({
                prokerId,
                nama_item: nama_item ? nama_item.trim() : '',
                satuan: satuan ? satuan.trim() : 'Pcs',
                jumlah: jml,
                harga_satuan: harga,
                bulan: bln,
                total
            });

            // Opsional: Anda juga bisa memperbarui total nilai anggaran di tabel Proker secara otomatis di sini jika diperlukan
            const allRAB = await RincianBiaya.findAll({ where: { prokerId } });
            const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
            await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: prokerId } });

            req.session.success_msg = "Item biaya berhasil ditambahkan!";
            res.redirect(`/proker/${prokerId}/biaya`);
        } catch (error) {
            console.error("Error store biaya:", error);
            req.session.error_msg = "Gagal menambahkan item biaya: " + error.message;
            res.redirect(`/proker/${prokerId}/biaya`);
        }
    },

    // Hapus item rincian biaya
    destroy: async (req, res) => {
        try {
            const { id, prokerId } = req.params;
            
            const itemBiaya = await RincianBiaya.findByPk(id);
            if (!itemBiaya) {
                req.session.error_msg = "Item biaya tidak ditemukan!";
                return res.redirect(`/proker/${prokerId}/biaya`);
            }

            await itemBiaya.destroy();

            // Perbarui kembali total anggaran pada tabel Proker setelah item dihapus
            const allRAB = await RincianBiaya.findAll({ where: { prokerId } });
            const totalAnggaranProker = allRAB.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
            await Proker.update({ anggaran: totalAnggaranProker }, { where: { id: prokerId } });

            req.session.success_msg = "Item biaya berhasil dihapus!";
            res.redirect(`/proker/${prokerId}/biaya`);
        } catch (error) {
            console.error("Error destroy biaya:", error);
            req.session.error_msg = "Gagal menghapus item biaya.";
            res.redirect(`/proker/${prokerId}/biaya`);
        }
    }
};

module.exports = biayaController;
