/* Load the HTTP library */
const http = require('http');
const express = require('express');
const request = require('request');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const client_id = '';
const client_secret = '';
const redirect_uri = '';

const cookieStateKey = 'spotify_auth_state';
const portNumber = 9000;

let app = express();
app.use(express.static(__dirname + '/public'));


app.get('/login', (req, res) => {
  res.send('Hello world!');
});



app.get('/callback', (req, res) => {

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

app.listen(portNumber, () => console.log(`App is listening on port: ${portNumber}`));