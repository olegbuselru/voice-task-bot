const { applyDeterministicIntentGuards } = require("../dist/services/therapistNlu.js");

const cases = [
  {
    text: "Василиса Островская завтра 10:00",
    input: { intent: "set_working_hours" },
    expected: "create_appointment",
  },
  {
    text: "рабочие часы 10:00-18:00",
    input: { intent: "set_working_hours" },
    expected: "set_working_hours",
  },
  {
    text: "настрой график пн-пт 10:00-18:00",
    input: { intent: "set_working_hours" },
    expected: "set_working_hours",
  },
  {
    text: "Василиса Островская какие есть свободные слоты завтра",
    input: {
      intent: "create_appointment",
      client_name: "Василиса Островская",
      start_datetime: "2022-07-18T10:00:00.000Z",
      notes: "Свободные слоты...",
    },
    expected: "suggest_slots",
  },
];

let failed = false;
for (const t of cases) {
  const out = applyDeterministicIntentGuards(t.text, t.input);
  const ok = out.intent === t.expected;
  if (!ok) {
    failed = true;
  }
  console.log(
    JSON.stringify({
      text: t.text,
      expected: t.expected,
      actual: out.intent,
      reason: out.confidenceOrReason,
      ok,
    })
  );
}

if (failed) {
  process.exit(1);
}
