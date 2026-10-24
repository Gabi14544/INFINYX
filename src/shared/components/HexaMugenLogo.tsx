interface HexaMugenLogoProps {
  className?: string;
}

/**
 * Isotipo vectorial Hexa-Mugen para INFINYX:
 * Doble bóveda hexagonal facetada en titanio con doble delineado
 * y núcleo central flotante en paleta Azul "Seis Ojos" (#BAE6FD, #38BDF8, #0284C7).
 * Adaptado con soporte para Modo Claro (Blanco Titanio) y Modo Oscuro (Obsidiana Abisal).
 */
export default function HexaMugenLogo({ className = 'h-9 w-9' }: HexaMugenLogoProps) {
  return (
    <svg
      viewBox="0 0 64 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="infin-titanium-outer" x1="0" y1="0" x2="64" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E2E8F0" />
          <stop offset="50%" stopColor="#64748B" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>
        <linearGradient id="infin-six-eyes-stroke" x1="8" y1="6" x2="56" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284C7" />
          <stop offset="50%" stopColor="#BAE6FD" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
        <radialGradient id="infin-six-eyes-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="55%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </radialGradient>
      </defs>

      {/* Trazo exterior de titanio: doble hexágono angulado formando el infinito (Mugen) */}
      <path
        d="M17 5L5 20L17 35H25L32 26L39 35H47L59 20L47 5H39L32 14L25 5H17Z"
        stroke="url(#infin-titanium-outer)"
        strokeWidth="2.4"
        strokeLinejoin="bevel"
        className="fill-white dark:fill-[#0D111A] transition-colors"
        fillOpacity="0.85"
      />

      {/* Segundo delineado interno energético en Azul Seis Ojos */}
      <path
        d="M19 9.5L10.5 20L19 30.5H23.5L32 20L40.5 30.5H45L53.5 20L45 9.5H40.5L32 20L23.5 9.5H19Z"
        stroke="url(#infin-six-eyes-stroke)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeOpacity="0.85"
      />

      {/* Núcleo/prisma central flotante (Punto de convergencia del Infinito) */}
      <polygon
        points="32,12.5 38.5,20 32,27.5 25.5,20"
        fill="url(#infin-six-eyes-core)"
        stroke="#BAE6FD"
        strokeWidth="1.2"
      />

      {/* Destello cristalino interno del núcleo */}
      <circle cx="32" cy="20" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}
