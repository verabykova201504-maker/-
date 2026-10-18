"use strict";

/**
 * 🍰 Telegram-бот магазина «ВКУСНО И ПРИЯТНО»
 * Каталог, корзина и оформление заказа — данные берутся из index.html.
 *
 * Запуск:  npm run bot
 * Настройка: см. bot/README.md
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Загрузка .env (без внешних зависимостей)
// ---------------------------------------------------------------------------
function loadEnvFile() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const env = { ...loadEnvFile(), ...process.env };

const TOKEN = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = env.ADMIN_CHAT_ID || "";

if (!TOKEN) {
  console.error(
    "❌ Не найден токен бота.\n" +
      "   Создайте файл .env в корне проекта и добавьте строку:\n" +
      "   BOT_TOKEN=ваш_токен_от_BotFather"
  );
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

// ---------------------------------------------------------------------------
// Товары (скопированы из index.html)
// ---------------------------------------------------------------------------
const PRODUCTS = [
  {
    id: 1,
    name: "Шоколадный торт",
    price: 2500,
    emoji: "🎂",
    description: "Нежный шоколадный торт для праздника.",
  },
  {
    id: 2,
    name: "Клубничное пирожное",
    price: 800,
    emoji: "🧁",
    description: "Воздушное пирожное с клубничным вкусом.",
  },
  {
    id: 3,
    name: "Сладкий пончик",
    price: 500,
    emoji: "🍩",
    description: "Мягкий пончик с аппетитной глазурью.",
  },
  {
    id: 4,
    name: "Шоколад",
    price: 400,
    emoji: "🍫",
    description: "Вкусный шоколад для сладкого перерыва.",
  },
  {
    id: 5,
    name: "Печенье",
    price: 300,
    emoji: "🍪",
    description: "Рассыпчатое печенье к чаю.",
  },
  {
    id: 6,
    name: "Мороженое",
    price: 600,
    emoji: "🍦",
    description: "Холодное лакомство для хорошего настроения.",
  },
];

const SHOP_NAME = "🍰 ВКУСНО И ПРИЯТНО";
const SHOP_TAGLINE = "сладости для хорошего настроения!";

// ---------------------------------------------------------------------------
// API Telegram
// ---------------------------------------------------------------------------
async function call(method, payload = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${method}: ${data.description || "unknown error"}`);
  }
  return data.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatPrice(price) {
  return price.toLocaleString("ru-RU");
}

// ---------------------------------------------------------------------------
// Хранилище: корзины и заказы (файлы рядом с ботом)
// ---------------------------------------------------------------------------
const DATA_DIR = __dirname;
const CARTS_FILE = path.join(DATA_DIR, "carts.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Ошибка чтения ${path.basename(file)}:`, e.message);
  }
  return fallback;
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`Ошибка записи ${path.basename(file)}:`, e.message);
  }
}

/** chatId -> { productId: quantity } */
const carts = readJson(CARTS_FILE, {});
/** chatId -> { step: 'name' | 'phone', name: string } */
const checkoutState = new Map();

let orders = readJson(ORDERS_FILE, []);

function saveCarts() {
  writeJson(CARTS_FILE, carts);
}

function getCart(chatId) {
  if (!carts[chatId]) carts[chatId] = {};
  return carts[chatId];
}

function cartEntries(chatId) {
  return Object.entries(getCart(chatId)).filter(([, qty]) => qty > 0);
}

function cartCount(chatId) {
  return cartEntries(chatId).reduce((sum, [, qty]) => sum + qty, 0);
}

function cartTotal(chatId) {
  return cartEntries(chatId).reduce((sum, [id, qty]) => {
    const product = PRODUCTS.find((p) => p.id === Number(id));
    return sum + (product ? product.price * qty : 0);
  }, 0);
}

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

// ---------------------------------------------------------------------------
// Тексты и клавиатуры
// ---------------------------------------------------------------------------
function mainKeyboard(chatId) {
  const count = cartCount(chatId);
  return [
    [{ text: "🍰 Каталог", callback_data: "catalog" }],
    [
      {
        text: count > 0 ? `🛒 Корзина (${count}) — ${formatPrice(cartTotal(chatId))} ₸` : "🛒 Корзина пуста",
        callback_data: "cart",
      },
    ],
    [{ text: "ℹ️ О магазине", callback_data: "info" }],
  ];
}

function startText() {
  return (
    `<b>${SHOP_NAME}</b>\n` +
    `${SHOP_TAGLINE}\n\n` +
    `Привет! 👋 Я бот для заказа сладостей.\n` +
    `Выбирай из каталога, складывай в корзину и оформляй заказ — я передам его прямо в магазин.`
  );
}

