# PRODUCT

## Producto
Web y sistema de reservas para **FILO**, barbería de precisión para hombre. «Filo» = el borde de la hoja: la precisión del corte. Se conservan el nombre y el logotipo.

## Audiencia
Hombres que buscan corte, degradado, barba o afeitado a navaja y reservan desde el móvil; el barbero y su equipo, que gestionan la agenda desde el panel.

## Trabajo principal
Que el visitante reserve: **barbero (opcional) → día → hora → nombre y teléfono → confirmar**, y pueda enviar la reserva por WhatsApp al barbero. Que el barbero vea y gestione sus citas, horarios y cierres sin tocar código.

## Verdades del producto
- Sin servicios ni precios en la reserva, en el panel ni en el mensaje de WhatsApp. La web enumera servicios solo como información.
- Reservas reales en `server/server.mjs` + SQLite compartida por web y panel; disponibilidad calculada en el servidor; sin dobles reservas.
- Estados: pendiente, confirmada, cancelada. Cancelar libera la hora; reprogramar mueve la misma reserva.
- Cerrar días o cambiar horarios nunca cancela citas sin avisar.
- No se inventan dirección, coordenadas, números de WhatsApp, reseñas, prensa ni cifras. Sin datos configurados, la web lo dice y no muestra mapa ni botón.
- Nunca se pide la ubicación del visitante.

## Compromisos de marca (sexta iteración)
- Identidad masculina y premium; sin imágenes femeninas, maquillaje ni flores; sin postes de barbería ni clichés vintage.
- Paleta: marfil #F2F0E9, blanco suave #FAF9F6, cemento #B8B8B2, gris medio #777873, carbón #252624, negro profundo #151615, arena #C9BBA7; metal cepillado discreto.
- Serif editorial para titulares, sans limpia para UI.
- Evitar degradados morados, sombras excesivas, aspecto SaaS genérico y transparencias por todas partes.
- Intro de 2–3 s una vez por sesión; CTA de reserva persistente que se expande hasta el formulario.

## Plataforma
HTML/CSS/JS sin framework + servidor Node sin dependencias. Escritorio y móvil como composiciones distintas.
