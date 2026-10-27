'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Lembaga extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
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