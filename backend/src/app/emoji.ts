const MAP: Array<{ re: RegExp; emoji: string }> = [
  { re: /(отчет|доклад)/i, emoji: "📄" },
  { re: /(звонок|созвон)/i, emoji: "📞" },
  { re: /(купить|магазин)/i, emoji: "🛒" },
  { re: /(врач|здоровье)/i, emoji: "🩺" },
  { re: /(спорт|тренировк)/i, emoji: "💪" },
  { re: /(деньги|оплата|счет)/i, emoji: "💳" },
  { re: /(встреча)/i, emoji: "🤝" },
];

export function pickEmoji(text: string): string {
  for (const rule of MAP) {
    if (rule.re.test(text)) return rule.emoji;
  }
  return "📝";
}
