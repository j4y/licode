/*global require, __dirname, console*/
var express = require('express'),
    bodyParser = require('body-parser'),
    errorhandler = require('errorhandler'),
    morgan = require('morgan'),
    net = require('net'),
    N = require('./nuve'),
    fs = require("fs"),
    https = require("https"),
    config = require('./../../licode_config');


var app = express();

// app.configure ya no existe
"use strict";
app.use(errorhandler({
    dumpExceptions: true,
    showStack: true
}));
app.use(morgan('dev'));
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));


N.API.init(config.nuve.superserviceID, config.nuve.superserviceKey, 'http://localhost:3000/');

var myRoom;

N.API.getRooms(function(roomlist) {
    "use strict";
    var rooms = JSON.parse(roomlist);
    console.log(rooms.length); //check and see if one of these rooms is 'basicExampleRoom'
    for (var room in rooms) {
        if (rooms[room].name === 'basicExampleRoom'){
            myRoom = rooms[room]._id;
        }
    }
    if (!myRoom) {
        N.API.createRoom('basicExampleRoom', function(roomID) {
            myRoom = roomID._id;
            console.log('Created room ', myRoom);
        });
    } else {
        console.log('Using room', myRoom);
    }
});


app.post('/createToken/', function(req, res) {
    "use strict";
    var room = myRoom,
        username = req.body.username,
        role = req.body.role;
    N.API.createToken(room, username, role, function(token) {
        console.log(token);
        res.send(token);
    });
});


app.use(function(req, res, next) {
    "use strict";
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.header('Access-Control-Allow-Headers', 'origin, content-type');
    if (req.method == 'OPTIONS') {
        res.send(200);
    } else {
        next();
    }
});


app.listen(3001);
