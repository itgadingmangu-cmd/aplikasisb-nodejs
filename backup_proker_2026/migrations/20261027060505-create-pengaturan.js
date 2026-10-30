'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Pengaturans', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      nama_aplikasi: {
        type: Sequelize.STRING
      },
      logo_icon: {
        type: Sequelize.STRING
      },
      step1_judul: {
        type: Sequelize.STRING
      },
      step1_deskripsi: {
        type: Sequelize.TEXT
      },
      step2_judul: {
        type: Sequelize.STRING
      },
      step2_deskripsi: {
        type: Sequelize.TEXT
      },
      step3_judul: {
        type: Sequelize.STRING
      },
      step3_deskripsi: {
        type: Sequelize.TEXT
      },
      step4_judul: {
        type: Sequelize.STRING
      },
      step4_deskripsi: {
        type: Sequelize.TEXT
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Pengaturans');
  }
};