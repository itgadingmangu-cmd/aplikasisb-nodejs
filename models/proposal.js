'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class Proposal extends Model {
        static associate(models) {
            Proposal.belongsTo(models.Proker, { foreignKey: 'prokerId', as: 'Proker' });
            Proposal.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
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
            type: DataTypes.ENUM('Draft', 'Diajukan', 'Disetujui', 'Direvisi'),
            defaultValue: 'Draft'
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
