# Revisión previa al push de INFINYX v2

## Decisión actual

**El código integrado y el backend están preparados para el commit y push de v2.** El usuario autorizó expresamente la actualización pendiente; `vault-access` se desplegó y se verificó activa, versión 3. Las pruebas nuevas pasaron después contra el endpoint Edge remoto, sin el transporte local.

No se hicieron commit ni push. La rama local `work` incorpora mediante fast-forward el `main` actual `9e72ad703916e8a7ddb236775d6e21c1e1a6e9f1`, incluidos los commits de funcionalidades `a9104e7` y `9e72ad7`. Se conservaron los cambios v2 en un stash recuperable antes de actualizar la base y se resolvieron todos los conflictos. Los cambios finales están pendientes en el checkout.

## Funcionalidades conservadas y adaptadas

- Subida individual, archivos múltiples y carpetas/subcarpetas, con insignias de carpeta, progreso y filtrado de metadatos del sistema operativo.
- Una única implementación de cifrado y commit para archivos y lotes; nombres, rutas relativas, MIME y hashes se mantienen cifrados.
- Versionado por nombre lógico en RAM, con el límite de tres versiones confirmado por el servidor.
- Selección múltiple, borrado de seleccionados y vaciado de bóveda con entrada explícita de la contraseña adicional.
- `delete-batch` autoriza la contraseña y la propiedad de toda la solicitud antes de tocar Storage. Procesa hasta 50 IDs por solicitud, registra cada borrado confirmado y devuelve éxitos y fallos por separado.
- La interfaz conserva los documentos fallidos para reintento, conserva los no seleccionados y no presenta un lote parcialmente fallido como éxito completo. Los archivos que ya se protegieron no se vuelven a subir al reintentar los fallidos.
- Cancelación lógica de operaciones tras bloqueo, logout o cambio de usuario: no se inician los siguientes elementos ni se restablecen secretos en RAM.
- Subidas limitadas a 500 archivos por lote, 50 MiB por archivo y 32 niveles de ruta; se rechazan rutas de traversal, controles y duplicados normalizados. Las rutas de Storage siguen siendo UUID aleatorios, no nombres del usuario.
- Catálogo paginado: páginas de 500 documentos y consultas de versiones por 100 IDs. Prueba de catálogo con 1.001 documentos. No se trunca el vaciado por el límite predeterminado de PostgREST.

## Validación completada

- Instalación con `--frozen-lockfile`, build, tipos del gateway y lint: correctos.
- **61 pruebas de regresión/unidad** aprobadas, incluyendo las pruebas heredadas de carpetas, criptografía y lotes adaptadas a v2. También pasan sin variables ni credenciales Supabase, como se requiere en CI.
- **2 pruebas locales de Chromium** aprobadas para login, bloqueo, reingreso, logout y rechazo del fallback antiguo.
- PostgreSQL 17 aislado: cuatro migraciones, **23 aserciones** y escenarios adicionales de rechazo aprobados.
- **38 comprobaciones de integración** aprobadas con Auth, PostgREST, RPC, Storage y datos reales de Supabase. Primero se validó con handler local y, tras el despliegue autorizado, se repitió con el endpoint Edge remoto y sin transporte local. Incluyen el rechazo de un lote cruzado o mixto y el borrado de ambos documentos propios.
- **Chromium con Supabase real y función Edge remota**: login, subida/descarga individual idéntica al original, subida de carpeta con subcarpeta, privacidad de rutas en backend, rechazo de contraseña incorrecta en lote, borrado de seleccionados conservando el resto, vaciado total y logout.
- Fixtures de integración limitados a cuentas temporales confirmadas, sin enviar correos; sólo se retiraron sus propias cuentas y objetos.
- Auditoría de dependencias: 0 avisos conocidos en la última comprobación.
- Cabeceras de `public/_headers` incluidas en `dist/_headers` y artefactos/secretos excluidos de Git.
- `.node-version` fija Node.js 24.22.1; `packageManager` fija pnpm 11.25.0.

## Backend desplegado y comprobado

La función existente `vault-access` ya incluye `delete-batch`. La revisión automática rechazó inicialmente su despliegue por falta de autorización explícita y por señalar `--no-verify-jwt`; el usuario confirmó la actualización y el despliegue se completó. La función conserva su verificación de cada token mediante `/auth/v1/user`, contraseña adicional, limitación de intentos y controles de propiedad. No se cambió la configuración JWT preexistente ni se necesitaron otras migraciones SQL.

Comprobación posterior: función `ACTIVE`, versión 3; 38 comprobaciones reales aprobadas y flujo completo de Chromium aprobado. Las cuentas temporales y sus objetos de prueba se retiraron, conservando sus eventos de auditoría sin identificadores de usuario. Los logs HTTP 403 del test de contraseña incorrecta son resultados esperados, no fallos del flujo.

Las suites reales se pueden repetir explícitamente con `pnpm test:live` y `pnpm test:live:browser` (con frontend local iniciado y confianza TLS correcta en Chromium). El modo opcional `INFINYX_TEST_LOCAL_GATEWAY=1` sigue disponible para pruebas futuras sin despliegue; no se utilizó en la validación final del endpoint remoto. Ninguna suite real se ejecuta por defecto en CI.

## Cloudflare y siguiente publicación

CORS ya autoriza `https://tech-value.pages.dev`, preservando los tres orígenes locales existentes: preflight HTTP 204 y `Access-Control-Allow-Origin` correcto; un origen no aprobado sigue recibiendo 403. El sitio actualmente publicado utiliza la URL y clave pública correctas, pero todavía sirve el frontend anterior.

El complemento de Cloudflare no expone herramientas en esta sesión. Confirmar en Pages: rama de producción prevista `main`, raíz del repositorio, build `pnpm run build`, salida `dist`, Node/pnpm compatibles con los pins y las dos variables públicas durante el build. No incluir credenciales administrativas en `VITE_*`.

El gateway actualizado ya fue autorizado y verificado; se puede crear el commit y hacer el push cuando el usuario lo indique. El autodespliegue debe verificarse después: bundle v2, cabeceras `_headers`, login y una subida/descarga real. GitHub Checks y Pages pueden ejecutarse en paralelo. HTTPS ya existe en `pages.dev`; no se necesita comprar un dominio.
