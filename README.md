# 🎨 Draw and Dare

Draw and Dare is an interactive web-based multiplayer game where players can join lobbies, draw, and participate in fun dares! Built using Node.js, Express, and MySQL.

## 🚀 Features
* **User Authentication:** Secure login and registration using session management.
* **Multiplayer Lobbies:** Create or join lobbies to play with friends.
* **Interactive Gameplay:** Real-time game logic for drawing and dares.
* **Server-Side Rendering:** Fast and dynamic views using the Pug template engine.

## 🛠️ Tech Stack
* **Backend:** Node.js, Express.js
* **Database:** MySQL (using `mysql2` promises)
* **View Engine:** Pug
* **Middleware:** `express-session`, `body-parser`

## ⚙️ Prerequisites
Make sure you have the following installed on your machine:
* Node.js (v14 or higher recommended)
* MySQL

## 📥 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/draw-and-dare.git
   cd draw-and-dare
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   * Create a `.env` file in the root directory.
   * Add your local database credentials and session secret (see `.env.example` if available).
   * Ensure you have a MySQL database named `drawanddare` created on your machine.

4. **Start the server:**
   ```bash
   npm start
   # or
   node app.js
   ```
   *The server will start running at `http://localhost:3000`.*

## 📂 Project Structure
* `/public` - Static assets (CSS, client-side JS, images).
* `/views` - Pug templates for rendering application pages.
* `/routes` - Express routers for modular features (`auth.js`, `pages.js`, `lobby.js`, `game.js`).
* `app.js` - Application entry point and configuration.

## 📝 License
MIT
