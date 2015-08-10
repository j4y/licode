/*global require, logger. setInterval, clearInterval, Buffer, exports*/
var crypto = require('crypto');
var ST = require('./Stream');
var http = require('http');
var affdex = require('affdex-licode');
var server = http.createServer();
var io = require('socket.io').listen(server, {log:false});
var config = require('./../../licode_config');
var Permission = require('./permission');
var Getopt = require('node-getopt');

// Configuration default values
GLOBAL.config = config || {};
GLOBAL.config.erizoController = GLOBAL.config.erizoController || {};
GLOBAL.config.erizoController.stunServerUrl = GLOBAL.config.erizoController.stunServerUrl || 'stun:stun.l.google.com:19302';
GLOBAL.config.erizoController.defaultVideoBW = GLOBAL.config.erizoController.defaultVideoBW || 300;
GLOBAL.config.erizoController.maxVideoBW = GLOBAL.config.erizoController.maxVideoBW || 300;
GLOBAL.config.erizoController.publicIP = GLOBAL.config.erizoController.publicIP || '';
GLOBAL.config.erizoController.hostname = GLOBAL.config.erizoController.hostname|| '';
GLOBAL.config.erizoController.port = GLOBAL.config.erizoController.port || 8080;
GLOBAL.config.erizoController.ssl = GLOBAL.config.erizoController.ssl || false;
GLOBAL.config.erizoController.listen_port = GLOBAL.config.erizoController.listen_port || 8080;
GLOBAL.config.erizoController.listen_ssl = GLOBAL.config.erizoController.listen_ssl || false;
GLOBAL.config.erizoController.turnServer = GLOBAL.config.erizoController.turnServer || undefined;
if (config.erizoController.turnServer !== undefined) {
    GLOBAL.config.erizoController.turnServer.url = GLOBAL.config.erizoController.turnServer.url || '';
    GLOBAL.config.erizoController.turnServer.username = GLOBAL.config.erizoController.turnServer.username || '';
    GLOBAL.config.erizoController.turnServer.password = GLOBAL.config.erizoController.turnServer.password || '';
}
GLOBAL.config.erizoController.warning_n_rooms = GLOBAL.config.erizoController.warning_n_rooms || 15;
GLOBAL.config.erizoController.limit_n_rooms = GLOBAL.config.erizoController.limit_n_rooms || 20;
GLOBAL.config.erizoController.interval_time_keepAlive = GLOBAL.config.erizoController.interval_time_keepAlive || 1000;
GLOBAL.config.erizoController.report.session_events = GLOBAL.config.erizoController.report.session_events || false;
GLOBAL.config.erizoController.recording_path = GLOBAL.config.erizoController.recording_path || undefined;

// Parse command line arguments
var getopt = new Getopt([
  ['r' , 'rabbit-host=ARG'            , 'RabbitMQ Host'],
  ['g' , 'rabbit-port=ARG'            , 'RabbitMQ Port'],
  ['l' , 'logging-config-file=ARG'    , 'Logging Config File'],
  ['t' , 'stunServerUrl=ARG'          , 'Stun Server URL'],
  ['b' , 'defaultVideoBW=ARG'         , 'Default video Bandwidth'],
  ['M' , 'maxVideoBW=ARG'             , 'Max video bandwidth'],
  ['i' , 'publicIP=ARG'               , 'Erizo Controller\'s public IP'],
  ['H' , 'hostname=ARG'               , 'Erizo Controller\'s hostname'],
  ['p' , 'port'                       , 'Port used by clients to reach Erizo Controller'],
  ['S' , 'ssl'                        , 'Enable SSL for clients'],
  ['L' , 'listen_port'                , 'Port where Erizo Controller will listen to new connections.'],
  ['s' , 'listen_ssl'                 , 'Enable HTTPS in server'],
  ['T' , 'turn-url'                   , 'Turn server\'s URL.'],
  ['U' , 'turn-username'              , 'Turn server\'s username.'],
  ['P' , 'turn-password'              , 'Turn server\'s password.'],
  ['R' , 'recording_path'             , 'Recording path.'],
  ['h' , 'help'                       , 'display this help']
]);

