'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Laporan extends Model {
    static associate(models) {
      Laporan.belongsTo(models.Pengajuan, { foreignKey: 'id_pengajuan' });
    }
  }
  Laporan.init({
    id_pengajuan: DataTypes.INTEGER,
    tanggal_realisasi: DataTypes.DATE,
    file_bukti: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Laporan',
  });
  return Laporan;
};
