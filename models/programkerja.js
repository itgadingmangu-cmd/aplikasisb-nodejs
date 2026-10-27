'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class ProgramKerja extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      ProgramKerja.belongsTo(models.Bidang, { foreignKey: 'id_bidang' });
      ProgramKerja.hasMany(models.Pengajuan, { foreignKey: 'id_program' });
    }
  }
  ProgramKerja.init({
    id_bidang: DataTypes.INTEGER,
    nama_kegiatan: DataTypes.STRING,
    jadwal_bulan: DataTypes.STRING,
    volume: DataTypes.INTEGER,
    biaya_satuan: DataTypes.INTEGER,
    total_biaya: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'ProgramKerja',
  });
  return ProgramKerja;
};
