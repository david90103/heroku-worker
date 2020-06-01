process.env.NTBA_FIX_319 = 1; // https://github.com/yagop/node-telegram-bot-api/issues/319
const WebTorrent = require('webtorrent');
const torrentStream = require('torrent-stream');
const youtubedl = require('youtube-dl');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const execFile = require('child_process').execFile;
const glob = require('glob');
const async = require('async');
const cloud = require('./cloud');
const database = require('./database');
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
const cycleTime = new Date().toLocaleString();
// WebTorrent client
let client = new WebTorrent();
// Torrent-stream clients
let streamClients = [];
let blacklist = getBlacklist(); // TODO Rewrite

cloud.init();

app.use(cookieParser());
app.use(require('body-parser').urlencoded({
  extended: true
}));
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, '../public')]);
app.use(express.static(path.join(__dirname, '../public')));

client.on('error', function (err) {
  log('Torrent client error: ' + err.message);
})

function verifyToken(req, res, next) {
  // skip if the request is from localhost or access token is valid
  if (req.headers.host.substring(0, 9) === '127.0.0.1' ||
      req.body.access_token === process.env.API_ACCESS_TOKEN) next();
  else res.send('ダメダメ');
}

app.get('/api/status', verifyToken, function (req, res) {
  database.getDownloading((data) => {
    res.json(data);
  });
});

app.get('/restart', verifyToken, function (req, res) {
  log('Clear all peers and pause for 3 seconds.');
  for (let i = 0; i < client.torrents.length; i++) {
    let l = Object.keys(client.torrents[i]._peers);
    for (let j = 0; j < l.length; j++) client.torrents[i].removePeer(l[j]);
    client.torrents[i].pause();
  }
  setTimeout(() => {
    for (let i = 0; i < client.torrents.length; i++) {
      client.torrents[i].resume();
    }
  }, 3000);
  res.send('All peers cleared. Restart in 3 seconds...');
});

app.get('/blacklist', verifyToken, function (req, res) {
  blacklist = getBlacklist();
  res.send('Update blacklist. (Before : ' + blacklist.toString() + ')');
  // FIXME TypeError: Cannot read property 'toString' of undefined
});

app.post('/addTorrentStream', verifyToken, function (req, res) {
  if (req.body.folder === 'dmhy') addTorrentStream(req.body.link, 'dmhy');
  else addTorrentStream(req.body.link, req.body.directory);
  res.redirect('/ff');
});

app.post('/addTorrent', verifyToken, function (req, res) {
  if (req.body.folder === 'dmhy') addTorrent(req.body.link, 'dmhy');
  else addTorrent(req.body.link, req.body.directory);
  res.redirect('/f');
});

app.post('/addYoutube', verifyToken, function (req, res) {
  addVideo(req.body.link, req.body.directory);
  res.redirect('/y');
});

app.post('/addBilibili', verifyToken, function (req, res) {
  addVideo(req.body.link, req.body.directory);
  res.redirect('/b');
});

app.post('/addDmg', verifyToken, function (req, res) {
  let child = execFile('python', [__dirname + '/util/extractor.py', req.body.link], {
    maxBuffer: 1024 * 4000
  }, function (err, stdout, stderr) {
    res.send(stdout + stderr);
  });
});

app.get('/add', verifyToken, function (req, res) {
  if (!req.query.magnet) res.send("ダメダメ");
  else {
    addTorrent(req.query.magnet);
    res.send("Add torrent magnet: " + req.query.magnet);
  }
});

