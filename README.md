# tech-value — Bóveda de Seguridad

Base técnica Vite + React + TypeScript con arquitectura Feature-Driven, Tailwind CSS v3 y Supabase.

## Stack

- Vite 8 + React 19 + TypeScript 6 (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS 3.4 + PostCSS + Autoprefixer
- Supabase JS 2, Zustand 5, Lucide React, clsx + tailwind-merge
- pnpm como gestor de paquetes
- Criptografía: Web Crypto API nativa (`window.crypto.subtle`), cero librerías externas (política Zero-Knowledge, ver `CLAUDE.MD`)

## Instalación

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Variables en `.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Scripts: `dev`, `build (tsc -b && vite build)`, `preview`, `lint`.

## Estructura Feature-Driven

```
src/
├── app/                        # router, providers, layout raíz
├── main.tsx                    # entrypoint (importa index.css + App)
├── index.css                   # solo @tailwind base/components/utilities
├── vite-env.d.ts               # tipado VITE_SUPABASE_URL / ANON_KEY
├── assets/                     # estáticos template Vite
├── shared/
│   ├── components/             # UI reutilizable
│   ├── lib/supabase.ts         # createClient con guard de env vars
│   └── types/index.ts          # Document, DocumentVersion, AuditLog
├── core/crypto/
│   └── vaultCrypto.ts          # motor Zero-Knowledge: PBKDF2, AES-GCM-256, SHA-256, frase de recuperación BIP-39
└── features/
    ├── auth/components-hooks-stores/
    ├── vault/components-hooks-stores/
    └── audit/components-hooks/
```

## Definiciones base

- `Document`: id, owner_id, title, description, file_path, mime_type, size_bytes, is_encrypted, status (active|archived|deleted), current_version, created_at/updated_at
- `DocumentVersion`: document_id, version_number, storage_path, sha256_hash, encryption_iv/salt, created_by/at
- `AuditLog`: user_id, document_id, action (document.created/updated/deleted/downloaded/shared, auth.login/logout), details (Record<string,unknown>), ip_address, created_at
- `supabase.ts`: falla explícitamente si faltan las env vars
- `tailwind.config.js`: content `./index.html` + `./src/**/*.{js,ts,jsx,tsx}`

## Motor criptográfico (`src/core/crypto/vaultCrypto.ts`)

Implementación Zero-Knowledge basada **únicamente** en la Web Crypto API nativa del navegador (sin librerías de terceros). El servidor nunca recibe passphrase, clave derivada ni texto plano.

- `deriveKey(passphrase, salt)`: deriva una `CryptoKey` AES-GCM-256 vía PBKDF2-SHA256 (100,000 iteraciones), **no extraíble** (`extractable: false`).
- `encryptBuffer(data, key)`: cifra con AES-GCM-256, generando un IV aleatorio de 12 bytes; retorna `{ cipherBuffer, iv }` (IV en hex).
- `decryptBuffer(cipherBuffer, key, ivString)`: descifra y verifica integridad mediante el tag de autenticación GCM (rechaza automáticamente si hay manipulación).
- `computeSHA256(data)`: huella digital en hexadecimal minúsculas, para verificación de integridad de archivos.
- `generateRecoveryPhrase()`: frase de recuperación de 12 palabras usando el diccionario oficial BIP-39 (inglés, 2048 palabras), con selección uniforme sin sesgo de módulo vía `crypto.getRandomValues`.
- Utilidades de conversión `bufferToHex` / `hexToBuffer` / `bufferToBase64` / `base64ToBuffer` para serializar buffers cifrados y hashes.

## Verificación

`pnpm exec tsc --noEmit` sin errores y `pnpm run build` exitoso.