function catalogText(chatId) {
  const lines = PRODUCTS.map(
    (p) =>
      `<b>${p.emoji} ${p.name}</b> — <b>${formatPrice(p.price)} ₸</b>\n` +
      `    <i>${p.description}</i>`
  );

  const header =
    `<b>🍰 Наши сладости</b>\n\n` + lines.join("\n\n") + "\n\n";

  const count = cartCount(chatId);
  const footer =
    count > 0
      ? `🛒 В корзине: <b>${count}</b> шт. на сумму <b>${formatPrice(cartTotal(chatId))} ₸</b>\n\n` +
        `Нажми на товар, чтобы добавить его в корзину 👇`
      : `Нажми на товар, чтобы добавить его в корзину 👇`;

  return header + footer;
}

function catalogKeyboard() {
  const rows = PRODUCTS.map((p) => [
    {
      text: `➕ ${p.emoji} ${p.name} — ${formatPrice(p.price)} ₸`,
      callback_data: `add:${p.id}`,
    },
  ]);
  rows.push([{ text: "🛒 Перейти в корзину", callback_data: "cart" }]);
  return rows;
}

function cartText(chatId) {
  const entries = cartEntries(chatId);

  if (entries.length === 0) {
    return (
      "<b>🛒 Твоя корзина</b>\n\n" +
      "Корзина пока пустая. Добавь что-нибудь вкусное! 😋"
    );
  }

  const lines = entries.map(([id, qty]) => {
    const p = findProduct(id);
    if (!p) return "";
    return (
      `${p.emoji} <b>${p.name}</b>\n` +
      `    ${formatPrice(p.price)} ₸ × ${qty} = <b>${formatPrice(p.price * qty)} ₸</b>`
    );
  });

  return (
    "<b>🛒 Твоя корзина</b>\n\n" +
    lines.join("\n\n") +
    `\n\n<b>Итого: ${formatPrice(cartTotal(chatId))} ₸</b>`
  );
}

function cartKeyboard(chatId) {
  const entries = cartEntries(chatId);
  const rows = entries.map(([id]) => {
    const p = findProduct(id);
    const label = p ? p.name : "Товар";
    return [
      { text: `➖ ${label}`, callback_data: `dec:${id}` },
      { text: "➕", callback_data: `inc:${id}` },
      { text: "🗑", callback_data: `del:${id}` },
    ];
  });

  if (entries.length > 0) {
    rows.push([{ text: "✅ Оформить заказ", callback_data: "checkout" }]);
  }
  rows.push([{ text: "🍰 В каталог", callback_data: "catalog" }]);
  return rows;
}

function infoText() {
  return (
    `<b>${SHOP_NAME}</b>\n` +
    `${SHOP_TAGLINE}\n\n` +
    `🍰 Любимые пирожные, торты и другие лакомства по приятным ценам.\n\n` +
    `📦 Как заказать:\n` +
    `1. Выбери сладости в каталоге\n` +
    `2. Проверь корзину\n` +
    `3. Нажми «Оформить заказ»\n` +
    `4. Оставь имя и телефон — и мы свяжемся с тобой\n\n` +
    `© 2026 ${SHOP_NAME}`
  );
}

function backToMainKeyboard(chatId) {
  return [[{ text: "🏠 В меню", callback_data: "main" }]];
}

// ---------------------------------------------------------------------------
// Редактирование сообщений
// ---------------------------------------------------------------------------
async function edit(chatId, messageId, text, replyMarkup) {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: replyMarkup },
    });
  } catch (e) {
    // «message is not modified» — нормальная ситуация, остальное логируем
    if (!String(e.message).includes("message is not modified")) {
      console.error("editMessageText:", e.message);
    }
  }
}

