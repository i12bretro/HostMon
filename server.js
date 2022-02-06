process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
const _APPLICATION = { name: 'HostMon', version: '1.0', copyright: ' | 2021', links: [{ name: 'GitHub', URL: 'https://github.com/i12bretro/HostMon'}] };
const fs = require('fs');
const os = require('os');
const separator = (os.platform() == 'win32') ? '\\' : '/';
const async = require('async');
const multer = require('multer');
const upload = multer({ dest: `${separator}tmp` });
const sharp = require('sharp');
const express = require('express');
const app = express();
const bodyParser = require("body-parser");
const ping = require("ping");
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ipaddr = require('ipaddr.js');
const broadcastIPs = [];
const port = 3000;
const http = require('http').Server(app);
const https = require('https');
const wol = require('wol');
const SSHClient = require('ssh2').Client;
const io = require('socket.io')(http, {
  cors: {
    origin: "*"
  }
});
const { spawn } = require('child_process');

let db = null;
let hosts = [];
let hostStatus = [];
let categories = [];
let icons = [];
let lastLogs = [];
let settings = {};
let intervals = [];

async function main() {
  try{
    console.log(`Preparing ${_APPLICATION.name}`);
    await readHostNetwork();
    db = await initializeDatabase();
    settings = await initSettings();
    hosts = await initHosts();
    settings.icons = await verifyIcons();
    console.log(`Starting ${_APPLICATION.name}`);
    writeLog(0, 'HostMon:Server started', '');
    startServer();
  } catch(err){
    console.log(err);
  }
}

async function readHostDetails(){
  return new Promise((resolve) => {
    d = 0;
    h = 0;
    m = 0;
    s = 0;
    up = os.uptime();
    d = parseInt(up / (24 * 3600));
    up = up % (24 * 3600);
    h = String(parseInt(up / 3600)).padStart(2, '0');
    up %= 3600;
    m = String(parseInt(up / 60)).padStart(2, '0');
    up %= 60;
    s = String(up).padStart(2, '0');
    resolve({ 
      hostname: os.hostname(),
      os: os.version(),
      uptime: `${d}:${h}:${m}:${s}`,
      cpu: { 
        model: os.cpus()[0].model,
        cores: os.cpus().length 
      },
      memory: { 
        free: Math.round(((os.freemem() / 1024) / 1024)),
        total: Math.round(((os.totalmem() / 1024) / 1024)),
        percentage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2)
      } 
    });
  });
}

async function readHostNetwork(){
  const interfaces = os.networkInterfaces();
  new Promise((resolve, reject) => {
		for (let interface in interfaces) {
			for (let iface in interfaces[interface]) {
				const i = interfaces[interface][iface];
				if (i.family == 'IPv4') {
					broadcastIPs.push(ipaddr.IPv4.broadcastAddressFromCIDR(i.cidr).toString());
				}
			}
		}
    resolve();
  });
}
async function initializeDatabase(){
  db = await open({
    filename: './data/hostmon.db',
    driver: sqlite3.Database
  });
  return(db);
}

async function initSettings(){
  return new Promise(async (resolve, reject) => {
    settings['settings'] = {};
    try {
      rows = await db.all('SELECT id, name, (CASE WHEN value = \'\' THEN default_value ELSE value END) AS value FROM settings ORDER BY name');
        rows.forEach((row)=>{
          settings['settings'][row.name] = row;
        });
        resolve(settings);
    } catch(err){
      reject(err.message);
    }
  });
}

