'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Proker extends Model {
    static associate(models) {
      // Relasi Proker ke Bidang
      Proker.belongsTo(models.Bidang, { foreignKey: 'bidangId', as: 'Bidang' });
      
      // Relasi Proker ke Lembaga (PENTING: agar query include Lembaga/Prokers tidak error)
      Proker.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
      
      // Relasi Proker ke RincianBiaya (RAB)
      Proker.hasMany(models.RincianBiaya, { foreignKey: 'prokerId', as: 'RincianBiayas', onDelete: 'CASCADE' });

      // TAMBAHAN UTAMA: Relasi Proker ke RealisasiBiaya (Pengeluaran Riil)
      Proker.hasMany(models.RealisasiBiaya, { foreignKey: 'prokerId', as: 'Realisasis', onDelete: 'CASCADE' });
    }
  }
  Proker.init({
    nama_program: DataTypes.STRING,
    deskripsi: DataTypes.TEXT,
    waktu_pelaksanaan: DataTypes.STRING,
    status: DataTypes.STRING,
    bidangId: DataTypes.INTEGER,
    lembagaId: DataTypes.INTEGER, // <-- KUNCI UTAMA: Ditambahkan agar tersambung ke Lembaga
    anggaran: DataTypes.DECIMAL(12, 2), // <-- Ditambahkan untuk menyimpan nominal total RAB
    tahun: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2026 // <-- Kolom baru untuk isolasi data per Tahun Anggaran
    }
  }, {
    sequelize,
    modelName: 'Proker',
  });
  return Proker;
};