var PUBLISHER_INITAL = 101, PUBLISHER_READY = 104;


opt = getopt.parse(process.argv.slice(2));

for (var prop in opt.options) {
    if (opt.options.hasOwnProperty(prop)) {
        var value = opt.options[prop];
        switch (prop) {
            case "help":
                getopt.showHelp();
                process.exit(0);
                break;
            case "rabbit-host":
                GLOBAL.config.rabbit = GLOBAL.config.rabbit || {};
                GLOBAL.config.rabbit.host = value;
                break;
            case "rabbit-port":
                GLOBAL.config.rabbit = GLOBAL.config.rabbit || {};
                GLOBAL.config.rabbit.port = value;
                break;
            case "logging-config-file":
                GLOBAL.config.logger = GLOBAL.config.logger || {};
                GLOBAL.config.logger.config_file = value;
                break;
            default:
                GLOBAL.config.erizoController[prop] = value;
                break;
        }
    }
}

// Load submodules with updated config
var logger = require('./../common/logger').logger;
var amqper = require('./../common/amqper');
var controller = require('./roomController');
var ecch = require('./ecch').Ecch({amqper: amqper});

// Logger
var log = logger.getLogger("ErizoController");

var server;

if (GLOBAL.config.erizoController.listen_ssl) {
    var https = require('https');
    var fs = require('fs');
    var options = {
        key: fs.readFileSync('../../cert/key.pem').toString(),
        cert: fs.readFileSync('../../cert/cert.pem').toString()
    };
    server = https.createServer(options);
} else {
    var http = require('http');
    server = http.createServer();
}

server.listen(GLOBAL.config.erizoController.listen_port);
var io = require('socket.io').listen(server, {log:false});

io.set('log level', 0);

var WARNING_N_ROOMS = GLOBAL.config.erizoController.warning_n_rooms;
var LIMIT_N_ROOMS = GLOBAL.config.erizoController.limit_n_rooms;

var INTERVAL_TIME_KEEPALIVE = GLOBAL.config.erizoController.interval_time_keepAlive;

var BINDED_INTERFACE_NAME = GLOBAL.config.erizoController.networkInterface;

var myId;
var rooms = {};
var myState;

/*
 * Sends a message of type 'type' to all sockets in a determined room.
 */
var sendMsgToRoom = function (room, type, arg) {
    "use strict";

    var sockets = room.sockets,
        id;
    for (id in sockets) {
        if (sockets.hasOwnProperty(id)) {
            log.info('Sending message to', sockets[id], 'in room ', room.id);
            io.sockets.socket(sockets[id]).emit(type, arg);
        }
    }
};

var privateRegexp;
var publicIP;

var addToCloudHandler = function (callback) {
    "use strict";

    var interfaces = require('os').networkInterfaces(),
        addresses = [],
        k,
        k2,
        address;


    for (k in interfaces) {
        if (interfaces.hasOwnProperty(k)) {
            for (k2 in interfaces[k]) {
                if (interfaces[k].hasOwnProperty(k2)) {
                    address = interfaces[k][k2];
                    if (address.family === 'IPv4' && !address.internal) {
                        if (k === BINDED_INTERFACE_NAME || !BINDED_INTERFACE_NAME) {
                            addresses.push(address.address);
                        }
                    }
                }
            }
        }
    }

    privateRegexp = new RegExp(addresses[0], 'g');

    if (GLOBAL.config.erizoController.publicIP === '' || GLOBAL.config.erizoController.publicIP === undefined){
        publicIP = addresses[0];
    } else {
        publicIP = GLOBAL.config.erizoController.publicIP;
    }

    log.debug('publicIp:', publicIP);
    myId = 42;   // FIXME: does this need to vary or can it stay hard-coded?
    myState = 2;

    callback("callback");
};