async function initHosts(){
  return new Promise(async (resolve, reject) => {
    categories = [];
    hosts = [];
    try{
      rows = await db.all('SELECT h.*, i.name AS icon_name, null AS last_status, 0 AS is_web, 0 AS is_wol FROM hosts h LEFT JOIN icon_def i ON i.id = h.icon_id ORDER BY h.category COLLATE NOCASE, h.host COLLATE NOCASE');
      rows.forEach((row)=>{
        hosts[row.id] = row;
        hosts[row.id]['ext'] = {};
        if(categories.indexOf(row.category) == -1){
          categories.push(row.category);
        }
      });
      settings.categories = categories;
      if(intervals.length > 0){
        intervals.forEach((interval) => {
          clearInterval(interval);
        });
        intervals = [];
      }
    } catch(err){
      reject(err.message);
    }

    try{
      rows = await db.all('SELECT host_id,key,value FROM hosts_extended_details ORDER BY host_id,key COLLATE NOCASE');
      rows.forEach((row)=>{
        hosts[row.host_id]['ext'][row.key] = row.value;
      });
    } catch(err){
      reject(err.message);
    }

    try{
      hosts.forEach(host => {
        if(host == null) return;
        hostInterval = (host['ext'].ping_interval !== undefined) ? (parseInt(host['ext'].ping_interval) * 1000) : (parseInt(settings['settings']['Default Ping Interval (sec)'].value) * 1000);
        if(new RegExp('^(https?:\\/\\/)+((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|((\\d{1,3}\\.){3}\\d{1,3}))(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*(\\?[;&a-z\\d%_.~+=-]*)?(\\#[-a-z\\d_]*)?$','i').test(host.host)){
          host.is_web = 1;
          pingURL(host.id, host.host);
          intervals[host.id] = setInterval(() => { 
            pingURL(host.id, host.host);
          }, hostInterval);
        } else {
          host.is_wol = (host.mac_address != null && /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})|([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})$/.test(host.mac_address)) ? 1 : 0;
          pingHost(host.id, host.host);
          intervals[host.id] = setInterval(() => { 
            pingHost(host.id, host.host);
          }, hostInterval);
        }
      });
      resolve(hosts);
    } catch(err){
      reject(err.message);
    }
  });
}

async function verifyIcons(){
  return new Promise(async (resolve, reject) => {
    if(!fs.existsSync(__dirname + '/public/images/icons/')){
      fs.mkdir(__dirname + '/public/images/icons/', (err) => {
        if(err){
          reject(err);
        }
      });
    }
    rows = await db.all('SELECT * FROM icon_def ORDER BY id');
    try{
      rows.forEach((row)=>{
        if(!fs.existsSync(__dirname + '/public/images/icons/'+ row.name +'.png')){
          const buffer = Buffer.from(row.data, 'base64');
          fs.writeFileSync(__dirname + '/public/images/icons/'+ row.name +'.png', buffer);
          writeLog(0, 'Icon:Create', `Created ${row.name}.png`);
        }
        delete row['data'];
        icons[row.id] = row.name;
      });
      resolve(icons);
    } catch(err){
      reject(err.message);
    }
  });
}

async function initLastLogs(){
  return new Promise(async (resolve, reject) => {
    try{
      rows = await db.all('SELECT * FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id DESC LIMIT 15) ORDER BY id');
      lastLogs = [];
      rows.forEach((row)=>{
        lastLogs.push({ i: row.id, h: row.host_id, a: row.action, d: row.details, s: row.status, n: '', t: row.log_date_time });
      });
      resolve(lastLogs);
    } catch(err){
      reject(err.message);
    }
  });
}

function cleanupTempFiles(){
  fs.readdir(`${__dirname}${separator}tmp`, (err, files) => {
    if(err) console.log(err);  
    for (const file of files) {
      fs.unlink(`${__dirname}${separator}tmp${separator}${file}`, err => {
        if(err) console.log(err);
      });
    }
  });
}

