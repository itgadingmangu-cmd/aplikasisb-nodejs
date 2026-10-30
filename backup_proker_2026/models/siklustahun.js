module.exports = (sequelize, DataTypes) => {
  const SiklusTahun = sequelize.define('SiklusTahun', {
    tahun: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    status: {
      type: DataTypes.STRING, // 'Aktif' atau 'Arsip'
      defaultValue: 'Arsip'
    },
    keterangan: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {});
  return SiklusTahun;
};
