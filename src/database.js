const MongoClient = require('mongodb').MongoClient;
const moment = require('moment');


function connect(collName, callback) {
  let collection;
  const dbName = "heroku";

  MongoClient.connect(process.env.MONGOURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }, function (err, client) {
    if (err) throw err;
    collection = client.db(dbName).collection(collName);
    callback(client, collection);
  });
}

exports.getConfig = (target, callback) => {
  connect("config", (client, collection) => {
    collection.find({
      key: target
    }).limit(2).toArray(function (err, docs) {
      client.close();
      callback(err, docs[0].value);
    });
  });
}

exports.find = (target, callback) => {
  connect("cloud", (client, collection) => {
    collection.find({
      info: target
    }).limit(2).toArray(function (err, docs) {
      client.close();
      callback(docs[0]);
    });
  });
}

exports.getDownloading = (callback) => {
  connect(process.env.WORKER_ID, (client, collection) => {
    collection.find({
      finished: false
    }).toArray(function (err, docs) {
      client.close();
      callback(docs);
    });
  });
}

exports.getRetriedDownloading = (link, callback) => {
  connect(process.env.WORKER_ID, (client, collection) => {
    collection.find({
      link: link,
      finished: false,
      retry: true
    }).toArray(function (err, docs) {
      client.close();
      callback(docs);
    });
  });
}

/**
 * Add a new download record to the database.
 * 
 * @param {String} link Link of video or torrent
 * @param {Number} type Download type: 1 for torrent, 2 for video
 * @param {string} folder Upload folder of google drive
 * @param {Boolean} trackProgress Track download progress
 * @param {Boolean} is_retry If this is a retry of failed download
 * @param {Boolean} is_stream If this is a download using torrent-stream package
 */
exports.newDownload = (link, type, folder, trackProgress = false, is_retry = false, is_stream = false) => {
  connect(process.env.WORKER_ID, (client, collection) => {
    collection.insertOne({
      link: link, // magnet or url of the video
      progress: 0,
      type: type, // 1: torrent, 2: video
      track: trackProgress, // boolean
      stream: is_stream, // torrent-stream download method
      retry: is_retry,
      folder: folder,
      startTime: moment().format('Y-MM-DD HH:mm:ss'),
      endTime: '',
      success: false,
      finished: false,
    }, function (err, r) {
        client.close();
    });
  });
}

exports.finishDownload = (link, success = true, callback) => {
  connect(process.env.WORKER_ID, (client, collection) => {
    collection.updateOne({
      link: link,
      finished: false,
    }, {
        $set: {
          finished: true,
          progress: success ? 100 : 0,
          success: success,
          endTime:moment().format('Y-MM-DD HH:mm:ss'),
        }
      }, function (err, r) {
        client.close();
        if (callback) callback();
      });
  });
}