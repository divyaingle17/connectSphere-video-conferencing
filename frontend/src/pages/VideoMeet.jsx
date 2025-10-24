import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from "socket.io-client";
import { Badge, IconButton, TextField, Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import ChatIcon from '@mui/icons-material/Chat';
import styles from "../styles/videoComponent.module.css";
import server from '../environment';

const server_url = server;
var connections = {};

const peerConfigConnections = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function VideoMeetComponent() {
  const socketRef = useRef();
  const socketIdRef = useRef();
  const localVideoref = useRef();
  const videoRef = useRef([]);

  const [videoAvailable, setVideoAvailable] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [video, setVideo] = useState([]);
  const [audio, setAudio] = useState();
  const [screen, setScreen] = useState();
  const [showModal, setModal] = useState(true);
  const [screenAvailable, setScreenAvailable] = useState();
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [newMessages, setNewMessages] = useState(0);
  const [askForUsername, setAskForUsername] = useState(true);
  const [username, setUsername] = useState("");
  const [videos, setVideos] = useState([]);

  // ---------------------- Permissions ----------------------
  const getPermissions = useCallback(async () => {
    try {
      const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true });
      setVideoAvailable(!!videoPermission);

      const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioAvailable(!!audioPermission);

      setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);

      if (videoAvailable || audioAvailable) {
        const userMediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoAvailable,
          audio: audioAvailable
        });
        window.localStream = userMediaStream;
        if (localVideoref.current) localVideoref.current.srcObject = userMediaStream;
      }
    } catch (error) {
      console.log(error);
    }
  }, [videoAvailable, audioAvailable]);

  useEffect(() => {
    getPermissions();
  }, [getPermissions]);

  // ---------------------- User Media ----------------------
  const getUserMediaSuccess = useCallback((stream) => {
    try {
      window.localStream.getTracks().forEach(track => track.stop());
    } catch (e) { }

    window.localStream = stream;
    localVideoref.current.srcObject = stream;

    for (let id in connections) {
      if (id === socketIdRef.current) continue;

      connections[id].addStream(window.localStream);
      connections[id].createOffer().then((description) => {
        connections[id].setLocalDescription(description)
          .then(() => {
            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
          })
          .catch(e => console.log(e));
      });
    }

    stream.getTracks().forEach(track => track.onended = () => {
      setVideo(false);
      setAudio(false);
      try {
        localVideoref.current.srcObject.getTracks().forEach(track => track.stop());
      } catch (e) { }

      const blackSilence = (...args) => new MediaStream([black(...args), silence()]);
      window.localStream = blackSilence();
      localVideoref.current.srcObject = window.localStream;

      for (let id in connections) {
        connections[id].addStream(window.localStream);
        connections[id].createOffer().then((description) => {
          connections[id].setLocalDescription(description)
            .then(() => {
              socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
            })
            .catch(e => console.log(e));
        });
      }
    });
  }, []);

  const getUserMedia = useCallback(() => {
    if ((video && videoAvailable) || (audio && audioAvailable)) {
      navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
        .then(getUserMediaSuccess)
        .catch((e) => console.log(e));
    }
  }, [video, audio, videoAvailable, audioAvailable, getUserMediaSuccess]);

  useEffect(() => {
    if (video !== undefined && audio !== undefined) {
      getUserMedia();
    }
  }, [video, audio, getUserMedia]);

  // ---------------------- Screen Share ----------------------
  const getDislayMediaSuccess = useCallback((stream) => {
    try {
      window.localStream.getTracks().forEach(track => track.stop());
    } catch (e) { }

    window.localStream = stream;
    localVideoref.current.srcObject = stream;

    for (let id in connections) {
      if (id === socketIdRef.current) continue;

      connections[id].addStream(window.localStream);
      connections[id].createOffer().then(description => {
        connections[id].setLocalDescription(description).then(() => {
          socketRef.current.emit('signal', id, JSON.stringify({ sdp: connections[id].localDescription }));
        }).catch(e => console.log(e));
      });
    }

    stream.getTracks().forEach(track => track.onended = () => {
      setScreen(false);
      getUserMedia();
    });
  }, [getUserMedia]);

  const getDislayMedia = useCallback(() => {
    if (screen) {
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        .then(getDislayMediaSuccess)
        .catch(e => console.log(e));
    }
  }, [screen, getDislayMediaSuccess]);

  useEffect(() => {
    getDislayMedia();
  }, [getDislayMedia]);

  // ---------------------- Video/Audio Controls ----------------------
  const handleVideo = () => setVideo(!video);
  const handleAudio = () => setAudio(!audio);
  const handleScreen = () => setScreen(!screen);

  const handleEndCall = () => {
    try {
      localVideoref.current.srcObject.getTracks().forEach(track => track.stop());
    } catch (e) { }
    window.location.href = "/";
  };

  // ---------------------- Chat ----------------------
  const addMessage = (data, sender, socketIdSender) => {
    setMessages(prev => [...prev, { sender, data }]);
    if (socketIdSender !== socketIdRef.current) {
      setNewMessages(prev => prev + 1);
    }
  };

  const sendMessage = () => {
    socketRef.current.emit('chat-message', message, username);
    setMessage("");
  };

  // ---------------------- Socket Connection ----------------------
  const connectToSocketServer = useCallback(() => {
    socketRef.current = io.connect(server_url, { secure: false });

    socketRef.current.on('signal', (fromId, message) => {
      const signal = JSON.parse(message);
      if (fromId !== socketIdRef.current) {
        if (signal.sdp) {
          connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
            if (signal.sdp.type === 'offer') {
              connections[fromId].createAnswer().then(description => {
                connections[fromId].setLocalDescription(description).then(() => {
                  socketRef.current.emit('signal', fromId, JSON.stringify({ sdp: connections[fromId].localDescription }));
                });
              });
            }
          });
        }
        if (signal.ice) {
          connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e));
        }
      }
    });

    socketRef.current.on('connect', () => {
      socketRef.current.emit('join-call', window.location.href);
      socketIdRef.current = socketRef.current.id;
      socketRef.current.on('chat-message', addMessage);
    });
  }, []);

  const getMedia = () => {
    setVideo(videoAvailable);
    setAudio(audioAvailable);
    connectToSocketServer();
  };

  const connect = () => {
    setAskForUsername(false);
    getMedia();
  };

  // ---------------------- Helper Functions ----------------------
  const silence = () => {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    ctx.resume();
    return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
  };

  const black = ({ width = 640, height = 480 } = {}) => {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext('2d').fillRect(0, 0, width, height);
    const stream = canvas.captureStream();
    return Object.assign(stream.getVideoTracks()[0], { enabled: false });
  };

  // ---------------------- JSX ----------------------
  return (
    <div>
      {askForUsername ? (
        <div>
          <h2>Enter Lobby</h2>
          <TextField label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
          <Button variant="contained" onClick={connect}>Connect</Button>
          <video ref={localVideoref} autoPlay muted></video>
        </div>
      ) : (
        <div className={styles.meetVideoContainer}>
          {showModal && (
            <div className={styles.chatRoom}>
              <div className={styles.chatContainer}>
                <h1>Chat</h1>
                <div className={styles.chattingDisplay}>
                  {messages.length ? messages.map((item, i) => (
                    <div key={i} style={{ marginBottom: "20px" }}>
                      <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                      <p>{item.data}</p>
                    </div>
                  )) : <p>No Messages Yet</p>}
                </div>
                <div className={styles.chattingArea}>
                  <TextField value={message} onChange={e => setMessage(e.target.value)} label="Enter Your Chat" variant="outlined" />
                  <Button variant="contained" onClick={sendMessage}>Send</Button>
                </div>
              </div>
            </div>
          )}
          <div className={styles.buttonContainers}>
            <IconButton onClick={handleVideo} style={{ color: "white" }}>{video ? <VideocamIcon /> : <VideocamOffIcon />}</IconButton>
            <IconButton onClick={handleEndCall} style={{ color: "red" }}><CallEndIcon /></IconButton>
            <IconButton onClick={handleAudio} style={{ color: "white" }}>{audio ? <MicIcon /> : <MicOffIcon />}</IconButton>
            {screenAvailable && <IconButton onClick={handleScreen} style={{ color: "white" }}>{screen ? <ScreenShareIcon /> : <StopScreenShareIcon />}</IconButton>}
            <Badge badgeContent={newMessages} max={999} color='orange'>
              <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>
          <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>
          <div className={styles.conferenceView}>
            {videos.map(video => (
              <div key={video.socketId}>
                <video
                  data-socket={video.socketId}
                  ref={ref => { if (ref && video.stream) ref.srcObject = video.stream; }}
                  autoPlay
                ></video>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
