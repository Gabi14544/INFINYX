# Despliegue de INFINYX v2

## Requisitos y estado

Esta actualización se preparó para un prototipo sin usuarios ni documentos reales, según confirmó el usuario. La migración se detiene si encuentra documentos antiguos; no elimina ni convierte silenciosamente ciphertext existente. Las cuentas de la versión anterior necesitan un plan de migración o recreación explícito: cambió la credencial Auth y la derivación de bóveda. No borrar cuentas ni datos automáticamente.

Para desplegar hacen falta el identificador del proyecto Supabase y acceso autorizado por CLI o panel. Configurar las credenciales por mecanismos seguros, nunca por chat, en archivos versionados o variables `VITE_*` privadas.

## Base de datos y función

1. Revisar las migraciones, enlazar un proyecto vacío/de pruebas con la versión de Supabase CLI instalada (consultar `supabase link --help` para sus opciones) y aplicar las migraciones con la CLI compatible o Management API, como se hizo en esta revisión. Incluye el esquema inicial, el endurecimiento anterior y la transición a v2. No usar `db reset` en un proyecto remoto.
2. Configurar `VAULT_ALLOWED_ORIGINS` en los secrets de Edge Functions con los orígenes exactos separados por comas (esquema, host y puerto; sin barra final). Para desarrollo local puede incluir `http://127.0.0.1:5173`; producción debe usar HTTPS. Esta lista no es una lista de dominios de salida.
3. Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` al runtime Edge. Verificar su disponibilidad sin imprimir valores. La clave de servicio jamás debe llegar al navegador.
4. Ejecutar `supabase functions deploy vault-access`. `verify_jwt=false` evita depender del formato de firma del gateway; el handler valida obligatoriamente cada token con `/auth/v1/user` antes de usar privilegios de servicio. No retirar esa validación.
5. Configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para compilar el frontend.
6. En Supabase Auth, verificar SMTP, confirmación de email y plantilla con `{{ .Token }}` para el flujo OTP de 6–8 dígitos. Revisar límites de registro/login, protección de contraseñas filtradas y prevención de abuso. El cliente no implementa MFA.

Los clientes reciben SELECT de sus perfiles, documentos, versiones y auditoría. La creación de perfiles ocurre mediante trigger; el commit del documento, la versión y la auditoría de subida ocurre en una única transacción RPC. Las credenciales adicionales sólo están disponibles para el backend. El bucket privado restringe uploads a 50 MiB + tag GCM y `application/octet-stream`.

La contraseña adicional no tiene todavía rotación o recuperación por autoservicio. No modificar verificadores a mano para eludir controles. La contraseña maestra y el email tampoco tienen flujo de rotación de claves.

## Frontend y cabeceras

`pnpm build` produce `dist/`. Publicar bajo HTTPS. `public/_headers` se copia a `dist/_headers` y sólo tiene efecto en hosts compatibles (por ejemplo, Cloudflare Pages o Netlify). En otros servidores hay que configurar las mismas cabeceras explícitamente. `vite preview` añade una CSP para comprobación local; el servidor de desarrollo admite el preámbulo de React/HMR y debe permanecer local.

Verificar en una respuesta real: CSP con `frame-ancestors 'none'`, `script-src 'self'`, `object-src 'none'`; HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `X-Frame-Options`. Adaptar `connect-src` si se usa un dominio Supabase propio. No desactivar CSP para resolver un dominio faltante.

## Validación obligatoria antes de datos reales

- Crear dos usuarios de prueba mediante el flujo completo de confirmación.
- Con A, subir un documento y comprobar que nombre, MIME y hash no aparecen en las filas del backend ni en auditoría.
- Con B y con la clave pública sin sesión, comprobar rechazo de lectura, modificación y borrado de A tanto en PostgREST como Storage y RPC.
- Con A, comprobar que el token de sesión solo no permite lectura/borrado directo de Storage; contraseña adicional errónea debe rechazar el gateway.
- Configurar una contraseña adicional distinta; descargar y comparar los bytes con el original. La URL firmada debe expirar después de 30 segundos.
- Probar bloqueo por inactividad y cierre de sesión mientras hay operaciones pendientes.
- Simular un error de Storage al borrar: debe conservarse el documento con estado de borrado pendiente, sin registrar éxito. Reintentar elimina sus versiones y conserva la auditoría.
- Verificar los eventos `UPLOAD`, `DOWNLOAD_AUTHORIZED` y `DELETE`, y el límite persistente de 30 solicitudes/minuto.

## Operación y límites

Una interrupción entre la subida a Storage y el commit SQL puede dejar objetos cifrados no referenciados. No borrarlos inmediatamente ante un error de red: el commit podría haberse confirmado aunque se perdiera su respuesta. El directorio lógico usa rutas aleatorias inmutables para evitar sobrescrituras.

Preparar una tarea administrativa periódica con privilegios de servicio que identifique objetos antiguos no referenciados por `document_versions`, deje un margen amplio para operaciones en curso, compruebe de nuevo las referencias y coordine la limpieza con los commits antes de borrar. No se añadió un borrado automático sin esa coordinación. Este mantenimiento, cuotas por usuario, monitorización, backups y restauración probada son requisitos de operación que deben concretarse antes de producción.

Los logs son auditables por el servidor de la aplicación, pero no inmutables frente a un administrador. Si se requiere evidencia regulatoria, enviar eventos a un sistema externo de retención inmutable. No se garantiza borrado de backups ni seguridad contra un frontend comprometido, extensiones maliciosas, un dispositivo comprometido o rollback del backend por un administrador.

## Proyecto verificado durante esta revisión

Se utilizó Supabase CLI 3.1.0 para desplegar `vault-access`, con `functions deploy vault-access --remote=<referencia> --use-api --no-verify-jwt --yes`. Las migraciones se aplicaron y registraron mediante Management API en transacciones. La migración adicional `20261109130000_audit_retention.sql` normaliza el FK de auditoría que difería en el proyecto original. Los scripts SQL ordenan por el prefijo de versión; no ordenar sólo por el nombre completo cuando se mezclan versiones cortas y timestamps.

Se configuraron únicamente orígenes locales de desarrollo en `VAULT_ALLOWED_ORIGINS`. Antes de publicar un frontend real se debe añadir su origen HTTPS exacto. No se publicó un frontend ni se configuró un dominio de producción.

`pnpm test:live` (Node.js 24+) ejecuta pruebas explícitas contra el proyecto configurado. Usa el access token sólo para obtener credenciales de servidor en memoria, crea dos cuentas confirmadas temporales sin enviar correos, prueba acceso y cifrado y retira sólo sus propios fixtures. No se ejecuta en CI. Los eventos de auditoría de estas pruebas se conservan sin identificador de usuario después de retirar las cuentas.

Las subidas nuevas solicitan caché cero. Las comprobaciones de borrado usan una petición nueva sin caché: una respuesta previamente almacenada por un intermediario no demuestra que el objeto continúe en el origen. No se promete revocación de copias ya descargadas o almacenadas en caché.

Para repetir el flujo de navegador real, iniciar el frontend con `pnpm exec vite --host 127.0.0.1 --port 5182 --strictPort` y ejecutar `pnpm test:live:browser`. Se pueden indicar `INFINYX_TEST_APP_URL` y `CHROMIUM_PATH`. Si el entorno inspecciona HTTPS, Chromium debe confiar en la CA suministrada y poder abrir su almacén NSS con sus permisos normales; no usar opciones que ignoren errores TLS.

## Adaptación de carpetas y borrado en lote

El handler local nuevo añade `delete-batch`; el frontend agrupa por 50 IDs y solicita confirmación fresca de contraseña para acciones masivas. La actualización no necesita otra migración SQL. El despliegue recibió inicialmente un rechazo de revisión automática; después de la aprobación explícita del usuario se actualizó la función existente y se verificó el endpoint remoto. `delete-batch` ya está disponible y probado antes del push que activa Pages.

Mientras se revisa el despliegue, `INFINYX_TEST_LOCAL_GATEWAY=1 pnpm test:live` y el mismo prefijo para `pnpm test:live:browser` ejecutan el handler actualizado localmente contra Auth/DB/Storage reales. El modo local compila el TypeScript del handler para Node y no publica funciones ni simula el backend. El test de navegador intercepta sólo el transporte de `vault-access`; el resto de la app se conecta a Supabase real. Las pruebas remotas normales, sin esa variable, deben ejecutarse después del despliegue aprobado.

## Resultado del despliegue autorizado de lotes

`vault-access` se verificó `ACTIVE`, versión 3. Se ejecutaron `pnpm test:live` y `pnpm test:live:browser` sin `INFINYX_TEST_LOCAL_GATEWAY`: 38 comprobaciones de API y el flujo de carpetas/borrado masivo en Chromium aprobados contra la función Edge remota. CORS de Pages devuelve 204 con el origen exacto y un origen no autorizado devuelve 403. No se hicieron commit ni push del frontend.