var listen = function () {
    "use strict";

    io.sockets.on('connection', function (socket) {
        log.info("Socket connect ", socket.id);

        // Gets 'token' messages on the socket.
        // Then registers it in the room and callback to the client.
        socket.on('token', function (token, callback) {

            log.debug("New token", token);

            var tokenDB = token, user, streamList = [], index;

            if (rooms[tokenDB.id] === undefined) {
                var room = {};

                room.id = tokenDB.id;
                room.sockets = [];
                room.sockets.push(socket.id);
                room.streams = {}; //streamId: Stream
                if (tokenDB.p2p) {
                    log.debug('Token of p2p room');
                    room.p2p = true;
                } else {
                    room.controller = controller.RoomController({amqper: amqper, ecch: ecch});
                    room.controller.addEventListener(function(type, event) {
                        // TODO Send message to room? Handle ErizoJS disconnection.
                        if (type === "unpublish") {
                            var streamId = parseInt(event); // It's supposed to be an integer.
                            log.info("ErizoJS stopped", streamId);
                            sendMsgToRoom(room, 'onRemoveStream', {id: streamId});
                            room.controller.removePublisher(streamId);

                            for (var s in room.sockets) {
                                var streams = io.sockets.socket(room.sockets[s]).streams;
                                var index = streams.indexOf(streamId);
                                if (index !== -1) {
                                    streams.splice(index, 1);
                                }
                            }

                            if (room.streams[streamId]) {
                                delete room.streams[streamId];
                            }
                        }

                    });
                }
                rooms[tokenDB.id] = room;
            } else {
                rooms[tokenDB.id].sockets.push(socket.id);
            }
            user = {name: "user"};
            socket.user = user;
            socket.room = rooms[tokenDB.id];
            socket.streams = []; //[list of streamIds]
            socket.state = 'sleeping';

            if (!tokenDB.p2p && GLOBAL.config.erizoController.report.session_events) {
                var timeStamp = new Date();
                amqper.broadcast('event', {room: tokenDB.id, user: socket.id, type: 'user_connection', timestamp:timeStamp.getTime()});
            }

            for (index in socket.room.streams) {
                if (socket.room.streams.hasOwnProperty(index)) {
                    if (socket.room.streams[index].status == PUBLISHER_READY){
                        streamList.push(socket.room.streams[index].getPublicStream());
                    }
                }
            }

            callback('success', {streams: streamList,
                                 id: socket.room.id,
                                 p2p: socket.room.p2p,
                                 defaultVideoBW: GLOBAL.config.erizoController.defaultVideoBW,
                                 maxVideoBW: GLOBAL.config.erizoController.maxVideoBW,
                                 stunServerUrl: GLOBAL.config.erizoController.stunServerUrl,
                                 turnServer: GLOBAL.config.erizoController.turnServer
                                });

        });

        //Gets 'sendDataStream' messages on the socket in order to write a message in a dataStream.
        socket.on('sendDataStream', function (msg) {
            if  (socket.room.streams[msg.id] === undefined){
              log.warn('Trying to send Data from a non-initialized stream ', msg);
              return;
            }
            var sockets = socket.room.streams[msg.id].getDataSubscribers(), id;
            for (id in sockets) {
                if (sockets.hasOwnProperty(id)) {
                    log.info('Sending dataStream to', sockets[id], 'in stream ', msg.id);
                    io.sockets.socket(sockets[id]).emit('onDataStream', msg);
                }
            }
        });

        socket.on('signaling_message', function (msg) {
            if (socket.room.p2p) {
                io.sockets.socket(msg.peerSocket).emit('signaling_message_peer', {streamId: msg.streamId, peerSocket: socket.id, msg: msg.msg});
            } else {
                socket.room.controller.processSignaling(msg.streamId, socket.id, msg.msg);
            }
        });

        //Gets 'updateStreamAttributes' messages on the socket in order to update attributes from the stream.
        socket.on('updateStreamAttributes', function (msg) {
            if  (socket.room.streams[msg.id] === undefined){
              log.warn('Trying to update atributes from a non-initialized stream ', msg);
              return;
            }
            var sockets = socket.room.streams[msg.id].getDataSubscribers(), id;
            socket.room.streams[msg.id].setAttributes(msg.attrs);
            for (id in sockets) {
                if (sockets.hasOwnProperty(id)) {
                    log.info('Sending new attributes to', sockets[id], 'in stream ', msg.id);
                    io.sockets.socket(sockets[id]).emit('onUpdateAttributeStream', msg);
                }
            }
        });

        // Gets 'publish' messages on the socket in order to add new stream to the room.
        // Returns callback(id, error)
        socket.on('publish', function (options, sdp, callback) {
            var id, st;
            id = Math.random() * 1000000000000000000;

            log.debug('received publish: id', id, 'state', options.state);

            if (options.state === 'url' || options.state === 'recording') {
                var url = sdp;
                if (options.state === 'recording') {
                    var recordingId = sdp;
                    if (GLOBAL.config.erizoController.recording_path) {
                        url = GLOBAL.config.erizoController.recording_path + recordingId + '.mkv';
                    } else {
                        url = '/tmp/' + recordingId + '.mkv';
                    }
                }
                socket.room.controller.addExternalInput(id, url, function (result) {
                    if (result === 'success') {
                        st = new ST.Stream({id: id, socket: socket.id, audio: options.audio, video: options.video, data: options.data, attributes: options.attributes});
                        socket.streams.push(id);
                        socket.room.streams[id] = st;
                        callback(id);
                        sendMsgToRoom(socket.room, 'onAddStream', st.getPublicStream());
                    } else {
                        callback(null, 'Error adding External Input');
                    }
                });
            } else if (options.state === 'erizo') {
                log.info("New publisher");
                
                socket.room.controller.addPublisher(id, options, function (signMess) {

                    if (signMess.type === 'initializing') {
                        callback(id);
                        st = new ST.Stream({id: id, socket: socket.id, audio: options.audio, video: options.video, data: options.data, screen: options.screen, attributes: options.attributes});
                        socket.streams.push(id);
                        socket.room.streams[id] = st;
                        st.status = PUBLISHER_INITAL;

                        if (GLOBAL.config.erizoController.report.session_events) {
                            var timeStamp = new Date();
                            amqper.broadcast('event', {room: socket.room.id, user: socket.id, name: socket.user.name, type: 'publish', stream: id, timestamp: timeStamp.getTime()});
                        }
                        return;
                    } else if (signMess.type ==='failed'){
                        log.info("IceConnection Failed on publisher, removing " , id);
                        socket.emit('connection_failed',{});
                        socket.state = 'sleeping';
                        if (!socket.room.p2p) {
                            socket.room.controller.removePublisher(id);
                            if (GLOBAL.config.erizoController.report.session_events) {
                                var timeStamp = new Date();
                                amqper.broadcast('event', {room: socket.room.id, user: socket.id, type: 'failed', stream: id, sdp: signMess.sdp, timestamp: timeStamp.getTime()});
                            }
                        }

                        var index = socket.streams.indexOf(id);
                        if (index !== -1) {
                            socket.streams.splice(index, 1);
                        }
                        return;
                    } else if (signMess.type === 'ready') {
                        st.status = PUBLISHER_READY;
                        sendMsgToRoom(socket.room, 'onAddStream', st.getPublicStream());
                    } else if (signMess === 'timeout') {
                        callback(undefined, 'No ErizoAgents available');
                    }

                    socket.emit('signaling_message_erizo', {mess: signMess, streamId: id});
                });
            } else {
                st = new ST.Stream({id: id, socket: socket.id, audio: options.audio, video: options.video, data: options.data, screen: options.screen, attributes: options.attributes});
                socket.streams.push(id);
                socket.room.streams[id] = st;
                st.status = PUBLISHER_READY;
                callback(id);
                sendMsgToRoom(socket.room, 'onAddStream', st.getPublicStream());
            }
        });

        //Gets 'subscribe' messages on the socket in order to add new subscriber to a determined stream (options.streamId).
        // Returns callback(result, error)
        socket.on('subscribe', function (options, sdp, callback) {
            //log.info("Subscribing", options, callback);

            var stream = socket.room.streams[options.streamId];

            if (stream === undefined) {
                return;
            }

            if (stream.hasData() && options.data !== false) {
                stream.addDataSubscriber(socket.id);
            }

            if (stream.hasAudio() || stream.hasVideo() || stream.hasScreen()) {

                if (socket.room.p2p) {
                    var s = stream.getSocket();
                    io.sockets.socket(s).emit('publish_me', {streamId: options.streamId, peerSocket: socket.id});

                } else {
                    socket.room.controller.addSubscriber(socket.id, options.streamId, options, function (signMess) {

                        if (signMess.type === 'initializing') {
                            log.info("Initializing subscriber");
                            callback(true);

                            if (GLOBAL.config.erizoController.report.session_events) {
                                var timeStamp = new Date();
                                amqper.broadcast('event', {room: socket.room.id, user: socket.id, name: socket.user.name, type: 'subscribe', stream: options.streamId, timestamp: timeStamp.getTime()});
                            }
                            return;
                        }
                        if(signMess.type==='bandwidthAlert'){
                          socket.emit('onBandwidthAlert', {streamID:options.streamId, message:signMess.message, bandwidth: signMess.bandwidth});
                        }

                        // if (signMess.type === 'candidate') {
                        //     signMess.candidate = signMess.candidate.replace(privateRegexp, publicIP);
                        // }
                        socket.emit('signaling_message_erizo', {mess: signMess, peerId: options.streamId});
                    });

                    log.info("Subscriber added");
                }
            } else {
                callback(true);
            }

        });

        // Gets 'startRecorder' messages
        // Returns callback(id, error)
        socket.on('startRecorder', function (options, callback) {
            var streamId = options.to;
<<<<<<< HEAD
            var recordingId = socket.room.id;
=======

	    // use recording ID instead of random number
            var recordingId = options.recordingId;

>>>>>>> Modify Licode to use the room name as the room id as a way to control the recording Id
            var url;

            if (GLOBAL.config.erizoController.recording_path) {
                url = GLOBAL.config.erizoController.recording_path + recordingId + '.mkv';
            } else {
                url = '/tmp/' + recordingId + '.mkv';
            }

            log.info("erizoController.js: Starting recorder streamID " + streamId + "url ", url);

            if (socket.room.streams[streamId].hasAudio() || socket.room.streams[streamId].hasVideo() || socket.room.streams[streamId].hasScreen()) {
                socket.room.controller.addExternalOutput(streamId, url, function (result) {
                    if (result === 'success') {
                        log.info("erizoController.js: Recorder Started");
                        callback(recordingId);
                    } else {
                        callback(null, 'This stream is not published in this room');
                    }
                });

            } else {
                callback(null, 'Stream can not be recorded');
            }
        });
        
        // Gets 'stopRecorder' messages
        // Returns callback(result, error)
        socket.on('stopRecorder', function (options, callback) {
            var recordingId = options.id;
            var url;

            if (GLOBAL.config.erizoController.recording_path) {
                url = GLOBAL.config.erizoController.recording_path + recordingId + '.mkv';
            } else {
                url = '/tmp/' + recordingId + '.mkv';
            }

            log.info("erizoController.js: Stoping recording  " + recordingId + " url " + url);
            socket.room.controller.removeExternalOutput(url, callback);

	    var sessionToken = recordingId;
            log.info("erizoController.js: affdex.saveVideo " + recordingId);
	
            affdex.saveVideo(sessionToken, url, function(err, data) {
		log.info('saveVideo callback');
		log.info(data);
	    });

        });

        //Gets 'unpublish' messages on the socket in order to remove a stream from the room.
        // Returns callback(result, error)
        socket.on('unpublish', function (streamId, callback) {
            // Stream has been already deleted or it does not exist
            if (socket.room.streams[streamId] === undefined) {
                return;
            }
            var i, index;

            sendMsgToRoom(socket.room, 'onRemoveStream', {id: streamId});

            if (socket.room.streams[streamId].hasAudio() || socket.room.streams[streamId].hasVideo() || socket.room.streams[streamId].hasScreen()) {
                socket.state = 'sleeping';
                if (!socket.room.p2p) {
                    socket.room.controller.removePublisher(streamId);
                    if (GLOBAL.config.erizoController.report.session_events) {
                        var timeStamp = new Date();
                        amqper.broadcast('event', {room: socket.room.id, user: socket.id, type: 'unpublish', stream: streamId, timestamp: timeStamp.getTime()});
                    }
                }
            }

            index = socket.streams.indexOf(streamId);
            if (index !== -1) {
                socket.streams.splice(index, 1);
            }
            if (socket.room.streams[streamId]) {
                delete socket.room.streams[streamId];
            }
            callback(true);
        });

        //Gets 'unsubscribe' messages on the socket in order to remove a subscriber from a determined stream (to).
        // Returns callback(result, error)
        socket.on('unsubscribe', function (to, callback) {
            if (socket.room.streams[to] === undefined) {
                return;
            }

            socket.room.streams[to].removeDataSubscriber(socket.id);

            if (socket.room.streams[to].hasAudio() || socket.room.streams[to].hasVideo() || socket.room.streams[to].hasScreen()) {
                if (!socket.room.p2p) {
                    socket.room.controller.removeSubscriber(socket.id, to);
                    if (GLOBAL.config.erizoController.report.session_events) {
                        var timeStamp = new Date();
                        amqper.broadcast('event', {room: socket.room.id, user: socket.id, type: 'unsubscribe', stream: to, timestamp:timeStamp.getTime()});
                    }
                };
            }
            callback(true);
        });

        //When a client leaves the room erizoController removes its streams from the room if exists.
        socket.on('disconnect', function () {
            var i, index, id;

            log.info('Socket disconnect ', socket.id);

            for (i in socket.streams) {
                if (socket.streams.hasOwnProperty(i)) {
                    sendMsgToRoom(socket.room, 'onRemoveStream', {id: socket.streams[i]});
                }
            }

            if (socket.room !== undefined) {

                for (i in socket.room.streams) {
                    if (socket.room.streams.hasOwnProperty(i)) {
                        socket.room.streams[i].removeDataSubscriber(socket.id);
                    }
                }

                index = socket.room.sockets.indexOf(socket.id);
                if (index !== -1) {
                    socket.room.sockets.splice(index, 1);
                }

                if (socket.room.controller) {
                    socket.room.controller.removeSubscriptions(socket.id);
                }

                for (i in socket.streams) {
                    if (socket.streams.hasOwnProperty(i)) {
                        id = socket.streams[i];
                        if( socket.room.streams[id]) {
                            if (socket.room.streams[id].hasAudio() || socket.room.streams[id].hasVideo() || socket.room.streams[id].hasScreen()) {
                                if (!socket.room.p2p) {
                                    socket.room.controller.removePublisher(id);
                                    if (GLOBAL.config.erizoController.report.session_events) {
                                        var timeStamp = new Date();
                                        amqper.broadcast('event', {room: socket.room.id, user: socket.id, type: 'unpublish', stream: id, timestamp: timeStamp.getTime()});
                                    }
                                }
                            }

                            delete socket.room.streams[id];
                        }
                    }
                }
            }

            if (socket.room !== undefined && !socket.room.p2p && GLOBAL.config.erizoController.report.session_events) {
                var timeStamp = new Date();
                amqper.broadcast('event', {room: socket.room.id, user: socket.id, type: 'user_disconnection', timestamp: timeStamp.getTime()});
            }

            if (socket.room !== undefined && socket.room.sockets.length === 0) {
                log.info('Empty room ', socket.room.id, '. Deleting it');
                delete rooms[socket.room.id];
            }
        });
    });
};


amqper.connect(function () {
    "use strict";
    try {
        addToCloudHandler(function () {
            var rpcID = 'erizoController_' + myId;

            amqper.bind(rpcID, listen);

        });
    } catch (error) {
        log.info("Error in Erizo Controller: ", error);
    }
});
