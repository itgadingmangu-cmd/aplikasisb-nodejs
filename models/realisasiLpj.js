module.exports = (sequelize, DataTypes) => {
    const RealisasiLpj = sequelize.define('RealisasiLpj', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        proposalId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        lembagaId: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        realisasi_anggaran: {
            type: DataTypes.INTEGER,
            defaultValue: 0
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
            defaultValue: 'Menunggu Review'
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
        RealisasiLpj.belongsTo(models.Proposal, { foreignKey: 'proposalId', as: 'Proposal' });
        RealisasiLpj.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
    };

    return RealisasiLpj;
};
