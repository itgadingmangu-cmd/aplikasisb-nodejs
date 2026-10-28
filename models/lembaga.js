'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Lembaga extends Model {
    static associate(models) {
      // Satu Lembaga memiliki banyak Bidang
      Lembaga.hasMany(models.Bidang, { foreignKey: 'lembagaId', as: 'Bidangs' });
      
      // Satu Lembaga memiliki banyak User (Admin Lembaga)
      Lembaga.hasMany(models.User, { foreignKey: 'lembagaId', as: 'Users' });
    }
  }
  Lembaga.init({
    nama_organisasi: DataTypes.STRING,
    nama_ketua: DataTypes.STRING,
    nomor_hp: DataTypes.STRING,
    alamat: DataTypes.TEXT,
    logo: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Lembaga',
  });
  return Lembaga;
};
