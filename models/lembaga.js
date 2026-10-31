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
    pembina_lembaga: DataTypes.STRING,
    pembina_senkom: DataTypes.STRING,
    nomor_hp: DataTypes.STRING,
    alamat: DataTypes.TEXT,
    logo: DataTypes.STRING,
    kop_surat: DataTypes.STRING,
    stempel: DataTypes.STRING,
    ttd_ketua: DataTypes.STRING,
    ttd_pengaju: DataTypes.STRING,
    ttd_pembina_senkom: DataTypes.STRING,
    // Tambahan atribut untuk 6 Pembina Wilayah / Dewan Penasihat
    pembina_1: DataTypes.STRING,
    pembina_2: DataTypes.STRING,
    pembina_3: DataTypes.STRING,
    pembina_4: DataTypes.STRING,
    pembina_5: DataTypes.STRING,
    pembina_6: DataTypes.STRING,
    // Konfigurasi tampilan komponen tanda tangan & stempel saat cetak
    print_stempel: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    print_ttd_ketua_img: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    print_ttd_pembina_img: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    print_ketua: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    print_pengaju: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    print_pembina: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'Lembaga',
  });
  
  return Lembaga;
};
