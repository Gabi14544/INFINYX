# INFINYX — Bóveda de Seguridad Zero-Knowledge

> Bóveda documental B2B con arquitectura estricta de **Conocimiento Cero (Zero-Knowledge)** y sistema de diseño **"Hexa-Mugen" con soporte dual nativo (Modo Oscuro "Seis Ojos" y Modo Claro "Blanco Titanio")** para sectores de alta exigencia: **Banca Privada, Family Offices, LegalTech, FinTech y Salud**. Ni el operador del servidor, ni el proveedor cloud, ni un atacante con acceso total a la infraestructura pueden leer los documentos: el texto plano jamás abandona la memoria RAM del cliente sin cifrar.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)
![Hexa-Mugen UI](https://img.shields.io/badge/Design_System-Hexa--Mugen_Dual-0284C7?logoColor=white)
![Dark & Light Mode](https://img.shields.io/badge/Theme-Dark_%26_Light_Mode-38BDF8?logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-Postgres_+_Storage-3ECF8E?logo=supabase&logoColor=black)
![Web Crypto API](https://img.shields.io/badge/Web_Crypto_API-nativa-F7DF1E?logo=javascript&logoColor=black)
![AES-GCM-256](https://img.shields.io/badge/AES--GCM--256-PBKDF2_SHA256-10B981)

**Índice**

1. [Visión ejecutiva](#1-visión-ejecutiva)
2. [El problema y el modelo de amenazas (Threat Model)](#2-el-problema-y-el-modelo-de-amenazas-threat-model)
3. [Especificación criptográfica (`src/core/crypto/vaultCrypto.ts`)](#3-especificación-criptográfica-srccryptovaultcryptots)
4. [Arquitectura de software (Feature-Driven)](#4-arquitectura-de-software-feature-driven)
5. [Sistema de diseño "Hexa-Mugen" y Tema Dual (Oscuro / Claro)](#5-sistema-de-diseño-hexa-mugen-y-tema-dual-oscuro--claro)
6. [Arquitectura del backend (Supabase / PostgreSQL)](#6-arquitectura-del-backend-supabase--postgresql)
7. [Guía de instalación y despliegue local](#7-guía-de-instalación-y-despliegue-local)
8. [Operación segura, limitaciones conocidas y roadmap](#8-operación-segura-limitaciones-conocidas-y-roadmap)

---

## 1. Visión ejecutiva

**INFINYX** es una bóveda documental institucional donde el cifrado se realiza **íntegramente en el cliente**, antes de cualquier transmisión por red. El backend (Supabase: PostgreSQL + Storage + Auth) opera bajo el principio de **servidor ciego**: almacena únicamente blobs cifrados indistinguibles de ruido blanco, vectores de inicialización públicos y metadatos no sensibles (nombre, tamaño del texto plano, huella de integridad).

| Propiedad | Garantía |
|---|---|
| **Confidencialidad** | AES-GCM-256 con clave derivada localmente vía PBKDF2-SHA-256 (100.000 iteraciones). El servidor nunca recibe passphrase, clave ni texto plano |
| **Integridad** | Doble capa: tag de autenticación AES-GCM (128 bits) + verificación SHA-256 del texto plano tras descifrar en cliente |
| **Aislamiento multitenant** | Row Level Security (RLS) estricto por `auth.uid()` en todas las tablas y bucket privado particionado por usuario |
| **Custodia de claves** | `CryptoKey` no extraíble (`extractable: false`), exclusivamente en memoria RAM (Zustand, sin middleware persistente) |
| **Contraseña de descarga** | Compuerta de autorización por descarga: verificador PBKDF2-SHA-256 (100.000 iteraciones) en `profiles`, contraseña en claro sólo en RAM (`useDownloadAuthStore`) |
| **Acciones por archivo** | 3 acciones de alto valor: 1) **Descargar archivo** (gateado por contraseña en RAM), 2) **Visualizar** (modal centrado y accesible con metadatos y copiado de huella) y 3) **Eliminar** (modal destructivo irreversible con autorización en RAM) |
| **Búsqueda y filtros en RAM** | Filtrado instantáneo 100 % en memoria del cliente por texto/hash, versión (`v1` / `v2+`) y ordenamiento sin peticiones extra |
| **Sistema visual Hexa-Mugen** | Isotipo de doble hexágono en titanio formando el infinito ($\infty$) con prisma central en paleta Azul Seis Ojos (`#BAE6FD`, `#38BDF8`, `#0284C7`) |
| **Soporte Dual de Tema** | **Modo Oscuro** (Obsidiana Abisal `#07090E` y Titanio `#0D111A`) y **Modo Claro** (Blanco Titanio `#FFFFFF` y Pizarra Limpia `#F8FAFC`), conmutables mediante `ThemeToggle` y persistidos en `localStorage` |
| **Recuperación soberana** | Frase mnemónica de 12 palabras (diccionario oficial BIP-39, 2048 palabras), generada con `crypto.getRandomValues` sin sesgo de módulo |
| **Trazabilidad** | Bitácora `audit_logs` con eventos `UPLOAD`, `DOWNLOAD_DECRYPT`, `DELETE` e `INTEGRITY_FAILURE` |
| **Cero dependencias cripto** | 100 % Web Crypto API nativa (`window.crypto.subtle`). Cero librerías externas para criptografía (sin crypto-js ni bcrypt) |

---

## 2. El problema y el modelo de amenazas (Threat Model)

### 2.1. Por qué las nubes tradicionales no bastan

En soluciones tradicionales de almacenamiento corporativo (Google Drive, OneDrive, AWS S3 SSE o Dropbox), **el proveedor retiene —directa o indirectamente— las claves de descifrado**:

- El cifrado "en reposo" lo aplica el servidor con claves que él mismo custodia (KMS del proveedor). Una orden judicial, un empleado desleal o una brecha con escalado de privilegios expone el contenido.
- El operador puede modificar políticas, rotar claves o acceder a snapshots sin conocimiento del cliente.
- Para un despacho jurídico, una entidad financiera o una firma de gestión patrimonial, esto incumple el principio de minimización de confianza exigido por RGPD, secreto bancario y normativas sectoriales (DORA, ENS, HIPAA).

### 2.2. Principio de Cero Confianza en el Servidor (Zero-Trust Backend)

INFINYX invierte el modelo: **el servidor es un disco duro ciego**.

- Supabase Storage (bucket privado `vault_files`) sólo recibe `ArrayBuffer` ya cifrados con AES-GCM-256, servidos como `application/octet-stream` con extensión `.enc`. Sin la clave, son indistinguibles de ruido blanco.
- PostgreSQL sólo guarda metadatos no sensibles: nombre de archivo, MIME, tamaño del texto plano, `storage_path`, IV (público por diseño en AES-GCM) y `sha256_hash` (sólo útil para verificar integridad *después* de descifrar, nunca para recuperar contenido).
- La autenticación (Supabase Auth) y la autorización (RLS) protegen el **acceso a los blobs**, pero incluso un atacante con `service_role`, con acceso físico a los discos o con un volcado completo de la base de datos **no puede descifrar ni un solo byte**: la clave sólo existe en la memoria RAM del navegador del usuario.

### 2.3. Actores y capacidades asumidas

| Atacante | Capacidad | Resultado esperado |
|---|---|---|
| **Curioso / empleado del proveedor** | Lectura total de Storage + Postgres | Obtiene ruido cifrado opaco. Sin clave: inútil |
| **Atacante de red (MITM)** | Interceptación TLS rota / CDN comprometido | Sólo ciphertext + metadatos públicos. La app exige contexto seguro (HTTPS) para Web Crypto |
| **Malware en el endpoint del usuario** | Lectura de RAM del navegador | Fuera de alcance: ningún software protege secretos en un endpoint comprometido; se mitiga con auto-bloqueo por inactividad (10 min) y destrucción inmediata de clave |
| **Usuario malicioso de otro tenant** | Llamadas autenticadas a la API | Bloqueado por RLS (`user_id = auth.uid()`) y rutas de Storage prefijadas por `{user_id}/` |
| **Manipulación del blob en servidor** | Sustitución o corrupción del `.enc` | Detectada: AES-GCM rechaza el tag de 128 bits y la verificación SHA-256 post-descifrado aborta la entrega, registrando `INTEGRITY_FAILURE` |

---

## 3. Especificación criptográfica (`src/core/crypto/vaultCrypto.ts`)

Todo el motor reside en un único módulo sin dependencias externas, basado exclusivamente en `window.crypto.subtle` y `window.crypto.getRandomValues`. Requiere **contexto seguro** (HTTPS o `localhost`).

### 3.1. Derivación de clave: PBKDF2-HMAC-SHA-256, 100.000 iteraciones

`deriveKey(passphrase, salt) → Promise<CryptoKey>`

1. La passphrase se importa como material base PBKDF2 (`importKey("raw", …, { name: "PBKDF2" }, false, ["deriveKey"])`).
2. Se deriva una clave simétrica `{ name: "AES-GCM", length: 256 }` con `iterations: 100_000` (recomendación OWASP) y hash `SHA-256`.
3. La `CryptoKey` resultante se crea con **`extractable: false`** y usos `["encrypt", "decrypt"]`: el material bruto de la clave no puede exportarse ni serializarse desde el proceso del navegador.

**Derivación del salt.** El salt PBKDF2 es determinista por usuario y se calcula en `deriveVaultSalt(userId)` como `SHA-256("tech-value:vault:kdf:v1:" + userId)`:
- Es único por cuenta (inmunidad frente a rainbow tables compartidas entre usuarios) y reproducible en cualquier dispositivo sin almacenar nada sensible.
- La etiqueta incluye dominio y versión para permitir migraciones futuras del KDF sin colisionar con claves existentes.

### 3.2. Cifrado simétrico autenticado: AES-GCM-256, IV de 12 bytes

`encryptBuffer(data, key) → { cipherBuffer, iv }` / `decryptBuffer(cipherBuffer, key, ivString)`

- Cada operación de cifrado genera un **IV aleatorio de 12 bytes (96 bits)** con `crypto.getRandomValues`, único por versión de documento, tal como exige la norma NIST SP 800-38D.
- El IV se serializa en hexadecimal y se almacena en claro en `document_versions.iv`. **El IV no es secreto** en AES-GCM: sólo garantiza unicidad.
- El descifrado valida la longitud del IV (12 bytes exactos) y delega en `subtle.decrypt`: si clave, IV o ciphertext no coinciden, la promesa se rechaza automáticamente mediante el **tag de autenticación de 128 bits** de GCM.

### 3.3. Integridad matemática: SHA-256 previo al cifrado

`computeSHA256(data) → hex` (minúsculas)

- En la subida se calcula el SHA-256 **del texto plano antes de cifrar** y se registra en `document_versions.sha256_hash` como referencia de integridad.
- En la descarga, tras descifrar en memoria RAM, se recalcula el hash del buffer resultante y se compara en tiempo constante. Cualquier discrepancia aborta la entrega al usuario y emite un evento `INTEGRITY_FAILURE` en auditoría.

### 3.4. Ciclo de vida de la clave en memoria RAM

```
Registro / Login
  → PBKDF2 local → CryptoKey (extractable: false)
    → useAuthStore.vaultKey (RAM, sin middleware persist)
      → uso en uploadDocument / downloadAndDecrypt (pasada por parámetro)
        → Inactividad (10 min) / signOut / F5 → null (destrucción inmediata)
```

- El store **no usa `persist` de Zustand**; la clave no extraíble jamás toca `localStorage`, cookies ni IndexedDB.
- `signOut()` destruye la clave **antes** de la llamada de red.
- Temporizador de inactividad de 10 minutos en `App.tsx` que purga automáticamente la clave y la contraseña de descarga si no hay interacción del usuario.

### 3.5. Recuperación soberana: 12 palabras BIP-39 sin sesgo de módulo

`generateRecoveryPhrase() → string`

- En el registro se genera una frase de **12 palabras** del **diccionario oficial BIP-39 (2048 palabras)** embebido en el módulo.
- Aleatoriedad provista por `crypto.getRandomValues` sobre `Uint16Array(12)`; al ser 2048 = 2¹¹, cada valor de 16 bits se enmascara a 11 bits (`& 0x07FF`), eliminando cualquier sesgo de módulo.
- La frase vive **sólo en RAM**, se muestra una única vez en el modal institucional y se purga tras confirmación.

### 3.6. Contraseña de descarga: verificador PBKDF2-SHA-256 + secreto sólo en RAM

`generateDownloadSaltHex()` / `deriveDownloadVerifier(password, saltHex)` / `timingSafeEqualHex(a, b)`:

- **Creación:** Salt aleatorio de 32 bytes (64 caracteres hex) + `PBKDF2-SHA-256, 100.000 iteraciones, 256 bits` vía `subtle.deriveBits`. Se persisten en `profiles.download_salt` y `profiles.download_verifier`.
- **Verificación:** Derivación del candidato y comparación en tiempo constante (`timingSafeEqualHex`) para mitigar ataques de temporización.
- **Custodia:** La contraseña validada vive únicamente en `useDownloadAuthStore.downloadSessionPassword` en RAM durante la pestaña activa.

---

## 4. Arquitectura de software (Feature-Driven)

### 4.1. Árbol de directorios

```
src/
├── main.tsx                      # Entrypoint: StrictMode + inicialización de tema + App
├── index.css                     # Directivas Tailwind + estilos base Dark/Light mode
├── vite-env.d.ts                 # Tipado de VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├── App.tsx                       # Orquestador: timeout inactividad (10m) + compuerta de estados
├── app/                          # Layout y proveedores base
├── assets/                       # Recursos estáticos
│
├── core/crypto/
│   └── vaultCrypto.ts            # Motor Zero-Knowledge puro: PBKDF2, AES-GCM-256,
│                                 # SHA-256, BIP-39, comparador timing-safe, utilidades hex
│
├── features/auth/
│   ├── components/
│   │   └── AuthCard.tsx          # Login, Registro, OTP y Frase BIP-39 con ThemeToggle
│   └── stores/
│       └── useAuthStore.ts       # Sesión Supabase + vaultKey en RAM + recoveryPhrase efímera
│
├── features/vault/
│   ├── components/
│   │   ├── VaultDashboard.tsx    # Header INFINYX, catálogo de custodia, ThemeToggle y filtros
│   │   ├── DocumentRow.tsx       # Fila adaptada con badges de versión y 3 acciones directas
│   │   ├── FileUploadModal.tsx   # Modal drag & drop con barra minimalista de cifrado
│   │   ├── DocumentPreviewModal.tsx # Modal centrado en portal: metadatos y copiado de SHA-256
│   │   ├── DownloadAuthModal.tsx # Compuerta de autorización para contraseña en RAM
│   │   └── DeleteDocumentModal.tsx  # Confirmación destructiva con autorización en RAM
│   ├── stores/
│   │   ├── useVaultStore.ts      # Catálogo + subida/descifrado + bitácora audit_logs
│   │   └── useDownloadAuthStore.ts # Contraseña de descarga en RAM (sin persist)
│   └── utils/
│       └── formatters.ts         # Formateadores institucionales (tamaño, fechas, hashes)
│
└── shared/
    ├── components/
    │   ├── HexaMugenLogo.tsx     # Isotipo vectorial de doble hexágono en titanio y Seis Ojos
    │   └── ThemeToggle.tsx       # Conmutador interactivo Sol / Luna (Modo Claro / Oscuro)
    ├── stores/
    │   └── useThemeStore.ts      # Gestor de tema con persistencia en localStorage
    ├── lib/
    │   └── supabase.ts           # Cliente tipado createClient<Database>
    └── types/
        ├── database.ts           # Esquema relacional de Supabase (PostgreSQL)
        └── index.ts              # Tipos de dominio: VaultDocument, UploadStatus, AuditAction
```

### 4.2. Flujo de datos: Subida Cifrada

```mermaid
flowchart LR
    A["File en RAM<br/>(FileReader / ArrayBuffer)"] --> B["computeSHA256<br/>(Huella texto plano)"]
    B --> C["encryptBuffer<br/>(AES-GCM-256 + IV 12B)"]
    C --> D["Storage upload<br/>vault_files/:uid/:docId/v1.enc"]
    D --> E["Postgres metadata<br/>documents + document_versions"]
    E --> F["audit_logs<br/>(UPLOAD)"]
```

1. **Lectura local**: Carga directa del archivo en memoria RAM del navegador.
2. **Huella criptográfica**: Cálculo SHA-256 del texto plano como sello de integridad.
3. **Cifrado autenticado**: Cifrado local con la `vaultKey` AES-GCM e IV único por versión.
4. **Almacenamiento ciego**: Transmisión a Supabase Storage con extensión `.enc` y tipo `application/octet-stream`.
5. **Registro de versión**: Escritura atómica de metadatos no sensibles (`iv`, `sha256_hash`, `file_size`).
6. **Compensación ante fallos**: Rollback automático en Storage si el registro relacional falla.

### 4.3. Flujo de datos: Descarga con Compuerta de Autorización

```mermaid
flowchart LR
    G{"¿Contraseña en RAM?"} -->|Sí| A
    G -->|No| M["DownloadAuthModal<br/>(Crear / Validar PBKDF2)"]
    M -->|Autorizado en RAM| A["Descarga Storage<br/>(Blob .enc cifrado)"]
    A --> B["decryptBuffer<br/>(AES-GCM-256 en RAM)"]
    B --> C["computeSHA256<br/>(Recálculo local)"]
    C -->|Coincide| D["Blob URL temporal<br/>(Descarga al disco)"]
    C -->|Difiere| E["Abortar + Registro<br/>(INTEGRITY_FAILURE)"]
```

---

## 5. Sistema de diseño "Hexa-Mugen" y Tema Dual (Oscuro / Claro)

El sistema de diseño **"Hexa-Mugen"** de **INFINYX** combina precisión geométrica con la paleta de energía Azul *"Seis Ojos"* (*Six Eyes*), ofreciendo dos estilos visuales completos:

1. **Modo Oscuro (*Obsidiana Abisal*)**: Profundidad cibernética en `#07090E`, tarjetas en titanio oscuro `#0D111A` y delineados energéticos luminosos.
2. **Modo Claro (*Blanco Titanio / Cristalino*)**: Lienzo blanco de pizarra suave `#F8FAFC`, tarjetas en porcelana técnica `#FFFFFF`, bordes sutiles de acero `#E2E8F0` y tipografía de alto contraste `#0F172A`.

### 5.1. Matriz de tokens y paleta de colores

| Token / Elemento | Modo Oscuro (*Dark*) | Modo Claro (*Light*) | Aplicación / Rol |
| :--- | :--- | :--- | :--- |
| **Fondo Principal** | `#07090E` | `#F8FAFC` | Fondo de `body`, pantalla de inicio y dashboard |
| **Tarjetas y Modales** | `#0D111A` / `#111827` | `#FFFFFF` | Superficie principal de contenido y ventanas modales |
| **Cabeceras de Tabla / Paneles** | `#0A0E17` | `#F8FAFC` / `#F1F5F9` | Cabecera `<thead>`, cajas de código y avisos |
| **Bordes de Contenedores** | `#1E293B` | `#E2E8F0` | Líneas de división y contornos de tarjeta |
| **Texto Principal** | `#F8FAFC` | `#0F172A` | Títulos, nombres de documentos y valores clave |
| **Texto Secundario** | `#94A3B8` | `#64748B` | Metadatos, fechas, tamaños y hashes |
| **Azul Seis Ojos (Acento)** | `#38BDF8` (`sky-400`) | `#0284C7` (`sky-600`) | Iconos de acento, bordes activos y checkboxes |
| **Núcleo Cristalino (Highlight)** | `#BAE6FD` (`sky-200`) | `#0369A1` (`sky-700`) | Punto focal del logo y texto de versión (`v1`, `v2+`) |
| **Gradiente Primario (CTA)** | `from-[#0284C7] via-[#0EA5E9] to-[#38BDF8]` | `from-[#0284C7] via-[#0EA5E9] to-[#38BDF8]` | Botones principales de acción (+ Proteger documento, Desbloquear) |

### 5.2. Selector de Tema (`ThemeToggle`) y Persistencia

- Gobernado por `useThemeStore.ts` y la clase `.dark` en `document.documentElement` (`darkMode: 'class'` en Tailwind).
- La preferencia se almacena en `localStorage.getItem('infinyx-theme')`, preservándose entre sesiones y recargas de pestaña.
- El conmutador se encuentra disponible tanto en la pantalla de autenticación (`AuthCard`) como en la cabecera principal (`VaultDashboard`).

### 5.3. Isotipo Vectorial Hexa-Mugen (`HexaMugenLogo.tsx`)

El isotipo representa la convergencia del infinito ($\infty$) mediante una estructura hexagonal facetada de titanio angulado con doble delineado y un prisma central flotante encendido con gradiente Azul Seis Ojos (`#BAE6FD` → `#38BDF8` → `#0284C7`). Su relleno se adapta automáticamente (`fill-white dark:fill-[#0D111A]`) para lucir impecable en ambos temas.

### 5.4. Barra de Progreso Minimalista en Cifrado

El modal de subida de archivos (`FileUploadModal.tsx`) incorpora una barra de progreso limpia y compacta con cálculo de porcentaje dinámico (`0%`, `25%`, `50%`, `75%`, `100%`) y estado reactivo (*"Cifrando archivo…"*, *"Archivo cifrado y protegido"*, *"Error al procesar el archivo"*), eliminando tarjetas redundantes.

---

## 6. Arquitectura del backend (Supabase / PostgreSQL)

Esquema `public` auditado y tipado en `src/shared/types/database.ts`:

### 6.1. Tablas relacionales

- **`profiles`**: Almacena el identificador `id uuid` (`auth.users.id`), `email`, y las columnas criptográficas de autorización:
  - `download_verifier text`: Hash derivado PBKDF2-SHA-256 (100.000 iteraciones) de la contraseña de descarga.
  - `download_salt text`: Salt criptográfico aleatorio de 32 bytes (hex).
- **`documents`**: Cabecera lógica de documentos vinculada a `user_id uuid`.
- **`document_versions`**: Versiones inmutables con `iv` (12 bytes hex), `sha256_hash` (hex del texto plano) y `storage_path`.
- **`audit_logs`**: Registro inmutable de eventos (`UPLOAD`, `DOWNLOAD_DECRYPT`, `DELETE`, `INTEGRITY_FAILURE`).

### 6.2. Row Level Security (RLS)

Políticas de seguridad a nivel de fila obligatorias:

```sql
alter table profiles          enable row level security;
alter table documents         enable row level security;
alter table document_versions enable row level security;
alter table audit_logs        enable row level security;

-- Aislamiento estricto por auth.uid()
create policy "profiles_owner"
  on profiles for all using (id = auth.uid()) with check (id = auth.uid());

create policy "documents_owner"
  on documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "versions_owner_select"
  on document_versions for select using (
    exists (select 1 from documents d where d.id = document_versions.document_id and d.user_id = auth.uid())
  );

create policy "versions_owner_write"
  on document_versions for insert with check (
    exists (select 1 from documents d where d.id = document_versions.document_id and d.user_id = auth.uid())
  );

create policy "audit_owner_insert"
  on audit_logs for insert with check (user_id = auth.uid());

create policy "audit_owner_select"
  on audit_logs for select using (user_id = auth.uid());
```

---

## 7. Guía de instalación y despliegue local

### 7.1. Requisitos

- **Node.js 20 LTS o 22+**
- **pnpm 9+**
- Proyecto Supabase configurado con el bucket privado `vault_files`.

### 7.2. Puesta en marcha

```bash
# 1. Clonar el repositorio
git clone <url-del-repo> infinyx-vault
cd infinyx-vault

# 2. Instalar dependencias exactas
pnpm install

# 3. Configurar variables de entorno
cp .env.example .env.local # O crear .env.local
```

Configuración en `.env.local`:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-publica
```

### 7.3. Comandos de desarrollo y auditoría

| Comando | Descripción |
|---|---|
| `pnpm run dev` | Inicia el servidor de desarrollo Vite con HMR |
| `pnpm run lint` | Ejecuta `oxlint` (validación estricta de TypeScript y reglas React) |
| `pnpm run build` | Compilación estricta con `tsc -b` y empaquetado optimizado en `dist/` |
| `pnpm run preview` | Sirve localmente la compilación de producción para validación |

---

## 8. Operación segura, limitaciones conocidas y roadmap

### 8.1. Buenas prácticas operativas

- **Contexto seguro obligatorio**: Servir bajo HTTPS en entornos de producción para habilitar `window.crypto.subtle`.
- **Inactividad**: La aplicación expira automáticamente la clave en RAM a los 10 minutos de inactividad del cursor o teclado.
- **Sin huella persistente**: Al cerrar sesión o recargar con F5, la memoria RAM es liberada y la clave de cifrado se destruye por completo.

### 8.2. Roadmap y evolución

1. **Rotación soberana de claves**: Re-cifrado en lote de versiones mediante derivación progresiva sin exposición en servidor.
2. **Historial de versiones completas**: Interfaz para restaurar versiones intermedias (`v1`, `v2`, `v3`) directamente en el modal de previsualización.
3. **Modo Solo Depósito**: Capacidad de recepción documental para terceros sin privilegios de lectura o eliminación.
4. **Triggers PostgreSQL**: Auditoría formal irrevocable mediante triggers automáticos en la base de datos.
