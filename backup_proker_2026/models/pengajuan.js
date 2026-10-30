'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Pengajuan extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */

static associate(models) {
      Pengajuan.belongsTo(models.ProgramKerja, { foreignKey: 'id_program' });
      Pengajuan.belongsTo(models.Bidang, { foreignKey: 'id_bidang' });
      Pengajuan.hasOne(models.Laporan, { foreignKey: 'id_pengajuan' });
    }
  }
  Pengajuan.init({
    id_program: DataTypes.INTEGER,
    id_bidang: DataTypes.INTEGER,
    tanggal_pengajuan: DataTypes.DATE,
    status: DataTypes.STRING,
    catatan_admin: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'Pengajuan',
  });
  return Pengajuan;
};
