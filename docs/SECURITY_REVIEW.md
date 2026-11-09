# Informe de seguridad y calidad de INFINYX

Fecha: 9 de noviembre de 2026. Revisión del código del prototipo, basada inicialmente en el commit `b6b4dae0b17636c1632886c407fbcb3412adba3e`. Los cambios de código están en el checkout de trabajo, sin commit ni push. El backend se desplegó posteriormente con autorización del usuario; ver la validación real al final de este informe.

## Resultado

Se corrigieron los fallos confirmados de autenticación, cifrado, controles de acceso y borrado, y se simplificó el código. La versión resultante pasa las comprobaciones locales detalladas más abajo. **El backend ya se desplegó y validó en Supabase real.** Esto no constituye una certificación ni una aprobación para producción: falta publicar el frontend corregido en Pages y completar las medidas operativas descritas al final.

El formato v2 es incompatible con el prototipo anterior. El preflight remoto encontró cuentas y documentos de prueba; el usuario confirmó que eran descartables. Se preservó una copia técnica local antes de retirarlos y desplegar v2. La migración mantiene una protección que rechaza documentos existentes para impedir conversiones silenciosas en otros entornos.

## Correcciones

| Hallazgo                                                      | Cambio realizado                                                                                                                                                                                      | Evidencia local                                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envío de la contraseña maestra original al fallar Auth        | Eliminado el fallback. Sólo se envía una credencial PBKDF2 con dominio separado `infinyx:auth:v2` y email normalizado.                                                                                | Regresión de store y navegador: un error produce una sola petición, con credencial `iv2_…`.                                                                             |
| Recuperación engañosa                                         | Eliminados el generador de palabras, el estado y la pantalla que prometían restaurar documentos. Se advierte que no existe recuperación.                                                              | Revisión de todos los usos y compilación sin referencias a esa funcionalidad. **No se implementó un mecanismo nuevo de recuperación.**                                  |
| Contraseña adicional eludible en frontend                     | Nueva función `vault-access`: valida la sesión con Auth, comprueba la contraseña en servidor y resuelve la propiedad del documento antes de actuar. Verificadores privados, sin SELECT para usuarios. | Pruebas de sesión inválida, contraseña errónea, acceso cruzado, limitación de intentos, setup y no sobrescritura.                                                       |
| Lectura o borrado directo de Storage con la sesión            | Bucket privado, permisos mínimos y políticas restrictivas que siguen bloqueando aunque exista otra política permisiva antigua.                                                                        | PostgreSQL aislado, con dos identidades y una política deliberadamente demasiado amplia.                                                                                |
| Descifrado sin AAD como fallback                              | Eliminado. Usuario, documento, versión y propósito forman parte del AAD obligatorio de AES-GCM. No se aceptan blobs legacy.                                                                           | Rechazo de corrupción, sustitución de usuario/documento/versión/propósito y blob antiguo sin AAD.                                                                       |
| Metadatos y hash en claro                                     | Nombres, MIME, tamaños exactos y SHA-256 se guardan juntos bajo cifrado autenticado con propósito `metadata`. La auditoría deja de incluirlos.                                                        | Prueba de subida: sólo ciphertext y metadatos cifrados llegan a Storage/RPC; se recuperan correctamente con la clave.                                                   |
| Derivación de contraseñas débil para el modelo de bóveda      | PBKDF2-SHA256 pasa de 100.000 a 600.000 iteraciones; cada bóveda recibe una sal aleatoria de 32 bytes.                                                                                                | Pruebas de derivación, sal inválida y generación independiente de perfiles en PostgreSQL. La sal determinista anterior no implicaba por sí sola que AES estuviera roto. |
| Auditoría controlada por el navegador                         | Subida y borrado se registran en transacciones del servidor; el gateway registra autorización de descarga antes de entregar la URL. El cliente no puede insertar, actualizar ni borrar logs.          | Pruebas SQL de commit y conservación del historial; prueba del gateway que no entrega la URL si falla el log.                                                           |
| Éxito falso al fallar el borrado físico                       | Se marca el documento como pendiente, se eliminan objetos y sólo después se finaliza metadata y auditoría. Un error de Storage conserva el estado necesario para reintentar.                          | Gateway: fallo de Storage impide finalizar. SQL: cascada de versiones e historial conservado.                                                                           |
| Commits parciales y carreras de versionado                    | Documento, versión y log se consolidan en una RPC transaccional con bloqueo por documento, unicidad y máximo de tres versiones. Las rutas de objetos son aleatorias e inmutables.                     | SQL: commit correcto, rechazo de duplicado y ausencia de versiones adicionales.                                                                                         |
| Resultados sensibles después de bloquear o cambiar de usuario | Registro central de limpieza, generación de sesión y comprobaciones tras operaciones asíncronas. Se limpian catálogo, contraseña adicional y object URLs.                                             | Pruebas de logout durante derivación, cambio de usuario, fetch pendiente y autorización de descarga pendiente.                                                          |
| Secretos temporales retenidos durante OTP                     | Eliminada la copia de contraseña a nivel de módulo. Retención temporal en un único store, con expiración de 10 minutos.                                                                               | Verificación de email después de expirar el secreto conserva la cuenta confirmada y exige nuevo login.                                                                  |
| Descargas sin límite durante lectura de red                   | Lectura por streaming con límite antes de reunir el ciphertext en un solo buffer.                                                                                                                     | Rechazo de exceso incluso sin `Content-Length`.                                                                                                                         |
| Pantalla en blanco por falta de configuración                 | Arranque controlado y mensaje visible; rechazo explícito de claves de servidor en configuración pública.                                                                                              | Tests de variables faltantes, HTTP externo y claves privadas.                                                                                                           |
| CSP incompatible con el desarrollo y cabeceras incompletas    | Cabeceras de producción en `_headers` y preview; desarrollo local separado; eliminadas fuentes externas innecesarias.                                                                                 | Compilación y navegador. **La aplicación efectiva de cabeceras en el host real sigue pendiente.**                                                                       |
| Dependencias vulnerables                                      | Vite actualizado y overrides de transitivas corregidas mediante `pnpm-workspace.yaml`; lockfile actualizado.                                                                                          | `pnpm audit`: de 8 avisos a 0, en el momento de esta revisión.                                                                                                          |

