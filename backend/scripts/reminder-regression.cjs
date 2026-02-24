const assert = require("node:assert/strict");

const { extractUserInput } = require("../dist/inputExtractor.js");
const { parseReminderCommand } = require("../dist/reminderParser.js");
const { buildConfirmationReply } = require("../dist/reminderReplies.js");

function run() {
  const update = {
    update_id: 9001,
    message: {
      message_id: 101,
      text: "Завтра помыть руки",
      chat: { id: 123456 },
    },
  };

  const extracted = extractUserInput(update);
  assert.ok(extracted, "extractUserInput should return payload");
  assert.equal(extracted.chatId, "123456", "chatId should come from update.message.chat.id");
  assert.equal(extracted.userText, "Завтра помыть руки", "must keep original user text");

  const fixedNow = new Date("2026-02-24T06:00:00.000Z");
  const parsed = parseReminderCommand(extracted.userText, fixedNow);
  assert.equal(parsed.ok, true, "parser should accept 'Завтра ...' without command prefix");

  if (!parsed.ok) {
    throw new Error(`Parser failed unexpectedly: ${parsed.reason}`);
  }

  assert.equal(parsed.value.text, "помыть руки", "task text must be extracted from user message content");

  const confirmation = buildConfirmationReply(
    parsed.value.remindDateLabel,
    parsed.value.remindTimeLabel,
    parsed.value.text
  );

  assert.match(confirmation, /помыть руки/i, "success reply must contain actual user task text");
  assert.doesNotMatch(
    confirmation,
    /полить цветок|позвонить маме|выключить плиту/i,
    "success reply must not include template example lines"
  );

  console.log("reminder regression passed");
}

run();
