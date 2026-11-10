# Corrección del estado de contraseña y del indicador de descarga

## Diagnóstico

La fila reutilizaba `busy` para mostrar «Descifrando…». Ese estado también incluía la carga del catálogo y los estados pendiente/error de la consulta de contraseña. Por eso todos los documentos podían aparentar una descarga tras subir un archivo sin que se hubiera solicitado ninguna.

La captura corresponde al origen `https://4802e0db.tech-value.pages.dev`. Las comprobaciones OPTIONS contra la función remota dieron:

| Origen                                  | Resultado                  |
| --------------------------------------- | -------------------------- |
| `https://tech-value.pages.dev`          | 204, origen autorizado     |
| `https://4802e0db.tech-value.pages.dev` | 403, sin autorización CORS |
| `http://localhost:5173`                 | 204, origen autorizado     |

La comprobación es de CORS, sin iniciar sesión ni consultar credenciales del usuario. El rechazo del origen no permite saber si el usuario tiene una contraseña adicional. La URL principal debe usarse para probar el sitio publicado. Una URL de despliegue con hash identifica una versión fija y no se actualiza con futuros pushes.

## Cambios en dev

- Sólo el documento que se está descargando muestra «Descifrando…». El estado global de carga y la disponibilidad del servicio pueden deshabilitar acciones sin mostrar una descarga inexistente.
- La consulta de estado de contraseña tiene un límite de 12 segundos y cancela su transporte si no responde. Los cambios de contraseña/borrados no reciben ese límite, para no presentar una mutación lenta como cancelada cuando podría haberse confirmado en el servidor.
- El botón «Crear contraseña de descarga y eliminación» conserva su nombre durante la comprobación y permanece visible ante un error. Se habilita cuando el servicio confirma que falta la contraseña. Los errores de conexión no se interpretan como ausencia de contraseña ni habilitan una sobrescritura.
- Se explica que no se pudo consultar si existe una contraseña; se ofrece reintentar y se sugiere utilizar el sitio principal. Los errores concretos de contraseña incorrecta devueltos por el servidor se conservan.
- El indicador de descarga se libera mediante `finally`.

No se ampliaron los orígenes autorizados ni se modificó Supabase. Para probar un preview con hash se necesita autorizar explícitamente su origen exacto; no debe permitirse cualquier dominio `pages.dev`.

## Verificación

- 73 pruebas unitarias aprobadas, incluidas nuevas regresiones de ausencia de contraseña frente a fallo de transporte, timeout/cancelación y limpieza del temporizador.
- 7 pruebas de Chromium aprobadas, incluidas una consulta que nunca responde durante la subida y un fallo de transporte. Se comprueba que no aparezca «Descifrando…», que el botón siga visible y que el reintento habilite la creación.
- Build TypeScript/Vite, lint y comprobación TypeScript del gateway aprobados.
- Pruebas del navegador con servicios simulados; las comprobaciones remotas se limitaron al preflight OPTIONS. No se subieron archivos ni se alteraron cuentas o contraseñas reales.

Correcciones desarrolladas y verificadas en `dev`. El usuario autorizó crear el commit, fusionar en `main` y hacer push para activar el despliegue automático de Pages. El resultado del despliegue se verifica por separado.
