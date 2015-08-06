var serverUrl = "/";
var localStream, room, recording, recordingId;

function testConnection () {
  window.location = "/connection_test.html";
}

function startRecording () {
  if (room !== undefined){
    if (!recording){
      room.startRecording(localStream, function(id) {
        recording = true;
        recordingId = id;
      });

    } else {
      room.stopRecording(recordingId);
      recording = false;
    }
  }
}

window.onload = function () {
  recording = false;
  var config = {audio: true, video: true, data: true, screen: false, videoSize: [640, 480, 640, 480]};
  localStream = Erizo.Stream(config);

  var token = JSON.stringify({
    "room": "basicExampleRoom",
    "host": "192.168.33.99:8080",  // FIXME: needs to come from the server
    "secure": false
  });
  console.log(token);
  room = Erizo.Room({token: token});

  localStream.addEventListener("access-accepted", function () {
    var subscribeToStreams = function (streams) {
      for (var index in streams) {
        var stream = streams[index];
        if (localStream.getID() !== stream.getID()) {
          room.subscribe(stream);
        }
      }
    };

    room.addEventListener("room-connected", function (roomEvent) {
      room.publish(localStream, {maxVideoBW: 3000, minVideoBW:500});
      subscribeToStreams(roomEvent.streams);
    });

    room.addEventListener("stream-subscribed", function(streamEvent) {
      var stream = streamEvent.stream;
      var div = document.createElement('div');
      div.setAttribute("style", "width: 320px; height: 240px;");
      div.setAttribute("id", "test" + stream.getID());

      document.body.appendChild(div);
      stream.show("test" + stream.getID());

    });

    room.addEventListener("stream-added", function (streamEvent) {
      var streams = [];
      streams.push(streamEvent.stream);
      subscribeToStreams(streams);
      document.getElementById("recordButton").disabled = false;
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
      console.log("STREAM FAILED, DISCONNECTION");
      room.disconnect();

    });

    room.connect();

    localStream.show("myVideo");

  });
  localStream.init();
};

// Local Variables:
// js-indent-level: 2
// indent-tabs-mode: nil
// End:
