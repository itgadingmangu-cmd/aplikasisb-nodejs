'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Proker extends Model {
    static associate(models) {
      // Relasi Proker ke Bidang
      Proker.belongsTo(models.Bidang, { foreignKey: 'bidangId', as: 'Bidang' });
      
      // Relasi Proker ke RincianBiaya
      Proker.hasMany(models.RincianBiaya, { foreignKey: 'prokerId', as: 'RincianBiayas', onDelete: 'CASCADE' });
    }
  }
  Proker.init({
    nama_program: DataTypes.STRING,
    deskripsi: DataTypes.TEXT,
    waktu_pelaksanaan: DataTypes.STRING,
    status: DataTypes.STRING,
    bidangId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Proker',
  });
  return Proker;
};
