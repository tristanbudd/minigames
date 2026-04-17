# Minigames

![](https://img.shields.io/github/stars/tristanbudd/minigames.svg)
![](https://img.shields.io/github/watchers/tristanbudd/minigames.svg)
![](https://img.shields.io/github/license/tristanbudd/minigames.svg)

Minigames - A simple web platform featuring singleplayer and multiplayer arcade games. Built using a vanilla frontend and a Node.js WebSocket backend.

## Project Description

This project is a web programming formative focused on real-time game logic and state synchronization. It allows players to play locally against AI or join global multiplayer sessions using 6-digit room codes.

* **Frontend:** HTML, CSS, and JavaScript.
* **Backend:** Node.js with the `ws` library for real-time communication.
* **Core Logic:** Includes lobby management, host migration, and adaptive difficulty.

## Available Games

> [!IMPORTANT]
> I self-host the game API on private infrastructure. As a result, I cannot guarantee 100% reliability or uptime. If the multiplayer features are unavailable, please try again later or play in singleplayer mode.

| Game | Description | Mode |
| :--- | :--- | :--- |
| **Panic Pass** | Type the word before the bomb explodes. Don't be the last one holding it. | SP / MP |
| **Maze Run** | Find the exit before the timer hits zero. | SP / MP |
| **Memory Matrix** | Watch the pattern and replay it before the timer runs out. | SP / MP |
| **Pattern Forge** | Draw the generated pattern before time expires. | SP / MP |

## Preview

Home Page:
<img width="1920" height="482" alt="Main Menu" src="https://github.com/user-attachments/assets/2d6e3c01-9bf3-4719-a91f-250f81625871" />

Game Mode Selection:
<img width="1920" height="624" alt="Game Mode Selection" src="https://github.com/user-attachments/assets/9c2992d9-26ad-4f2c-8b7c-992fd90fc7e3" />

Multiplayer Lobby System:
<img width="1920" height="522" alt="Multiplayer Lobby System" src="https://github.com/user-attachments/assets/5e1f90ca-0e7c-4747-af87-bc4fdc977713" />

Panic Pass Gameplay:
<img width="1920" height="866" alt="Panic Pass Gameplay" src="https://github.com/user-attachments/assets/5dfc27ab-a41e-4ef6-b341-78d703ae38f7" />

Maze Run Gameplay:
<img width="1920" height="777" alt="Maze Run Gameplay" src="https://github.com/user-attachments/assets/fafca9c7-23b6-40da-8f22-676b04b47f29" />

Memory Matrix Gameplay:
<img width="1920" height="844" alt="Memory Matrix Gameplay" src="https://github.com/user-attachments/assets/321d40f0-513a-4efb-aee6-5e097949b969" />

Pattern Forge Gameplay:
<img width="1920" height="661" alt="Pattern Forge Gameplay" src="https://github.com/user-attachments/assets/f0311764-6723-4346-94dd-6bf726aadbc1" />

## Installation & Setup

1. Clone the repository
```bash
git clone https://github.com/tristanbudd/minigames.git
cd minigames
```

2. Install dependencies
```bash
npm install
```

3. Start the server(s) (OPTIONAL)
```bash
node server/(game name).js
```

4. Open the site
Open `index.html` in your browser.

## Technical Notes

* **Multiplayer:** Server-side sessions are managed via a central Map.
* **Synchronization:** WebSocket protocol handles live typing updates and authoritative timers.
* **Error Handling:** Features a word generation system with API timeout protection and local file fallbacks.
* **Responsiveness:** Built with a minimum width requirement of 400px using CSS grid and flexbox.

## Contributing

1. Fork the repository and create a branch.
2. Maintain "use strict" standards in all JavaScript files.
3. Submit a pull request with a detailed description of your changes.

## Security

Please report any security vulnerabilities by opening a private issue in the repository.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
