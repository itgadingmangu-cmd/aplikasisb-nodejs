'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Bidang extends Model {
    static associate(models) {
      // Relasi Bidang ke Lembaga
      Bidang.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
      
      // Relasi Bidang ke Proker
      Bidang.hasMany(models.Proker, { foreignKey: 'bidangId', as: 'Prokers', onDelete: 'CASCADE' });

      // TAMBAHAN INI: Relasi Bidang ke User (Pengurus Bidang)
      Bidang.hasMany(models.User, { foreignKey: 'id_bidang', as: 'Users' });
    }
  }
  Bidang.init({
    nama_bidang: DataTypes.STRING,
    lembagaId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'Bidang',
  });
  return Bidang;
};
