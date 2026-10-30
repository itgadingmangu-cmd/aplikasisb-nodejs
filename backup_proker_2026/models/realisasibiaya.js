'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RealisasiBiaya extends Model {
    static associate(models) {
      // Relasi Realisasi ke Proker
      RealisasiBiaya.belongsTo(models.Proker, { foreignKey: 'prokerId', as: 'Proker' });
      // Relasi ke User / Pengurus yang menginput
      RealisasiBiaya.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
    }
  }
  RealisasiBiaya.init({
    prokerId: DataTypes.INTEGER,
    userId: DataTypes.INTEGER,
    uraian_pengeluaran: DataTypes.STRING,
    nominal_realisasi: DataTypes.DECIMAL(12, 2),
    tanggal_transaksi: DataTypes.DATEONLY,
    keterangan: DataTypes.TEXT,
    bukti_nota: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'RealisasiBiaya',
  });
  return RealisasiBiaya;
};
