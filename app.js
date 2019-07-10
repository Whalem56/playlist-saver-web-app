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

let access_token;
let refresh_token;

let app = express();

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
  //const state = req.query.state || null;
  //const storedState = req.cookies ? req.cookies[stateKey] : null;

  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      grant_type: 'authorization_code'
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
    }
    console.log(error);
    console.log(response.statusCode);
    //console.log(response);
    //console.log(body);
    console.log(access_token);
    console.log(refresh_token);
    res.redirect('/');
  });
});

// Generate random string of numbers and letters. Use this to for state.
const generateRandomString = (length) => {
  let result = '';
  const possibleChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < length; i++) {
    result += possibleChars.charAt(Math.floor(Math.random() * possibleChars.length));
  }

  return result;
}

app.use(express.static(__dirname + '/public'))
  .use(cors())
  .use(cookieParser());

app.listen(portNumber, () => console.log(`App is listening on port: ${portNumber}`));