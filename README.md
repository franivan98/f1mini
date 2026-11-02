# F1 Mini Campeonato 🏁

Juego de carreras 2D multijugador estilo F1, para jugar con amigos desde el navegador.
Sin servidor propio: el que crea la sala hace de host (P2P con WebRTC / PeerJS).

## Publicarlo en GitHub Pages
1. Creá un repo nuevo en GitHub (por ejemplo `f1mini`) y subí **todo el contenido de esta carpeta** a la raíz.
   ```bash
   git init && git add . && git commit -m "F1 Mini"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/f1mini.git
   git push -u origin main
   ```
2. En el repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → Save.
3. Al minuto queda en `https://TU_USUARIO.github.io/f1mini/`.

> No se puede abrir con doble click (`file://`) porque usa módulos JS. Para probar local: `python3 -m http.server` y entrás a `http://localhost:8000`.

## Cómo se juega
- **Crear sala** → te da un código de 5 letras. Con **Copiar link** se lo mandás a tus amigos y entran directo.
- El host elige el calendario (las pistas tildadas, en orden), las vueltas, los bots y la dificultad.
- Puntos tipo F1: 25-18-15-12-10-8-6-4-2-1, más **+1 por vuelta rápida** si terminás en el top 10.
- **Grilla invertida** (opcional): desde la 2ª carrera, el que va primero en el campeonato larga último.
- Controles: ↑/W acelerar · ↓/S frenar · ←→/A D girar · **R** volver a pista · **M** sonido. En el celular aparecen botones táctiles (mejor con el celu horizontal).
- **Rebufo**: si vas pegado atrás de otro auto, sumás velocidad punta.
- **DRS**: en las rectas marcadas con "DRS", si al entrar estás a menos de 1 s del de adelante (desde la vuelta 2), se abre el alerón (+9% de punta). Se cierra al frenar.
- **Gomas y boxes**: las gomas se gastan (más rápido si derrapás o pisás pasto) y el auto agarra menos. Entrá al pit lane de la recta principal (limitador 90 km/h), frená en los recuadros amarillos y en 2,6 s tenés gomas nuevas.
- **Daño**: los choques fuertes rompen el alerón (menos velocidad y menos giro). Se arregla en boxes (+2,2 s).
- **Parada obligatoria** (opcional): si no parás en boxes, +20 s al final.
- **Fin de carrera**: cuando alguien recibe la bandera a cuadros, el resto termina al cruzar la línea. Cuando terminan todos los humanos, la carrera cierra a los 5 s. Como máximo, 90 s después del primer humano (o 2 min después del ganador). Arriba aparece la cuenta regresiva.

## Cosas para saber
- El host **no tiene que cerrar la pestaña**: si se va, se corta la sala. Los bots corren en la compu del host.
- La conexión usa el servidor público gratuito de PeerJS para "presentar" a los jugadores. Después el tráfico va directo entre navegadores (o por un TURN público si alguna red no deja pasar la conexión directa).
- Si un amigo se desconecta en plena carrera, la carrera termina igual: 60 s después de que llega el primero.
- Para usar tu propio servidor PeerJS: `?peerhost=mi.server.com&peerport=443&peersecure=1`.

## Estructura
- `js/core.js` — pistas, física, vueltas e IA de bots (para agregar una pista, sumala en `TRACKS`).
- `js/net.js` — conexión P2P host/cliente.
- `js/main.js` — salas, campeonato, render, HUD, input y sonido.
- `js/scenery.js` — escenografía: pianos, grava, boxes, tribunas, árboles, edificios, cerros.
- `vendor/peerjs.min.js` — PeerJS 1.5.5 (licencia MIT).
