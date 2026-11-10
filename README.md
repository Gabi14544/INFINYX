# INFINYX

Prototipo de bóveda documental con React, TypeScript, Vite y Supabase. Los archivos, nombres, tipos MIME y huellas SHA-256 se cifran en el navegador. El servidor conserva identificadores, fechas, relaciones, tamaños aproximados del ciphertext y los blobs cifrados.

Esta versión endurece el prototipo sin datos reales. **No es compatible con las cuentas ni el cifrado anteriores.** No hay recuperación de la clave: olvidar la contraseña maestra implica perder acceso a los documentos. No cambies contraseñas ni emails mediante el panel de Supabase para cuentas con documentos: falta implementar la rotación de claves.

## Desarrollo

Requisitos: Node.js >=22.12 y pnpm 11.25.0. Usa el checkout existente; no necesitas otro worktree.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
# Completar únicamente la URL y la clave pública del proyecto.
pnpm dev
```

En máquinas con permisos restringidos para el directorio personal:

```bash
XDG_DATA_HOME=/workspace/.cache/xdg pnpm install --frozen-lockfile --store-dir /workspace/.cache/pnpm-store
```

El frontend necesita también las migraciones y la función `vault-access` desplegadas. Ver [despliegue](docs/DEPLOYMENT.md). La clave `service_role` y las claves `sb_secret_*` nunca deben entrar en variables `VITE_*` ni en el frontend.

## Comprobaciones

```bash
pnpm build
pnpm lint
pnpm check:gateway
pnpm test
pnpm test:browser
pnpm test:sql
pnpm audit
```

Las pruebas SQL crean y destruyen una base PostgreSQL 17 aislada mediante el daemon Docker local, sin puertos publicados. Emulan los contratos mínimos de Auth y Storage para probar migraciones, privilegios y RLS. No sustituyen la validación de los servicios de Supabase.

Las pruebas del navegador usan Chromium (`CHROMIUM_PATH` permite otra ruta) y respuestas simuladas de Auth/PostgREST; no contienen credenciales reales ni acceden a un proyecto remoto.

## Estructura

- `src/core/crypto`: primitives Web Crypto, derivación, autenticación AES-GCM y metadatos cifrados.
- `src/features/auth`: registro, OTP y sesión de autenticación; la clave vive en memoria.
- `src/features/vault`: catálogo descifrado, subida y acciones sobre documentos.
- `src/shared/lib`: cliente Supabase, configuración pública, gateway, descarga acotada y limpieza de memoria.
- `supabase/migrations`: esquema reproducible, permisos, transacciones y auditoría del servidor.
- `supabase/functions/vault-access`: autenticación, contraseña adicional, límites de intentos, descarga autorizada y borrado.
- `tests`: regresiones de cifrado, sesión, gateway, navegador y SQL.

## Modelo de seguridad

AES-GCM-256 usa IV aleatorio de 96 bits, tag de 128 bits y AAD obligatorio con usuario, documento, versión y propósito. PBKDF2-SHA256 usa 600.000 iteraciones; cada bóveda tiene una sal aleatoria de 32 bytes. La credencial Auth tiene separación de dominio y no es la contraseña original. No se admite descifrado antiguo sin AAD.

El catálogo se descifra en memoria. El hash del contenido se guarda dentro de los metadatos cifrados. Los tokens Auth persisten en localStorage; las claves y la contraseña adicional no. Se borran referencias, catálogo y object URLs al bloquear, salir o cambiar de usuario. JavaScript no ofrece borrado físico garantizado de memoria.

El gateway verifica la sesión y la contraseña adicional en cada descarga y borrado. Guarda el verificador en una tabla inaccesible a los clientes y limita a 30 solicitudes por usuario por minuto. La contraseña adicional se envía por HTTPS al gateway: debe ser distinta de la maestra. El navegador impide reutilizar la misma clave al configurarla por la interfaz.

Los clientes no pueden leer ni borrar directamente los objetos de `vault_files`. Las URLs firmadas duran 30 segundos y son credenciales portadoras temporales: quien ya obtuvo una URL puede usarla durante ese plazo. La contraseña adicional no impide usar una copia ya descargada ni protege frente a código malicioso en una pestaña desbloqueada.

La auditoría del servidor registra `UPLOAD`, `DOWNLOAD_AUTHORIZED` y `DELETE`; no afirma observar el descifrado local. Un operador con control de la base o del frontend puede modificar logs, servir código malicioso o causar pérdida de disponibilidad. Una aplicación web servida por un operador no protege contra ese operador si cambia el JavaScript que recibe el usuario.

Consulta [el informe de revisión](docs/SECURITY_REVIEW.md) para las correcciones, las pruebas y las limitaciones.

## Validación remota de esta revisión

Las cuatro migraciones y `vault-access` ya se aplicaron al proyecto de pruebas autorizado. Se aprobaron 33 comprobaciones reales de SDK/API y el flujo completo de subida/descarga/borrado en Chromium, retirando después las cuentas temporales. Esta validación corresponde a la revisión v2 inicial; el frontend v2 se publicó posteriormente en Pages. Consultar los informes para los detalles y límites.

Las pruebas remotas son explícitas y usan cuentas temporales sin envío de correos: `pnpm test:live` y `pnpm test:live:browser` (este último requiere un frontend local iniciado y Chromium configurado). No se incluyen en CI.

## Carpetas y autorización de pestaña

El panel permite **Crear contraseña de descarga y eliminación** de forma explícita. Configurarla no ejecuta ni autoriza operaciones. La primera descarga o eliminación solicita esa contraseña; después se conserva sólo en memoria de la pestaña hasta bloquear, cerrar sesión o recargar. Las eliminaciones siguen requiriendo confirmación. El gateway continúa verificando cada operación.

Las nuevas carpetas se empaquetan localmente en un ZIP, se cifran como un único documento y se descargan como `NombreCarpeta.zip`. Se conservan los archivos y sus rutas de subcarpetas; tanto el contenido original como el ZIP deben caber en 50 MiB. Se admite un máximo de 500 archivos por selección. Se omiten archivos de sistema conocidos; las carpetas vacías no se representan y los archivos vacíos se rechazan mediante la validación existente. La compresión usa un worker del mismo origen, cancelado al bloquear la bóveda.

Los documentos v2 existentes siguen funcionando. Las carpetas que se subieron antes como documentos independientes mantienen esa organización. No se necesita una migración ni un cambio del backend para estas funciones.

Ver [informe de implementación y pruebas](docs/DEV_FOLDERS_AUTH_REPORT.md). Implementación desarrollada y probada en `dev`, con integración local en `main` autorizada por el usuario. La publicación requiere un push posterior.
