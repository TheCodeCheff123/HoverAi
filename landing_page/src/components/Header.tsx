import HoverAiLogo from "./Logo"

export default function Header() {
	return (
		<header className="fixed top-0 md:top-4 left-0 right-0 z-50 w-full md:px-4 flex items-center justify-center border-b border-gray-200 md:border-none">
			
			<div
			className="flex items-center justify-between w-full md:max-w-[1200px] md:rounded-full  md:border md:border-black/[0.09] px-4 sm:px-6 py-3"
			style={{
				backdropFilter: 'blur(5px) saturate(10%) brightness(1.1)',
				WebkitBackdropFilter: 'blur(5px) saturate(10%) brightness(1.1)',
			}}
			aria-label="Main navigation"
			>
				<HoverAiLogo />
				<div className="hidden md:flex items-center gap-7 text-[16px] font-regular text-black">
					<a href="#features" className="hover:text-neutral-900 transition-colors">Features</a>
					<a href="#how-it-works"      className="hover:text-neutral-900 transition-colors">How it Works</a>
					<a href="#languages" className="hover:text-neutral-900 transition-colors">Language</a>
					<a href="#pricing"    className="hover:text-neutral-900 transition-colors">Pricing</a>
					<a href="#faq"    className="hover:text-neutral-900 transition-colors">FAQ</a>
				</div>
			<a
				href="https://wa.me/message/XXXXXXXXXX"
				target="_blank"
				rel="noopener noreferrer"
				className="bg-[#009933] text-white text-xs sm:text-sm font-semibold px-4 sm:px-6 py-2 sm:py-2.5 rounded-full hover:bg-[#007a28] transition-colors whitespace-nowrap"
			>
				Contact Support
			</a>
			</div>
      </header>
	)
}