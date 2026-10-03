/* =========================================================
   Robucca — data toko & menu
   Sumber: ROBUCCA - MENU 2026.pdf + Google Maps.
   Harga = harga di buku menu (tanpa tambahan pajak di aplikasi).
   ========================================================= */

window.MG_CONFIG = {
  storeName: "Robucca",
  branch: "Ijen Nirwana",
  tagline: "Rbc Group",
  address: "Blok D No.1A, Jl. Ijen Nirwana Residence, Bareng, Klojen, Kota Malang, Jawa Timur 65116",
  addressShort: "Ijen Nirwana Residence Blok D No.1A, Malang",
  phoneDisplay: "0877-4184-8928",
  phoneIntl: "6287741848928",          // dipakai untuk tel: & WhatsApp
  instagram: "https://www.instagram.com/robucca.id/",
  tiktok: "",                          // kosong = baris TikTok disembunyikan
  handle: "@robucca.id",
  mapsUrl: "https://maps.app.goo.gl/o7jJLn7jHP1qcneJ7",
  lat: -7.979489,
  lng: 112.6174187,
  appleMapsQuery: "Robucca Ijen Malang",
  mapsEmbed: "https://www.google.com/maps?q=-7.979489,112.6174187&z=17&output=embed",
  open: "08:00",
  close: "21:00",
  lastPickup: "20:45",
  rsvFirst: "08:00",
  rsvLast: "19:30",
  taxRate: 0,                          // 0 = harga menu sudah final
  taxLabel: "",
  priceNote: "Harga sesuai buku menu Robucca 2026.",
  roundTo: 100,
  prepMinutes: 15,
  maxGuests: 30,
  orderPrefix: "RB-",
  cupMark: "Rbc.",
  icsDomain: "robucca.id",

  /* Teks & gambar tampilan */
  welcome: "Mau makan atau ngopi apa hari ini?",
  heroImg: "hero-spread",
  storeImg: "venue-essentials",
  rsvImg: "venue-table",
  story: {
    title: "Ramen, bento, pastry, dan kopi.",
    text: "Robucca di kawasan Ijen Nirwana, Malang — tempat untuk sarapan, makan siang, nongkrong, atau kerja, dari pagi sampai malam.",
  },
  storyImgs: [["venue-essentials", 300], ["venue-table", 220], ["gyu-don", 170], ["tantan-creamy-ramen", 170], ["almond-croissant", 170]],
  homeCats: [
    ["ramen", "Ramen", "shoyu-ramen"], ["bento", "Bento", "chicken-karaage-sambal-matah"], ["donburi", "Rice Bowl", "gyu-don"], ["snack", "Snack", "truffle-fries"],
    ["pastry", "Pastry", "almond-croissant"], ["dessert", "Dessert", "classic-tiramisu"], ["coffee", "Coffee", "ice-caffe-latte"], ["milk", "Milk Based", "matcha-berry-latte"],
  ],
  areas: [
    { v: "Indoor", img: "venue-cups", sub: "Ruang dalam" },
    { v: "Outdoor", img: null, sub: "Area luar" },
    { v: "Bebas", img: "venue-table", sub: "Mana saja" },
  ],
  footNote: "Prototipe untuk demo · belum terhubung ke sistem kasir Robucca.",
};

/* ---------- Grup opsi ---------- */
const SUGAR = { id: "sugar", name: "Level Gula", type: "single", choices: [
  { n: "Normal" }, { n: "Less Sugar" }, { n: "No Sugar" } ] };
const ICED = ["Iced · Regular", "Iced · Large"];
const ICE_ALWAYS = { id: "ice", name: "Level Es", type: "single", choices: [{ n: "Normal Ice" }, { n: "Less Ice" }] };
const ICE_IF_ICED = { ...ICE_ALWAYS, showIf: { size: ICED } };
// Ukuran R/L (minuman dingin)
const size = (large) => ({ id: "size", name: "Ukuran", type: "single", required: true, def: "Regular",
  choices: [{ n: "Regular" }, { n: "Large", p: large }] });
// Iced R/L + Hot dalam satu menu; foto berganti saat memilih Hot
const iceHot = (large, hot, hotImg) => ({ id: "size", name: "Penyajian & ukuran", type: "single", required: true, def: ICED[0],
  choices: [{ n: ICED[0] }, { n: ICED[1], p: large }, { n: "Hot", p: hot, img: hotImg }] });