La contraseña adicional se envía al gateway por HTTPS para su verificación. Debe ser distinta de la maestra; la interfaz comprueba que no derive la misma clave de bóveda antes de configurarla. Esto no convierte la segunda contraseña en un factor independiente ni protege una pestaña desbloqueada contra XSS.

## Calidad y estructura

Se mantuvo la organización por funcionalidades. Se separaron configuración pública, acceso al gateway, descarga acotada, primitivas criptográficas y limpieza de memoria. Se redujo el store de bóveda al flujo de cliente: las decisiones de acceso y las transacciones están en el backend.

Se eliminaron:

- CSS, imágenes e iconos sobrantes de la plantilla de Vite sin referencias.
- Dependencias sin uso `clsx` y `tailwind-merge`.
- Directorios vacíos sostenidos únicamente por `.gitkeep`.
- La lista de palabras y el flujo de recuperación sin utilidad real.
- Copias de estado, selectores y funciones de autorización obsoletos.
- El fallback de autenticación y el fallback de descifrado inseguros.
- Conflictos de merge y afirmaciones contradictorias del README, reemplazado por documentación correspondiente al comportamiento real.

Se añadieron `.env.example`, protección de archivos `.env.*`, scripts de prueba, formato consistente y un workflow de GitHub Actions. El workflow está preparado, pero **no se ejecutó en GitHub**. Los tipos de filas persistidas se distinguen de la proyección de metadatos descifrados usada en RAM.

No se observaron usos de `dangerouslySetInnerHTML`, `eval`, supresiones `@ts-ignore` ni tipos explícitos `any` en la aplicación y el gateway revisados. Esto no demuestra la ausencia de toda vulnerabilidad ni sustituye una auditoría independiente.

## Validación ejecutada

| Comprobación                 | Resultado y alcance                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instalación y lockfile       | Dependencias instaladas manteniendo TLS y verificaciones de integridad.                                                                                                                                                              |
| `pnpm build`                 | Correcto: TypeScript del frontend y build de producción.                                                                                                                                                                             |
| `pnpm check:gateway`         | Correcto: comprobación estática del handler del gateway. No equivale a ejecutar Deno en Supabase.                                                                                                                                    |
| `pnpm lint`                  | Correcto.                                                                                                                                                                                                                            |
| `pnpm test`                  | **31 pruebas aprobadas**: criptografía, configuración, límites de descarga, sesión, subidas y gateway. Las respuestas de servicios externos se simulan.                                                                              |
| `pnpm test:browser`          | **2 pruebas aprobadas con Chromium**: login con credencial derivada, catálogo, bloqueo por inactividad, reingreso, logout y ausencia de fallback en Auth fallido. Backend simulado.                                                  |
| `pnpm test:sql`              | Correcto sobre PostgreSQL 17 aislado: aplicación de las cuatro migraciones, **23 aserciones** y dos escenarios adicionales de rechazo. Los contratos de Auth/Storage están emulados; no se ejecuta el servicio completo de Supabase. |
| `pnpm audit`                 | **0 avisos conocidos**, incluyendo dependencias de desarrollo.                                                                                                                                                                       |
| Formato y `git diff --check` | Comprobados localmente.                                                                                                                                                                                                              |

