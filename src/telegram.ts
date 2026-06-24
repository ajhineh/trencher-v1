// src/telegram.ts
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

// --- START: بخش جدید برای خواندن تنظیمات از .env ---
const PROXY_URL = process.env.PROXY_URL;
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

// اگر متغیر در .env نبود، پیش‌فرض true در نظر گرفته می‌شود
const areNotificationsEnabled = (process.env.ENABLE_TELEGRAM_NOTIFICATIONS ?? 'true').toLowerCase() === 'true';
// --- END: بخش جدید ---


// Store for tracking message IDs per token (for deleting buy messages when sold)
const tokenMessageMap = new Map<string, number>(); // mint -> message_id

export function storeMessageId(mint: string, messageId: number): void {
  tokenMessageMap.set(mint, messageId);
}

export function getMessageId(mint: string): number | undefined {
  return tokenMessageMap.get(mint);
}

export function clearMessageId(mint: string): void {
  tokenMessageMap.delete(mint);
}

export async function deleteMessage(messageId: number): Promise<void> {
  if (!areNotificationsEnabled) return;
  if (!BOT_TOKEN || !CHAT_ID) return;

  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      message_id: messageId
    });

    const options: https.RequestOptions = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/deleteMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      agent: agent as any
    };

    const req = https.request(options, (res) => {
      res.on('end', () => resolve());
    });

    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

export async function sendTelegram(message: string, useMarkdown: boolean = true): Promise<void> {
  // مرحله ۱: چک کردن اینکه آیا نوتیفیکیشن‌ها فعال هستند یا نه
  if (!areNotificationsEnabled) {
    return; // اگر غیرفعال بود، هیچ کاری انجام نده
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("⚠️ Telegram Bot Token or Chat ID is not set in the .env file.");
    return;
  }

  return new Promise((resolve, reject) => {
    // Modified to take a parameter for current attempt, defaulting to the function argument for the first try
    const makeRequest = (isMarkdownAttempt: boolean) => {
      const data = JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: isMarkdownAttempt ? 'HTML' : undefined,
        disable_web_page_preview: true // ✅ Disable link previews
      });

      const options: https.RequestOptions = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        agent: agent as any
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve();
          } else if (res.statusCode === 400 && isMarkdownAttempt) {
            console.warn(`⚠️ Telegram Markdown failed, retrying as plain text...`);
            makeRequest(false); // Retry without Markdown
          } else {
            console.error(`❌ Telegram API error: ${res.statusCode} - ${responseData}`);
            resolve(); // Don't reject to avoid crashing the bot
          }
        });
      });

      req.on('error', (error: any) => {
        console.error("❌ Error sending message to Telegram:", error.code || error.message);
        resolve(); // Don't reject to avoid crashing the bot
      });

      req.write(data);
      req.end();
    };

    // Initial attempt 
    makeRequest(useMarkdown);
  });
}

// Send message with inline keyboard and return message_id
export async function sendTelegramWithKeyboard(
  message: string,
  buttons: { text: string; url?: string; callback_data?: string }[],
  useMarkdown: boolean = true
): Promise<number | null> {
  if (!areNotificationsEnabled) return null;
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("⚠️ Telegram Bot Token or Chat ID is not set in the .env file.");
    return null;
  }

  return new Promise((resolve) => {
    const keyboard = buttons.map(btn => ({
      text: btn.text,
      url: btn.url,
      callback_data: btn.callback_data
    }));

    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: useMarkdown ? 'HTML' : undefined,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [keyboard]
      }
    });

    const options: https.RequestOptions = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      agent: agent as any
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(responseData);
            if (response.ok && response.result?.message_id) {
              resolve(response.result.message_id);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        } else {
          console.error(`❌ Telegram API error: ${res.statusCode} - ${responseData}`);
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}
