'use strict';

module.exports = (sequelize, DataTypes) => {
    const RealisasiLpj = sequelize.define('RealisasiLpj', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        proposalId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            validate: {
                isInt: { msg: 'proposalId harus berupa bilangan bulat.' },
                min: { args: [1], msg: 'proposalId tidak valid.' }
            }
        },
        lembagaId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            validate: {
                isInt: { msg: 'lembagaId harus berupa bilangan bulat.' },
                min: { args: [1], msg: 'lembagaId tidak valid.' }
            }
        },
        realisasi_anggaran: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
            validate: {
                isInt: { msg: 'realisasi_anggaran harus berupa angka bulat.' },
                min: { args: [0], msg: 'realisasi_anggaran tidak boleh bernilai negatif.' }
            }
        },
        deskripsi_kegiatan: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        foto_kegiatan: {
            type: DataTypes.STRING,
            allowNull: true
        },
        bukti_transfer_bendahara: {
            type: DataTypes.STRING,
            allowNull: true
        },
        nota_belanja: {
            type: DataTypes.STRING,
            allowNull: true
        },
        status_lpj: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'Menunggu Review',
            validate: {
                notEmpty: { msg: 'status_lpj tidak boleh kosong.' }
            }
        },
        catatan_lpj: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'RealisasiLpjs',
        timestamps: true
    });

    RealisasiLpj.associate = (models) => {
        if (models.Proposal) {
            RealisasiLpj.belongsTo(models.Proposal, {
                foreignKey: 'proposalId',
                as: 'Proposal',
                onDelete: 'CASCADE'
            });
        }
        if (models.Lembaga) {
            RealisasiLpj.belongsTo(models.Lembaga, {
                foreignKey: 'lembagaId',
                as: 'Lembaga',
                onDelete: 'CASCADE'
            });
        }
    };

    return RealisasiLpj;
};
