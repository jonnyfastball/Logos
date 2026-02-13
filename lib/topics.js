const TOPICS = [
  "AI will replace most jobs within 20 years",
  "Social media does more harm than good",
  "College education is overrated",
  "Privacy is more important than security",
  "Universal basic income should be implemented globally",
];

export function pickRandomTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

export default TOPICS;
