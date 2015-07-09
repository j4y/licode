var serverUrl = "/";
var localStream, room, recording,
    sessionId = Math.random() * 1000;  // FIXME: get sessionId from somewhere

function testConnection () {
  window.location = "/connection_test.html";
}

function startRecording () {
  if (room !== undefined){
    if (!recording){
      room.startRecording(localStream, recordingId, function(id) {
        recording = true;
      });
    } else {
      room.stopRecording();
      recording = false;
    }
  }
}

window.onload = function () {
  recording = false;
  var config = {audio: true, video: true, data: true, screen: false, videoSize: [640, 480, 640, 480]};
  localStream = Erizo.Stream(config);

  var token = JSON.stringify({
    "id": "session-" + sessionId,
    "host": "192.168.33.99:8080",  // FIXME: needs to come from the server
    "secure": false
  });
  room = Erizo.Room({token: token});
  room.addEventListener("room-connected", function (roomEvent) {
    room.publish(localStream, {maxVideoBW: 3000, minVideoBW:500});
    document.getElementById("recordButton").disabled = false;
  });
  room.addEventListener("stream-failed", function (streamEvent){
    console.log("STREAM FAILED, DISCONNECTION");
    room.disconnect();
  });

  localStream.addEventListener("access-accepted", function () {
    localStream.show("myVideo");

    room.connect();
  });

  localStream.init();
};

// Local Variables:
// js-indent-level: 2
// indent-tabs-mode: nil
// End:
