const fs = require('fs');
const express = require('express');
const request = require('request');
const rp = require('request-promise');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const querystring = require('querystring');
const path = require('path');
const config = require('./config');

const ip = config.hostIP;
const portNumber = process.env.PORT || config.portNumber;
const client_id = config.clientId;
const client_secret = config.clientSecret;
const redirect_uri = config.url + 'authenticate';
console.log('url: ', config.url);
console.log('redirect_uri: ', redirect_uri);

// Cookies values
const cookie_access_token = 'spotify_access_token';
const cookie_auth_state = 'spotify_auth_state';
const auth_state_length = 16;

let app = express();

/*
 * Middleware
 */
app.use(cors());
app.use(cookieParser());
app.use(express.static(__dirname + '/public'));

/*
 * End Points
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/authenticated', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'authenticated.html'));
});


app.get('/login', (req, res) => {
  const state = generateRandomString(auth_state_length);
  res.cookie(cookie_auth_state, state);

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
  const storedState = req.cookies ? req.cookies[cookie_auth_state] : null;

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
        // SUCCESS
        res.cookie(cookie_access_token, body.access_token);
        return res.status(200).redirect('/authenticated');
      } else {
        if (error) {
          console.log(response.statusCode);
          console.log(error);
          return res.status(400).redirect('/');
        }
      }
    });
  } else {
    console.log('State mismatch');
    res.status(400).redirect('/');
  }
});


app.get('/getPlaylists', async (req, res) => {
  const access_token = req.cookies[cookie_access_token];
  if (!access_token) {
    console.log('Inside endpoint: getPlaylists.\n No cookie');
    return res.redirect(400, '/');
  }

  try {
    // Get playlists
    const idPlaylistMap = await getPlaylists(access_token);

    // Get tracks associated with each playlist
    const playlistTrackMap = await getTracks(idPlaylistMap, access_token);

    // Generate output to write to file
    const output = getOutput(playlistTrackMap);

    const file = path.join(__dirname, '/public', '/playlist.txt');

    fs.writeFileSync(file, output, {
      flag: 'w+'
    });
  } catch (err) {
    console.log(err);
    return res.redirect(400, '/');
  }

  res.status(200).end();
});


app.get('*', (req, res) => {
  res.redirect('/');
});

/*
 * Helper Functions 
 */
const getPlaylists = async (access_token) => {
  let idPlaylistMap = [];

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
  idPlaylistMap = processPlaylistData(idPlaylistMap, body.items);
  numPlaylists = body.total;
  options.qs.offset += options.qs.limit;

  // Continue making requests for playlists if limit is less than 
  // the amount of playlists
  while (options.qs.offset < numPlaylists) {
    body = await rp.get(options);
    idPlaylistMap = processPlaylistData(idPlaylistMap, body.items);
    options.qs.offset += options.qs.limit;
  }

  return idPlaylistMap;
}

const getTracks = async (idPlaylistMap, access_token) => {
  let playlistTrackMap = {};

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

  for (let i = 0; i < idPlaylistMap.length; i++) {
    const playlistId = idPlaylistMap[i].id;
    const playlistName = idPlaylistMap[i].name;

    options.qs.offset = 0;
    options.url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    let body = await rp.get(options);
    const numTracks = body.total;
    processTrackData(playlistTrackMap, playlistName, body.items);
    options.qs.offset += options.qs.limit;

    // Continue making requests for tracks if limit is less than 
    // the amount of playlists
    while (options.qs.offset < numTracks) {
      body = await rp.get(options);
      processTrackData(playlistTrackMap, playlistName, body.items);
      options.qs.offset += options.qs.limit;
    }
  }

  return playlistTrackMap;
}

const processPlaylistData = (idPlaylistMap, items) => {

  const currMap = items.map((playlist) => {
    let pair = {};
    pair.id = playlist.id;
    pair.name = playlist.name;
    return pair;
  });

  return idPlaylistMap.concat(currMap);
}

const processTrackData = (playlistTrackMap, playlistName, items) => {
  const parsedTracks = items.map((item) => {

    return {
      'trackName': item.track.name,
      'trackArtist': item.track.artists[0].name
    };
  });

  if (playlistTrackMap.hasOwnProperty(playlistName)) {
    playlistTrackMap[playlistName] = playlistTrackMap[playlistName].concat(parsedTracks);
  } else {
    playlistTrackMap[playlistName] = parsedTracks;
  }
}

const getOutput = (playlistTrackMap) => {
  let output = '';
  for (let playlist in playlistTrackMap) {
    if (playlistTrackMap.hasOwnProperty(playlist)) {
      output += `\n${playlist}:\n\n`;
      playlistTrackMap[playlist].forEach((track) => {
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