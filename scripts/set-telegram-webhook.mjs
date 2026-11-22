// Mendaftarkan webhook bot Telegram ke deployment SalesTrain.
// Usage:
//   node --env-file=.env.local scripts/set-telegram-webhook.mjs https://salestrain-xi.vercel.app
//   node --env-file=.env.local scripts/set-telegram-webhook.mjs --info
//
// Bila TELEGRAM_WEBHOOK_SECRET diset, Telegram akan mengirim header
// X-Telegram-Bot-Api-Secret-Token yang divalidasi oleh /api/telegram/webhook.
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN belum diset (gunakan --env-file=.env.local).");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const arg = process.argv[2];

if (!arg || arg === "--info") {
  const info = await api("getWebhookInfo");
  console.log(JSON.stringify(info, null, 2));
  if (!arg) console.log("\nUntuk mendaftarkan: node --env-file=.env.local scripts/set-telegram-webhook.mjs <https://domain-anda>");
  process.exit(0);
}

const base = new URL(arg);
if (base.protocol !== "https:") {
  console.error("Telegram hanya menerima webhook HTTPS.");
  process.exit(1);
}
const url = new URL("/api/telegram/webhook", base).toString();

const result = await api("setWebhook", {
  url,
  allowed_updates: ["message"],
  drop_pending_updates: true,
  ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : {}),
});
console.log("setWebhook →", url);
console.log(JSON.stringify(result, null, 2));

await api("setMyCommands", { commands: [{ command: "start", description: "Lihat Telegram Chat ID untuk login SalesTrain" }] });
