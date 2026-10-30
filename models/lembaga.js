'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Lembaga extends Model {
    static associate(models) {
      // Satu Lembaga memiliki banyak Bidang
      Lembaga.hasMany(models.Bidang, { foreignKey: 'lembagaId', as: 'Bidangs', onDelete: 'CASCADE' });
      
      // Satu Lembaga memiliki banyak User / Pengurus
      Lembaga.hasMany(models.User, { foreignKey: 'lembagaId', as: 'Users', onDelete: 'CASCADE' });
      
      // Satu Lembaga memiliki banyak Program Kerja
      Lembaga.hasMany(models.Proker, { foreignKey: 'lembagaId', as: 'Prokers', onDelete: 'CASCADE' });

      // Satu Lembaga memiliki banyak Proposal
      Lembaga.hasMany(models.Proposal, { foreignKey: 'lembagaId', as: 'Proposals', onDelete: 'CASCADE' });
    }
  }
  
  Lembaga.init({
    nama_organisasi: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nama_ketua: DataTypes.STRING,
    nomor_hp: DataTypes.STRING,
    alamat: DataTypes.TEXT,
    logo: DataTypes.STRING,
    kop_surat: DataTypes.STRING,
    stempel: DataTypes.STRING,
    ttd_ketua: DataTypes.STRING,
    ttd_pengaju: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Lembaga',
  });
  
  return Lembaga;
};