function startServer(){
  app.use(bodyParser.urlencoded({extended : true, limit: '150mb'})) 
  app.set('view engine', 'ejs');
  app.use(express.static(__dirname + '/public'));
  app.use('/xterm.css', express.static(require.resolve('xterm/css/xterm.css')));
  app.use('/xterm.js', express.static(require.resolve('xterm')));
  app.use('/xterm-addon-fit.js', express.static(require.resolve('xterm-addon-fit')));

  app.get(['/','/index.html'], (req, res) => {
    res.render('index',{ pageTitle: `${_APPLICATION.name} v${_APPLICATION.version}`, _APPLICATION: _APPLICATION });
  }).get('/ping.html', async (req, res) => {
    settings = await initSettings();
    res.render('ping',{ pageTitle: `${_APPLICATION.name} v${_APPLICATION.version} // Ping`, _GET: req.query, settings: settings.settings });
  }).get('/editor.html', (req, res) => {
    res.render('editor',{ pageTitle: `${_APPLICATION.name} v${_APPLICATION.version} // Editor`, host: hosts[req.query.host], _GET: req.query });
  }).get('/settings.html', async (req, res) => {
    hostDetails = await readHostDetails();
    res.render('settings',{ settings: settings, hostDetails: hostDetails, _APPLICATION: _APPLICATION, pageTitle: `${_APPLICATION.name} v${_APPLICATION.version} // Settings`, host: hosts[req.query.host], _GET: req.query });
  }).get('/ssh.html', async (req, res) => {
    settings = await initSettings();
    res.render('ssh',{ pageTitle: `${_APPLICATION.name} v${_APPLICATION.version} // Terminal`, _GET: req.query, settings: settings.settings });
  }).get('/api', (req, res) => {
    if(settings.settings.API.value == 'N'){
      res.status(404);
      res.send();
    } else {
      //res.header("Content-Type",'application/json');
      res.sendFile(`${__dirname}/public/api.html`);
    }
  }).post('/actions.html', async (req, res) =>{
    switch(req.query.action){
      case 'deleteHost':
        actionResponse = await deleteHost(parseInt(req.body.hostId));
        actionResponse.closeDialog = true;
        res.send(actionResponse);
      break;

      case 'exportData':
        var dt = new Date();
        // todo finish data export
        db.cmd(`'.dump' > "${__dirname}${separator}tmp${separator}hostmon_${String(dt.getFullYear())}${String(dt.getMonth()).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}${String(dt.getHours()).padStart(2, '0')}${String(dt.getMinutes()).padStart(2, '0')}${String(dt.getSeconds()).padStart(2, '0')}_db.sql"`);
      break;

      case 'getHostLogs':
        hostLogs = await getHostLogs(req.body.host, req.body.page);
        res.send(hostLogs);
      break;

      case 'purgeHostLogs':
        actionResponse = await purgeLogs(parseInt(req.body.hostId));
        actionResponse.closeDialog = true;
        res.send(actionResponse);
      break;

      case 'purgeLogs':
        actionResponse = await purgeLogs(null);
        actionResponse.closeDialog = true;
        res.send(actionResponse);
      break;

      case 'resetToDefault':
        actionResponse = await resetToDefault();
        actionResponse.closeDialog = true;
        res.send(actionResponse);
      break;

      case 'updateHost':
        actionResponse = await updateHost(req.body);
        hosts = await initHosts();
        if(req.body.host_id == ''){
          actionResponse.redirectPage = `/editor.html?host=${actionResponse.hostID}`;
        }
        res.send(actionResponse);
        io.emit('initdata', JSON.stringify({_APPLICATION: _APPLICATION, hosts: hosts, settings: settings }));
      break;

      case 'updateHostExt':
        actionResponse = await updateHostExt(req.body.host_id,req.body);
        hosts = await initHosts();
        res.send(actionResponse);
        io.emit('initdata', JSON.stringify({_APPLICATION: _APPLICATION, hosts: hosts, settings: settings }));
      break;

      case 'updateSettings':
        actionResponse = await updateSettings(req.body);
        settings = await initSettings();
        actionResponse.closeDialog = true;
        res.send(actionResponse);
        io.emit('initdata', JSON.stringify({_APPLICATION: _APPLICATION, hosts: hosts, settings: settings }));
      break;

    }

  }).post('/upload.html', upload.array('file'), async (req, res) =>{
    switch(req.query.action){
      case 'uploadIcon':
      if(req.files.length > 0){
        async.each(req.files, async function(file) {
          iconData = await addIcon(file);
          settings.icons[iconData.iconID] = iconData.name;
        }, function(err) {
          res.send(settings.icons);
          cleanupTempFiles();
        });     
      }
      break;
    }
  });

  io.on('connection', async (socket) => {
    switch (true){
      case (socket.handshake.headers.referer.indexOf('/api') > -1):
        socket.join('api');
      break; 

      case (socket.handshake.headers.referer.indexOf('/editor.html') > -1):
        if(socket.handshake.headers.referer.indexOf('?host=') > -1){
          hostID = /\?host=(\d*)$/ig.exec(socket.handshake.headers.referer)[1];
          socket.join(`host${hostID}`);
        }
      break;

      case (socket.handshake.headers.referer.indexOf('/ssh.html') > -1):
        hostID = /\?host=(\d*)$/ig.exec(socket.handshake.headers.referer)[1];
        if(hostID in hosts){
          socket.join(socket.id);
          var ssh = new SSHClient();
          
          socket.on('sshauth', (authdata) => {
            ssh.on('ready', () => {
              io.sockets.in(socket.id).emit('sshauth', 'success');
              writeLog(hostID, 'SSH:Session started', `SSH session started for ${hosts[hostID].host}`);
              ssh.shell((err, stream) => {
                if (err)
                  return socket.emit('data', 'An error occurred:'+ err.message +'\r\n\r\n');
                socket.on('data', (data) => {
                  stream.write(data);
                });
                stream.on('data', (d) => {
                  io.sockets.in(socket.id).emit('sshresponse', d.toString('binary'));
                }).on('close', () => {
                  ssh.end();
                });
              });
            }).on('close', () => {
              io.sockets.in(socket.id).emit('sshclosed', '');
            }).on('error', (err) => {
              if(err.message.indexOf('authentication methods failed')){
                io.sockets.in(socket.id).emit('sshauth', 'failed');
                writeLog(hostID, 'SSH:Auth Error', `SSH authentication failed for ${hosts[hostID].host}`);
              } else {
                io.sockets.in(socket.id).emit('sshresponse', '\r\n*** SSH CONNECTION ERROR: ' + err.message + ' ***\r\n');
              }
            }).connect({
              host: hosts[hostID].host,
              port: 22,
              username: authdata.username,
              password: authdata.password
            });
          }).on('disconnect', () => {
            try{
              ssh.end();
              writeLog(hostID, 'SSH:Session closed', `SSH session closed for ${hosts[hostID].host}`);
            } catch(e){
              console.log(e);
            }
            io.sockets.in(socket.id).socketsLeave(socket.id);
          });
        } else {
          io.sockets.in(socket.id).emit('sshresponse', 'Invalid host ID specified');
        }
      break;

      case (socket.handshake.headers.referer.indexOf('/ping.html') > -1):
        hostID = /\?host=(\d*)$/ig.exec(socket.handshake.headers.referer)[1];
        if(hostID in hosts){
          socket.join(socket.id);
          args = [((new RegExp('^(https?:\\/\\/)+((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|((\\d{1,3}\\.){3}\\d{1,3}))(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*(\\?[;&a-z\\d%_.~+=-]*)?(\\#[-a-z\\d_]*)?$','i').test(hosts[hostID].host)) ? new RegExp('^https?:\/\/(.*?)(?:\:|\/)','i').exec(hosts[hostID].host)[1] : hosts[hostID].host)];
          switch(os.platform()){
            case 'win32':
              bin = `${process.env.windir.toLowerCase()}\\system32\\ping.exe`;
              args.push(...['-t','-w','1000']);
              break;
          
            case 'darwin':
              bin = '/sbin/ping';
              break;
          
            case 'linux':
              bin = '/bin/ping';
              break;
          }
          const cmd = spawn(bin, args);
          writeLog(hostID, 'Ping:Start', `Live ping started ${cmd.spawnargs.join(' ')}`);
          io.sockets.in(socket.id).emit('initdata', `${cmd.spawnargs.join(' ')}`);
          cmd.stdout.on('data', (data) => {
            io.sockets.in(socket.id).emit('pingresponse', `${data}`);
          });
         
          socket.on('disconnect', () => {
            cmd.kill();
            io.sockets.in(socket.id).socketsLeave(socket.id);
          });
        } else {
          socket.emit('pingresponse', 'Invalid host ID specified');
          socket.disconnect();
        }
      break;

      default:
        socket.emit('initdata', JSON.stringify({_APPLICATION: _APPLICATION, hosts: hosts, settings: settings }));
        lastLogs = await initLastLogs();
        socket.emit('log', JSON.stringify(lastLogs)); 
        socket.on('data', async (data) => {
          console.log('received something from browser');
          console.log(data);
          switch(true){
            case (data.action == 'refreshHosts'):
              hosts = await initHosts();
              socket.emit('initdata', JSON.stringify({_APPLICATION: _APPLICATION, hosts: hosts, settings: settings }));
            break;
            
            case (data.action == 'wol'):
              let errs = [];
              broadcastIPs.forEach(broadcast =>{
                wol.wake(hosts[data.host].mac_address,{ address: broadcast, port: 7 }, (err) => {
                  if(err){
                    errs.push(err);
                  }
                });
              });
              if(errs.length > 0){
                writeLog(data.host, 'WOL:Error', `WOL error for ${hosts[data.host].host}: ${errs.join(',')}`, `An error occurred sending the WOL packet:<br />${errs.join(',')}`);
              } else {
                writeLog(data.host, 'WOL:Sent', `WOL sent for ${hosts[data.host].host}`, `WOL has been successfully sent to ${hosts[data.host].host}`);
              }
            break;
          }
        }).on('disconnect', () => {
          // todo slow ping interval when nobody is watching
          /*
          console.log('dis, connected: '+ io.engine.clientsCount);
          console.log(parseInt(settings.settings['Override Ping Interval (sec)'].value));
          if(io.engine.clientsCount === 0 && parseInt(settings.settings['Override Ping Interval (sec)'].value) > 0){
            intervals.forEach((interval) => {
              console.log(intervals.indexOf(interval));
              id = intervals.indexOf(interval);
              //console.log(interval);
              tempInterval = interval;
              intervals.splice(id, 1);
              clearInterval(interval);
              intervals[id] = setInterval(() => {
                tempInterval['_onTimeout'];
              }, (parseInt(settings.settings['Override Ping Interval (sec)']).value * 1000));
            });
          }*/
        });
    }
  });
   
  http.listen(port, () => {
    console.log('Listening on http://localhost:'+ port);
  });
}

