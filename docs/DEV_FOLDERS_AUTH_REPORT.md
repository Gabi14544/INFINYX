# Implementación en dev: carpetas cifradas y autorización de pestaña

Fecha: 2026-11-10. Base: `main` en `3e3aef0f5470bda9adfbe7eb27802999739aeeff` (`INFINYX V2`). Implementación desarrollada y validada en `dev`. Tras la revisión, el usuario autorizó crear un commit e integrar `dev` en `main` localmente. Esta autorización no incluye push ni despliegue; no se modificó producción.

## Resultado

- Botón explícito «Crear contraseña de descarga y eliminación», consulta de estado y reintento ante errores. Las cuentas que ya tienen contraseña muestran su estado configurado.
- La creación valida longitud, confirmación y que sea diferente de la maestra. No inicia operaciones ni deja la pestaña autorizada. La primera operación pide la contraseña; las siguientes reutilizan la autorización en memoria. Bloquear, salir o recargar la elimina.
- Descargar y eliminar mantienen las comprobaciones del gateway. Los borrados individuales y en lote conservan la confirmación destructiva aunque la pestaña esté autorizada.
- Cada carpeta nueva produce un único ZIP cifrado, documento y versión. El catálogo muestra el icono de carpeta y su cantidad de archivos; la descarga entrega un ZIP con las rutas originales.
- Compresión en un worker propio y dependencia `fflate` para ZIP. El cifrado sigue usando Web Crypto. Se agregó `worker-src 'self'` a las políticas de Pages y preview.
- La información de carpeta se guarda dentro de los metadatos cifrados y autenticados. Los metadatos v2 existentes sin esa información siguen siendo válidos. Un archivo y una carpeta del mismo nombre no se consideran versiones del mismo documento.

## Límites y compatibilidad

Se verifican por separado los 50 MiB de contenido original y los 50 MiB del ZIP resultante, antes de subir. Una carpeta justo en el límite puede necesitar reducirse por la cabecera ZIP. Se mantienen los límites existentes de 500 archivos por selección y 32 segmentos de ruta, el rechazo de rutas inválidas/duplicadas y el filtrado de archivos de sistema.

Las carpetas vacías no se incluyen; los archivos de cero bytes siguen siendo rechazados. No se convierten las carpetas antiguas formadas por documentos separados. La compresión y el cifrado necesitan memoria local; esta versión no implementa streaming ni admite carpetas mayores.

No se necesitan migraciones SQL, cambios del bucket ni despliegue de funciones para estas funciones. La contraseña adicional continúa viajando por HTTPS al gateway y vive temporalmente en RAM de la pestaña autorizada, igual que el modelo existente; no se almacena en localStorage.

## Validación

- 70 pruebas unitarias: cifrado y compatibilidad, rutas/duplicados, empaquetado y lectura ZIP, límites de entrada y salida, descriptores de descarga y cancelación/terminación del worker.
- 5 pruebas de Chromium sobre el servidor de desarrollo y las mismas 5 sobre un build de producción con CSP estricta. Auth, API y Storage simulados; cifrado, compresión, worker y descarga reales en navegador.
- Flujos comprobados: configuración explícita, rechazo de la contraseña maestra, contraseña incorrecta, carpeta con subcarpetas como un solo documento, recuperación tras recarga, autorización compartida entre descarga y borrado, y confirmación de vaciado sin nueva contraseña.
- `pnpm build`, `pnpm lint` y `pnpm check:gateway`.
- El script remoto `tests/live/browser.mjs` se adaptó al nuevo flujo; no se ejecutó contra Supabase en esta tarea. No se crearon usuarios ni se tocaron datos remotos. Las verificaciones remotas históricas de v2 no constituyen validación remota de estos cambios.

Las comprobaciones locales no certifican ausencia absoluta de fallos. Antes de publicar se recomienda probar manualmente el flujo en una URL de preview si se habilita su despliegue.
