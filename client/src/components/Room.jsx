import React, { useEffect, useState } from 'react';
import { useMediasoup } from '../hooks/useMediasoup';
import { Video } from './Video';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Share2 } from 'lucide-react';

export const Room = ({ roomId, onLeave }) => {
    const {
        initialize,
        joinRoom,
        localStream,
        remoteStreams,
        connectionState,
        toggleMic,
        toggleCam,
        shareScreen
    } = useMediasoup(roomId);

    const [isMicOn, setIsMicOn] = useState(true);
    const [isCamOn, setIsCamOn] = useState(true);

    useEffect(() => {
        initialize().then(() => {
            joinRoom();
        });
    }, []);

    const handleToggleMic = () => {
        toggleMic();
        setIsMicOn(!isMicOn);
    };

    const handleToggleCam = () => {
        toggleCam();
        setIsCamOn(!isCamOn);
    };

    if (connectionState !== 'joined') {
        return (
            <div className="loading-screen">
                <div className="text-xl">Connecting to Room {roomId}...</div>
            </div>
        );
    }

    return (
        <div className="room-container">
            <header className="room-header">
                <h1 className="room-title">Room: {roomId}</h1>
            </header>

            <div className="video-grid">
                {/* Local Video */}
                {localStream && (
                    <Video stream={localStream} isLocal={true} />
                )}

                {/* Remote Videos */}
                {Array.from(remoteStreams.entries()).map(([socketId, stream]) => (
                    <Video key={socketId} stream={stream} isLocal={false} />
                ))}
            </div>

            {/* Control Bar */}
            <div className="control-bar">
                <button
                    onClick={handleToggleMic}
                    className={`control-btn ${isMicOn ? 'active' : 'inactive'}`}
                >
                    {isMicOn ? <Mic /> : <MicOff />}
                </button>

                <button
                    onClick={handleToggleCam}
                    className={`control-btn ${isCamOn ? 'active' : 'inactive'}`}
                >
                    {isCamOn ? <VideoIcon /> : <VideoOff />}
                </button>

                <button
                    className="control-btn screen-share-btn"
                    onClick={shareScreen}
                >
                    <Share2 />
                </button>

                <button
                    onClick={onLeave}
                    className="control-btn leave-btn"
                >
                    <PhoneOff />
                </button>
            </div>
        </div>
    );
};