app.get('/', function (req, res) {
  let data = {
    webtorrent: {
      length: client.torrents.length,
      infohash: [],
      downloaded: [],
      uploaded: [],
      peers: [],
      downSpeed: [],
      upSpeed: [],
      progress: [],
    },
    streams: {
      length: streamClients.length,
      infohash: [],
      peers: [],
      path: [],
      size: [],
      downSpeed: [],
      upSpeed: [],
      downloaded: [],
      uploaded: [],
      progress: [],
      files: [],
      startTime: [],
    },
    cycleTime: cycleTime,
  }
  if (client.torrents.length > 0) {
    client.torrents.forEach(torrent => {
      data.webtorrent.infohash.push(torrent.infoHash);
      data.webtorrent.downloaded.push(prettyBytes(torrent.downloaded));
      data.webtorrent.uploaded.push(prettyBytes(torrent.uploaded));
      data.webtorrent.peers.push(torrent.numPeers);
      data.webtorrent.downSpeed.push(prettyBytes(torrent.downloadSpeed));
      data.webtorrent.upSpeed.push(prettyBytes(torrent.uploadSpeed));
      data.webtorrent.progress.push(Number.parseFloat(Math.round(torrent.progress * 100 * 100) / 100).toFixed(1));
    })
  }
  streamClients.forEach(t => {
    data.streams.infohash.push(t.infoHash);
    data.streams.peers.push(t.swarm.wires.length);
    data.streams.path.push(t.path);
    data.streams.size.push((t.torrent) ? prettyBytes(t.torrent.length) : '--');
    data.streams.downSpeed.push(prettyBytes(t.swarm.downloadSpeed()));
    data.streams.upSpeed.push(prettyBytes(t.swarm.uploadSpeed()));
    data.streams.downloaded.push(prettyBytes(t.swarm.downloaded));
    data.streams.uploaded.push(prettyBytes(t.swarm.uploaded));
    data.streams.progress.push(Number.parseFloat((t.swarm.downloaded / t.torrent.length) * 100).toFixed(1));
    data.streams.startTime.push(t.startTime);
    data.streams.files.push([t.files.map(v => {
      return v.name + ' (' + prettyBytes(v.length).toString() + ')';
    })]);
  });

  res.render('status', {
    data: data
  });
});

app.get('*', function (req, res) {
  res.redirect('/');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log(`Listening on ${port}`, false);
  // retryDownloads();
});

/**
 * Retry failed or unfinished downloads in the previos dyno cycle
 */
// function retryDownloads() {
//   database.getDownloading((data) => {
//     for (let d of data) {
//       // Retry only once
//       database.getRetriedDownloading(d.link, (r) => {
//         // Set previous download to failed
//         database.finishDownload(d.link, false, () => {
//           if (r.length == 0) {
//             if (d.type == 1) {
//               if (d.stream) addTorrentStream(d.link, d.folder, true);
//               else addTorrent(d.link, d.folder, true);
//             } else {
//               addVideo(d.link, d.folder, true);
//             }
//           } else {
//             log('Failed to download: ' + d.link);
//           }
//         });
//       });
//     }
//   });
// }

/**
 * New download method: Stream torrent to google drive using torrent-stream package
 */
function addTorrentStream(magnet, directory_id = 'bt', is_retry = false) {
  /**
   * TODO Verify magnet link from requrest
   * Only magnet link is allowed, no torrent file or link.
   * If magnet is not valid, it won't throw error.
   * This download will timeout when heroku dyno cycles.
   */
  let engine;
  try {
    engine = torrentStream(magnet, {uploads: 0});
    engine.startTime = new Date().toLocaleString();
  } catch (e) {
    log("Invalid torrent identifier: " + magnet);
    return;
  }
  log("Start download: " + magnet + ".");
  database.newDownload(magnet, 1, directory_id, false, is_retry, true);
  streamClients.push(engine);
  engine.on('ready', function() {
      async.eachLimit(engine.files, 3, (elem, callback) => {
        // Check if file is ad
        for (let b of blacklist) {
          if (elem.name.includes(b)) {
            return callback();
          }
        }
        cloud.uploadStream(elem.createReadStream(), elem.name, directory_id, (e) => {
          if (e) log('Torrent stream upload ERROR: ' + magnet + '. File: ' + elem.name);
          else log('Torrent stream upload success: ' + magnet + '. File: ' + elem.name);
          callback();
        });
      }, (err) => {
        /**
         * TODO Catch error while streaming 
         * If error occurs when streaming, it will be ignore.
         * For example google drive upload api timeout.
         */
        // Remove torrent client from list
        const idx = streamClients.findIndex(v => {
          return (v.infoHash === engine.infoHash) && (v.startTime === engine.startTime);
        });
        streamClients.splice(idx, 1);
        // And destroy it
        engine.destroy();
        // Mark this torrent as done in database
        database.finishDownload(magnet);
      });
  });
}

