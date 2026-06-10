# Quantum Arena - Multiplayer 2D Shooter

Un frenetico sparatutto spaziale in tempo reale, ottimizzato per girare ed essere ospitato su **Render.com**.

## Caratteristiche
- 🚀 **Multiplayer in tempo reale**: Connessione tramite Socket.io per un gameplay fluido.
- ⚡ **Ottime Performance**: Rendering dinamico su HTML5 Canvas con effetti particellari (esplosioni, scie motori, scintille).
- 💎 **Interfaccia Premium**: Design responsive in stile fantascientifico con vetromorfismo (glassmorphism) ed effetti neon.
- 🏆 **Classifica Live**: Tracciamento dei punteggi e classifica dei migliori piloti aggiornata in tempo reale.

## Comandi di Gioco
- **Movimento**: Tasti `W`, `A`, `S`, `D` per spostare la navicella.
- **Mirare**: Sposta il mouse sullo schermo per orientare la nave spaziale.
- **Sparare**: Premi o tieni premuto `SPAZIO` per fare fuoco.

## Esecuzione in Locale
Per testare il gioco sul tuo computer (richiede Node.js installato):

1. Installa le dipendenze:
   ```bash
   npm install
   ```
2. Avvia il server:
   ```bash
   npm start
   ```
3. Apri [http://localhost:3000](http://localhost:3000) in una o più schede del browser per giocare con te stesso o con altri!

## Come distribuire su Render.com

1. Esegui il push di questo repository su GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Quantum Arena game"
   git branch -M main
   git remote add origin https://github.com/wox76/multiplayer_render.git
   git push -u origin main
   ```
2. Accedi al pannello di controllo di [Render](https://dashboard.render.com/).
3. Clicca su **New +** e seleziona **Web Service**.
4. Collega il tuo account GitHub e seleziona il repository `multiplayer_render`.
5. Configura i seguenti parametri:
   - **Name**: `quantum-arena` (o quello che preferisci)
   - **Environment**: `Node`
   - **Region**: Scegli quella più vicina (es. `Frankfurt (EU)`)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
6. Clicca su **Create Web Service** ed attendi il completamento del deployment!