const FOOD_NOTES = ["Tidak pedas", "Extra pedas", "Tanpa sayur", "Saus dipisah"];
const DRINK_NOTES = ["Tanpa topping", "Pisah es"];

/* ---------- Kategori & menu ---------- */
window.MG_GROUPS = [
  { id: "food", name: "Makanan" },
  { id: "snack", name: "Snack, Pastry & Dessert" },
  { id: "drinks", name: "Minuman" },
];

const LARGE = 4000; // selisih harga ukuran Large di seluruh buku menu
const iced = [size(LARGE), SUGAR, ICE_ALWAYS];

window.MG_MENU = [
  { id: "ramen", group: "food", name: "Ramen", notes: FOOD_NOTES, items: [
    { id: "shoyu-ramen", name: "Shoyu Ramen", price: 35000 },
    { id: "tantan-creamy-ramen", name: "Tantan Creamy Ramen", price: 40000 },
    { id: "dry-yaki-ramen", name: "Dry Yaki Ramen", price: 38000 },
    { id: "sambel-matah-karaage-ramen", name: "Sambel Matah Karaage Ramen", price: 35000, img: "sambel-matah-kaarage-ramen" },
    { id: "spicy-chicken-ramen", name: "Spicy Chicken Ramen", price: 37000 },
    { id: "katsu-curry-ramen", name: "Katsu Curry Ramen", price: 35000 },
    { id: "miso-ramen-katsu-chicken", name: "Miso Ramen Katsu Chicken", price: 39000 },
    { id: "tori-paitan-ramen", name: "Tori Paitan Ramen", price: 37000 },
  ]},
  { id: "bento", group: "food", name: "Bento", notes: FOOD_NOTES, items: [
    { id: "butter-soya-soseji-bento", name: "Butter Soya Soseji Bento", price: 28000 },
    { id: "spicy-soseji-bento", name: "Spicy Soseji Bento", price: 30000 },
    { id: "chicken-karaage-sambal-matah", name: "Chicken Karaage Sambal Matah", price: 30000 },
    { id: "chicken-karaage-mozzato", name: "Chicken Karaage Mozzato", price: 30000 },
    { id: "chicken-karaage-spicy-cheese-bento", name: "Chicken Karaage Spicy Cheese Bento", price: 30000 },
    { id: "chicken-karaage-butter-soya-bento", name: "Chicken Karaage Butter Soya Bento", price: 30000, img: "chicken-kaarage-butter-soya-bento" },
    { id: "gochujang-fire-chicken", name: "Gochujang Fire Chicken", price: 32000, img: "gochunjang-fire-chicken" },
  ]},
  { id: "donburi", group: "food", name: "Rice Bowl", sub: "Donburi & curry", notes: FOOD_NOTES, items: [
    { id: "gyu-don", name: "Gyu Don", price: 40000 },
    { id: "gyu-tan-don", name: "Gyu Tan Don", price: 40000 },
    { id: "chicken-katsudon", name: "Chicken Katsudon", price: 31000 },
    { id: "karaage-egg-mayo-don", name: "Karaage Egg Mayo Don", price: 32000 },
    { id: "chicken-katsu-curry", name: "Chicken Katsu Curry", price: 38000 },
  ]},
  { id: "breakfast", group: "food", name: "Breakfast & Sandwich", notes: FOOD_NOTES, items: [
    { id: "sourdough-full-breakfast", name: "Sourdough Full Breakfast", price: 40000 },
    { id: "french-full-breakfast", name: "French Full Breakfast", price: 42000 },
    { id: "blt-sourdough-sandwich", name: "BLT Sourdough Sandwich", price: 39000 },
    { id: "spicy-oriental-sourdough-sandwich", name: "Spicy Oriental Sourdough Sandwich", price: 39000 },
  ]},
  { id: "salad", group: "food", name: "Salad", notes: FOOD_NOTES, items: [
    { id: "sesame-dressing-japanese-salad", name: "Sesame Dressing Japanese Salad", price: 37000 },
    { id: "ham-and-cheese-italian-salad", name: "Ham and Cheese Italian Salad", price: 37000 },
  ]},
  { id: "pasta", group: "food", name: "Pasta", notes: FOOD_NOTES, items: [
    { id: "pasta-aglio-olio", name: "Pasta Aglio Olio", price: 30000, img: "pasta-oglio-olio" },
    { id: "cheesy-pasta", name: "Cheesy Pasta", price: 31000 },
  ]},

  { id: "snack", group: "snack", name: "Snack", notes: FOOD_NOTES, items: [
    { id: "truffle-fries", name: "Truffle Fries", price: 27000 },
    { id: "french-fries", name: "French Fries", price: 20000 },
    { id: "potato-wedges", name: "Potato Wedges", price: 20000 },
    { id: "aromatic-garlic-fries", name: "Aromatic Garlic Fries", price: 24000 },
    { id: "fries-gravy-moza", name: "Fries Gravy Moza", price: 30000 },
    { id: "chicken-karaage", name: "Chicken Karaage", price: 22000 },
    { id: "takoyaki", name: "Takoyaki", price: 28000 },
    { id: "aburage-chicken-roll", name: "Aburage Chicken Roll", price: 26000 },
    { id: "shrimp-sando", name: "Shrimp Sando", price: 27000 },
    { id: "chicken-katsu-sando", name: "Chicken Katsu Sando", price: 30000 },
    { id: "egg-sando", name: "Egg Sando", price: 28000 },
    { id: "thai-pandan-toast", name: "Thai Pandan Toast", price: 20000 },
    { id: "thai-caramel-toast", name: "Thai Caramel Toast", price: 20000 },
    { id: "salt-edamame", name: "Salt Edamame", price: 19000 },
    { id: "spicy-garlic-edamame", name: "Spicy Garlic Edamame", price: 24000 },
  ]},
  { id: "pastry", group: "snack", name: "Pastry", sub: "Croissant & crookies", items: [
    { id: "croissant-plain", name: "Croissant Plain", price: 15500 },
    { id: "croissant-cheese", name: "Croissant Cheese", price: 24000 },
    { id: "almond-croissant", name: "Almond Croissant", price: 32000 },
    { id: "matcha-croissant", name: "Matcha Croissant", price: 27000 },
    { id: "red-velvet-croissant", name: "Red Velvet Croissant", price: 27000 },
    { id: "double-chocolate-croissant", name: "Double Chocolate Croissant", price: 27000 },
    { id: "croissant-piscok", name: "Croissant Piscok", price: 30000 },
    { id: "pain-au-chocolate", name: "Pain au Chocolate", price: 20000 },
    { id: "crookies-chocolate", name: "Crookies Chocolate", price: 30000 },
  ]},
  { id: "dessert", group: "snack", name: "Dessert", sub: "Misu, cheesecake & cookies", items: [
    { id: "classic-tiramisu", name: "Classic Tiramisu", price: 42000 },
    { id: "matcha-misu", name: "Matcha Misu", price: 42000 },
    { id: "cookies-misu", name: "Cookies Misu", price: 30000 },
    { id: "new-york-cheesecake", name: "New York Cheesecake", price: 31000 },
    { id: "cheesecake-biscoff", name: "Cheesecake Biscoff", price: 32000 },
    { id: "cookies-chocolate", name: "Cookies Chocolate", price: 20000 },
    { id: "cookies-matcha", name: "Cookies Matcha", price: 20000 },
  ]},

  { id: "essentials", group: "drinks", name: "Robucca Essentials", sig: true, notes: DRINK_NOTES, items: [
    { id: "kopi-susu-essentials", name: "Kopi Susu Essentials", price: 24000, sig: true, opts: [SUGAR, ICE_ALWAYS] },
    { id: "kopi-kelapa", name: "Kopi Kelapa", price: 26000, sig: true, opts: [SUGAR, ICE_ALWAYS] },
  ]},
  { id: "signature", group: "drinks", name: "Signature", sig: true, notes: DRINK_NOTES, items: [
    { id: "coffee-misu-latte", name: "Coffee Misu Latte", price: 37000, sig: true, opts: [SUGAR] },
    { id: "sea-salt-butterscotch-latte", name: "Sea Salt Butterscotch Latte", price: 34000, sig: true, opts: [SUGAR] },
    { id: "kinoko-choco-hazel", name: "Kinoko Choco Hazel", price: 29000, sig: true, opts: [SUGAR] },
    { id: "double-cream-ceremonial-matcha", name: "Double Cream Ceremonial Matcha", price: 29000, sig: true, opts: [SUGAR] },
  ]},
  { id: "coffee", group: "drinks", name: "Coffee Based", notes: DRINK_NOTES, items: [
    { id: "caffe-latte", name: "Caffe Latte", price: 19000, img: "ice-caffe-latte", opts: [iceHot(LARGE, 2000, "caffe-latte-hot"), SUGAR, ICE_IF_ICED] },
    { id: "cappuccino", name: "Cappuccino", price: 20000, img: "ice-cappucino", opts: [iceHot(LARGE, 2000, "cappucino-hot"), SUGAR, ICE_IF_ICED] },
    { id: "americano", name: "Americano", price: 16000, img: "ice-americano", opts: [iceHot(LARGE, 2000, "americano-hot"), SUGAR, ICE_IF_ICED] },
    { id: "mochaccino", name: "Mochaccino", price: 20000, img: "ice-mochaccino", opts: [iceHot(LARGE, 0, "mochaccino-hot"), SUGAR, ICE_IF_ICED] },
    { id: "brown-sugar-coffee-regal", name: "Brown Sugar Coffee Regal", price: 28000, opts: iced },
    { id: "brown-coffee-cream-brulee", name: "Brown Coffee Cream Brulee", price: 28000, opts: iced },
    { id: "coffee-cream-caramel", name: "Coffee Cream Caramel", price: 24000, opts: iced },
    { id: "coconut-shaken", name: "Coconut Shaken", price: 24000, opts: iced },
    { id: "coffee-scotch", name: "Coffee Scotch", price: 22000, opts: iced },
    { id: "jamocca", name: "Jamocca", price: 28000, opts: iced },
  ]},
  { id: "milk", group: "drinks", name: "Milk Based", notes: DRINK_NOTES, items: [
    { id: "green-tea-latte", name: "Green Tea Latte", price: 20000, img: "ice-green-tea", opts: [iceHot(LARGE, 0, "green-tea-latte-hot"), SUGAR, ICE_IF_ICED] },
    { id: "red-velvet-latte", name: "Red Velvet Latte", price: 20000, img: "ice-red-velvet-ice", opts: [iceHot(LARGE, 0, "red-velvet-latte-hot"), SUGAR, ICE_IF_ICED] },
    { id: "matcha-berry-latte", name: "Matcha Berry Latte", price: 28000, opts: iced },
    { id: "chocolate-hot", name: "Chocolate (Hot)", price: 20000, opts: [SUGAR] },
    { id: "cocoa-ice", name: "Cocoa Ice", price: 20000, opts: iced },
    { id: "choco-mint", name: "Choco Mint", price: 28000, opts: iced },
    { id: "bitter-sweet-choco", name: "Bitter Sweet Choco", price: 29000, opts: iced },
    { id: "choco-peanut-butter", name: "Choco Peanut Butter", price: 29000, opts: iced },
    { id: "banana-peanut-butter", name: "Banana Peanut Butter", price: 28000, opts: iced },
    { id: "boba-brown-sugar-regal", name: "Boba Brown Sugar Regal", price: 28000, opts: iced },
    { id: "sakura", name: "Sakura", price: 24000, opts: iced },
    { id: "mix-berry-salty-cream", name: "Mix Berry Salty Cream", price: 27500, opts: iced },
  ]},
  { id: "tea", group: "drinks", name: "Tea Based", notes: DRINK_NOTES, items: [
    { id: "mango-tea", name: "Mango Tea", price: 18000, opts: iced },
    { id: "honeydew-lemon-tea", name: "Honeydew Lemon Tea", price: 22000, opts: iced },
    { id: "yuzu-squash-tea", name: "Yuzu Squash Tea", price: 23000, opts: iced },
    { id: "blackcurrant-tea", name: "Blackcurrant Tea", price: 18000, opts: iced },
    { id: "apple-mintea", name: "Apple Mintea", price: 18000, opts: iced },
  ]},
  { id: "soda", group: "drinks", name: "Soda Based", notes: DRINK_NOTES, items: [
    { id: "orange-soda-americano", name: "Orange Soda Americano", price: 22000, opts: iced },
    { id: "summer-breeze", name: "Summer Breeze", price: 22000, opts: iced },
    { id: "strawberry-basil-bubble", name: "Strawberry Basil Bubble", price: 25000, opts: iced },
  ]},
];

/* Banner promo beranda → membuka kategori */
window.MG_BANNERS = [
  { img: "banner-essentials", cat: "essentials", label: "Robucca Essentials", pos: "center" },
  { img: "banner-food", cat: "ramen", label: "Food", pos: "center" },
  { img: "banner-snack", cat: "snack", label: "Snack", pos: "center" },
  { img: "banner-beverage", cat: "coffee", label: "Beverage", pos: "center" },
  { img: "banner-menu", cat: "breakfast", label: "Menu 2026", pos: "center" },
];
