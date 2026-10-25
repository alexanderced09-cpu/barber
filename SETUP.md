# FILO: puesta en marcha

La web y el panel funcionan con un servidor Node **sin dependencias** (`server/server.mjs`) y una base de datos SQLite incluida en Node.

## Requisitos
- Node.js **22.5 o superior** (probado con 24.22). No hace falta `npm install`.

## Arranque
```bash
node server/server.mjs
```
- Web pública: http://127.0.0.1:8080/
- Panel de la barbería: http://127.0.0.1:8080/admin/

> Abrir `filo/index.html` directamente o con un servidor estático **no basta**: la reserva necesita la API. Sin ella, la web avisa de que no puede cargar la disponibilidad y no deja reservar.

## Acceso al panel
- En el primer arranque se genera una contraseña aleatoria y se guarda en `data/admin-password.txt` (fuera de la carpeta pública). La consola indica la ruta.
- Para fijar una contraseña propia, arranca con `FILO_ADMIN_PASSWORD`. Sustituye a la anterior en cada arranque.
- Las sesiones duran 12 horas (cookie `HttpOnly`, `SameSite=Strict`, más una cabecera anti-CSRF en cada escritura). Tras 8 intentos fallidos en 15 minutos, el acceso se bloquea temporalmente.

## Qué hay que configurar (desde el panel, no en el código)
`server/config.json` solo da **valores iniciales** la primera vez que arranca una base de datos nueva. Después, todo se cambia en el panel y se guarda en la base de datos:

| Panel → | Qué | Estado actual |
|---|---|---|
| **Negocio → Ubicación** | Dirección, ciudad, teléfono, indicaciones, latitud/longitud o enlace de Google Maps | **Vacío.** La web dice que la dirección se publicará más adelante y no muestra mapa. |
| **Negocio → Equipo** | Nombre, nombre corto, especialidad, foto (`assets/…`), **WhatsApp**, activo | Equipo y fotos **de muestra**. **Ningún WhatsApp configurado** (no se ha inventado ninguno). |
| **Horarios** | Días de apertura, franjas (los huecos entre franjas son descansos), duración de cada cita, días de antelación, horario propio por barbero | Horario **de muestra**: martes a viernes 10–14 y 16–20 (viernes hasta 20:30), sábado 9:30–14:30, citas de 45 min, 21 días de antelación. |
| **Cierres** | Días completos o franjas sin servicio, para toda la barbería o un barbero | Hay dos cierres que creaste antes (25 y 26 de octubre). |

- **WhatsApp:** formato internacional con código de país, sin «+» ni espacios (p. ej. `34600123456`). Vacío = no aparece el botón; la reserva se registra igual.
- **Mapa:** con latitud y longitud marca el punto exacto; con solo la dirección, Google Maps la busca. Sin ninguna de las dos, no hay mapa. La web nunca pide la ubicación del visitante.
- **Zona horaria:** `Europe/Madrid` por defecto (Negocio). Se usa para saber qué horas ya han pasado.

## Cómo funcionan las reservas
- Flujo del cliente: **barbero** (opcional, «Sin preferencia»; se omite si solo hay uno) → **día** → **hora** → nombre y teléfono → revisar → confirmar → pantalla de éxito con WhatsApp.
- La disponibilidad la calcula **el servidor** a partir del horario, los descansos, los cierres (de día o de franja, generales o por barbero), las reservas activas (con su duración), la duración de cita y la zona horaria. Nunca ofrece horas pasadas.
- Reservar se hace en una transacción (`BEGIN IMMEDIATE`) más un índice único: con peticiones simultáneas solo una gana. El cliente que llega tarde ve «Esa hora ya no está disponible» y conserva sus datos.
- Estados: `pendiente` (desde la web), `confirmada` y `cancelada` (desde el panel, siempre con confirmación). Cancelar libera la hora. Reprogramar cambia la misma reserva (mismo código) y libera la hora anterior.
- Cerrar un día o cambiar el horario **nunca cancela citas solas**: el panel enumera las afectadas y pide confirmar.
- Los endpoints públicos no devuelven nombres ni teléfonos; solo horas libres.
- WhatsApp: el botón abre `wa.me/<número del barbero>` con el texto «Hola, soy [cliente]. Acabo de registrar una reserva para el [fecha] a las [hora] con [profesional]. Mi código de reserva es [código].» El envío lo hace el cliente; la web no afirma que se haya enviado.

## Variables de entorno
| Variable | Uso | Por defecto |
|---|---|---|
| `PORT` / `HOST` | Puerto y dirección de escucha | `8080` / `127.0.0.1` |
| `FILO_ADMIN_PASSWORD` | Contraseña del panel | generada |
| `FILO_DATA_DIR` | Carpeta de la base de datos | `data/` |
| `FILO_CONFIG` | Valores iniciales | `server/config.json` |
| `FILO_SECURE_COOKIE=1` | Cookie `Secure`, detrás de HTTPS | desactivada |

## Copia de seguridad de la migración
Antes de pasar a esta versión se copió la base de datos a `data/respaldo-antes-v6/` (los tres archivos `filo.db`, `-wal` y `-shm`). La migración reasignó tus 2 reservas del barbero de muestra `lia` a `leo` y conservó los 2 cierres. Puedes borrar esa carpeta cuando compruebes que todo está bien.

## Publicarlo
Hace falta un alojamiento que ejecute Node con **disco persistente** (VPS, Railway, Render o Fly.io con volumen…). Un alojamiento estático no sirve.
- Pon el servidor detrás de HTTPS y usa `FILO_SECURE_COOKIE=1`.
- Haz copias de seguridad de `data/` (con el servidor parado, o copiando los tres archivos juntos).
- Ejecuta **una sola instancia**: SQLite y el límite de peticiones en memoria están pensados para un único proceso.
- Sustituye las fotografías de muestra (ver `filo/assets/CREDITS.md`) por fotografía propia.
