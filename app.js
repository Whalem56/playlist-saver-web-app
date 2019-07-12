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
  console.log('state: ', state);
  console.log('storedState: ', storedState);
  console.log('req.cookies: ', req.cookies);

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
        console.log("access_token: ", access_token);
        console.log("refresh_token: ", refresh_token);
        res.redirect('/getPlaylists');
      }
    });
  } else {
    console.log('State mismatch');
    res.redirect('/');
  }

});


await app.get('/getPlaylists', async (req, res) => {

  // Get playlists. Store in global: idToPlaylistMap
  await getPlaylists();

  // Get tracks associated with each playlist and stores in 
  // global: playlistTracksMapList. Reads from global : idToPlaylistMap
  await getTracks();

  console.log('listOfPlayToTracks', listOfPlayToTracks);

  let output = getOutput();

  await fs.writeFile(__dirname +'/playlist.txt', output, (err) => {
    if (err) {
      console.log(err);
    } else {
      console.log('The file was saved!');
    }
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
  await rp.get(options, async (error, response, body) => {
    //console.log('response.statusCode', response.statusCode);
    proccessPlaylistData(body.items);

    numPlaylists = body.total;
  });

  options.qs.offset += options.qs.limit;

  // Continue making requests requests for playlists if limit is less than 
  // the amount of playlists
  while (options.qs.offset < numPlaylists) {
    await rp.get(options, async (error, response, body) => {
      proccessPlaylistData(body.items);
    });

    options.qs.offset += options.qs.limit;
  }
}

const proccessPlaylistData = (items) => {

  const currMap = items.map((playlist) => {
    let pair = {};
    pair.id = playlist.id;
    pair.name = playlist.name;
    return pair;
  });

  idToPlaylistMap = idToPlaylistMap.concat(currMap);
}

const getTracks = async () => {
  console.log('inside getTracks()');
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

  await idToPlaylistMap.forEach(async (pair) => {
    const playlistId = pair.id;
    const playlistName = pair.name;
    let numTracks = 0;
    options.offset = 0;
    options.url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    
    await rp.get(options, async (error, response, body) => {
      if (error) {
        console.log(error);
      }
      processTrackData(playlistName, body.items);
      numTracks = body.total;
    });

    console.log('numTracks: ', numTracks);

    options.qs.offset += options.qs.limit;

    // Continue making requests for tracks if limit is less than 
    // the amount of playlists
    while (options.qs.offset < numTracks) {
      await rp.get(options, async (error, response, body) => {
        if (error) {
          console.log(error);
        }
        console.log(response.statusCode);
        processTrackData(playlistName, body.items);
      });

      options.qs.offset += options.qs.limit;
    }
  });

  console.log('Inside getTracks(). listOfPlayToTracks: \n', listOfPlayToTracks);

  // TESTING ONLY
  // options.url = `https://api.spotify.com/v1/playlists/6JTPtzzATO79FeNCfdz8rV/tracks`;
  // await rp.get(options, async (error, response, body) => {
  //   const playlistName = 'Sublime Playlist';
  //   processTrackData(playlistName, body.items);
  // });
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
  console.log('listOfPlayToTracks: \n', listOfPlayToTracks);
  for (let playlist in listOfPlayToTracks) {
    if (listOfPlayToTracks.hasOwnProperty(playlist)) {
      output += `${playlist}:\n\n`;
      console.log(listOfPlayToTracks[playlist].length);
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