## Accesos y estado actual

Las variables públicas y el token administrativo ya se configuraron y se comprobó su acceso. Las cuatro migraciones están registradas y `vault-access` está desplegada. Las pruebas reales se describen al final. No se publicaron el frontend corregido ni commits; faltan el origen HTTPS de producción, las cabeceras del hosting y las medidas operativas correspondientes.

## Límites y tareas antes de producción

- No hay recuperación ni rotación de la clave maestra, ni cambio seguro de email/contraseña con recifrado. La contraseña adicional tampoco tiene recuperación o rotación de autoservicio. Son funcionalidades ausentes, documentadas y sin promesas en la interfaz.
- Una subida interrumpida antes del commit puede dejar ciphertext no referenciado. Se evita el borrado automático peligroso después de una respuesta de red ambigua. Hace falta mantenimiento administrativo coordinado con los commits; también cuotas y control de costes por usuario.
- Una eliminación física parcialmente completada puede requerir reintento. Se conserva el documento pendiente para permitirlo; el sistema no puede restaurar objetos ya borrados. No se garantiza eliminación de backups del proveedor.
- Las URLs firmadas son credenciales portadoras válidas durante 30 segundos; el logout o el bloqueo local no revocan instantáneamente una URL ya emitida. Una operación autorizada en servidor puede terminar aunque después se bloquee la interfaz.
- El navegador no garantiza borrado físico de memoria. Claves no exportables aún pueden utilizarse desde código malicioso en la misma página.
- Tokens Auth en localStorage, dependencias y frontend servido siguen siendo parte de la superficie XSS/supply chain. Un operador que cambie el JavaScript puede capturar futuras contraseñas; el cifrado web no elimina esa confianza.
- IDs, fechas, cantidad de documentos/versiones y tamaños aproximados continúan siendo observables. No se implementó protección contra rollback de todo el backend.
- Los logs del servidor no son evidencia inmutable frente a un administrador. La retención externa, backups, restauración, monitorización, límites de Auth y revisión de infraestructura requieren configuración operativa real.

La conclusión es una mejora verificable del prototipo, no una garantía de que "no queda ningún fallo". El backend de acceso, Storage y Auth ya se validó en el proyecto de pruebas; la puesta en producción requiere además verificar el frontend publicado y la infraestructura operativa completa.

## Despliegue y validación reales completados

El token de Management API configurado por el usuario funcionó sobre el proyecto seleccionado. El preflight detectó datos distintos de la suposición inicial: 3 cuentas, 20 documentos, 21 versiones y 40 objetos (9.653.546 bytes). El usuario confirmó que eran únicamente pruebas descartables. Antes de retirarlas se guardó una copia técnica local verificada de las tablas de aplicación, metadatos de cuentas sin contraseñas y los 40 objetos cifrados, con manifiesto SHA-256, en `/workspace/infinyx-backups/pre-v2-eat1b_4j`. Esta copia no incluye credenciales Auth ni garantiza restauración automática de cuentas. No se guardaron claves de servicio ni access tokens en ese backup.

La revisión de políticas reales confirmó un fallo adicional: Storage tenía políticas de lectura y borrado para cualquier usuario autenticado del bucket, sin aislamiento por propietario. También se permitía al cliente modificar sus propios logs de auditoría. Los permisos y políticas restrictivas desplegados bloquean ambas vías.

Se aplicaron y registraron las migraciones `20261018`, `20261019`, `20261109` y `20261109130000`. Se normalizaron timestamps y restricciones que diferían del esquema local. La última migración corrige el FK de auditoría, que en el proyecto original eliminaba eventos al borrar perfiles: ahora conserva los eventos con `user_id = NULL` al borrar la cuenta. Las 23 aserciones SQL locales pasan con ese cambio.

Se desplegó `vault-access` con Supabase CLI 3.1.0. El gateway valida por sí mismo cada sesión contra Auth. Los orígenes CORS permitidos se limitaron a desarrollo local; no se añadió un origen de producción inexistente. Se comprobó que la plantilla de confirmación contiene `{{ .Token }}`; no se enviaron correos ni se probó la entrega SMTP.

### Resultados remotos