main();

process.on('exit', () => {
  writeLog(0, 'HostMon:Server stopped', '');
});

async function pingURL(id, url){
  start = new Date().getTime();
  new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 3000 }, (res) => {
      res.on('error', (e) => {
        statusClass = 'Down';
        responseTime = 'Unreachable';
        statusCode = null;
        if(id in hostStatus && hostStatus[id] != statusClass){
          statusCode = (statusClass == 'Down') ? 'WARNING' : 'SUCCESS';
          writeLog(id, `Status:${statusClass}`, `Host status changed to ${statusClass.toLowerCase()}`,`${hosts[id].host} is ${statusClass.toLowerCase()}`,statusCode);
        }
        hostStatus[id] = statusClass;
        hosts[id].last_status = {i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode };
        data = JSON.stringify({i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode });
        io.emit('data', data);
        io.sockets.in('api').emit('data', data);
        resolve();
      }).on('data', () => {
        responseTime = (new Date().getTime() - start).toString()+'ms';
        statusCode = res.statusCode;
        statusClass = (statusCode > 499) ? 'Down' : 'Up';
        if(id in hostStatus && hostStatus[id] != statusClass){
          statusCode = (statusClass == 'Down') ? 'WARNING' : 'SUCCESS';
          writeLog(id, `Status:${statusClass}`, `Host status changed to ${statusClass.toLowerCase()}`,`${hosts[id].host} is ${statusClass.toLowerCase()}`,statusCode);
        }
        hostStatus[id] = statusClass;
        hosts[id].last_status = {i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode };
        data = JSON.stringify({i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode });
        io.emit('data', data);
        io.sockets.in('api').emit('data', data);
        resolve();
      });
    }).on('timeout', (e) => {
      statusClass = 'Down';
      responseTime = 'Timeout';
      statusCode = null;
      if(id in hostStatus && hostStatus[id] != statusClass){
        statusCode = (statusClass == 'Down') ? 'WARNING' : 'SUCCESS';
        writeLog(id, `Status:${statusClass}`, `Host status changed to ${statusClass.toLowerCase()}`,`${hosts[id].host} is ${statusClass.toLowerCase()}`,statusCode);
      }
      hostStatus[id] = statusClass;
      hosts[id].last_status = {i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode };
      data = JSON.stringify({i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode });
      io.emit('data', data);
      io.sockets.in('api').emit('data', data);
      resolve();
    }).on('error', (e) => {
      statusClass = 'Down';
      responseTime = 'Unreachable';
      statusCode = null;
      if(id in hostStatus && hostStatus[id] != statusClass){
        statusCode = (statusClass == 'Down') ? 'WARNING' : 'SUCCESS';
        writeLog(id, `Status:${statusClass}`, `Host status changed to ${statusClass.toLowerCase()}`,`${hosts[id].host} is ${statusClass.toLowerCase()}`,statusCode);
      }
      hostStatus[id] = statusClass;
      hosts[id].last_status = {i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode };
      data = JSON.stringify({i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: statusCode });
      io.emit('data', data);
      io.sockets.in('api').emit('data', data);
      resolve();
    });
    req.end();
  });
}

