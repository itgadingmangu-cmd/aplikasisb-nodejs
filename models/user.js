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
    nama_lengkap: {
      type: DataTypes.STRING,
      allowNull: false
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pengurus_bidang'
    },
    jabatan: {
      type: DataTypes.STRING, // Kolom baru untuk menyimpan hierarki jabatan (Ketua, Sekretaris, dll.)
      allowNull: true
    },
    id_bidang: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lembagaId: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'User',
  });

  return User;
};