- **33 comprobaciones reales aprobadas** mediante SDK/API: dos usuarios confirmados temporales, login, perfil y sal, contraseña adicional, subida cifrada y commit, privacidad de metadatos, aislamiento entre usuarios, bloqueo de lectura/borrado directo, verificador privado, auditoría no modificable por cliente, rechazo de contraseña incorrecta y accesos cruzados, descarga idéntica al original, límite persistente HTTP 429, caducidad de URL firmada y borrado con conservación de auditoría.
- **Dos comprobaciones negativas adicionales aprobadas:** sin sesión el gateway responde HTTP 401; con origen no permitido responde HTTP 403.
- **Flujo real en Chromium aprobado sin mocks:** login, subida, configuración de contraseña adicional, descarga descifrada idéntica al original, borrado y logout, sin errores de JavaScript. Se confió en la CA pública proporcionada por el entorno y se permitió a Chromium usar su almacén NSS; no se desactivó la verificación TLS.
- La primera prueba remota detectó una respuesta antigua de un objeto borrado. Se añadieron subidas con `cacheControl: '0'` y se verificó la eliminación con una petición nueva sin caché. No se promete revocación de respuestas ya almacenadas por un intermediario.
- Un intento intermedio de la suite remota falló en una lectura de auditoría sin mensaje útil; se añadió diagnóstico HTTP y una nueva ejecución completa pasó las 33 comprobaciones. Los intentos fallidos no se cuentan como aprobados.
- Se retiraron todas las cuentas y archivos creados para las pruebas. La comprobación administrativa final encontró **0 usuarios, 0 documentos, 0 versiones y 0 objetos del bucket**, conservando 8 eventos de auditoría de las pruebas sin identificadores de usuario.

Se añadió `pnpm test:live` como prueba remota explícita y `pnpm test:live:browser` para el navegador con frontend local ya iniciado. Ambas requieren configuración segura; no corren automáticamente en CI y sólo retiran sus propios fixtures.

### Estado final y pendientes

El acceso al proyecto, las migraciones y la función ya no están bloqueados. No se publicó el frontend corregido, no se hicieron commit ni push y no se afirma que las cabeceras del host de producción estén aplicadas. Antes de publicar, configurar el origen HTTPS real en `VAULT_ALLOWED_ORIGINS` y comprobar las cabeceras del hosting.

Siguen siendo necesarias las decisiones de operación previamente documentadas: cuotas por usuario, mantenimiento coordinado de objetos no referenciados, backups y restauración, monitorización y posible retención externa de logs. No se implementaron recuperación, cambio de contraseña/email con recifrado, rotación de claves ni MFA. La seguridad frente a un frontend o dispositivo comprometido tampoco está garantizada.

## Verificación del sitio existente en Cloudflare Pages

El usuario informó que ya tenía un despliegue en Pages y etiquetó el complemento de Cloudflare. Sus herramientas no están expuestas en esta sesión; por eso no se pudieron revisar cuenta, proyecto, ramas, variables de build ni historial interno de despliegues mediante ese complemento. No se solicitó ni se extrajo ningún token de Cloudflare.

La configuración de Auth de Supabase identifica `https://tech-value.pages.dev` como sitio y autoriza sus redirecciones. Se verificó esa URL pública con Chromium, conservando la verificación TLS: HTTP 200, título de INFINYX, pantalla de login visible y sin errores de JavaScript. La petición HTTP genérica fue rechazada por Cloudflare con código 1010; el navegador estándar sí pudo abrir la página. No se hizo login ni se enviaron formularios en el sitio publicado.

**Ya existe HTTPS mediante `pages.dev`; no hace falta comprar un dominio para usarlo.** Sin embargo, el sitio publicado sigue sirviendo código anterior a los parches: el bundle `/assets/index-1pux1UJW.js` contiene los dominios de derivación v1 y el texto de recuperación antiguo, y no contiene el dominio Auth v2, `vault-access` ni `vault_salt`. Su SHA-256 fue `b333d22ace3b1ed53655c80ea584bdfded21a4fb9b0ff52787430f2a95e371fc`. Por tanto, el frontend existente necesita un redeploy del código corregido para ser compatible con el backend v2.

Las respuestas públicas incluyen `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`. La CSP se entrega por meta HTML, no por cabecera HTTP; faltan `frame-ancestors` y las cabeceras `X-Frame-Options` y `Permissions-Policy` preparadas en `public/_headers`. No se recibió una cabecera HSTS explícita; esto no implica que falte HTTPS ni un downgrade en navegadores para `.dev`, que está precargado con HSTS.

