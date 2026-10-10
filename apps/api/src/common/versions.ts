/** Versi pesanan untuk perubahan dari sisi server (pelanggan membatalkan reservasi, ganti ke bayar di kasir, refund).
    Perangkat POS menaikkan versi +1 per perubahan dan server menganggap versi yang sama sebagai kiriman ulang (duplikat).
    Bila server juga menaikkan +1, perubahan kasir yang dibuat dari versi lama bisa bernomor sama lalu terbuang diam-diam.
    Karena itu server menaikkan sebanyak langkah ini: salinan perangkat dari versi sebelumnya (kurang dari 1000 perubahan
    offline) selalu "conflict" → perangkat memakai versi server dan kasir melihat pemberitahuannya. */
export const SERVER_VERSION_STEP = 1000;
