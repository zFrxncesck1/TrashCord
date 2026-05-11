# blueTimestamps

A [Vencord](https://github.com/Vendicated/Vencord) user plugin that adds seconds to Discord message timestamps. 

## Features

- **Precise Timestamps:** See the exact second a message was sent.
- **Customizable Settings:**
  - **Pad Hours:** Add a leading zero to the hours (e.g., `09:00:00` vs `9:00:00`).
  - **12/24 Hour Mode:** Choose between 12-hour AM/PM format and 24-hour format.

## Installation

### Linux
1. Clone the Vencord repository (replace `/home/[user]/Vencord` with your desired path if different):
   ```bash
   git clone https://github.com/Vendicated/Vencord.git /home/[user]/Vencord
   ```
2. Navigate to the Vencord `src/userplugins` directory and create a folder for the plugin:
   ```bash
   cd /home/[user]/Vencord/src/userplugins
   mkdir blueTimestamps
   ```
3. Place the `index.tsx` file inside the newly created `blueTimestamps` folder.
4. Go back to the root Vencord directory and install dependencies (if this is your first time):
   ```bash
   cd /home/[user]/Vencord
   pnpm install
   ```
5. Build and inject Vencord:
   ```bash
   pnpm build && pnpm inject
   ```

### Windows
The steps for Windows are essentially the same, just using Windows paths!
1. Open Command Prompt or PowerShell and clone the Vencord repository:
   ```cmd
   git clone https://github.com/Vendicated/Vencord.git
   cd Vencord
   ```
2. Go into the `src\userplugins` folder, create a folder named `blueTimestamps`, and drop your `index.tsx` file inside.
3. In the root Vencord directory, install dependencies (if this is your first time):
   ```cmd
   pnpm install
   ```
4. Build and inject Vencord:
   ```cmd
   pnpm build && pnpm inject
   ```
