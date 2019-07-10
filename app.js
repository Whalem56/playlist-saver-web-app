// fields=tracks.items.track(name,artists)

const express = require('express');
const request = require('request');
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
let numPlaylists = -1;

let output = '';

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


app.get('/getPlaylists', async (req, res) => {
  console.log("insid getPlaylists endpoint!!!!!!");
  let options = {
    url: 'https://api.spotify.com/v1/me/playlists',
    headers: { 'Authorization': 'Bearer ' + access_token },
    qs: {
      offset: 0,
      limit: 50
    },
    json: true,
  }
  console.log('about to make request');

  await request.get(options, async (error, response, body) => {
    console.log('response.statusCode', response.statusCode);
    proccessPlaylistData(body.items);

    options.qs.offset += options.qs.limit;
    numPlaylists = body.total;

    while (options.qs.offset < numPlaylists ) {

     await request.get(options, (error, response, body) => {
        proccessPlaylistData(body.items);        
        // console.log('============idToPlaylistMap============');
         console.log(idToPlaylistMap);
        // console.log('length of map', idToPlaylistMap.length);
      });

      options.qs.offset += options.qs.limit;
    }
  });
  res.redirect('/getTracks');
});


app.get('/getTracks', (req, res) => {
  console.log("inside getTracks endpoint!!!!!!");
  console.log('numPlaylists', numPlaylists);
  console.log('idToPlaylistMap.length', idToPlaylistMap.length);
  // Wait until done querying for playslists
  while(numPlaylists != idToPlaylistMap.length) {}
  console.log(idToPlaylistMap);
  // request.get(options, (error, response, body) {

  // }
  // res.download(filePathAndName, clientFileName);
  res.redirect('/');

});

const proccessPlaylistData = (items) => {
    const currMap = items.map((playlist) => {
      let pair = {};
      pair.id = playlist.id;
      pair.name = playlist.name;
      return pair;
    });

    idToPlaylistMap = idToPlaylistMap.concat(currMap);
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