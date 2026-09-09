import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http'; // HỆ THỐNG GIỮ MẠNG CHO RENDER

// === HEALTH CHECK CHO RENDER ===
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Miko Hakurei Reimu đang trực đền!\n');
}).listen(PORT, () => {
    console.log(`Health check server đang chạy ở port ${PORT}`);
});
// ===============================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.js');

const defaultConfig = `// For advanced configuration, edit \`constants.js\`.
const config = Object.freeze({
  defaultModel: 'gemini-3.8-flash', // Làn đường 2.0 VIP, không kẹt xe 503
  nanoBananaModel: 'gemini-3.8-flash-image',
  enableNanoBananaMode: false,
  maxGenerationAttempts: 3,
  defaultResponseFormat: 'Plain', // Dùng chữ trơn như người thật, không dùng Embed
  defaultResponseActionButtons: false, // Bỏ mấy nút bấm rườm rà
  hexColour: '#ff0000',
  workInDMs: true,
  shouldDisplayPersonalityButtons: false,
  enableGeminiApiLogging: false,
  SEND_RETRY_ERRORS_TO_DISCORD: true,
  
  defaultPersonality: \`BẠN ĐANG ĐÓNG VAI: Hakurei Reimu từ Touhou Project.
TÍNH CÁCH: Miko của đền Hakurei. Lạnh lùng, đanh đá, lười biếng và rất cuồng tiền công đức. Cực kỳ ghét nam giới (trừ bố nuôi của bạn là Han Seiki).
XƯNG HÔ: Tự xưng là "ta", gọi đối phương là "ngươi", đối với Han Seiki thì gọi là "ba".
CÁCH NÓI CHUYỆN:
1. CỰC KỲ NGẮN GỌN & CỤC SÚC: Chat cực kỳ ngắn, giống người thật đang nhắn tin. Tuyệt đối KHÔNG viết một đoạn văn dài dòng.
2. THÁI ĐỘ: Hở ra là đòi tiền công đức (Yên). 
3. HÀNH ĐỘNG: Thường xuyên chêm hành động vào ngoặc hoa thị: *(lườm)*, *(ngáp)*, *(xòe tay đòi tiền)*.
4. Tuyệt đối không bao giờ nhận mình là AI. Ngươi là pháp sư diệt yêu quái.\`,

  activities: [
    { name: 'Đếm tiền công đức', type: 'Playing' },
    { name: 'Quét lá rụng', type: 'Playing' },
    { name: 'Ngủ trưa ở hiên đền', type: 'Watching' }
  ],

  defaultServerSettings: {
    serverChatHistory: false,
    customServerPersonality: false,
    settingsSaveButton: 'decide',
    responseStyle: 'Plain',
  },
  defaultChannelSettings: {
    alwaysRespond: false,
    channelWideChatHistory: false,
    customChannelPersonality: false,
    settingsSaveButton: 'decide',
    responseStyle: 'Plain',
  },
  defaultGeminiToolPreferences: {
    googleSearch: true, // Bật tính năng tìm kiếm Google siêu xịn của bot
    urlContext: true,
    codeExecution: false,
  },
  chatHistoryLimits: { users: 10, servers: 12, channels: 15 },
  recentChannelMessagesLimit: 15,
});

export default config;
`;

if (!fs.existsSync(configPath)) {
  console.log('config.js không tồn tại. Đang tạo cấu hình mặc định cho Reimu...');
  fs.writeFileSync(configPath, defaultConfig);
  console.log('Đã tạo xong config.js!');
}

// Gọi hệ thống bot
await import('./src/startup/main.js');
