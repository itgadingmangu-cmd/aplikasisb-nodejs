'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Bidang extends Model {
    static associate(models) {
      Bidang.hasMany(models.ProgramKerja, { foreignKey: 'id_bidang' });
      Bidang.hasMany(models.Pengajuan, { foreignKey: 'id_bidang' });
    }
  }
  Bidang.init({
    nama_bidang: DataTypes.STRING,
    username: DataTypes.STRING,
    password: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Bidang',
  });
  return Bidang;
};
