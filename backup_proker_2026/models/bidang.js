'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Bidang extends Model {
    static associate(models) {
      // Relasi Bidang ke Lembaga
      Bidang.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
      
      // Relasi Bidang ke Proker
      Bidang.hasMany(models.Proker, { foreignKey: 'bidangId', as: 'Prokers', onDelete: 'CASCADE' });

      // Relasi Bidang ke User (Pengurus Bidang)
      Bidang.hasMany(models.User, { foreignKey: 'id_bidang', as: 'Users', onDelete: 'SET NULL' });
    }
  }

  Bidang.init({
    nama_bidang: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deskripsi_tugas: {
      type: DataTypes.TEXT, // <-- Kolom untuk menyimpan uraian tugas/jobdesk bidang
      allowNull: true
    },
    lembagaId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    tahun: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2026 // <-- Kolom baru untuk isolasi data per Tahun Anggaran
    }
  }, {
    sequelize,
    modelName: 'Bidang',
  });

  return Bidang;
};
