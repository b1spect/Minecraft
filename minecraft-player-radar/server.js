const express = require('express');
const cors = require('cors');
const minecraft = require('minecraft-server-util');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище найденных серверов
let foundServers = [];

// Список приватных серверов для мониторинга (можно добавлять свои)
const privateServers = [
  // Пример: { host: '192.168.1.100', port: 25565, name: 'Сервер друга' }
  // Добавьте сюда IP ваших друзей или известные вам приватные сервера
];

// Функция проверки сервера
async function checkServer(host, port = 25565, name = null) {
  try {
    const result = await minecraft.status(host, { port: port });
    return {
      host: host,
      port: port,
      name: name || result.host,
      online: true,
      players: {
        online: result.players.online,
        max: result.players.max,
        list: result.players.sample ? result.players.sample.map(p => p.name) : []
      },
      version: result.version.name,
      description: result.description.text || result.description.extra?.map(e => e.text).join('') || '',
      ping: result.latency,
      lastSeen: new Date().toISOString()
    };
  } catch (error) {
    return {
      host: host,
      port: port,
      name: name || host,
      online: false,
      players: { online: 0, max: 0, list: [] },
      version: 'Неизвестно',
      description: '',
      ping: null,
      lastSeen: new Date().toISOString(),
      error: error.message
    };
  }
}

// API: Получить все найденные сервера
app.get('/api/servers', (req, res) => {
  res.json(foundServers);
});

// API: Добавить сервер вручную
app.post('/api/add', async (req, res) => {
  const { host, port = 25565, name } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  const server = await checkServer(host, parseInt(port), name);
  
  // Удаляем старый запись если есть
  foundServers = foundServers.filter(s => s.host !== host || s.port !== parseInt(port));
  foundServers.push(server);
  
  res.json(server);
});

// API: Проверить список IP
app.post('/api/check', async (req, res) => {
  const { servers } = req.body; // [{host, port, name}, ...]
  
  if (!servers || !Array.isArray(servers)) {
    return res.status(400).json({ error: 'Servers array is required' });
  }

  const results = [];
  for (const server of servers) {
    const result = await checkServer(server.host, parseInt(server.port || 25565), server.name);
    results.push(result);
    
    // Обновляем в хранилище
    foundServers = foundServers.filter(s => s.host !== result.host || s.port !== result.port);
    if (result.online) {
      foundServers.push(result);
    }
  }
  
  res.json(results);
});

// API: Удалить сервер
app.delete('/api/server/:host/:port', (req, res) => {
  const { host, port } = req.params;
  foundServers = foundServers.filter(s => s.host !== host || s.port !== parseInt(port));
  res.json({ success: true });
});

// API: Статистика
app.get('/api/stats', (req, res) => {
  const onlineServers = foundServers.filter(s => s.online);
  const totalPlayers = onlineServers.reduce((sum, s) => sum + s.players.online, 0);
  
  res.json({
    totalServers: foundServers.length,
    onlineServers: onlineServers.length,
    offlineServers: foundServers.length - onlineServers.length,
    totalPlayers: totalPlayers,
    lastUpdate: new Date().toISOString()
  });
});

// Запуск периодической проверки
setInterval(async () => {
  console.log('🔄 Обновление статуса серверов...');
  const updatedServers = [];
  
  for (const server of foundServers) {
    const result = await checkServer(server.host, server.port, server.name);
    updatedServers.push(result);
  }
  
  foundServers = updatedServers;
}, 30000); // Каждые 30 секунд

app.listen(PORT, () => {
  console.log(`🎮 Minecraft Player Radar запущен на http://localhost:${PORT}`);
  console.log('📡 Добавляйте приватные сервера через интерфейс или API');
});
