#!/bin/bash

# Cek apakah ada pesan commit yang dimasukkan sebagai argumen, jika tidak pakai pesan default
COMMIT_MSG="${1:-update: auto-sync project}"

echo "==> Menambahkan perubahan ke git..."
git add .

echo "==> Melakukan commit dengan pesan: '$COMMIT_MSG'..."
git commit -m "$COMMIT_MSG"

echo "==> Mengirim (push) ke GitHub (branch main)..."
git push origin main

echo "==> Selesai! Kode berhasil disinkronkan ke GitHub."
