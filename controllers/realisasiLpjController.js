const { Proposal, RealisasiLpj, Proker, Bidang, Lembaga } = require('../models');
const path = require('path');
const fs = require('fs');

const realisasiLpjController = {
    // 1. Menampilkan Form / Detail LPJ untuk Proposal yang sudah dicairkan
    formLpj: async (req, res) => {
        try {
            const { id } = req.params; // ID Proposal
            const proposal = await Proposal.findOne({
                where: { id },
                include: [
                    { model: Proker, as: 'Proker', include: [{ model: Bidang, as: 'Bidang' }] },
                    { model: Lembaga, as: 'Lembaga' },
                    { model: RealisasiLpj, as: 'RealisasiLpj' }
                ]
            });

            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            res.render('proker/form_lpj', {
                title: `Laporan Pertanggungjawaban (LPJ) - ${proposal.Proker.nama_program}`,
                proposal,
                userSession: req.session.user
            });
        } catch (error) {
            console.error("ERROR FORM LPJ:", error);
            req.session.error_msg = 'Gagal memuat form LPJ: ' + error.message;
            res.redirect('/lembaga-admin/proposal');
        }
    },

    // 2. Menyimpan atau Memperbarui Data LPJ beserta Upload Berkas
    storeOrUpdateLpj: async (req, res) => {
        try {
            const { id } = req.params; // ID Proposal
            const { realisasi_anggaran, deskripsi_kegiatan } = req.body;

            const proposal = await Proposal.findByPk(id);
            if (!proposal) {
                req.session.error_msg = 'Proposal tidak ditemukan.';
                return res.redirect('/lembaga-admin/proposal');
            }

            // Tangkap file yang diunggah via multer (jika ada)
            const foto_kegiatan = req.files && req.files['foto_kegiatan'] ? req.files['foto_kegiatan'][0].filename : null;
            const nota_belanja = req.files && req.files['nota_belanja'] ? req.files['nota_belanja'][0].filename : null;
            const bukti_transfer_bendahara = req.files && req.files['bukti_transfer_bendahara'] ? req.files['bukti_transfer_bendahara'][0].filename : null;

            // Cek apakah data LPJ sudah pernah dibuat sebelumnya
            let lpj = await RealisasiLpj.findOne({ where: { proposalId: id } });

            if (lpj) {
                // Update data LPJ (gabungkan file baru jika diupload, pertahankan file lama jika tidak ada upload baru)
                lpj.realisasi_anggaran = realisasi_anggaran || lpj.realisasi_anggaran;
                lpj.deskripsi_kegiatan = deskripsi_kegiatan || lpj.deskripsi_kegiatan;
                if (foto_kegiatan) lpj.foto_kegiatan = foto_kegiatan;
                if (nota_belanja) lpj.nota_belanja = nota_belanja;
                if (bukti_transfer_bendahara) lpj.bukti_transfer_bendahara = bukti_transfer_bendahara;
                lpj.status_lpj = 'Menunggu Review'; // Reset status review jika ada revisi
                await lpj.save();
            } else {
                // Buat data LPJ baru
                await RealisasiLpj.create({
                    proposalId: id,
                    lembagaId: proposal.lembagaId,
                    realisasi_anggaran: realisasi_anggaran || 0,
                    deskripsi_kegiatan,
                    foto_kegiatan,
                    nota_belanja,
                    bukti_transfer_bendahara,
                    status_lpj: 'Menunggu Review'
                });
            }

            req.session.success_msg = 'Laporan Pertanggungjawaban (LPJ) berhasil disimpan dan dikirim untuk direview!';
            return res.redirect(`/lembaga-admin/proker/proposal/lpj/${id}`);
        } catch (error) {
            console.error("ERROR STORE/UPDATE LPJ:", error);
            req.session.error_msg = 'Gagal menyimpan LPJ: ' + error.message;
            return res.redirect('back');
        }
    }
};

module.exports = realisasiLpjController;
