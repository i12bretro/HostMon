# HostMon
<p>HostMon is a simple web-based host monitor and application dashboard. It can be used to monitor the real-time status of hosts and services running in your homelab environment. In addition to monitoring, HostMon has built-in Wake-On-LAN (WOL) capability, SSH client, real-time ping output and the ability to link to your existing Apache Guacamole installation to remotely control hosts from the within browser.

The HostMon application is written in javascript and uses a SQLite database backend. </p>

https://user-images.githubusercontent.com/54692756/152793104-31997735-f1e7-4a58-95eb-e925aa923670.mp4

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Coming Soon](#coming-soon)
- [Screenshots](#screenshots)

## Features
- Wake-On-LAN (WOL)
- SSH client
- Real-time ping
- Logging
- Custom icons
- Configurable ping interval
- Host/Application grouping
- Search
- Customizable ssh colors

- Responsive layout

## Installation

### Docker
```sh
 COMING SOON!!!
```


### Linux
```sh
git clone https://github.com/i12bretro/HostMon.git ./hostmon
cd hostmon
npm install
npm audit fix
node ./server.js
```

### Windows
1. Install NodeJS for Windows <a href="https://nodejs.org/en/download/" target="_blank">https://nodejs.org/en/download/</a>
2. Download the latest HostMon release <a href="https://github.com/i12bretro/HostMon/releases/latest" target="_blank">https://github.com/i12bretro/HostMon/releases/latest</a>
3. Extract the downloaded release files
4. Launch PowerShell or Command Prompt
5. Change directory to the extracted HostMon files
6. Run
```powershell
npm install
npm audit fix
node .\server.js
```

## Coming Soon
Currently working on creating a containerized version of HostMon to run in Docker

## Screenshots
### Main Dashboard
![main](https://user-images.githubusercontent.com/54692756/152792668-227ab62c-a391-46d0-a625-cd90d9137336.jpg)
### SSH Client
![ssh_client](https://user-images.githubusercontent.com/54692756/152792841-19fa8562-ffad-4aa9-886b-5ff1774c3a5a.jpg)
### Real-time Ping
![realtime_ping](https://user-images.githubusercontent.com/54692756/152792842-f76192bc-29aa-4058-8a9e-11fefe30232e.jpg)
### Wake-On-LAN (WOL)
![wol](https://user-images.githubusercontent.com/54692756/152792843-f9e37eb8-c014-4ef3-8e81-0439a0333950.jpg)
### Logging
![logs](https://user-images.githubusercontent.com/54692756/152792844-dfed961d-2d0c-436b-aeaf-020f44e59a25.jpg)
