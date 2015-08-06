var serverUrl = "/";
var localStream, room;

function printText(text) {
  document.getElementById('messages').value += '- ' + text + '\n';
}

window.onload = function () {
  var config = {audio: true, video: true, data: true, videoSize: [640, 480, 640, 480]};
  localStream = Erizo.Stream(config);
  var token = JSON.stringify({
    "room": "basicExampleRoom",
    "host": "192.168.33.99:8080",  // FIXME: needs to come from the server
    "secure": false
  });
  console.log(token);
  room = Erizo.Room({token: token});

  localStream.addEventListener("access-accepted", function () {
    printText('Mic and Cam OK');
    var subscribeToStreams = function (streams) {
      for (var index in streams) {
        var stream = streams[index];
        room.subscribe(stream);
      }
    };

    room.addEventListener("room-connected", function (roomEvent) {
      printText('Connected to the room OK');
      room.publish(localStream, {maxVideoBW: 300});
    });

    room.addEventListener("stream-subscribed", function(streamEvent) {
      printText('Subscribed to your local stream OK');
      var stream = streamEvent.stream;
      stream.show("my_subscribed_video");
    });

    room.addEventListener("stream-added", function (streamEvent) {
      printText('Local stream published OK');
      var streams = [];
      streams.push(streamEvent.stream);
      subscribeToStreams(streams);
    });

    room.addEventListener("stream-removed", function (streamEvent) {
      // Remove stream from DOM
      var stream = streamEvent.stream;
      if (stream.elementID !== undefined) {
        var element = document.getElementById(stream.elementID);
        document.body.removeChild(element);
      }
    });

    room.addEventListener("stream-failed", function (streamEvent){
      printText('STREAM FAILED, DISCONNECTION');
      room.disconnect();
    });

    room.connect();

    localStream.show("my_local_video");

  });
  localStream.init();
};

// Local Variables:
// js-indent-level: 2
// indent-tabs-mode: nil
// End:
