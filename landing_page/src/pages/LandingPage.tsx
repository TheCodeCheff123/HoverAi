import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import LandingFooter from '@/components/LandingFooter'
import RemixIcon from '@/components/RemixIcon'
import FadeUp from '@/components/FadeUp'
import hero from '../../assets/images/hero.png'
import { TOOLS } from '@/data/tools'
import Header from '@/components/Header'

/* ── Ease curve used throughout ─────────────────────────────────────── */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/* ── Count-up hook ──────────────────────────────────────────────────── */
function useCountUp(target: number, duration = 1800) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1)
          const ease = 1 - Math.pow(1 - progress, 3)
          setCount(Math.floor(ease * target))
          if (progress < 1) requestAnimationFrame(tick)
          else setCount(target)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, duration])

  return { count, ref }
}

/* ── Feature cards data ─────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: 'ri-mic-2-line',
    iconBg: 'linear-gradient(135deg, #7c86ff 0%, #615fff 100%)',
    title: 'Code-switched voice input',
    body: 'Start a sentence in English, finish it in Yorùbá — Hover AI keeps up, mid-thought, without needing you to pick a "mode."',
    dark: false,
  },
  {
    icon: 'ri-focus-3-line',
    iconBg: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    title: 'Live screen context',
    body: "Hover AI sees the app you're actually in — not a generic script it hopes applies.",
    dark: true,
  },
  {
    icon: 'ri-cursor-line',
    iconBg: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)',
    title: 'On-screen guidance',
    body: 'A glowing beacon lands right on the button to click — no hunting through menus.',
    dark: true,
  },
  {
    icon: 'ri-lock-password-line',
    iconBg: 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)',
    title: 'Private by default',
    body: 'Screen and voice context are processed for the task at hand and never leave your device without your say-so. No silent recording, ever.',
    dark: false,
  },
]

/* ── How it works steps ─────────────────────────────────────────────── */
const STEPS = [
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
const PLANS = [
  {
    name: 'Personal',
    sub: 'For solo creators getting started',
    price: '$0',
    period: '/month',
    cta: 'Get Started Free',
    ctaStyle: { background: 'transparent', border: '1.5px solid rgba(255,255,255,0.25)', color: '#fff' },
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
    ctaStyle: { background: 'linear-gradient(135deg, #615fff 0%, #432dd7 100%)', color: '#fff' },
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
const FAQS = [
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
const LANGUAGES = [
  { label: 'Nigeria + Pidgin', flag: '🇳🇬' },
  { label: 'Yorùbá',           flag: '🇳🇬' },
  { label: 'Igbo',             flag: '🇳🇬' },
  { label: 'Hausa',            flag: '🇳🇬' },
  { label: 'English',          flag: '🇬🇧' },
]

/* ════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const { count, ref } = useCountUp(4000)
  const midpoint = Math.ceil(TOOLS.length / 2)
  const firstHalf  = TOOLS.slice(0, midpoint)
  const secondHalf = TOOLS.slice(midpoint)

  /* FAQ open state */
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0a0a' }}>

	  <section id="home">
		{/* header handler */}
		<div className='h-[120px] w-full'>
		<Header />
		</div>

		{/* hero and picture handler */}
		<div className="w-full max-w-[90%] mx-auto px-5 sm:px-8 pt-10 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-10 items-start">
				
			<div>
			{/* Social proof */}
			<motion.div
				className="flex items-center gap-2 mb-6 flex-wrap"
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
			>
				<div className="flex -space-x-2 shrink-0">
				{[0, 1, 2].map(i => (
					<img
					key={i}
					src="/avatar.png"
					alt="user avatar"
					className="w-7 h-7 rounded-full border-2 object-cover"
					style={{ borderColor: '#0a0a0a', zIndex: 3 - i }}
					/>
				))}
				</div>
				<span className="text-[13px] text-white/70">
				Trusted by <span ref={ref} className="text-white font-semibold">{count.toLocaleString()}+</span> creators building in Lagos, Nairobi &amp; Accra
				</span>
			</motion.div>

			{/* Headline */}
			<motion.h1
				className="font-extrabold leading-[1.06] tracking-tight text-white mb-5"
				style={{ fontSize: 'clamp(36px, 5.5vw, 72px)' }}
				initial={{ opacity: 0, y: 24 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.6, delay: 0.18, ease: EASE }}
			>
				Talk to your screen<br />
				the way you{' '}
				<span
				style={{
					backgroundImage: 'linear-gradient(90deg, #ffffff 0%, #7c86ff 35%, #24f992 70%)',
					WebkitBackgroundClip: 'text',
					WebkitTextFillColor: 'transparent',
					backgroundClip: 'text',
				}}
				>
				actually
				</span>
				<span
				style={{
					backgroundImage: 'linear-gradient(90.18deg, #FFFFFF 0.16%, #7C86FF 26.35%, #24F992 63.32%)',
					WebkitBackgroundClip: 'text',
					WebkitTextFillColor: 'transparent',
					backgroundClip: 'text',
				}}
				>
				{' '}talk{' '}
				</span>

				<svg
					viewBox="0 0 408 41"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					style={{
						display: 'inline-block',
						width: 'clamp(200px, 30vw, 420px)',
						height: '0.8em',
						verticalAlign: 'middle',
						overflow: 'visible',
					}}
				>
					<defs>
						<linearGradient id="stroke-grad" x1="1.31406" y1="20.3755" x2="408" y2="20.3755" gradientUnits="userSpaceOnUse">
							<stop stopColor="#ffffff" />
							<stop offset="0.41" stopColor="#7c86ff" />
							<stop offset="1" stopColor="#24f992" />
						</linearGradient>
					</defs>
					<motion.path
						d="M1.31406 35.7516C45.9807 23.5849 142.714 0.551555 172.314 5.75155C201.914 10.9516 155.647 27.9182 128.814 35.7516C183.981 23.5849 316.914 0.551554 407.314 5.75155"
						stroke="url(#stroke-grad)"
						strokeWidth="8"
						strokeLinecap="round"
						fill="none"
						initial={{ pathLength: 0, opacity: 0 }}
						animate={{ pathLength: [0, 1, 1, 0], opacity: [0, 1, 1, 0] }}
						transition={{
							duration: 3,
							ease: 'easeInOut',
							repeat: Infinity,
							repeatDelay: 0.6,
							times: [0, 0.45, 0.7, 1],
						}}
					/>
				</svg>
			</motion.h1>

			{/* Sub */}
			<motion.p
				className="text-[15px] text-white/60 leading-relaxed mb-8 max-w-[560px]"
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.28, ease: EASE }}
			>
				Hover AI listens to code-switched voice commands, sees exactly what's on your screen, and draws a glowing beacon to the button you need — mid-sentence, mid-language, mid-task.
			</motion.p>

			{/* CTAs */}
			<motion.div
				className="flex items-center gap-3 flex-wrap"
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.38, ease: EASE }}
			>
				<Link
				to="/signup"
				className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[14px] font-semibold text-white transition-opacity hover:opacity-90 whitespace-nowrap"
				style={{ background: 'linear-gradient(135deg, #615fff 0%, #432dd7 100%)' }}
				>
				Get Started Free
				<RemixIcon name="ri-arrow-right-line" size={16} color="#fff" />
				</Link>
				<a
				href="#how-it-works"
				className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[14px] font-semibold text-white/80 hover:text-white transition-colors whitespace-nowrap"
				style={{ border: '1.5px solid rgba(255,255,255,0.25)' }}
				>
				<RemixIcon name="ri-play-circle-line" size={16} color="currentColor" />
				See it work
				</a>
			</motion.div>
			</div>

			{/* Right — hero image */}
			<motion.div
			className="flex items-center justify-center"
			initial={{ opacity: 0, scale: 0.96, y: 24 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			transition={{ duration: 0.7, delay: 0.32, ease: EASE }}
			>
			<img
				src={hero}
				alt="Hover AI screen guidance demo"
				className="w-full object-contain"
				style={{ maxHeight: 'calc(100vh - 220px)' }}
			/>
			</motion.div>
		</div>

		{/* tools marquee */}
		<div className="w-full overflow-hidden py-6">
			<MarqueeRow items={firstHalf} reverse={false} />
			<MarqueeRow items={secondHalf} reverse={true} />
		</div>
	  </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* FEATURES                                                    */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section id="features" className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 py-24">
        <FadeUp>
          <p className="text-[13px] font-bold tracking-widest uppercase mb-3" style={{ color: '#615fff' }}>
            Features
          </p>
          <h2 className="text-[clamp(30px,4vw,48px)] font-extrabold text-white leading-tight mb-4">
            Built for how creators<br />actually speak.
          </h2>
          <p className="text-[15px] text-white/50 max-w-[400px] leading-relaxed mb-12">
            Not another rigid voice command list. Hover AI understands intent, sees context, and shows — not just tells.
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={i * 0.08}>
              <div
                className="rounded-2xl p-7 h-full"
                style={{
                  background: f.dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {/* Icon */}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: f.iconBg }}
                >
                  <RemixIcon name={f.icon} size={20} color="#fff" />
                </div>
                <h3 className="text-[17px] font-bold text-white mb-3">{f.title}</h3>
                <p className="text-[14px] text-white/50 leading-relaxed">{f.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* HOW IT WORKS                                                */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 py-24">
        <FadeUp>
          <p className="text-[13px] font-bold tracking-widest uppercase mb-3" style={{ color: '#615fff' }}>
            How it Works
          </p>
          <h2 className="text-[clamp(28px,4vw,48px)] font-extrabold text-white leading-tight mb-16">
            From "how do I…" to done, in<br />three beats.
          </h2>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {STEPS.map((s, i) => (
            <FadeUp key={s.num} delay={i * 0.1}>
              <div>
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-5 text-[15px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #615fff 0%, #432dd7 100%)' }}
                >
                  {s.num}
                </div>
                <h3 className="text-[17px] font-bold text-white mb-3">{s.title}</h3>
                <p className="text-[14px] text-white/50 leading-relaxed">{s.body}</p>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* LANGUAGES                                                   */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section id="languages" className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 pb-24">
        <FadeUp>
          <div
            className="rounded-2xl p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-8"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Left */}
            <div className="md:max-w-[320px]">
              <p className="text-[13px] font-bold tracking-widest uppercase mb-3" style={{ color: '#615fff' }}>
                FAQ
              </p>
              <h2 className="text-[clamp(26px,3.5vw,40px)] font-extrabold text-white mb-4">
                Good to know.
              </h2>
              <p className="text-[14px] text-white/50 leading-relaxed">
                Six language profiles today, growing every quarter — trained on real code-switched speech, not textbook translations.
              </p>
            </div>

            {/* Right — language pills */}
            <div className="flex flex-wrap gap-3">
              {LANGUAGES.map(l => (
                <span
                  key={l.label}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium text-white"
                  style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)' }}
                >
                  <span role="img" aria-label={l.label}>{l.flag}</span>
                  {l.label}
                </span>
              ))}
              <span
                className="inline-flex items-center gap-1 px-4 py-2 rounded-full text-[13px] font-medium text-white/50"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <RemixIcon name="ri-add-line" size={14} color="currentColor" />
                more coming
              </span>
            </div>
          </div>
        </FadeUp>
      </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* PRICING                                                     */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section id="pricing" className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 py-24">
        <FadeUp className="text-center mb-12">
          <p className="text-[13px] font-bold tracking-widest uppercase mb-3" style={{ color: '#615fff' }}>
            Pricing
          </p>
          <h2 className="text-[clamp(28px,4vw,52px)] font-extrabold text-white leading-tight">
            Start free. Upgrade when it's<br />part of your workflow.
          </h2>
        </FadeUp>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-[800px] mx-auto">
          {PLANS.map((plan, i) => (
            <FadeUp key={plan.name} delay={i * 0.1}>
              <div
                className="rounded-2xl p-7 h-full flex flex-col relative"
                style={{
                  background: plan.popular
                    ? 'rgba(97,95,255,0.15)'
                    : 'rgba(255,255,255,0.04)',
                  border: plan.popular
                    ? '1.5px solid rgba(97,95,255,0.6)'
                    : '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {plan.popular && (
                  <span
                    className="absolute top-5 right-5 text-[11px] font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: 'rgba(97,95,255,0.7)' }}
                  >
                    Most Popular
                  </span>
                )}
                <p className="text-[17px] font-bold text-white mb-1">{plan.name}</p>
                <p className="text-[13px] text-white/50 mb-6">{plan.sub}</p>

                {/* Price */}
                <div className="flex items-baseline gap-1 mb-7">
                  <span className="text-[48px] font-extrabold text-white leading-none">{plan.price}</span>
                  <span className="text-[14px] text-white/50">{plan.period}</span>
                </div>

                {/* CTA */}
                <button
                  className="w-full py-3 rounded-xl text-[14px] font-semibold mb-7 transition-opacity hover:opacity-90"
                  style={plan.ctaStyle as React.CSSProperties}
                >
                  {plan.cta}
                </button>

                {/* Features */}
                <ul className="flex flex-col gap-3 mt-auto">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-[13px] text-white/70">
                      <RemixIcon name="ri-check-line" size={15} color="#615fff" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* FAQ                                                         */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section id="faq" className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 py-24">
        <FadeUp>
          <p className="text-[13px] font-bold tracking-widest uppercase mb-3" style={{ color: '#615fff' }}>
            FAQ
          </p>
          <h2 className="text-[clamp(28px,4vw,48px)] font-extrabold text-white mb-10">
            Good to know.
          </h2>
        </FadeUp>

        <div className="flex flex-col gap-3 max-w-[760px]">
          {FAQS.map((item, i) => (
            <FadeUp key={item.q} delay={i * 0.06}>
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <button
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-[14px] font-medium text-white/80">{item.q}</span>
                  <span className="ml-4 shrink-0 text-white/40 text-xl leading-none">
                    {openFaq === i ? '×' : '+'}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      style={{ overflow: 'hidden' }}
                    >
                      <p className="px-6 pb-5 text-[13px] text-white/50 leading-relaxed">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* CTA BANNER                                                  */}
      {/* ══════════════════════════════════════════════════════════ */}
      <section className="w-full max-w-[1100px] mx-auto px-5 sm:px-8 pb-24">
        <FadeUp>
          <div
            className="rounded-3xl px-8 py-16 flex flex-col items-center text-center"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #22c55e 100%)',
            }}
          >
            <h2 className="text-[clamp(24px,4vw,44px)] font-extrabold text-white leading-tight mb-4 max-w-[500px]">
              Your screen is about to start listening properly.
            </h2>
            <p className="text-[14px] text-white/80 mb-8">
              Free to start. No credit card. Set up your shortcut in under a minute.
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full text-[14px] font-semibold text-indigo-700 bg-white hover:bg-white/90 transition-colors whitespace-nowrap"
            >
              Get Started Free
              <RemixIcon name="ri-arrow-right-line" size={15} color="currentColor" />
            </Link>
          </div>
        </FadeUp>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <LandingFooter />
    </div>
  )
}

/* ── Marquee row helper ─────────────────────────────────────────────── */
function MarqueeRow({ items, reverse }: { items: typeof TOOLS; reverse: boolean }) {
  const repeated = [...items, ...items, ...items, ...items]
  return (
    <div
      className="relative overflow-hidden py-4"
      style={{
        maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
      }}
    >
      <div className={`${reverse ? 'animate-marquee-reverse' : 'animate-marquee'} flex gap-12`}>
        {repeated.map((tool, i) =>
          tool.logo ? (
            <div
              key={`${tool.name}-${i}`}
              className="flex items-center gap-3 shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <img src={tool.logo} alt={tool.name} className="h-8 sm:h-10 w-auto object-contain" />
              <span className="text-[15px] text-white/70 whitespace-nowrap">{tool.name}</span>
            </div>
          ) : null,
        )}
      </div>
    </div>
  )
}
