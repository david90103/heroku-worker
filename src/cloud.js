const fs = require('fs');
const {google} = require('googleapis');
const database = require('./database.js');

let drive;

exports.init = function () {
  const credentials = JSON.parse(process.env.googleauth);
  const clientSecret = credentials.installed.client_secret;
  const clientId = credentials.installed.client_id;
  const redirectUrl = credentials.installed.redirect_uris[0];
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
  oauth2Client.credentials = JSON.parse(process.env.token_downloader);
  drive = google.drive({
    version: 'v3',
    auth: oauth2Client
  });
}

exports.upload = function (path, name, folder, callback) {
  let filepath = path;

  if (fs.existsSync(filepath) === false) {
    callback('File does not exists: ' + path);
    return;
  }
  let fileMetadata = {
    name: name,
    parents: [folder]
  };
  let media = {
    // mimeType: type, // 'video/mp4', 'video/x-flv'
    body: fs.createReadStream(filepath)
  };

  drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id'
  }, function (err, file) {
    if (err) {
      console.log('[x] Upload error at: file=%s, name=%s\n', path, name);
      console.error(err);
      fs.appendFile('error.txt', '[x] Upload error at: file=' + path + ', name=' + name + '\n', (e) => {
        if (e) console.log(e);
      });
      fs.appendFile('error.txt', err, (e) => {
        if (e) console.log(e);
      });
    } else {
      console.log('Upload finished. File Id: ', file.data.id);
      fs.unlink(filepath, () => { }); // delete file after upload
    }
    callback();
  });
}

// Upload file using stream from torrent-stream package
exports.uploadStream = function (stream, name, folder, callback) {
  let fileMetadata = {
    name: name,
    parents: [folder]
  };
  let media = {
    // mimeType: type, // 'video/mp4', 'video/x-flv'
    body: stream
  };

  drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id'
  }, function (err, file) {
    if (err) {
      console.log('[x] Upload error at: name=%s\n', name);
      console.error(err);
      fs.appendFile('error.txt', '[x] Upload error at: name=' + name + '\n', (e) => {
        if (e) console.log(e);
      });
      fs.appendFile('error.txt', err, (e) => {
        if (e) console.log(e);
      });
      callback(err);
    } else {
      console.log('Upload finished. File Id: ', file.data.id);
      callback();
    }
  });
}