El preflight real del gateway con `Origin: https://tech-value.pages.dev` devolvió HTTP 403 y `Origen no autorizado`, sin `Access-Control-Allow-Origin`. El origen aún no está en `VAULT_ALLOWED_ORIGINS`, que se configuró sólo para las pruebas locales. Para completar la publicación hay que desplegar los cambios locales en Pages y añadir ese origen HTTPS exacto preservando los orígenes necesarios. En esta revisión pública no se cambió Cloudflare ni la configuración CORS del backend.

## Estado actualizado antes del push

Se completó una revisión previa al push en `RELEASE_READINESS.md`. CORS ya autoriza el origen HTTPS exacto de Pages, preservando los tres orígenes locales y rechazando orígenes no autorizados. Se fijó Node.js en `.node-version`; lockfile, build, lint, tipos, 31 pruebas de regresión y 2 pruebas de navegador vuelven a pasar, y el audit no reporta avisos conocidos.

**La publicación completa sigue pendiente de integración:** GitHub `main` avanzó a `9e72ad7` con subida de carpetas y operaciones en lote que todavía usan el esquema anterior. La rama local no se movió de su base y no se hicieron merge, rebase, commit ni push. Las funcionalidades nuevas deben adaptarse a v2 y probarse antes de publicar. Esta condición supera la anterior impresión de que sólo faltaba enviar el código a GitHub.

## Integración posterior de carpetas y operaciones en lote

Por instrucción del usuario se incorporó el nuevo `main` (`9e72ad7`) a la base local y se adaptaron sus funcionalidades a v2. La subida individual y por lote comparte un único pipeline de cifrado, metadata y commit. Las rutas relativas sólo se consultan en RAM y se guardan cifradas. Las carpetas tienen límites de profundidad/cantidad y validación de rutas; los fallos parciales se informan y permiten reintentar sólo los elementos fallidos. El catálogo ahora se pagina y tiene una regresión con 1.001 documentos.

El borrado de seleccionados y el vaciado usan `delete-batch`, con propiedad de toda la solicitud y contraseña comprobadas en servidor, límite de 50 IDs por petición y resultados confirmados por documento. No se reintrodujeron las lecturas de verificadores desde `profiles`, el borrado directo del cliente ni el almacenamiento en claro de nombres/hashes. Las pruebas nuevas de carpetas y lotes ya forman parte de la suite, en lugar de quedar excluidas por la configuración de Vitest.

Resultado: **61 pruebas locales**, **2 pruebas de Chromium** y **23 aserciones SQL** aprobadas. Una suite adicional de **38 comprobaciones** y el flujo de carpetas/borrado en Chromium pasaron con servicios Supabase reales y el handler actualizado ejecutándose localmente. No se enviaron correos; las cuentas/objetos temporales se retiraron. Estos resultados no se atribuyen a la función Edge publicada.

La revisión automática de permisos rechazó actualizar la función remota `vault-access`, señalando la falta de aprobación explícita del despliegue persistente y `--no-verify-jwt`. No se publicó por otro medio ni se cambiaron los controles del servicio existente. Falta autorización del usuario para actualizar esa función, mantener su validación propia de tokens y verificar los lotes sobre el runtime remoto. No se hicieron commit ni push. Ver `RELEASE_READINESS.md` para el estado actual, que reemplaza el bloqueo anterior de integración de código.

## Cierre de la autorización y validación del gateway actualizado

El usuario confirmó explícitamente el despliegue pendiente de `vault-access`. La actualización se publicó conservando la validación propia de tokens contra Supabase Auth y la configuración JWT existente. Management API confirmó la función `ACTIVE`, versión 3. No se requirieron migraciones SQL adicionales ni cambios en los secretos de aplicación.

Se repitieron las suites reales sin `INFINYX_TEST_LOCAL_GATEWAY`: **38 comprobaciones de API aprobadas contra el endpoint Edge remoto**, incluidos propiedad de todos los elementos del lote, rechazo de acceso cruzado/mixto y eliminación de documentos propios. Chromium también pasó login, subida/descarga individual íntegra, carpetas y subcarpetas, privacidad de rutas en el backend, contraseña masiva incorrecta rechazada, borrado de seleccionados conservando los demás, vaciado y logout. Las cuentas temporales y sus objetos se retiraron.

El preflight de `https://tech-value.pages.dev` respondió 204 con `Access-Control-Allow-Origin` correcto; un origen no autorizado respondió 403. Por tanto, el bloqueo de despliegue descrito en la sección anterior quedó resuelto. El código integrado y el backend están preparados para commit/push; no se hicieron commit ni push y el frontend público todavía sirve la versión anterior hasta que el usuario lo publique. Los límites operativos y la verificación posterior del hosting siguen documentados en `RELEASE_READINESS.md`.
