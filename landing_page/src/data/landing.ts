/* ── Feature cards ──────────────────────────────────────────────────── */
export const FEATURES = [
  {
    icon: 'ri-mic-fill',
    iconColor: 'var(--color-indigo-500)',
    iconBg: 'var(--color-indigo-200)',
    title: 'Code-switched voice input',
    body: 'Start a sentence in English, finish it in Yorùbá — Hover AI keeps up, mid-thought, without needing you to pick a "mode."',
    accent: false,
  },
  {
    icon: 'ri-eye-fill',
    iconColor: 'var(--color-green-300)',
    iconBg: 'var(--color-green-600)',
    title: 'Live screen context',
    body: "Hover AI sees the app you're actually in — not a generic script it hopes applies.",
    accent: true,
  },
  {
    icon: 'ri-fullscreen-fill',
    iconColor: 'var(--color-orange-400)',
    iconBg: 'var(--color-orange-200)',
    title: 'On-screen guidance',
    body: 'A glowing beacon lands right on the button to click — no hunting through menus.',
    accent: true,
  },
  {
    icon: 'ri-lock-2-fill',
    iconColor: 'var(--color-pink-600)',
    iconBg: 'var(--color-pink-200)',
    title: 'Private by default',
    body: 'Screen and voice context are processed for the task at hand and never leave your device without your say-so. No silent recording, ever.',
    accent: false,
  },
]

/* ── How it works steps ─────────────────────────────────────────────── */
export const STEPS = [
  {
    num: '01',
    title: 'Ask, your way',
    body: 'Hit the shortcut & ask in whatever mix of languages feels natural. No commands to memorize.',
  },
  {
    num: '02',
    title: 'Hover AI reads your screen',
    body: "It matches your intent to exactly what's open — the app, the panel, the state you're in right now.",
  },
  {
    num: '03',
    title: 'Follow the beacon',
    body: 'A glowing marker walks you to the right button, step by step, until the task is done.',
  },
]

/* ── Pricing plans ──────────────────────────────────────────────────── */
export const PLANS = [
  {
    name: 'Personal',
    sub: 'For solo creators getting started',
    price: '$0',
    period: '/month',
    cta: 'Get Started Free',
    ctaStyle: { background: 'var(--color-neutral-700)', border: '1px solid #E5E5E5', color: '#fff' },
    popular: false,
    features: [
      '50 voice commands / month',
      '2 language profiles',
      'On-screen guidance',
      'Community support',
    ],
  },
  {
    name: 'Creator Pro',
    sub: 'For daily, professional use',
    price: '$15',
    period: '/month',
    cta: 'Upgrade to Pro',
    ctaStyle: { background: 'var(--color-indigo-400)', color: '#fff' },
    popular: true,
    features: [
      'Unlimited voice commands',
      'All 6 language profiles',
      'Priority screen-context speed',
      'Command history & replay',
      'Priority support',
    ],
  },
]

/* ── FAQ items ──────────────────────────────────────────────────────── */
export const FAQS = [
  {
    q: 'What does "code-switched" actually mean here?',
    a: 'It means you can speak naturally across multiple languages in a single sentence — e.g. "abeg help me find the export button" — and Hover AI understands your intent without needing you to switch modes.',
  },
  {
    q: 'Which languages are supported today?',
    a: 'Nigeria + Pidgin, Yorùbá, Igbo, Hausa, and English. More language profiles ship every quarter.',
  },
  {
    q: 'Is my screen and voice data private?',
    a: 'Yes. Screen captures and voice audio are processed ephemerally for the task at hand and never stored or sent to third parties without your explicit consent.',
  },
  {
    q: 'Which apps does it work with?',
    a: 'Any desktop app — design tools (Figma, Photoshop, Illustrator), browsers, productivity apps (Notion, VS Code), and more. The list grows as we train on new screen contexts.',
  },
  {
    q: 'Can I change the shortcut or turn off screen access?',
    a: 'Absolutely. You control the activation shortcut, screen-capture permissions, and microphone access from the settings panel at any time.',
  },
]

/* ── Language pills ─────────────────────────────────────────────────── */
export const LANGUAGES = [
  { label: 'Nigeria + Pidgin', flag: '🇳🇬' },
  { label: 'Yorùbá',           flag: '🇳🇬' },
  { label: 'Igbo',             flag: '🇳🇬' },
  { label: 'Hausa',            flag: '🇳🇬' },
  { label: 'English',          flag: '🇬🇧' },
]
