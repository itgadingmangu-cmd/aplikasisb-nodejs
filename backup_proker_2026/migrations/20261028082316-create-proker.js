'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Prokers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      nama_program: {
        type: Sequelize.STRING
      },
      deskripsi: {
        type: Sequelize.TEXT
      },
      waktu_pelaksanaan: {
        type: Sequelize.STRING
      },
      status: {
        type: Sequelize.STRING
      },
      bidangId: {
        type: Sequelize.INTEGER,
        references: {
          model: 'Bidangs',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
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
    await queryInterface.dropTable('Prokers');
  }
};
