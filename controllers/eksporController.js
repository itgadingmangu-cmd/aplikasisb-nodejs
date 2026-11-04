'use strict';
const { Proker, Bidang, RincianBiaya, RealisasiBiaya, Lembaga, Pengaturan } = require('../models');
const ExcelJS = require('exceljs');

const eksporController = {
    // Ekspor Rekap Global & Realisasi ke Excel (.xlsx)
    eksporExcel: async (req, res) => {
        try {
            const lembagaId = req.session.user.activeLembagaId || req.session.user.lembagaId;
            const pengaturan = await Pengaturan.findOne() || { tahun_aktif: 2026 };
            const tahunAktifInt = parseInt(pengaturan.tahun_aktif, 10);

            const lembaga = await Lembaga.findByPk(lembagaId);
            const prokers = await Proker.findAll({
                where: { lembagaId: lembagaId, tahun: tahunAktifInt },
                include: [
                    { model: Bidang, as: 'Bidang' },
                    { model: RincianBiaya, as: 'RincianBiayas' },
                    { model: RealisasiBiaya, as: 'Realisasis' }
                ]
            });

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Rekapitulasi Keuangan');

            // Header Dokumen
            worksheet.addRow([ lembaga ? lembaga.nama_organisasi.toUpperCase() : 'LAPORAN KEUANGAN' ]);
            worksheet.addRow([ `REKAPITULASI PROGRAM KERJA & REALISASI TAHUN ${tahunAktifInt}` ]);
            worksheet.addRow([]); // Baris kosong

            // Header Tabel
            worksheet.addRow(['No', 'Nama Program Kerja', 'Bidang', 'Jenis', 'Pagu RAB (Rp)', 'Realisasi Riil (Rp)', 'Selisih / Sisa (Rp)', 'Status']);

            // Masukkan Data
            prokers.forEach((p, index) => {
                const totalRAB = p.RincianBiayas ? p.RincianBiayas.reduce((s, i) => s + (parseFloat(i.total) || 0), 0) : 0;
                const totalRealisasi = p.Realisasis ? p.Realisasis.reduce((s, r) => s + (parseFloat(r.nominal_realisasi) || 0), 0) : 0;
                const selisih = totalRAB - totalRealisasi;

                worksheet.addRow([
                    index + 1,
                    p.nama_program || p.nama_proker,
                    p.Bidang ? p.Bidang.nama_bidang : '-',
                    p.jenis || 'Reguler',
                    totalRAB,
                    totalRealisasi,
                    selisih,
                    p.status || 'Aktif'
                ]);
            });

            // Format Header
            worksheet.getRow(4).font = { bold: true };
            worksheet.getRow(4).alignment = { horizontal: 'center' };

            // Set Response Header untuk Unduh File Excel
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=Rekap-Keuangan-${tahunAktifInt}.xlsx`);

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            console.error("ERROR EKSPOR EXCEL:", error);
            req.session.error_msg = 'Gagal mengekspor data ke Excel: ' + error.message;
            res.redirect('back');
        }
    }
};

module.exports = eksporController;
