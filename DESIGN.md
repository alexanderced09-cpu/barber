# DESIGN — FILO, barbería

Extraído del prototipo construido (`filo/`), sexta iteración: identidad masculina, premium y contemporánea.

## Idea
Barbería de precisión. **La línea de corte** (arena, 1 px) es el hilo conductor: la traza la intro, sostiene el titular de la reserva, la superficie de reserva se abre desde ella y cruza el logotipo del pie. Metal cepillado solo en detalles (tijeras de la intro, ficha técnica de servicios).

## Color (`styles.css :root`)
| Token | Valor | Uso |
|---|---|---|
| `--ivory` | #F2F0E9 | Fondo principal claro, superficie del CTA de reserva |
| `--paper` | #FAF9F6 | Equipo, formulario de reserva, cabecera al hacer scroll |
| `--ivory-2` | #E7E4DB | Opciones del formulario en reposo |
| `--cement` | #B8B8B2 | Texto secundario sobre oscuro, bordes de campos |
| `--mid` | #777873 | Estados inactivos |
| `--soft` | #575853 | Texto secundario sobre claro (6,4:1) |
| `--charcoal` | #252624 | Texto principal |
| `--deep` | #151615 | Servicios, escena de reserva, pie, botón principal |
| `--sand` | #C9BBA7 | Único acento cálido: línea de corte, selección, foco sobre oscuro |
| `--metal` | #C8CAC5 | Trazos de la ficha técnica |

## Tipografía
- **Zodiak** (serif editorial, 400–500): titulares, nombres, cifras de día.
- **Hanken Grotesk** (400–600): navegación, textos, formularios, botones y todo el panel.
- **Sofia Sans Extra Condensed 900**: solo el logotipo FILO (se conserva).

## Estructura de la web
Portada panorámica a sangre con velo marfil (lectura a la izquierda) y datos vivos («Hoy», «Próxima hora libre») → manifiesto fijado → servicios (fondo oscuro, foto fija + ficha técnica) → equipo (desde la configuración) → **Dónde estamos** (dirección, mapa diferido, cómo llegar, horario agrupado, próximos cierres) → reserva → pie.

## Cabecera y CTA
Cabecera fina (64 px), siempre visible, que toma el tema de la sección que tiene debajo (`data-theme`). El botón compacto «Reservar» es carbón sobre claro y marfil sobre oscuro. Al fijarse la escena de reserva, la cabecera se vuelve transparente, el botón cede el relevo y una superficie marfil crece **desde su rectángulo exacto** hasta ocupar la pantalla, ligada al scroll; el formulario se abre desde la línea de corte. Mientras la superficie aún no cubre el logotipo, solo queda el logotipo en la cabecera.

## Intro (≈2,5 s, una vez por sesión)
Fondo carbón con grano sutil → la línea de corte cruza la pantalla → las tijeras entran abriéndose y cortan sobre la línea → cae pelo cortado → «FILO» emerge de la línea → el logotipo viaja hasta la cabecera (FLIP exacto, ivory → carbón) mientras la escena se cierra sobre la línea y revela la portada. Se salta con clic o tecla; espera a fuentes e imagen como máximo 400 ms / hasta el revelado; `?intro=replay` y `?intro=scrub` para revisarla. Con movimiento reducido no hay intro.

## Panel (`filo/admin/`)
Fondo marfil, texto carbón, tarjetas `--paper` con borde suave. Barra lateral en escritorio y barra inferior de 5 secciones en móvil (con zona segura). Estados con pastilla de texto y punto: pendiente (ocre), confirmada (verde musgo), cancelada (gris). Calendarios: punto = citas activas, gris = cerrado, borde discontinuo = no abre por horario, marca arena = cierre parcial. Toda acción que cambia una cita pasa por un diálogo de confirmación.

## Movimiento
Tokens: `--ease-out` (0.23,1,0.32,1), `--ease-in-out` (0.77,0,0.175,1), `--ease-drawer` (0.32,0.72,0,1). Presión 160 ms (`scale(0.97)`), UI ≤ 300 ms, revelados 700–900 ms. Solo `transform`, `opacity` y `clip-path`. `prefers-reduced-motion`: sin intro, parallax ni expansión; la reserva es un formulario normal.

## Pendiente de sustituir
Fotografías y equipo son de muestra (créditos en `filo/assets/CREDITS.md`). Dirección, WhatsApp y horario real: desde el panel (ver `SETUP.md`).
