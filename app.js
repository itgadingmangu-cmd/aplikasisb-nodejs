require('dotenv').config();
const express = require('express');
const db = require('./models');
const User = db.User || db.user;

const app = express();
const port = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Aplikasi Node.js & Sequelize berjalan!');
});

app.post('/users', async (req, res) => {
  try {
    const { nama, email } = req.body;
    const newUser = await User.create({ nama, email });
    res.status(201).json(newUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
