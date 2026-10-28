'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RincianBiaya extends Model {
    static associate(models) {
      // Relasi RincianBiaya ke Proker
      RincianBiaya.belongsTo(models.Proker, { foreignKey: 'prokerId', as: 'Proker' });
    }
  }
  RincianBiaya.init({
    prokerId: DataTypes.INTEGER,
    nama_item: DataTypes.STRING,
    satuan: DataTypes.STRING,
    jumlah: DataTypes.INTEGER,
    harga_satuan: DataTypes.INTEGER,
    bulan: DataTypes.INTEGER,
    total: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'RincianBiaya',
  });
  return RincianBiaya;
};