async function answer(callbackId, text, alert = false) {
  try {
    await call("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
      show_alert: alert,
    });
  } catch (e) {
    console.error("answerCallbackQuery:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Обработка кнопок
// ---------------------------------------------------------------------------
async function handleCallback(update) {
  const cb = update.callback_query;
  const data = cb.data || "";
  const chatId = cb.message && cb.message.chat.id;
  const messageId = cb.message && cb.message.message_id;
  const userId = cb.from && cb.from.id;

  if (chatId == null) return;

  // «Оформить заказ» начинаем с нового сообщения, а не редактируем каталог
  if (data === "checkout") {
    await answer(cb.id);
    checkoutState.set(chatId, { step: "name", userId });
    await call("sendMessage", {
      chat_id: chatId,
      text: "✍️ Как тебя зовут? (имя или nickname)",
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Отменить", callback_data: "cancel_checkout" }]],
      },
    });
    return;
  }

  if (data === "cancel_checkout") {
    checkoutState.delete(chatId);
    await answer(cb.id, "Оформление отменено");
    await edit(chatId, messageId, cartText(chatId), cartKeyboard(chatId));
    return;
  }

  if (data === "main") {
    await answer(cb.id);
    await edit(chatId, messageId, startText(), mainKeyboard(chatId));
    return;
  }

  if (data === "info") {
    await answer(cb.id);
    await edit(chatId, messageId, infoText(), backToMainKeyboard(chatId));
    return;
  }

  if (data === "catalog") {
    await answer(cb.id);
    await edit(chatId, messageId, catalogText(chatId), catalogKeyboard());
    return;
  }

  if (data === "cart") {
    await answer(cb.id);
    await edit(chatId, messageId, cartText(chatId), cartKeyboard(chatId));
    return;
  }

  const [action, rawId] = data.split(":");
  const product = findProduct(rawId);
  if (!product) {
    await answer(cb.id, "Товар не найден", true);
    return;
  }

  const cart = getCart(chatId);

  if (action === "add") {
    cart[product.id] = (cart[product.id] || 0) + 1;
    saveCarts();
    await answer(cb.id, `✅ ${product.name} добавлен в корзину`);
    await edit(chatId, messageId, catalogText(chatId), catalogKeyboard());
    return;
  }

  if (action === "inc") {
    cart[product.id] = (cart[product.id] || 0) + 1;
    saveCarts();
    await answer(cb.id);
    await edit(chatId, messageId, cartText(chatId), cartKeyboard(chatId));
    return;
  }

  if (action === "dec") {
    if (cart[product.id]) {
      cart[product.id] -= 1;
      if (cart[product.id] <= 0) delete cart[product.id];
    }
    saveCarts();
    await answer(cb.id);
    await edit(chatId, messageId, cartText(chatId), cartKeyboard(chatId));
    return;
  }

  if (action === "del") {
    delete cart[product.id];
    saveCarts();
    await answer(cb.id, `🗑 ${product.name} удалён`);
    await edit(chatId, messageId, cartText(chatId), cartKeyboard(chatId));
    return;
  }

  await answer(cb.id);
}

// ---------------------------------------------------------------------------
// Оформление заказа: имя -> телефон -> отправка
// ---------------------------------------------------------------------------
async function sendToAdmin(orderText) {
  if (!ADMIN_CHAT_ID) {
    console.warn("⚠️ ADMIN_CHAT_ID не задан — заказ показан только в консоли.");
    console.warn(orderText.replace(/<[^>]+>/g, ""));
    return false;
  }
  await call("sendMessage", {
    chat_id: ADMIN_CHAT_ID,
    text: orderText,
    parse_mode: "HTML",
  });
  return true;
}

async function finalizeOrder(chatId, phone, username) {
  const entries = cartEntries(chatId);
  const state = checkoutState.get(chatId) || {};
  const name = state.name || "—";
  const total = cartTotal(chatId);

  const number = orders.length + 1;
  const createdAt = new Date().toISOString();

  const items = entries.map(([id, qty]) => {
    const p = findProduct(id);
    return p ? `${p.emoji} ${p.name} × ${qty} = ${formatPrice(p.price * qty)} ₸` : "";
  });

  const userLink = username ? `@${username}` : `chat ${chatId}`;

  const orderText =
    `<b>🛍 НОВЫЙ ЗАКАЗ №${number}</b>\n\n` +
    items.map((line) => `• ${line}`).join("\n") +
    `\n\n<b>Итого: ${formatPrice(total)} ₸</b>\n\n` +
    `👤 Имя: <b>${name}</b>\n` +
    `📞 Телефон: <b>${phone}</b>\n` +
    `🆔 Клиент: ${userLink}`;

  const order = {
    number,
    createdAt,
    chatId,
    username: username || null,
    name,
    phone,
    items: entries.map(([id, qty]) => {
      const p = findProduct(id);
      return { id: Number(id), name: p ? p.name : "?", qty, price: p ? p.price : 0 };
    }),
    total,
    status: "new",
  };

  let delivered = false;
  try {
    delivered = await sendToAdmin(orderText);
    order.notified = delivered;
  } catch (e) {
    console.error("Не удалось отправить заказ админу:", e.message);
    order.notified = false;
  }

  orders.push(order);
  writeJson(ORDERS_FILE, orders);

  carts[chatId] = {};
  saveCarts();
  checkoutState.delete(chatId);

  await call("sendMessage", {
    chat_id: chatId,
    text:
      `🎉 <b>Заказ №${number} принят!</b>\n\n` +
      items.map((line) => `• ${line}`).join("\n") +
      `\n\n<b>Итого: ${formatPrice(total)} ₸</b>\n\n` +
      `👤 ${name}, ${phone}\n` +
      (delivered
        ? `Мы свяжемся с тобой в ближайшее время. Спасибо за заказ! 💜`
        : `Заказ сохранён. Мы свяжемся с тобой для подтверждения. 💜`),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: mainKeyboard(chatId) },
  });
}

