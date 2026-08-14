const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const http = require('http');

// Get Telegram Token
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing from environment variables.");
  process.exit(1);
}

// Initialize Bot with Polling
const bot = new TelegramBot(token, { polling: true });

// Prevent Railway deployment timeouts by opening a basic dummy port
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Grammarly Bot active.\n');
}).listen(PORT, () => console.log(`Health check listening on port ${PORT}`));

// Helper function to safely send POST requests using native HTTPS
function checkGrammar(text) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      text: text,
      language: 'en-US'
    }).toString();

    const options = {
      hostname: 'api.languagetool.org',
      port: 443,
      path: '/v2/check',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

// Sanitize output for Markdown formatting
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
}

// /start command listener
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "✍️ *Grammarly Bot is Active!*\n\nSend any text in English and I will point out spelling, grammar, and punctuation issues.",
    { parse_mode: 'Markdown' }
  );
});

// Incoming message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Skip commands and empty inputs
  if (!text || text.startsWith('/')) return;

  try {
    const data = await checkGrammar(text);
    const matches = data.matches || [];

    if (matches.length === 0) {
      return bot.sendMessage(chatId, "✅ No grammar or spelling errors detected!");
    }

    let report = `📝 *Grammar & Correction Analysis*\n\nFound *${matches.length}* issue(s):\n\n`;

    matches.slice(0, 5).forEach((match, idx) => {
      const errorText = text.substring(match.offset, match.offset + match.length);
      const suggestions = match.replacements.map(r => r.value).slice(0, 3).join(', ');

      report += `*${idx + 1}. Error:* \`${escapeMarkdown(errorText)}\`\n`;
      report += `• *Message:* ${escapeMarkdown(match.message)}\n`;
      if (suggestions) {
        report += `• *Suggestions:* ${escapeMarkdown(suggestions)}\n`;
      }
      report += `\n`;
    });

    await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error("Execution error:", err);
    bot.sendMessage(chatId, "⚠️ Failed to verify text. Please try again later.");
  }
});
