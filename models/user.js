'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Relasi ke Bidang (jika menggunakan id_bidang)
      User.belongsTo(models.Bidang, { foreignKey: 'id_bidang', as: 'Bidang' });
      
      // Tambahan relasi ke Lembaga menggunakan lembagaId
      User.belongsTo(models.Lembaga, { foreignKey: 'lembagaId', as: 'Lembaga' });
    }
  }
  User.init({
    nama_lengkap: DataTypes.STRING,
    username: DataTypes.STRING,
    password: DataTypes.STRING,
    role: DataTypes.STRING,
    id_bidang: DataTypes.INTEGER,
    lembagaId: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'User',
  });
  return User;
};
