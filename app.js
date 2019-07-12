const fs = require('fs');
const express = require('express');
const request = require('request');
const rp = require('request-promise')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const querystring = require('querystring');
const path = require('path');
const config = require('./config');

const ip = config.hostIP;
const portNumber = config.portNumber;
const client_id = config.clientId;
const client_secret = config.clientSecret;
const redirect_uri = 'http://' + ip + ':' + portNumber + '/authenticate';

const cookieStateKey = 'spotify_auth_state';
const cookieStateLength = 16;

let access_token = null;
let refresh_token = null;

let idToPlaylistMap = [];
let listOfPlayToTracks = {};

let app = express();

app.use(express.static(__dirname + '/public'))
  .use(cors())
  .use(cookieParser());

//app.timeout = 1000 * 60 * 10;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/login', (req, res) => {
  const state = generateRandomString(cookieStateLength);
  res.cookie(cookieStateKey, state);

  const scope = 'playlist-read-private playlist-read-collaborative';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      redirect_uri: redirect_uri,
      scope: scope,
      state: state,
    }));
});


// Check state parameter on req. Respond by asking for refresh and access tokens
app.get('/authenticate', (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[cookieStateKey] : null;

  if (state !== null && state === storedState) {
    const authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirect_uri,
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    }
    request.post(authOptions, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        access_token = body.access_token;
        refresh_token = body.refresh_token;
        res.redirect('/getPlaylists');
      }
    });
  } else {
    console.log('State mismatch');
    res.redirect('/');
  }
});


app.get('/getPlaylists', async (req, res) => {

  let result;
  // Get playlists. Store in global: idToPlaylistMap
  result = await getPlaylists();

  // Get tracks associated with each playlist and stores in 
  // global: playlistTracksMapList. Reads from global : idToPlaylistMap
  result = await getTracks();

  let output = getOutput();

  const file = path.join(__dirname,'/public', '/playlist.txt');
  console.log('file: ', file);
  fs.writeFileSync(file, output);
  res.download(file, (err) => {
    if (err) {
      console.log(err);
    }
    console.log('res.headersSent: ', res.headersSent);
  });
  res.redirect('/');
});


const getPlaylists = async () => {

  let options = {
    url: 'https://api.spotify.com/v1/me/playlists',
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    qs: {
      offset: 0,
      limit: 50
    },
    json: true,
  }

  let numPlaylists = -1;

  // Make first request for playlists. 
  let body = await rp.get(options);
  processPlaylistData(body.items);
  numPlaylists = body.total;
  options.qs.offset += options.qs.limit;

  // Continue making requests for playlists if limit is less than 
  // the amount of playlists
  while (options.qs.offset < numPlaylists) {
    body = await rp.get(options);
    processPlaylistData(body.items);
    options.qs.offset += options.qs.limit;
  }
}

const getTracks = async () => {
  let options = {
    headers: {
      'Authorization': 'Bearer ' + access_token
    },
    qs: {
      fields: 'total,items(track(name,artists))',
      offset: 0,
      limit: 100
    },
    json: true,
  }

  for (let i = 0; i < idToPlaylistMap.length; i++) {
    const playlistId = idToPlaylistMap[i].id;
    const playlistName = idToPlaylistMap[i].name;

    options.qs.offset = 0;
    options.url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    //console.log('options: \n', options);
    let body = await rp.get(options);
    const numTracks = body.total;
    processTrackData(playlistName, body.items);
    options.qs.offset += options.qs.limit;

    // Continue making requests for tracks if limit is less than 
    // the amount of playlists
    while (options.qs.offset < numTracks) {
      body = await rp.get(options);
      processTrackData(playlistName, body.items);
      options.qs.offset += options.qs.limit;
    }
  }
}

const processPlaylistData = (items) => {

  const currMap = items.map((playlist) => {
    let pair = {};
    pair.id = playlist.id;
    pair.name = playlist.name;
    return pair;
  });

  idToPlaylistMap = idToPlaylistMap.concat(currMap);
}

const processTrackData = (playlistName, items) => {
  const parsedTracks = items.map((item) => {

    return {
      'trackName': item.track.name,
      'trackArtist': item.track.artists[0].name
    };
  });

  if (listOfPlayToTracks.hasOwnProperty(playlistName)) {
    listOfPlayToTracks[playlistName] = listOfPlayToTracks[playlistName].concat(parsedTracks);
  } else {
    listOfPlayToTracks[playlistName] = parsedTracks;
  }
}

const getOutput = () => {
  let output = '';
  for (let playlist in listOfPlayToTracks) {
    if (listOfPlayToTracks.hasOwnProperty(playlist)) {
      output += `\n${playlist}:\n\n`;
      listOfPlayToTracks[playlist].forEach((track) => {
        output += `\t${track.trackName}  -  ${track.trackArtist}\n`;
      });
    }
  }

  return output;
}

// Generate random string of numbers and letters. Use this to for state.
const generateRandomString = (length) => {
  let result = '';
  const possibleChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < length; i++) {
    result += possibleChars.charAt(Math.floor(Math.random() * possibleChars.length));
  }

  return result;
}

app.listen(portNumber, () => console.log(`App is listening on port: ${portNumber}`));