function addTorrent(magnet, directory_id = 'bt', is_retry = false) {
  let folder = magnet.replace(/\//g, '');
  database.newDownload(magnet, 1, directory_id, false, is_retry);

  if (!fs.existsSync(__dirname + "/" + folder + "/")) {
    try {
      fs.mkdirSync(__dirname + "/" + folder + "/");
    } catch (err) {
      database.finishDownload(magnet, false);
      console.error('Make folder error: ' + err);
    }
  }

  client.add(magnet, {
    path: __dirname + "/" + folder + "/"
  }, function (torrent) {
    log("Start download: " + magnet + ".");

    torrent.on('error', function (err) {
      database.finishDownload(magnet, false);
      console.error('Torrent error: ' + err.message);
    });

    torrent.on('done', function () {
      let hash = torrent.infoHash;
      let filelist = [];
      client.remove(torrent.infoHash);
      glob(__dirname + '/' + folder + "/**/*.@(mp4|flv|mkv|avi|m2ts|iso|srt|sub|ssa|exe|7z|zip)", {}, function (err, files) {
        log('Torrent download finished, start upload: ' + hash + '\n----\nGot files: ' + files);
        files.forEach(file => {
          let f = {
            'path': '',
            'name': ''
          }
          f.path = __dirname + '/' + folder + '/' + file.substring(file.indexOf(folder) + folder.length + 1);
          f.name = f.path.substring(f.path.lastIndexOf('/') + 1);
          let isAd = false;
          for (let i = 0; i < blacklist.length; i++)
            if (f.name.includes(blacklist[i])) isAd = true;
          if (isAd) {
            log('Found ad: ' + f.name);
            rimraf(f.path, () => { });
          }
          else {
            filelist.push(f);
          }
        });
        async.eachLimit(filelist, 3, (elem, callback) => {
          cloud.upload(elem.path, elem.name, directory_id, (e) => {
            if (e) log(e);
            else rimraf(elem.path, () => { });
            callback();
          });
        }, (err) => {
          database.finishDownload(magnet);
          rimraf(__dirname + '/' + folder, () => { });
        });
      });
    });
  });
}

function addVideo(url, directory_id, is_retry) {
  log('Start download: ' + url + '.');
  database.newDownload(url, 2, directory_id, false, is_retry);

  youtubedl.exec(url, ['-f', 'bestvideo+bestaudio/best', '-o', '%(title)s.mp4'], {
    maxBuffer: 4000 * 1024
  }, function exec(err, output) {
    if (err) {
      database.finishDownload(url, false);
      log(err);
    } else {
      // get realname of video
      youtubedl.exec(url, ['--get-filename', '-o', '%(title)s.mp4'], {}, function exec(err, output) {
        let fileName = output[0];
        let path = process.env.HOME + '/' + fileName;
        // check if file merged by youtube-dl
        // https://github.com/ytdl-org/youtube-dl/issues/5710
        if (!fs.existsSync(path)) {
          fileName = fileName.replace(/.flv|.webm|.mp4/, '.mkv')
          path = process.env.HOME + '/' + fileName;
        }

        cloud.upload(path, fileName, directory_id || 'bt', (e) => {
          if (e) {
            database.finishDownload(url, false);
            log(e);
          }
          else {
            database.finishDownload(url);
            log('Video file: ' + fileName + ' uploaded.');
            rimraf(path, () => { });
          }
        });
      });
    }
  });
}

function getBlacklist() {
  database.find("blacklist", (d) => {
    blacklist = d.words;
  });
}

function prettyBytes(num) {
  let exponent, unit, neg = num < 0,
    units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  if (neg) num = -num
  if (num < 1) return (neg ? '-' : '') + num + ' B'
  exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1)
  num = Number((num / Math.pow(1000, exponent)).toFixed(2))
  unit = units[exponent]
  return (neg ? '-' : '') + num + ' ' + unit
}

function log(t) {
  console.log("[Downloader] " + t);
}