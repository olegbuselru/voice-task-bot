#!/usr/bin/env node
/* Lightweight voice pipeline self-check: no secrets required */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = {
  voice: path.join(root, 'src', 'app', 'voice.ts'),
  bot: path.join(root, 'src', 'app', 'bot.ts'),
  server: path.join(root, 'src', 'server.ts'),
};

function checkFfmpeg() {
  try {
    const out = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const firstLine = out.split('\n')[0] || 'ffmpeg detected';
    return { ok: true, detail: firstLine };
  } catch (e) {
    return { ok: false, detail: 'ffmpeg missing or not executable' };
  }
}

function fileContains(filePath, needle) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.includes(needle);
}

function checkWiring() {
  const checks = [
    { name: 'voice handler registered', ok: fileContains(files.bot, 'bot.on(message("voice")') },
    { name: 'voice transcription call', ok: fileContains(files.bot, 'transcribeVoiceFromTelegram') },
    { name: 'webhook route exists', ok: fileContains(files.server, 'app.post("/telegram/webhook"') },
    { name: 'telegram getFile usage', ok: fileContains(files.voice, 'telegram.getFile(fileId)') },
    { name: 'openrouter audio payload', ok: fileContains(files.voice, 'input_audio') },
  ];
  return checks;
}

const ffmpeg = checkFfmpeg();
const wiring = checkWiring();
const allOk = ffmpeg.ok && wiring.every((x) => x.ok);

console.log(JSON.stringify({
  tag: 'voice_self_check',
  ffmpeg,
  wiring,
  ok: allOk,
}, null, 2));

process.exit(allOk ? 0 : 1);