async function pingHost(id, host){
  const result = await ping.promise.probe(host, {
    timeout: 2,
    extra: ["-i", "2"],
  });
  if(!result.alive){
    statusClass = 'Down';
    responseTime = 'Unreachable';
  } else {
    statusClass = 'Up';
    responseTime = result.time+'ms';
  }
  if(id in hostStatus && hostStatus[id] != statusClass){
    statusCode = (statusClass == 'Down') ? 'WARNING' : 'SUCCESS';
    writeLog(id, `Status:${statusClass}`, `Host status changed to ${statusClass.toLowerCase()}`,`${hosts[id].host} is ${statusClass.toLowerCase()}`,statusCode);
  }
  hostStatus[id] = statusClass;
  hosts[id].last_status = {i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: null };
  data = JSON.stringify({i: id, t: Math.floor(new Date().getTime() / 1000), s: statusClass, r: responseTime, c: null });
  io.emit('data', data);
  io.sockets.in('api').emit('data', data);
  if(io.sockets.adapter.rooms.get(`host${id}`) !== undefined && io.sockets.adapter.rooms.get(`host${id}`).size > 0){
    io.sockets.in(`host${id}`).emit('hostdata', data);
  }
}

async function writeLog(id, action, details, notification = '', status = 'SUCCESS'){
  timeStamp = Math.round(new Date().getTime() / 1000);
  if(typeof(id) === 'number' && id > 0 && hosts[id].ext !== undefined && hosts[id].ext.logging !== undefined && hosts[id].ext.logging === 'N'){
    io.emit('bubbleNotify', notification);
    return;
  }
  try{
    result = await db.run('INSERT INTO logs (host_id, action, details, status, log_date_time) VALUES (?,?,?,?,?)',[id, action, details, status, timeStamp]);
    rowID = result.lastID;
    io.emit('log', JSON.stringify(new Array({ i: rowID, h: id, a: action, d: details, s: status, n: notification, t: timeStamp })));
  } catch(err){
    console.log(`An error occurred writing to the logs table: ${err}`);
    io.emit('log', JSON.stringify(new Array({ i: -1, h: id, a: `${action}:ERROR`, d: err, s: 'ERROR', n: notification, t: timeStamp })));
  }
}

