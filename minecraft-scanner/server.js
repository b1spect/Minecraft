const express = require('express');
const cors = require('cors');
const { StatusChecker } = require('mcstatus');
const http = require('http');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище найденных серверов
let foundServers = [];
let isScanning = false;
let scanProgress = { current: 0, total: 0, found: 0 };

// Исключаем популярные публичные сервера
const publicServers = [
  'hypixel.net', 'mineplex.com', 'cubecraft.net', 'hivemc.com',
  'wynncraft.com', 'manacube.com', 'cosmicpvp.com', 'archonhq.net'
];

// Диапазоны IP для сканирования (частные диапазоны и случайные подсети)
// В реальности сканирование всех IP невозможно, поэтому используем выборочные диапазоны
const scanRanges = [
  // Частные сети (где чаще всего бывают приватные сервера)
  { start: '192.168.1.1', end: '192.168.1.254' },
  { start: '192.168.0.1', end: '192.168.0.254' },
  { start: '10.0.0.1', end: '10.0.0.254' },
  { start: '172.16.0.1', end: '172.16.0.254' },
  // Некоторые публичные подсети (для примера)
  { start: '45.32.100.1', end: '45.32.100.50' },
  { start: '149.28.200.1', end: '149.28.200.50' },
  { start: '207.246.80.1', end: '207.246.80.50' }
];

// Функция проверки IP на принадлежность к публичным серверам
function isPublicServer(ip, domain) {
  if (!domain) return false;
  return publicServers.some(pub => domain.toLowerCase().includes(pub.toLowerCase()));
}

// Функция преобразования IP в число
function ipToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// Функция преобразования числа в IP
function numberToIp(num) {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

// Функция сканирования диапазона IP
async function scanIPRange(startIP, endIP, port = 25565) {
  const start = ipToNumber(startIP);
  const end = ipToNumber(endIP);
  const results = [];
  
  for (let ipNum = start; ipNum <= end; ipNum++) {
    if (!isScanning) break;
    
    const ip = numberToIp(ipNum);
    scanProgress.current++;
    
    try {
      const checker = new StatusChecker(ip, port);
      const status = await checker.checkStatus();
      
      if (status.online && !isPublicServer(ip, status.hostname)) {
        const serverInfo = {
          ip: ip,
          port: port,
          online: true,
          players: status.players?.online || 0,
          maxPlayers: status.players?.max || 0,
          version: status.version?.name || 'Unknown',
          motd: status.motd?.clean || status.motd || 'No description',
          hostname: status.hostname || ip,
          ping: status.latency || 0,
          discoveredAt: new Date().toISOString()
        };
        
        // Проверяем, нет ли уже такого сервера в списке
        const exists = foundServers.some(s => s.ip === ip && s.port === port);
        if (!exists) {
          foundServers.unshift(serverInfo);
          results.push(serverInfo);
          scanProgress.found++;
        }
      }
    } catch (error) {
      // Сервер не отвечает или ошибка соединения - пропускаем
    }
    
    // Небольшая задержка чтобы не перегружать сеть
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return results;
}

// Запуск сканирования
app.post('/api/scan', async (req, res) => {
  if (isScanning) {
    return res.status(400).json({ error: 'Сканирование уже запущено' });
  }
  
  const { ranges, port } = req.body;
  const rangesToScan = ranges || scanRanges;
  const scanPort = port || 25565;
  
  isScanning = true;
  scanProgress = { current: 0, total: 0, found: 0 };
  
  // Считаем общее количество IP для сканирования
  rangesToScan.forEach(range => {
    const start = ipToNumber(range.start);
    const end = ipToNumber(range.end);
    scanProgress.total += (end - start + 1);
  });
  
  res.json({ message: 'Сканирование запущено', total: scanProgress.total });
  
  // Запускаем сканирование в фоне
  (async () => {
    for (const range of rangesToScan) {
      if (!isScanning) break;
      await scanIPRange(range.start, range.end, scanPort);
    }
    
    isScanning = false;
  })();
});

// Остановка сканирования
app.post('/api/stop', (req, res) => {
  isScanning = false;
  res.json({ message: 'Сканирование остановлено' });
});

// Получение найденных серверов
app.get('/api/servers', (req, res) => {
  res.json({
    servers: foundServers,
    isScanning: isScanning,
    progress: scanProgress
  });
});

// Добавление конкретного IP для проверки
app.post('/api/check', async (req, res) => {
  const { ip, port = 25565 } = req.body;
  
  if (!ip) {
    return res.status(400).json({ error: 'IP адрес обязателен' });
  }
  
  try {
    const checker = new StatusChecker(ip, port);
    const status = await checker.checkStatus();
    
    if (status.online && !isPublicServer(ip, status.hostname)) {
      const serverInfo = {
        ip: ip,
        port: port,
        online: true,
        players: status.players?.online || 0,
        maxPlayers: status.players?.max || 0,
        version: status.version?.name || 'Unknown',
        motd: status.motd?.clean || status.motd || 'No description',
        hostname: status.hostname || ip,
        ping: status.latency || 0,
        discoveredAt: new Date().toISOString()
      };
      
      const exists = foundServers.some(s => s.ip === ip && s.port === port);
      if (!exists) {
        foundServers.unshift(serverInfo);
      }
      
      res.json({ found: true, server: serverInfo });
    } else {
      res.json({ found: false, reason: status.online ? 'Публичный сервер' : 'Сервер не найден' });
    }
  } catch (error) {
    res.json({ found: false, reason: 'Ошибка подключения' });
  }
});

// Удаление сервера из списка
app.delete('/api/server/:ip/:port', (req, res) => {
  const { ip, port } = req.params;
  const portNum = parseInt(port);
  
  const index = foundServers.findIndex(s => s.ip === ip && s.port === portNum);
  if (index !== -1) {
    foundServers.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Сервер не найден' });
  }
});

// Очистка списка
app.delete('/api/servers', (req, res) => {
  foundServers = [];
  res.json({ success: true });
});

// Статистика
app.get('/api/stats', (req, res) => {
  const onlineServers = foundServers.filter(s => s.online);
  const totalPlayers = onlineServers.reduce((sum, s) => sum + s.players, 0);
  
  res.json({
    totalFound: foundServers.length,
    onlineServers: onlineServers.length,
    totalPlayers: totalPlayers,
    isScanning: isScanning,
    progress: scanProgress
  });
});

// Обновление статуса всех серверов
async function updateAllServers() {
  const updated = [];
  
  for (const server of foundServers) {
    try {
      const checker = new StatusChecker(server.ip, server.port);
      const status = await checker.checkStatus();
      
      updated.push({
        ...server,
        online: status.online,
        players: status.players?.online || 0,
        maxPlayers: status.players?.max || 0,
        version: status.version?.name || server.version,
        motd: status.motd?.clean || status.motd || server.motd,
        ping: status.latency || server.ping,
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      updated.push({
        ...server,
        online: false,
        lastUpdate: new Date().toISOString()
      });
    }
  }
  
  foundServers = updated;
}

// Автообновление каждые 30 секунд
setInterval(() => {
  if (foundServers.length > 0) {
    updateAllServers();
  }
}, 30000);

app.listen(PORT, () => {
  console.log(`🔍 Minecraft Private Scanner запущен на http://localhost:${PORT}`);
  console.log('📡 Сканирует приватные сервера игроков...');
});
