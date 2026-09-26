// Decorative left panel shown on auth screens.
// Orbit technique: each item has an outer "arm" div anchored at the ring
// centre with transformOrigin:'0 0'. The keyframe rotates the arm. An inner
// div is offset by the ring radius along X and then counter-rotated so the
// label+icon stays upright throughout the orbit.

const ORBIT_ITEMS = [
  {
    icon: 'ri-mic-fill',
    label: 'Code-switched voice input',
	iconColor: 'var(--color-indigo-500)',
    iconBg: 'var(--color-indigo-200)',
    radius: 190,
    startDeg: -90,
    duration: 32,
    dir: 1 as const,
  },
  {
    icon: 'ri-fullscreen-fill',
    label: 'On-screen step guidance',
	iconColor: 'var(--color-orange-400)',
    iconBg: 'var(--color-orange-200)',
    radius: 145,
    startDeg: 155,
    duration: 24,
    dir: -1 as const,
  },
  {
    icon: 'ri-eye-fill',
    label: 'Live screen context',
	iconColor: 'var(--color-green-300)',
    iconBg: 'var(--color-green-600)',
    radius: 100,
    startDeg: 30,
    duration: 18,
    dir: 1 as const,
  },
  {
    icon: 'ri-lock-2-fill',
    label: 'Private by default',
	iconColor: 'var(--color-pink-600)',
    iconBg: 'var(--color-pink-200)',
    radius: 55,
    startDeg: 210,
    duration: 13,
    dir: -1 as const,
  },
]

const ORBIT_SIZE = 440

export default function AuthPanel() {
  // Build keyframes for each item.
  // Arm starts rotated to startDeg, translateX pushes the payload out to
  // the ring edge. Counter-rotate keeps the payload upright.
  const css = ORBIT_ITEMS.map(({ radius, startDeg, duration, dir }, i) => {
    const end = startDeg + dir * 360
    return `
@keyframes orb${i} {
  from { transform: rotate(${startDeg}deg) translateX(${radius}px) rotate(${-startDeg}deg); }
  to   { transform: rotate(${end}deg)      translateX(${radius}px) rotate(${-end}deg); }
}
.orb${i} { animation: orb${i} ${duration}s linear infinite; }`
  }).join('\n')

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        background: 'var(--color-indigo-800)',
        width: '45%',
        minWidth: 380,
        flexShrink: 0,
        padding: '36px 32px',
      }}
    >
      <style>{css}</style>

      {/* Logo */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="42" height="24" viewBox="0 0 57 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M51.2865 8.93283C53.184 10.1486 53.2719 12.2467 51.4827 13.6191C49.3816 15.2308 49.4848 17.6947 51.7131 19.1223L54.8222 21.1143C56.7198 22.33 56.8076 24.4281 55.0184 25.8006L51.1841 28.7418C49.3949 30.1142 46.4062 30.2413 44.5086 29.0256L31.8688 20.9275C29.9712 19.7118 29.8834 17.6137 31.6726 16.2412C33.7737 14.6295 33.6705 12.1657 31.4421 10.738L28.333 8.74607C26.4355 7.53034 26.3476 5.43221 28.1368 4.05976L31.9711 1.11856C33.7603 -0.253887 36.7491 -0.380937 38.6466 0.834791L51.2865 8.93283Z" fill="white" />
          <path d="M24.4362 10.882C26.3337 12.0978 26.4216 14.1959 24.6324 15.5684C22.7103 17.0427 22.8047 19.2967 24.8432 20.6027L28.7887 23.1305C30.6863 24.3462 30.7741 26.4444 28.9849 27.8168L25.1506 30.758C23.3614 32.1305 20.3726 32.2575 18.4751 31.0418L5.83526 22.9438C3.93769 21.728 3.84985 19.6299 5.63904 18.2574C7.56114 16.7831 7.46676 14.5291 5.42825 13.2231L1.48267 10.6952C-0.414855 9.47949 -0.502734 7.38135 1.28646 6.00891L5.12078 3.06771C6.90997 1.69528 9.89871 1.56825 11.7963 2.78394L24.4362 10.882Z" fill="white" />
        </svg>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em' }}>HoverAi</span>
      </div>

      {/* Orbit stage — centred absolutely */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: ORBIT_SIZE,
          height: ORBIT_SIZE,
          transform: 'translate(-50%, -52%)',
          pointerEvents: 'none',
        }}
      >
        {/* Ring circles */}
        {ORBIT_ITEMS.map(({ radius }, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: radius * 2,
              height: radius * 2,
              marginTop: -radius,
              marginLeft: -radius,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          />
        ))}

        {/* Centre watermark */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
          <svg width="70" height="40" viewBox="0 0 57 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.14 }}>
            <path d="M51.2865 8.93283C53.184 10.1486 53.2719 12.2467 51.4827 13.6191C49.3816 15.2308 49.4848 17.6947 51.7131 19.1223L54.8222 21.1143C56.7198 22.33 56.8076 24.4281 55.0184 25.8006L51.1841 28.7418C49.3949 30.1142 46.4062 30.2413 44.5086 29.0256L31.8688 20.9275C29.9712 19.7118 29.8834 17.6137 31.6726 16.2412C33.7737 14.6295 33.6705 12.1657 31.4421 10.738L28.333 8.74607C26.4355 7.53034 26.3476 5.43221 28.1368 4.05976L31.9711 1.11856C33.7603 -0.253887 36.7491 -0.380937 38.6466 0.834791L51.2865 8.93283Z" fill="white" />
            <path d="M24.4362 10.882C26.3337 12.0978 26.4216 14.1959 24.6324 15.5684C22.7103 17.0427 22.8047 19.2967 24.8432 20.6027L28.7887 23.1305C30.6863 24.3462 30.7741 26.4444 28.9849 27.8168L25.1506 30.758C23.3614 32.1305 20.3726 32.2575 18.4751 31.0418L5.83526 22.9438C3.93769 21.728 3.84985 19.6299 5.63904 18.2574C7.56114 16.7831 7.46676 14.5291 5.42825 13.2231L1.48267 10.6952C-0.414855 9.47949 -0.502734 7.38135 1.28646 6.00891L5.12078 3.06771C6.90997 1.69528 9.89871 1.56825 11.7963 2.78394L24.4362 10.882Z" fill="white" />
          </svg>
        </div>

        {/* Orbiting items */}
        {ORBIT_ITEMS.map(({ icon, label, iconBg, iconColor }, i) => (
          // "Arm" div: lives at ring centre, rotates around it (transformOrigin 0 0).
          // translateX in the keyframe pushes it out to the ring edge.
          // The inner wrapper counter-rotates so content stays upright.
          <div
            key={i}
            className={`orb${i}`}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transformOrigin: '0 0',   // pivot = ring centre
              willChange: 'transform',
            }}
          >
            {/* Inner: offset left so it sits centred on the orbit point */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Icon circle */}
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: `0 4px 16px ${iconBg}70`,
                }}
              >
                <i className={icon} style={{ color: `${iconColor}`, fontSize: 18 }} />
              </div>

              {/* Label pill */}
              <div
                style={{
                  background: iconColor,
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '12px 20px',
				  width: '131px',
                  borderRadius: 15,
                  boxShadow: `0 4px 16px ${iconColor}55`,
                }}
              >
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tagline */}
      <div style={{ position: 'relative', zIndex: 10 }}>
        <p style={{ color: '#fff', fontSize: 34, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.03em' }}>
          Your screen
          <br />
          understands you now.
        </p>
      </div>
    </div>
  )
}