function getHostLogs(host, page = 0){
  return new Promise(async (resolve, reject) => {
    try{
      offset = parseInt(page) * 100;
      if(host == ''){
        rows = await db.all(`SELECT * FROM logs ORDER BY log_date_time DESC LIMIT 100 OFFSET ${offset}`);
      } else {
        rows = await db.all(`SELECT * FROM logs WHERE host_id = ? ORDER BY log_date_time DESC LIMIT 100 OFFSET ${offset}`,[host]);
      }
      returnLogs = [];
      rows.forEach((row)=>{
        returnLogs.push({ i: row.id, h: row.host_id, a: row.action, d: row.details, s: row.status, n: '', t: row.log_date_time });
      });
      resolve(returnLogs); 
    } catch(err){
      reject({message: `A database error occurred: ${err}`});
    }
  });
}

function addIcon(file){
  return new Promise(async (resolve, reject) => {
    tempPath = `${__dirname}${separator}tmp${separator}${file.filename}`;
    fs.readFile(file.path, async function (err, data) {
      fs.writeFile(tempPath, data, (err) => {
        sharp(tempPath).resize(75).png({quality: 100}).toFile(`${__dirname}${separator}public${separator}images${separator}icons${separator}${file.originalname}`, async (err, info) => {
          if(!err){
            try{
              data = { name: file.originalname.replace(`.${file.originalname.split('.').pop()}`,''), imgdata: fs.readFileSync(`${__dirname}${separator}public${separator}images${separator}icons${separator}${file.originalname}`, 'base64'), mime: file.mimetype };
              timeStamp = Math.round(new Date().getTime() / 1000);
              result = await db.run('INSERT INTO icon_def (name, data, mime_type, created_date_time) VALUES (?,?,?,?)',[data.name, data.imgdata, data.mime, timeStamp]);
              rowID = result.lastID;
              data.imgdata = 'BASE64 IMAGE';
              writeLog('', 'Icon:Add', JSON.stringify(data));
              resolve({ iconID: parseInt(rowID), name: data.name });
            } catch(err){
              writeLog('', 'Icon:Add', JSON.stringify(err), '', 'ERROR');
              reject({message: `A database error occurred: ${err}`});
            }
          }
        });
      });
    });
  });
}

