const EXAMPLES = [
  "завтра полить цветок",
  "завтра в 09:30 позвонить маме",
  "сегодня в 21:30 выключить плиту",
].join("\n");

export function buildMissingTextReply(): string {
  return "Пришли текстом: завтра в 09:30 позвонить маме";
}

export function buildMissingDateReply(): string {
  return "Когда напомнить? Пример: 'завтра в 09:30 позвонить маме'";
}

export function buildParseFailedReply(): string {
  return `Не понял.\n${EXAMPLES}`;
}

export function buildConfirmationReply(remindDateLabel: string, remindTimeLabel: string, taskText: string): string {
  return `Ок. Напомню ${remindDateLabel} в ${remindTimeLabel} (МСК): ${taskText}`;
}
