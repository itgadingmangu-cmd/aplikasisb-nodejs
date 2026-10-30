'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Pengaturan extends Model {
    static associate(models) {
      // define association here
    }
  }
  Pengaturan.init({
    nama_aplikasi: DataTypes.STRING,
    logo_icon: DataTypes.STRING,
    logo_aplikasi: DataTypes.STRING, // <-- Ditambahkan di sini agar sinkron
    step1_judul: DataTypes.STRING,
    step1_deskripsi: DataTypes.TEXT,
    step2_judul: DataTypes.STRING,
    step2_deskripsi: DataTypes.TEXT,
    step3_judul: DataTypes.STRING,
    step3_deskripsi: DataTypes.TEXT,
    step4_judul: DataTypes.STRING,
    step4_deskripsi: DataTypes.TEXT,
    tahun_aktif: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Pengaturan',
  });
  return Pengaturan;
};