function resetToDefault(){
  return new Promise(async (resolve, reject) => {
    try{
      await db.run('UPDATE settings SET value=?','');
      writeLog(0, 'HostMon:ResetToDefault', '');
      resolve({ hostID: 0, message: 'Reset settings to defaults successfully' });
    } catch(err){
      writeLog(0, 'HostMon:ResetToDefault', JSON.stringify(err), '', 'ERROR');
      reject({message: `A database error occurred: ${err}`});
    }
  });
}

function purgeLogs(id){
  return new Promise(async (resolve, reject) => {
    try{
      if(id == null){
        await db.run('DELETE FROM logs');
        writeLog(0, 'HostMon:PurgeLogs', `{hostID: ${id}}`);
        resolve({ hostID: id, message: `Purged logs successfully` });
      } else {
        await db.run('DELETE FROM logs WHERE host_id = ?',[id]);
        writeLog(id, 'Host:PurgeLogs', `{hostID: ${id}}`);
        resolve({ hostID: id, message: `Purged logs for ${hosts[id].host} successfully` });
      }
    } catch(err){
      writeLog(id, 'Host:PurgeLogs', JSON.stringify(err), '', 'ERROR');
      reject({message: `A database error occurred: ${err}`});
    }
  });
}

function deleteHost(id){
  return new Promise(async (resolve, reject) => {
    try{
      await db.run('DELETE FROM hosts_extended_details WHERE host_id = ?',[id]);
      await db.run('DELETE FROM hosts WHERE id = ?',[id]);
      writeLog(id, 'Host:Delete', `{hostID: ${id}}`);
      resolve({ hostID: id, message: `Delete ${hosts[id].host} successfully` });
    } catch(err){
      writeLog(id, 'Host:Delete', JSON.stringify(err), '', 'ERROR');
      reject({message: `A database error occurred: ${err}`});
    }
  });
}

