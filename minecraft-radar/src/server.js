const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Список серверов для мониторинга (можно расширять)
const serversToMonitor = [
  'hypixel.net',
  'mineplex.com',
  'cubecraft.net',
  'play.hivemc.com'
];

// Функция получения информации о сервере через API
async function getServerInfo(address) {
  try {
    // Используем публичный API mcsrvstat.us для получения данных о сервере
    const response = await axios.get(`https://api.mcsrvstat.us/2/${address}`);
    const data = response.data;
    
    if (data.online) {
      return {
        address: address,
        online: true,
        players: {
          online: data.players.online,
          max: data.players.max
        },
        version: data.version,
        motd: data.motd ? data.motd.clean : 'No MOTD',
        icon: data.icon,
        latency: data.debug.ping || 0
      };
    } else {
      return {
        address: address,
        online: false,
        players: { online: 0, max: 0 },
        version: 'Offline',
        motd: 'Server is offline',
        icon: null,
        latency: 0
      };
    }
  } catch (error) {
    console.error(`Error fetching info for ${address}:`, error.message);
    return {
      address: address,
      online: false,
      players: { online: 0, max: 0 },
      version: 'Error',
      motd: 'Failed to fetch data',
      icon: null,
      latency: 0
    };
  }
}

// Функция обновления данных о всех серверах
async function updateServers() {
  const results = [];
  
  for (const server of serversToMonitor) {
    const info = await getServerInfo(server);
    results.push(info);
  }
  
  return results;
}

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, '../public')));

// API endpoint для получения данных о серверах
app.get('/api/servers', async (req, res) => {
  try {
    const servers = await updateServers();
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket подключение
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Отправляем данные при подключении
  updateServers().then(servers => {
    socket.emit('servers-update', servers);
  });
  
  // Обновляем данные каждые 10 секунд
  const interval = setInterval(() => {
    updateServers().then(servers => {
      socket.emit('servers-update', servers);
    });
  }, 10000);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    clearInterval(interval);
  });
});

server.listen(PORT, () => {
  console.log(`Minecraft Radar Server running on http://localhost:${PORT}`);
});
