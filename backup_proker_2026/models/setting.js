'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Setting extends Model {
    static associate(models) {
      // define association here
    }
  }
  Setting.init({
    app_name: DataTypes.STRING,
    app_logo: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Setting',
  });
  return Setting;
};