function updateSettings(_POST){
  return new Promise(async (resolve, reject) => {
    let errs = [];
    timeStamp = Math.round(new Date().getTime() / 1000);
    try{
      for(var key in _POST){
        result = db.run('UPDATE settings SET value = ?, modified_date_time = ? WHERE name = ?',[_POST[key], timeStamp, key]); 
      }
      writeLog(0, 'HostMon:Settings', JSON.stringify(_POST));
    } catch(err){
      errs.push(err);
    }

    if(errs.length > 0){
      writeLog(id, 'HostMon:Settings', `The following error(s) occurred, please try again: ${errs.join(',')}`, `The following error(s) occurred, please try again:<br />${errs.join(',')}`,'ERROR');
      reject({ message: `The following error(s) occurred, please try again: ${errs.join(',')}` });
    } else {
      resolve({ message: `Updated global settings successfully` });
    }
  });
}

function updateHostExt(id,_POST){
  return new Promise(async (resolve, reject) => {
    if(id === undefined) return;
    let errs = [];
    timeStamp = Math.round(new Date().getTime() / 1000);
    try{
      result = db.run('DELETE FROM hosts_extended_details WHERE host_id=?',[id]);
      try{
        for(var key in _POST){
          if(_POST[key] !== '' && key != 'host_id'){
            result = db.run('INSERT INTO hosts_extended_details (host_id, key, value, modified_date_time) VALUES (?,?,?,?)',[id, key, _POST[key], timeStamp]); 
          }
        }
        writeLog(id, 'Host:ExtDetails', JSON.stringify(_POST));
      } catch(err){
        errs.push(err);
      }
    } catch(err){
      errs.push(err);
    }
      
    if(errs.length > 0){
      writeLog(id, 'Host:ExtDetails', `The following error(s) occurred, please try again: ${errs.join(',')}`, `The following error(s) occurred, please try again:<br />${errs.join(',')}`,'ERROR');
      reject(errs);
    } else {
      resolve({ hostID: id, message: `Updated extended details successfully` });
    }
  });
}

function updateHost(_POST){
  return new Promise(async (resolve, reject) => {
    timeStamp = Math.round(new Date().getTime() / 1000);
    if(_POST.host_id !== ''){
      try{
        result = await db.run('UPDATE hosts SET host=?, category=?, icon_id=?, mac_address=?, notes=?, tags=?, modified_date_time=? WHERE id=?',[_POST.host, _POST.category, _POST.icon, _POST.mac_address, _POST.notes, _POST.tags, timeStamp, _POST.host_id]);
        writeLog(_POST.host_id, 'Host:Update', JSON.stringify(_POST));
        resolve({ status: 'Success', hostID: parseInt(_POST.host_id), message: `Updated ${_POST.host} successfully` }); 
      } catch(err){
        writeLog(_POST.host_id, 'Host:Update', JSON.stringify(err), '', 'ERROR');
        reject({ status: 'Error', message: `A database error occurred: ${err}`});
      } 
    } else {
      try{
        result = await db.run('INSERT INTO hosts (host, category, icon_id, mac_address, notes, tags, modified_date_time, created_date_time) VALUES (?,?,?,?,?,?,?,?)',[_POST.host, _POST.category, _POST.icon, _POST.mac_address, _POST.notes, _POST.tags, timeStamp, timeStamp]);
        rowID = result.lastID;
        writeLog(rowID, 'Host:Create', JSON.stringify(_POST));
        resolve({ hostID: parseInt(rowID), message: `Created ${_POST.host} successfully` });
      } catch(err){
        writeLog(_POST.host_id, 'Host:Create', JSON.stringify(err), '', 'ERROR');
        reject({message: `A database error occurred: ${err}`});
      }
    }
  });
}

app.locals.buildSelect = function (field, selected){
  switch(field){
    case 'category':
      r = `<input type="text" name="category" id="category" list="categories" value="${selected}" /> \
        <datalist id="categories">`;
        settings.categories.forEach((category) => {
          r += `<option value="${category}">`;
        });
        r += '</datalist>';
        return r;
    break;

    case 'icon':
      r = '<select name="icon" id="icon" REQUIRED> \
        <option value=""></option>';
        icons.forEach((icon, index) => {
          selText = (index == selected) ? ' SELECTED' : '';
          r += `<option value="${index}"${selText}>${icon}</option>`;
        });
        r += `</select>`;
        return r;
    break;
  }
}