async function handleCheckoutMessage(chatId, text, contact, username) {
  const state = checkoutState.get(chatId);
  if (!state) return false;

  if (text === "❌ Отменить" || text.toLowerCase() === "/cancel") {
    checkoutState.delete(chatId);
    await call("sendMessage", {
      chat_id: chatId,
      text: "Оформление заказа отменено.",
      reply_markup: { inline_keyboard: mainKeyboard(chatId) },
    });
    return true;
  }

  if (state.step === "name") {
    if (!text) return false;
    state.name = text.trim().slice(0, 64);
    state.step = "phone";
    checkoutState.set(chatId, state);

    await call("sendMessage", {
      chat_id: chatId,
      text:
        "📞 Теперь оставь номер телефона — нажми кнопку ниже или напиши номер:\n" +
        "<i>Чтобы мы могли связаться с тобой по заказу.</i>",
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [
          [{ text: "📱 Отправить номер", request_contact: true }],
          [{ text: "❌ Отменить" }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return true;
  }

  if (state.step === "phone") {
    let phone = null;
    if (contact && contact.phone_number) {
      phone = contact.phone_number;
    } else if (text) {
      const digits = text.replace(/[^\d+]/g, "");
      if (digits.length >= 7) phone = digits;
    }

    if (!phone) {
      await call("sendMessage", {
        chat_id: chatId,
        text: "Похоже, это не номер 🙈. Отправь номер кнопкой или напиши его текстом.",
      });
      return true;
    }

    await call("sendMessage", {
      chat_id: chatId,
      text: "⏳ Оформляем заказ…",
      reply_markup: { remove_keyboard: true },
    });

    await finalizeOrder(chatId, phone, username);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Текстовые сообщения и команды
// ---------------------------------------------------------------------------
async function handleMessage(update) {
  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const contact = msg.contact || null;
  const username = msg.from && msg.from.username;

  // Сначала — сценарий оформления заказа
  if (checkoutState.has(chatId)) {
    const handled = await handleCheckoutMessage(chatId, text, contact, username);
    if (handled) return;
  }

  if (!text) return;

  const command = text.split(/\s+/)[0].toLowerCase();

  if (command === "/start" || command === "/help" || command === "/menu") {
    await call("sendMessage", {
      chat_id: chatId,
      text: startText(),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: mainKeyboard(chatId) },
    });
    return;
  }

  if (command === "/catalog" || command === "/shop") {
    await call("sendMessage", {
      chat_id: chatId,
      text: catalogText(chatId),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: catalogKeyboard() },
    });
    return;
  }

  if (command === "/cart") {
    await call("sendMessage", {
      chat_id: chatId,
      text: cartText(chatId),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: cartKeyboard(chatId) },
    });
    return;
  }

  if (command === "/orders" && ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID)) {
    const last = orders.slice(-10);
    const body =
      last.length === 0
        ? "Заказов пока нет."
        : last
            .map(
              (o) =>
                `№${o.number} от ${o.createdAt.slice(0, 16).replace("T", " ")} — ` +
                `${o.name} (${o.phone}) — ${formatPrice(o.total)} ₸ — ${o.status}`
            )
            .join("\n");
    await call("sendMessage", {
      chat_id: chatId,
      text: `<b>📦 Последние заказы</b>\n\n${body}`,
      parse_mode: "HTML",
    });
    return;
  }

  // Просто текст без команды — подсказка
  await call("sendMessage", {
    chat_id: chatId,
    text:
      "Я понимаю команды 👇\n" +
      "/catalog — каталог сладостей\n" +
      "/cart — корзина\n" +
      "/start — меню",
    reply_markup: { inline_keyboard: mainKeyboard(chatId) },
  });
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update);
  } else if (update.message) {
    await handleMessage(update);
  }
}

// ---------------------------------------------------------------------------
// Запуск: long polling
// ---------------------------------------------------------------------------
async function main() {
  const me = await call("getMe");
  console.log(`✅ Бот запущен: @${me.username} (${me.first_name})`);
  if (ADMIN_CHAT_ID) {
    console.log(`📦 Заказы будут приходить в чат: ${ADMIN_CHAT_ID}`);
  } else {
    console.log("⚠️ ADMIN_CHAT_ID не задан — заказы будут только в консоли.");
  }
  console.log("Ожидание сообщений…\n");

  let offset = 0;

  // Начинаем с пустого списка, чтобы не подхватывать старые апдейты
  const boot = await call("getUpdates", { timeout: 0, offset: -1 });
  offset = boot.length ? boot[boot.length - 1].update_id + 1 : 0;

  for (;;) {
    try {
      const updates = await call("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (e) {
          console.error("Ошибка обработки апдейта:", e.message);
        }
      }
    } catch (e) {
      console.error("Ошибка polling:", e.message);
      await sleep(3000);
    }
  }
}

main().catch((e) => {
  console.error("Фатальная ошибка:", e);
  process.exit(1);
});
