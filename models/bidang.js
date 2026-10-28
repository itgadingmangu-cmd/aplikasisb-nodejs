'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Bidang extends Model {
    static associate(models) {
      // Definisikan relasi: Satu Bidang milik satu Lembaga
      Bidang.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
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
