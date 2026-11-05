'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class Proposal extends Model {
        static associate(models) {
            Proposal.belongsTo(models.Proker, { foreignKey: 'prokerId', as: 'Proker' });
            Proposal.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
            
            // DITAMBAHKAN: Relasi aman ke User (Pengaju Proposal) agar TTD dinamis terbaca
            Proposal.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
            
            // Relasi aman ke RealisasiLpj untuk Modul LPJ (Tahap 5)
            Proposal.hasOne(models.RealisasiLpj, { foreignKey: 'proposalId', as: 'RealisasiLpj' });
        }
    }

    Proposal.init({
        prokerId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        lembagaId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true // Menyimpan ID user/pengaju yang membuat proposal
        },
        latar_belakang: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        tujuan: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        tema: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status: {
            // Mempertahankan seluruh status ENUM yang sudah berjalan tanpa regresi
            type: DataTypes.ENUM('Draft', 'Diajukan', 'Disetujui', 'Direvisi', 'Perlu Revisi', 'Dana Dicairkan', 'Dana Ditolak', 'Selesai'),
            defaultValue: 'Draft'
        },
        // Kolom riwayat catatan dari pimpinan
        catatan_revisi: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        // Konfigurasi 6 Pembina Opsional (Nama / Status TTD)
        pembina_1: { type: DataTypes.STRING, allowNull: true },
        pembina_2: { type: DataTypes.STRING, allowNull: true },
        pembina_3: { type: DataTypes.STRING, allowNull: true },
        pembina_4: { type: DataTypes.STRING, allowNull: true },
        pembina_5: { type: DataTypes.STRING, allowNull: true },
        pembina_6: { type: DataTypes.STRING, allowNull: true }
    }, {
        sequelize,
        modelName: 'Proposal',
        tableName: 'Proposals'
    });

    return Proposal;
};
